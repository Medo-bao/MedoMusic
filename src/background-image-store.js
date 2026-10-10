const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const DEFAULTS = Object.freeze({ image: null, name: '', clarity: 30, blur: 7.5, opacity: 90, material: 'frosted' });

function createBackgroundImageStore(directory, nativeImage) {
  const imageDirectory = path.join(directory, 'backgrounds');
  const settingsFile = path.join(directory, 'background-image.json');
  const clamp = (value, fallback, maximum, precision = 1) => Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(maximum, value)) * precision) / precision : fallback;
  const normalize = (value = {}) => ({
    image: typeof value.image === 'string' && /^[a-f0-9]{64}\.png$/.test(value.image) ? value.image : null,
    name: typeof value.name === 'string' ? value.name : '',
    clarity: clamp(value.clarity, DEFAULTS.clarity, 100),
    blur: clamp(value.blur, DEFAULTS.blur, 15, 100),
    opacity: clamp(value.opacity, DEFAULTS.opacity, 100),
    material: value.material === 'transparent' ? 'transparent' : 'frosted'
  });
  let settings;
  let selection = null;
  let pending = Promise.resolve();
  const loaded = fs.readFile(settingsFile, 'utf8').then(async text => {
    settings = normalize(JSON.parse(text));
    await removeUnusedImages();
  }).catch(() => { settings = { ...DEFAULTS }; });

  async function removeUnusedImages() {
    try {
      const entries = await fs.readdir(imageDirectory, { withFileTypes: true });
      for (const entry of entries) {
        // Only remove this store's flat, generated PNG files after a successful
        // settings load/save. Never follow directories or links in the cache.
        if (entry.isFile() && /^[a-f0-9]{64}\.png$/.test(entry.name) && entry.name !== settings.image) {
          await fs.unlink(path.join(imageDirectory, entry.name));
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Unused background image cleanup failed:', error.message);
    }
  }

  async function snapshot() {
    await loaded;
    let imageUrl = null;
    if (settings.image) {
      const imagePath = path.join(imageDirectory, settings.image);
      try { await fs.access(imagePath); imageUrl = pathToFileURL(imagePath).href; } catch {}
    }
    return { ...settings, imageUrl };
  }

  function enqueue(action) {
    const result = pending.then(async () => { await loaded; return action(); });
    pending = result.catch(() => {});
    return result;
  }

  async function save(next) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(`${settingsFile}.tmp`, JSON.stringify(next, null, 2));
    await fs.rename(`${settingsFile}.tmp`, settingsFile);
    settings = next;
    return snapshot();
  }

  return {
    get: snapshot,
    choose: async filePath => {
      const source = await fs.readFile(filePath);
      const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp' };
      const type = types[path.extname(filePath).toLowerCase()];
      if (!type) throw new Error('不支持的图片格式');
      selection = { token: crypto.randomUUID(), name: path.basename(filePath) };
      return { ...selection, dataUrl: `data:${type};base64,${source.toString('base64')}` };
    },
    apply: values => enqueue(async () => {
      if (!selection || values?.token !== selection.token || typeof values.png !== 'string') throw new Error('图片选择已失效');
      let image = nativeImage.createFromBuffer(Buffer.from(values.png, 'base64'));
      if (image.isEmpty()) throw new Error('无法读取这张图片');
      const size = image.getSize();
      const scale = Math.min(1, 4096 / Math.max(size.width, size.height));
      if (scale < 1) image = image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), quality: 'best' });
      const bitmap = image.toPNG();
      const name = `${crypto.createHash('sha256').update(bitmap).digest('hex')}.png`;
      await fs.mkdir(imageDirectory, { recursive: true });
      await fs.writeFile(path.join(imageDirectory, name), bitmap);
      const result = await save({ ...settings, image: name, name: selection.name });
      selection = null;
      await removeUnusedImages();
      return result;
    }),
    update: values => enqueue(() => save(normalize({
      ...settings,
      clarity: values?.clarity ?? settings.clarity,
      blur: values?.blur ?? settings.blur,
      opacity: values?.opacity ?? settings.opacity,
      material: values?.material ?? settings.material
    }))),
    reset: () => enqueue(async () => {
      const result = await save({ ...DEFAULTS });
      await removeUnusedImages();
      return result;
    })
  };
}

module.exports = { createBackgroundImageStore };
