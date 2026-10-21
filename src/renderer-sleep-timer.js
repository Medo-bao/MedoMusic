(() => {
  const form = document.querySelector('#sleep-timer-form');
  const duration = document.querySelector('#sleep-timer-duration');
  const custom = document.querySelector('#sleep-timer-custom-control');
  const minutes = document.querySelector('#sleep-timer-minutes');
  const start = document.querySelector('#sleep-timer-start');
  const cancel = document.querySelector('#sleep-timer-cancel');
  const status = document.querySelector('#sleep-timer-status');
  let deadline = null;
  let interval = null;
  let busy = true;

  const render = () => {
    const active = deadline !== null;
    start.disabled = busy;
    cancel.disabled = busy;
    cancel.hidden = !active;
    start.textContent = active ? '重新计时' : '开始定时';
    status.dataset.active = String(active);
    if (!active) {
      status.textContent = '未开启定时关闭';
      return;
    }
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const hours = Math.floor(seconds / 3600);
    const clock = `${hours ? `${hours}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    const time = new Date(deadline).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    status.textContent = seconds ? `剩余 ${clock} · 将于 ${time} 退出` : '定时已结束，正在退出';
  };
  const sync = state => {
    deadline = state.deadline;
    clearInterval(interval);
    interval = deadline === null ? null : setInterval(render, 1000);
    render();
  };
  duration.addEventListener('change', () => {
    const enabled = duration.value === 'custom';
    custom.hidden = !enabled;
    minutes.disabled = !enabled;
    if (enabled) minutes.focus();
  });
  const update = async operation => {
    if (busy) return;
    busy = true;
    render();
    try {
      sync(await operation());
      showActionFeedback(deadline === null ? '已取消定时关闭' : '已设置定时关闭');
    } catch {
      showActionFeedback('定时关闭设置失败，请重试');
    } finally {
      busy = false;
      render();
    }
  };
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    update(() => window.medo.startSleepTimer(Number(duration.value === 'custom' ? minutes.value : duration.value)));
  });
  cancel.addEventListener('click', () => update(() => window.medo.cancelSleepTimer()));
  window.medo.onSleepTimer(sync);
  window.medo.getSleepTimer().then(sync).catch(() => {
    showActionFeedback('无法读取定时关闭状态，请重试');
  }).finally(() => { busy = false; render(); });
})();
