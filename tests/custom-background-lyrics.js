const assert = require('node:assert/strict');

module.exports = async function checkCustomBackgroundLyrics(page) {
  const measure = () => page.evaluate(() => {
    const root = document.documentElement;
    const stage = document.querySelector('.lyrics-stage');
    const previousMode = root.dataset.glassBackground;
    const inspecting = stage.classList.contains('inspecting');
    const override = document.createElement('style');
    override.textContent = '.lyric-line, .lyric-line * { transition: none !important; }';
    document.head.append(override);
    const lines = [...document.querySelectorAll('.lyric-line')];
    const elements = [...document.querySelectorAll('.lyric-line, .lyric-karaoke-base, .lyric-karaoke-fill, .lyric-translation')];
    const read = element => {
      const style = getComputedStyle(element);
      return { color: style.color, opacity: style.opacity, background: style.backgroundImage,
        weight: style.fontWeight, shadow: style.textShadow, filter: style.filter };
    };
    const snapshot = mode => {
      root.dataset.glassBackground = mode;
      return { lines: lines.map(read), active: elements.filter(element => element.closest('.lyric-line.active')).map(read) };
    };
    let selected;
    let wasSelected;
    try {
      stage.classList.remove('inspecting');
      const normal = snapshot('theme'), image = snapshot('image');
      stage.classList.add('inspecting');
      const inspectingNormal = snapshot('theme'), inspectingImage = snapshot('image');
      stage.classList.remove('inspecting');
      selected = lines.find(line => !line.classList.contains('active'));
      wasSelected = selected.classList.contains('selected');
      selected.classList.add('selected');
      const selectedNormal = snapshot('theme').lines[lines.indexOf(selected)];
      const selectedImage = snapshot('image').lines[lines.indexOf(selected)];
      return { normal, image, inspectingNormal, inspectingImage, selectedNormal, selectedImage,
        classes: lines.map(line => line.className), theme: root.dataset.theme };
    } finally {
      selected?.classList.toggle('selected', wasSelected);
      stage.classList.toggle('inspecting', inspecting);
      root.dataset.glassBackground = previousMode;
      override.remove();
    }
  });
  const report = await measure();
  const strength = style => {
    const values = style.color.match(/[\d.]+/g).map(Number);
    return (values[3] ?? 1) * Number(style.opacity);
  };
  const results = report.classes.map((classes, index) => ({ classes,
    before: strength(report.normal.lines[index]), after: strength(report.image.lines[index]) }))
    .filter(line => !line.classes.split(' ').includes('active'));
  assert.ok(results.some(line => line.classes.includes('near')));
  assert.ok(results.some(line => line.classes.includes('past') && !line.classes.includes('near')));
  assert.ok(results.some(line => !line.classes.includes('past') && !line.classes.includes('near')));
  assert.deepEqual(report.image, report.normal, 'Image backgrounds use the same lyric palette, color alpha and opacity as default backgrounds');
  assert.deepEqual(report.image.active, report.normal.active, 'Current lyric and karaoke retain their original appearance');
  assert.deepEqual(report.inspectingImage, report.inspectingNormal, 'Manual lyric inspection retains its original appearance');
  assert.deepEqual(report.selectedImage, report.selectedNormal, 'Selected lyric retains its original appearance');
  try {
    await page.emulateMedia({ contrast: 'more' });
    const contrast = await measure();
    assert.deepEqual(contrast.image, contrast.normal, 'High contrast remains unchanged across backgrounds');
  } finally {
    await page.emulateMedia({ contrast: 'no-preference' });
  }
  return { theme: report.theme, inactive: results, backgroundBoostRemoved: true, activePreserved: true, inspectionPreserved: true, selectionPreserved: true, contrastPreserved: true };
};
