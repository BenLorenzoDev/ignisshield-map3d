// Presentation time only. Recorded fire/evacuation calculations remain unchanged.
const IgnisPlayback = (() => {
  function advance(minute, elapsedSeconds, speed, end, rendered) {
    if (!rendered) return minute;
    // Drop stalled wall time instead of fast-forwarding through unseen fire steps.
    const dt = Math.min(0.1, Math.max(0, elapsedSeconds));
    // Always land on the next recorded minute before advancing beyond it.
    const limit = Math.min(end, Math.floor(minute) + 1);
    const next = Math.min(limit, minute + dt * speed);
    return limit - next < 1e-9 ? limit : next;
  }
  return {advance};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = IgnisPlayback;
