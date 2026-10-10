window.MedoGlassBackground = {
  create({ onChange, updateRange }) {
    const root = document.documentElement;
    const layer = document.querySelector('#glass-background');
    const tint = layer.querySelector('.glass-background-tint');
    const image = layer.querySelector('img');
    const preview = document.querySelector('#background-image-preview');
    const choose = document.querySelector('#choose-background-image');
    const reset = document.querySelector('#reset-background-image');
    const clarity = document.querySelector('#background-image-clarity');
    const blur = document.querySelector('#background-image-blur');
    const transparency = document.querySelector('#background-transparency');
    const materials = [...document.querySelectorAll('[data-background-material-value]')];
    const status = document.querySelector('#background-image-status');
    const defaults = { image: null, imageUrl: null, name: '', clarity: 30, blur: 7.5, opacity: 90, material: 'frosted' };
    let settings = { ...defaults };
    let saved = settings;
    let revision = 0;
    let savedRevision = 0;
    let loading = true;
    let restoreFailed = false;
    let busy = false;

    function controls() {
      const available = Boolean(settings.imageUrl);
      choose.disabled = busy || loading;
      choose.textContent = loading ? '正在恢复背景…' : busy ? '正在处理图片…' : available ? '更换图片' : '选择图片';
      reset.disabled = busy || loading || (!restoreFailed && !settings.image && settings.clarity === defaults.clarity && settings.blur === defaults.blur && settings.opacity === defaults.opacity && settings.material === defaults.material);
      clarity.disabled = blur.disabled = transparency.disabled = busy || loading;
      clarity.value = settings.clarity;
      const blurPercent = Math.round(settings.blur / 15 * 100);
      blur.value = blurPercent;
      const transparencyPercent = 100 - settings.opacity;
      transparency.value = transparencyPercent;
      updateRange(clarity, settings.clarity / 100);
      updateRange(blur, blurPercent / 100);
      updateRange(transparency, transparencyPercent / 100);
      document.querySelector('#background-image-clarity-value').textContent = `${settings.clarity}%`;
      document.querySelector('#background-image-blur-value').textContent = `${blurPercent}%`;
      document.querySelector('#background-transparency-value').textContent = `${transparencyPercent}%`;
      clarity.setAttribute('aria-valuetext', `${settings.clarity}%`);
      blur.setAttribute('aria-valuetext', `${blurPercent}%`);
      transparency.setAttribute('aria-valuetext', `${transparencyPercent}%`);
      for (const button of materials) {
        const selected = button.dataset.backgroundMaterialValue === settings.material;
        button.disabled = busy || loading;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-checked', String(selected));
      }
      preview.hidden = !available;
      document.querySelector('#background-image-placeholder').hidden = available;
      if (available) preview.src = settings.imageUrl;
      else preview.removeAttribute('src');
      document.querySelector('#background-image-name').textContent = available ? settings.name : '默认染色';
      document.querySelector('#background-image-name').title = available ? settings.name : '';
    }

    function apply(next) {
      settings = { ...defaults, ...next };
      const backgroundCoverage = settings.opacity / 100;
      root.style.setProperty('--background-coverage', String(backgroundCoverage));
      const available = Boolean(settings.imageUrl);
      const source = available ? 'image' : 'theme';
      const changed = root.dataset.glassBackground !== source;
      if (changed) root.dataset.glassBackground = source;
      tint.hidden = available;
      image.hidden = !available;
      if (available && image.getAttribute('src') !== settings.imageUrl) image.src = settings.imageUrl;
      if (!available) image.removeAttribute('src');
      // The tint and image base share the CSS coverage, leaving more room for
      // the native desktop without changing artwork or control opacity.
      const highClarity = Math.max(0, (settings.clarity - 80) / 20);
      tint.style.setProperty('--default-tint-strength', `${settings.clarity * .16 + highClarity * 14}%`);
      tint.style.filter = image.style.filter = `blur(${settings.blur}px)`;
      // Clarity mixes the picture with its neutral base. CSS applies coverage
      // once to that entire plane, so neither slider can saturate the other.
      const imageOpacity = settings.clarity / 100 * .8 + highClarity * .15;
      image.style.opacity = String(imageOpacity);
      image.style.setProperty('--background-overscan', `${settings.blur * 3}px`);
      controls();
      if (changed) onChange();
    }

    async function prepare(next) {
      if (next.imageUrl) {
        const ready = new Image();
        ready.src = next.imageUrl;
        try { await ready.decode(); }
        catch { return { ...next, imageUrl: null }; }
      }
      return next;
    }

    async function action(operation, failureMessage) {
      if (loading || busy) return;
      const token = ++revision;
      busy = true;
      controls();
      status.textContent = '';
      try {
        let next = await operation();
        if (next && token === revision) {
          next = await prepare(next);
          if (token === revision) {
            saved = next;
            savedRevision = token;
            restoreFailed = Boolean(next.image && !next.imageUrl);
            apply(next);
            status.textContent = restoreFailed ? '背景图片已不可用，请重新选择或恢复默认。' : next.imageUrl ? '图片染色已应用，桌面透视继续保留。' : '已恢复默认染色。';
          }
        }
      } catch {
        if (token === revision) status.textContent = failureMessage;
      } finally {
        if (token === revision) { busy = false; controls(); }
      }
    }

    async function saveAdjustments() {
      if (loading || busy) return;
      const token = ++revision;
      const imageUrl = settings.imageUrl;
      status.textContent = '正在保存…';
      try {
        const next = await window.medo.setBackgroundImageSettings({ clarity: settings.clarity, blur: settings.blur, opacity: settings.opacity, material: settings.material });
        if (token > savedRevision) {
          saved = { ...next, imageUrl };
          savedRevision = token;
        }
        if (token === revision) status.textContent = '调整已保存。';
      } catch {
        if (token === revision) { apply(saved); status.textContent = '调整未能保存，请重试。'; }
      }
    }
    for (const input of [clarity, blur, transparency]) {
      input.addEventListener('input', () => {
        if (loading || busy) return;
        revision += 1;
        const values = input === clarity ? { clarity: Number(clarity.value) }
          : input === blur ? { blur: Math.round(Number(blur.value) * 15) / 100 }
          : { opacity: 100 - Number(transparency.value) };
        apply({ ...settings, ...values });
        status.textContent = '松开后保存调整。';
      });
      input.addEventListener('change', saveAdjustments);
    }
    for (const button of materials) button.addEventListener('click', () => {
      if (loading || busy) return;
      apply({ ...settings, material: button.dataset.backgroundMaterialValue });
      saveAdjustments();
    });
    choose.addEventListener('click', () => action(async () => {
      const selected = await window.medo.chooseBackgroundImage();
      if (!selected) return null;
      const decoded = new Image();
      decoded.src = selected.dataUrl;
      await decoded.decode();
      // Browser codecs cover WebP/BMP too. A data URL keeps canvas reads local
      // and origin-clean; no cover-art sampling or media protocol is changed.
      const scale = Math.min(1, 4096 / Math.max(decoded.naturalWidth, decoded.naturalHeight));
      const canvas = Object.assign(document.createElement('canvas'), {
        width: Math.max(1, Math.round(decoded.naturalWidth * scale)),
        height: Math.max(1, Math.round(decoded.naturalHeight * scale))
      });
      canvas.getContext('2d').drawImage(decoded, 0, 0, canvas.width, canvas.height);
      return window.medo.applyBackgroundImage({ token: selected.token, png: canvas.toDataURL('image/png').split(',')[1] });
    }, '图片无法读取，请选择有效的 JPG、PNG、WebP 或 BMP 图片。'));
    reset.addEventListener('click', () => action(() => window.medo.resetBackgroundImage(), '默认背景未能恢复，请重试。'));
    apply(defaults);
    const ready = (async () => {
      const token = revision;
      try {
        if (!window.medo.getBackgroundImageSettings) return;
        const next = await prepare(await window.medo.getBackgroundImageSettings());
        if (token === revision) {
          saved = next;
          restoreFailed = Boolean(next.image && !next.imageUrl);
          apply(next);
          if (restoreFailed) status.textContent = '背景图片已不可用，请重新选择或恢复默认。';
        }
      } catch {
        restoreFailed = true;
        if (token === revision) status.textContent = '背景图片未能恢复，请重新选择或恢复默认。';
      } finally {
        loading = false;
        controls();
      }
    })();
    return { ready };
  }
};
