const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBackgroundImageStore } = require('../src/background-image-store');

async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'medo-background-store-'));
  const file = path.join(directory, 'background-image.json');
  try {
    assert.deepEqual(await createBackgroundImageStore(directory).get(), { image: null, name: '', imageUrl: null, clarity: 30, blur: 7.5, opacity: 90, material: 'frosted' });
    await fs.writeFile(file, JSON.stringify({ image: null, name: '', clarity: 91, blur: 7 }));
    const store = createBackgroundImageStore(directory);
    const migrated = await store.get();
    assert.equal(migrated.opacity, 90); assert.equal(migrated.material, 'frosted');
    assert.equal(migrated.clarity, 91); assert.equal(migrated.blur, 7);
    await store.update({ opacity: 27, material: 'transparent' });
    await store.update({ blur: 3 });
    const reopened = await createBackgroundImageStore(directory).get();
    assert.deepEqual(reopened, { image: null, name: '', imageUrl: null, clarity: 91, blur: 3, opacity: 27, material: 'transparent' });
    await Promise.all([store.update({ opacity: 10 }), store.update({ opacity: 80 }), store.update({ material: 'frosted' })]);
    const latest = await createBackgroundImageStore(directory).get();
    assert.equal(latest.opacity, 80); assert.equal(latest.material, 'frosted');
    assert.equal(latest.clarity, 91); assert.equal(latest.blur, 3);
    await store.update({ blur: .15 });
    assert.equal((await createBackgroundImageStore(directory).get()).blur, .15);
    await store.update({ blur: 14.85 });
    assert.equal((await createBackgroundImageStore(directory).get()).blur, 14.85);
    await store.update({ opacity: 0 });
    assert.equal((await createBackgroundImageStore(directory).get()).opacity, 0);
    await store.update({ opacity: 100 });
    assert.equal((await createBackgroundImageStore(directory).get()).opacity, 100);
    await store.reset();
    assert.deepEqual(await createBackgroundImageStore(directory).get(), { image: null, name: '', imageUrl: null, clarity: 30, blur: 7.5, opacity: 90, material: 'frosted' });
    const images = path.join(directory, 'backgrounds');
    await fs.mkdir(images);
    const active = `${'a'.repeat(64)}.png`, stale = `${'b'.repeat(64)}.png`;
    await fs.writeFile(path.join(images, active), 'active fixture');
    await fs.writeFile(path.join(images, stale), 'old fixture');
    await fs.writeFile(path.join(images, 'keep.txt'), 'unmanaged file');
    await fs.mkdir(path.join(images, `${'c'.repeat(64)}.png`));
    await fs.writeFile(file, JSON.stringify({ image: active, blur: 7 }));
    const cached = createBackgroundImageStore(directory);
    assert.equal((await cached.get()).image, active);
    assert.deepEqual((await fs.readdir(images)).sort(), [active, `${'c'.repeat(64)}.png`, 'keep.txt'].sort());
    await cached.reset();
    assert.deepEqual((await fs.readdir(images)).sort(), [`${'c'.repeat(64)}.png`, 'keep.txt'].sort());
    await fs.writeFile(path.join(images, active), 'preserve on corrupt settings');
    await fs.writeFile(file, '{broken json');
    await createBackgroundImageStore(directory).get();
    assert.equal(await fs.readFile(path.join(images, active), 'utf8'), 'preserve on corrupt settings');
    console.log('Background settings passed: legacy values, fractional blur, ordered persistence, endpoints, reset and scoped cache cleanup');
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
