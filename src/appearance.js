/* Atmosphere is independent of audio/lyric timing. Small cropped bitmaps keep
   transitions cheap, including when a rapid skip interrupts a crossfade. */
window.MedoAppearance = {
  create({ getCurrentCover, missingArt }) {
    const root = document.documentElement;
    const base = document.querySelector('.detail-artwork-base');
    const incoming = document.querySelector('.detail-artwork-incoming');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const cache = new Map();
    let requested = null;
    let request = Promise.resolve(false);
    let generation = 0;
    let transition = null;
    let front = null;
    let behind = null;
    const canvas = () => Object.assign(document.createElement('canvas'), { width: 96, height: 96 });
    const neutral = canvas();
    neutral.getContext('2d').fillStyle = '#89919c';
    neutral.getContext('2d').fillRect(0, 0, 96, 96);
    const fallback = { bitmap: neutral, url: neutral.toDataURL(), color: null, available: false };

    function finish() {
      if (!front) return;
      transition?.cancel();
      transition = null;
      behind = front;
      base.style.backgroundImage = `url("${front.url}")`;
      incoming.style.opacity = '0';
      incoming.style.backgroundImage = 'none';
    }

    function present(next) {
      // Flatten the visible blend before replacing its target. Exactly two DOM
      // layers survive rapid skips; there is no jump to an unfinished target.
      if (transition && behind && front) {
        const snapshot = canvas();
        const context = snapshot.getContext('2d');
        context.drawImage(behind.bitmap, 0, 0);
        context.globalAlpha = Number(getComputedStyle(incoming).opacity);
        context.drawImage(front.bitmap, 0, 0);
        transition.cancel();
        transition = null;
        behind = { bitmap: snapshot, url: snapshot.toDataURL() };
        base.style.backgroundImage = `url("${behind.url}")`;
      }
      const animate = Boolean(front) && !document.hidden && !document.body.classList.contains('background-mode') &&
        document.body.classList.contains('playback-detail-active') && !reducedMotion.matches;
      front = next;
      root.style.setProperty('--cover-tone', next.color ? `rgb(${next.color.join(' ')})` : 'var(--ambient-fallback)');
      root.style.setProperty('--detail-theme', 'var(--cover-tone)');
      if (next.color) root.style.setProperty('--detail-theme-rgb', next.color.join(', '));
      else root.style.removeProperty('--detail-theme-rgb');
      if (!animate) { finish(); return; }
      incoming.style.backgroundImage = `url("${next.url}")`;
      incoming.style.opacity = '0';
      const animation = incoming.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 440, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards'
      });
      transition = animation;
      animation.finished.then(() => { if (transition === animation) finish(); }).catch(() => {});
    }

    async function decode(cover) {
      if (!cover || cover === missingArt) return fallback;
      if (cache.has(cover)) return cache.get(cover);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = cover;
      await image.decode();
      try {
        const bitmap = canvas();
        const context = bitmap.getContext('2d', { willReadFrequently: true });
        context.fillStyle = '#89919c';
        context.fillRect(0, 0, 96, 96);
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
        const pixels = context.getImageData(0, 0, 96, 96).data;
        const totals = [0, 0, 0];
        let weight = 0;
        for (let i = 0; i < pixels.length; i += 16) {
          const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
          const brightness = (rgb[0] + rgb[1] + rgb[2]) / 3;
          const range = Math.max(...rgb) - Math.min(...rgb);
          if (brightness < 30 || brightness > 232 || range < 12) continue;
          const strength = 1 + range / 80;
          rgb.forEach((value, channel) => { totals[channel] += value * strength; });
          weight += strength;
        }
        const color = weight ? totals.map(value => Math.round(Math.min(205, Math.max(65, value / weight)) * .78 + 128 * .22)) : null;
        const result = { bitmap, url: bitmap.toDataURL(), color, available: true };
        cache.set(cover, result);
        if (cache.size > 96) cache.delete(cache.keys().next().value);
        return result;
      } catch {
        // A decoded image is still valid artwork when canvas sampling/export
        // fails. Only the atmosphere falls back; keep the original cover visible.
        return { ...fallback, available: true };
      }
    }

    function setCover(cover = missingArt) {
      cover ||= missingArt;
      if (cover === requested) return request;
      requested = cover;
      const token = ++generation;
      request = decode(cover).catch(() => fallback).then(result => {
        if (token === generation && (getCurrentCover() || missingArt) === cover) present(result);
        return result.available;
      });
      return request;
    }
    reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) finish(); });
    present(fallback);
    return { setCover, finish };
  }
};
