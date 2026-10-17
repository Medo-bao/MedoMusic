window.MedoShortcutEditor = (() => {
  let session = null;
  function close() {
    if (!session || session.saving) return;
    const row = session.row;
    session.node.remove();
    session = null;
    if (row.offsetParent) row.querySelector(".shortcut-edit")?.focus({ preventScroll: true });
  }

  function open(row, state, onSaved) {
    if (session?.saving) return;
    close();
    const node = document.createElement("div");
    node.className = "shortcut-editor";
    node.innerHTML = '<p class="shortcut-editor-instruction">选择修饰键，再输入一个主键，例如 K、1、F8 或 Space。</p><div class="shortcut-combination"><div class="shortcut-modifiers"><label><input type="checkbox" value="Ctrl"><span>Ctrl</span></label><label><input type="checkbox" value="Alt"><span>Alt</span></label><label><input type="checkbox" value="Shift"><span>Shift</span></label></div><span aria-hidden="true">+</span><input class="shortcut-key-input" type="text" maxlength="16" autocomplete="off" spellcheck="false"><button type="button" class="secondary-button shortcut-check">检查冲突</button></div><p class="shortcut-draft"></p><p class="shortcut-check-message" role="status" aria-live="polite"></p><div class="shortcut-editor-actions"><button type="button" class="secondary-button shortcut-default">恢复默认</button><span></span><button type="button" class="secondary-button shortcut-cancel">取消</button><button type="button" class="primary-button shortcut-save" disabled>保存</button></div>';
    const current = session = { node, row, type: state.type, saving: false, valid: false, generation: 0, accelerator: "" };
    const keyInput = node.querySelector(".shortcut-key-input");
    keyInput.setAttribute("aria-label", `${state.label}快捷键主键`);
    keyInput.setAttribute("aria-describedby", `shortcut-check-${state.type}`);
    const message = node.querySelector(".shortcut-check-message");
    message.id = `shortcut-check-${state.type}`;
    const save = node.querySelector(".shortcut-save");
    const modifiers = [...node.querySelectorAll('input[type="checkbox"]')];
    modifiers.forEach(input => input.setAttribute("aria-label", `${state.label}快捷键 ${input.value}`));

    function populate(accelerator) {
      const parts = accelerator.split("+");
      keyInput.value = parts.at(-1);
      modifiers.forEach(input => { input.checked = parts.includes(input.value); });
    }
    function report(text, status) {
      message.textContent = text;
      node.dataset.checkState = status;
    }
    async function check() {
      const generation = ++current.generation;
      current.valid = false;
      save.disabled = true;
      const draft = [...modifiers.filter(input => input.checked).map(input => input.value), keyInput.value.trim()].join("+");
      const parsed = window.MedoShortcutKeys.validate(draft);
      node.querySelector(".shortcut-draft").textContent = `当前组合：${parsed.ok ? parsed.accelerator : draft || "尚未设置"}`;
      if (!parsed.ok) { report(parsed.message, "error"); return; }
      current.accelerator = parsed.accelerator;
      report("正在检查快捷键冲突…", "checking");
      try {
        const result = await window.medo.checkGlobalShortcut(state.type, parsed.accelerator);
        if (session !== current || generation !== current.generation) return;
        current.valid = result.ok;
        save.disabled = !result.ok || result.accelerator === state.preferredAccelerator;
        report(result.ok ? result.warning || "系统注册检查通过，保存后生效。" : result.message, result.ok ? result.warning ? "warning" : "valid" : "error");
      } catch {
        if (session === current && generation === current.generation) report("检查失败，请点击“检查冲突”重试。", "error");
      }
    }
    keyInput.addEventListener("input", check);
    modifiers.forEach(input => input.addEventListener("change", check));
    node.querySelector(".shortcut-check").addEventListener("click", check);
    node.querySelector(".shortcut-default").addEventListener("click", () => { populate(state.defaultAccelerator); check(); });
    node.querySelector(".shortcut-cancel").addEventListener("click", close);
    node.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    });
    save.addEventListener("click", async () => {
      if (!current.valid || current.saving) return;
      current.saving = true;
      ++current.generation;
      node.querySelectorAll("input, button").forEach(control => { control.disabled = true; });
      report("正在保存并重新检查占用…", "checking");
      try {
        const result = await window.medo.setGlobalShortcut(state.type, current.accelerator);
        if (result.ok) {
          current.saving = false;
          close();
          onSaved(result);
          return;
        }
        current.valid = false;
        report(result.message, "error");
      } catch {
        current.valid = false;
        report("保存失败，请重新检查后重试。", "error");
      }
      current.saving = false;
      node.querySelectorAll("input, button").forEach(control => { control.disabled = false; });
      save.disabled = true;
    });
    populate(state.preferredAccelerator);
    row.append(node);
    check();
    keyInput.focus({ preventScroll: true });
    keyInput.select();
  }
  document.addEventListener("click", event => {
    if (session && !session.row.contains(event.target)) close();
  });
  return { open, close };
})();
