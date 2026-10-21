const MAX_MINUTES = 24 * 60;

function createSleepTimer({ onExpire, onChange = () => {}, now = Date.now, schedule = setTimeout, unschedule = clearTimeout }) {
  let deadline = null;
  let timer = null;
  const getState = () => ({ deadline });
  const clearTimeoutHandle = () => {
    if (timer !== null) unschedule(timer);
    timer = null;
  };
  const check = () => {
    clearTimeoutHandle();
    if (deadline === null) return;
    const remaining = deadline - now();
    if (remaining > 0) {
      timer = schedule(check, remaining);
      return;
    }
    deadline = null;
    onChange(getState());
    onExpire();
  };
  const start = minutes => {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
      throw new RangeError('定时时长需为 1–1440 的整数分钟');
    }
    deadline = now() + minutes * 60000;
    check();
    onChange(getState());
    return getState();
  };
  const cancel = () => {
    clearTimeoutHandle();
    deadline = null;
    onChange(getState());
    return getState();
  };
  return { start, cancel, check, getState };
}

module.exports = { createSleepTimer };
