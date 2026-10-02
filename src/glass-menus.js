/* Theme-aware menus shared by track, playlist and select controls. */
window.MedoMenus = (() => {
  let dismiss = null;
  const action = (label, name) => ({ label, value: { action: name } });
  const targets = names => names.map(name => ({ label: name, value: { action: 'add-to-playlist', playlist: name } }));
  function show(items, anchor) {
    dismiss?.();
    return new Promise(resolve => {
      const controller = new AbortController();
      const signal = controller.signal;
      const previousFocus = document.activeElement;
      const host = [...document.querySelectorAll('dialog[open]')].at(-1) || document.body;
      const panels = [];
      let done = false;
      const finish = value => {
        if (done) return;
        done = true; controller.abort();
        panels.forEach(panel => panel.remove());
        dismiss = null;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        resolve(value);
      };
      dismiss = () => finish(null);
      const removeChildren = level => {
        while (panels.length > level + 1) panels.pop().remove();
        panels[level]?.querySelectorAll('[aria-expanded]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      };
      const place = (panel, x, y, parent) => {
        const box = panel.getBoundingClientRect();
        if (parent && x + box.width > innerWidth - 8) x = parent.left - box.width - 4;
        panel.style.left = `${Math.max(8, Math.min(x, innerWidth - box.width - 8))}px`;
        panel.style.top = `${Math.max(8, Math.min(y, innerHeight - box.height - 8))}px`;
      };
      const create = (entries, x, y, level = 0, parentButton = null) => {
        const panel = document.createElement('div');
        panel.className = 'glass-menu'; panel.popover = 'manual'; panel.tabIndex = -1;
        panel.setAttribute('role', 'menu'); panel.setAttribute('aria-label', parentButton?.textContent || '操作菜单');
        const buttons = [];
        for (const item of entries) {
          if (item.separator) {
            const line = document.createElement('div'); line.setAttribute('role', 'separator'); panel.append(line); continue;
          }
          const button = document.createElement('button');
          button.type = 'button'; button.setAttribute('role', 'menuitem'); button.tabIndex = -1;
          button.textContent = item.label; button.setAttribute('aria-label', item.label); button.disabled = Boolean(item.disabled);
          if (item.checked) button.classList.add('checked');
          if ('checked' in item) { button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(item.checked)); }
          if (item.children) { button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); }
          const openChild = focus => {
            if (button.disabled) return;
            if (button.getAttribute('aria-expanded') !== 'true') {
              removeChildren(level);
              const rect = button.getBoundingClientRect();
              create(item.children, rect.right + 4, rect.top, level + 1, button);
              button.setAttribute('aria-expanded', 'true');
            }
            if (focus) panels[level + 1]?.querySelector('button:not(:disabled)')?.focus();
          };
          button.addEventListener('pointerenter', () => {
            if (item.children) openChild(false); else removeChildren(level);
          });
          button.addEventListener('click', () => item.children ? openChild(true) : finish(item.value));
          if (item.contextMenu) button.addEventListener('contextmenu', event => {
            event.preventDefault(); event.stopPropagation(); finish(null); item.contextMenu(event);
          });
          button.addEventListener('keydown', event => {
            if (event.key === 'ArrowRight' && item.children) { event.preventDefault(); openChild(true); }
          });
          panel.append(button); buttons.push(button);
        }
        panel.addEventListener('keydown', event => {
          const enabled = buttons.filter(button => !button.disabled);
          const index = enabled.indexOf(document.activeElement);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
            enabled[next]?.focus();
          } else if (event.key === 'ArrowLeft' && parentButton) {
            event.preventDefault(); removeChildren(level - 1); parentButton.focus();
          } else if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation();
            if (parentButton) { removeChildren(level - 1); parentButton.focus(); } else finish(null);
          } else if (event.key === 'Tab') { finish(null); }
          else if (event.key.length === 1 && event.key !== ' ') {
            enabled.find(button => button.textContent.toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
          }
        });
        panel.addEventListener('contextmenu', event => event.preventDefault());
        panel.addEventListener('scroll', () => removeChildren(level));
        host.append(panel); panels.push(panel); panel.showPopover();
        place(panel, x, y, parentButton?.getBoundingClientRect());
        return panel;
      };
      const rect = anchor?.currentTarget?.getBoundingClientRect?.() || anchor?.getBoundingClientRect?.();
      const pointer = anchor && (anchor.clientX || anchor.clientY);
      const root = create(items, pointer ? anchor.clientX : rect?.left || 8, pointer ? anchor.clientY : rect?.bottom || 46);
      (root.querySelector('button.checked:not(:disabled)') || root.querySelector('button:not(:disabled)') || root).focus();
      document.addEventListener('pointerdown', event => {
        if (!panels.some(panel => panel.contains(event.target))) finish(null);
      }, { capture: true, signal });
      window.addEventListener('blur', () => finish(null), { signal });
      window.addEventListener('resize', () => finish(null), { signal });
      document.addEventListener('scroll', event => {
        if (!panels.some(panel => panel.contains(event.target))) finish(null);
      }, { capture: true, signal });
    });
  }
  function playlist(options, anchor) {
    return show([action('播放', 'play'), action('播放下一首', 'play-next'),
      { label: '添加到', disabled: !options.playlists.length, children: targets(options.playlists) },
      ...(!options.favorites ? [{ separator: true }, action('重命名', 'rename'), action('删除', 'delete')] : [])], anchor);
  }
  function track(options, anchor) {
    return show([action('播放', 'play'), action('添加到播放队列', 'add-to-queue'), action('添加到下一首播放', 'play-next'),
      { label: '添加到', disabled: !options.playlists.length, children: targets(options.playlists) },
      action(options.currentPlaylist ? '从播放列表中删除' : '删除', options.currentPlaylist ? 'remove-from-playlist' : 'remove-from-library'),
      action('显示专辑', 'show-album'), action('编辑信息', 'edit-info'), action('属性', 'properties'), action('打开歌曲位置', 'open-location'),
      { separator: true }, action('选择', 'select')], anchor);
  }
  function chooseTarget(names, anchor) {
    return show(names.length ? names.map(name => ({ label: name, value: name })) : [{ label: '暂无播放列表', disabled: true }], anchor);
  }
  // Keep the existing select/change contract while styling its popup in the same layer.
  document.querySelectorAll('select').forEach(select => {
    const open = async () => {
      if (select.disabled) return;
      const value = await show([...select.options].map(option => ({
        label: option.textContent, value: option.value, disabled: option.disabled, checked: option.selected,
        contextMenu: select.id === 'sound-preset' ? event => option.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY
        })) : null
      })), select);
      if (value !== null && value !== select.value) {
        select.value = value; select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    select.addEventListener('pointerdown', event => { if (event.button === 0) { event.preventDefault(); select.focus(); } });
    select.addEventListener('click', event => { event.preventDefault(); open(); });
    select.addEventListener('keydown', event => {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
    });
  });
  return { show, playlist, track, chooseTarget };
})();
