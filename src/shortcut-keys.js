(function () {
  const modifiers = ["Ctrl", "Alt", "Shift"];
  const namedKeys = ["Space", "Tab", "Enter", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Up", "Down", "Left", "Right", "Escape", "Plus"];
  const reserved = new Set(["Alt+F4", "Alt+Tab", "Alt+Shift+Tab", "Alt+Escape", "Ctrl+Escape", "Ctrl+Shift+Escape", "Ctrl+Alt+Delete", "Ctrl+Space"]);
  const common = {
    "Ctrl+A": "全选", "Ctrl+C": "复制", "Ctrl+V": "粘贴", "Ctrl+X": "剪切", "Ctrl+Z": "撤销", "Ctrl+Y": "重做",
    "Ctrl+S": "保存", "Ctrl+O": "打开", "Ctrl+N": "新建", "Ctrl+P": "打印", "Ctrl+F": "查找", "Ctrl+H": "替换",
    "Ctrl+W": "关闭标签页或文档", "Ctrl+T": "新建标签页", "Ctrl+L": "地址栏", "Ctrl+R": "刷新",
    "Ctrl+Shift+S": "另存为", "Ctrl+Shift+T": "恢复关闭的标签页", "Ctrl+Shift+W": "关闭窗口",
    "Alt+D": "浏览器地址栏", "Alt+Shift+D": "Word 插入日期", "Alt+Shift+E": "Word 编辑邮件合并数据"
  };

  function validate(value) {
    const invalid = message => ({ ok: false, code: "invalid", message });
    if (typeof value !== "string" || value.length > 80) return invalid("请输入有效的组合键。");
    const parts = value.split("+").map(part => part.trim());
    const selected = new Set();
    const keys = [];
    for (const part of parts) {
      const modifier = modifiers.find(item => item.toLowerCase() === part.toLowerCase()) || (/^control$/i.test(part) ? "Ctrl" : null);
      if (modifier) {
        if (selected.has(modifier)) return invalid("修饰键不能重复。");
        selected.add(modifier);
      } else keys.push(part);
    }
    if (!selected.has("Ctrl") && !selected.has("Alt")) return invalid("请至少选择 Ctrl 或 Alt，避免影响日常文字输入。");
    if (keys.length !== 1 || !keys[0]) return invalid("请输入一个主键，例如 K、1、F8 或 Space。");
    const raw = keys[0];
    const key = /^[a-z0-9]$/i.test(raw) || /^F(?:[1-9]|1\d|2[0-4])$/i.test(raw) ? raw.toUpperCase() :
      namedKeys.find(item => item.toLowerCase() === raw.toLowerCase()) ||
      ({ esc: "Escape", return: "Enter" })[raw.toLowerCase()] || (/^[,.;/\\\[\]'`=\-]$/.test(raw) ? raw : null);
    if (!key) return invalid("主键支持字母、数字、F1–F24，以及 Space、Enter、方向键等。");
    const accelerator = [...modifiers.filter(item => selected.has(item)), key].join("+");
    if (reserved.has(accelerator)) return { ok: false, code: "reserved", message: `${accelerator} 是系统常用操作快捷键，请使用其他组合。` };
    return { ok: true, accelerator, warning: common[accelerator] ? `此组合常用于“${common[accelerator]}”，启用后可能影响其他软件，建议换一个组合。` : "" };
  }

  const api = { validate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MedoShortcutKeys = api;
})();
