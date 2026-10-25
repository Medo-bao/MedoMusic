const { hasNativeWordTiming } = require("./lyrics-timing");

// Two workers give another matched recording a chance while one request retries.
// Resolve in match order so a quick preview cannot beat a pending original.
async function findNativeWordCandidate(candidates, lookup, onCandidate, onFailure) {
  const controller = new AbortController();
  let next = 0;
  let bestNativeIndex = Infinity;
  const slots = candidates.map(() => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  });
  const worker = async () => {
    while (!controller.signal.aborted && next < candidates.length && next <= bestNativeIndex) {
      const index = next++;
      let found = null;
      try {
        found = await lookup(candidates[index], controller.signal);
        if (!controller.signal.aborted && found) {
          if (hasNativeWordTiming(found.text)) bestNativeIndex = Math.min(bestNativeIndex, index);
          else onCandidate(found, index);
        }
      } catch (error) {
        if (!controller.signal.aborted) onFailure(error);
      } finally {
        slots[index].resolve(found);
      }
    }
  };
  const workers = Array.from({ length: Math.min(2, candidates.length) }, worker);
  try {
    for (const [index, slot] of slots.entries()) {
      const found = await slot.promise;
      if (found && hasNativeWordTiming(found.text)) {
        onCandidate(found, index);
        return found;
      }
    }
    return null;
  } finally {
    controller.abort();
    await Promise.allSettled(workers);
  }
}

module.exports = { findNativeWordCandidate };
