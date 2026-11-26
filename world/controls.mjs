export const DEFAULT_SENSITIVITY = 40;

// One gain for both pointer-lock and drag look. The old drag gain (.008) was
// 2.46x the locked gain (.00325), so losing the pointer lock silently made
// the same hand movement turn 2.5x faster. Drag look still exists as a
// fallback for browsers that refuse the lock, but it now feels identical.
const LOOK_GAIN = .00325;
// Queue cap for buffered look input. A 500px flick at the default 40%
// sensitivity is ~0.65rad, so the old .19rad cap truncated most of it. The
// cap is now a safety bound for abnormal bursts only; normal flicks fit in
// full and are drained over frames instead of being discarded.
const MAX_BUFFERED_ANGLE = .75;
// Smoothing time constant (was .014) and max turn rate (was 7.2rad/s with an
// extra .11rad/frame cap). Draining is proportional to elapsed time, so a
// big flick always arrives in full, just spread over a few frames. The queue
// cap (.75rad) is the safety bound for a dropped frame: one stalled frame
// may deliver the whole capped burst, but never more than the cap.
const SMOOTHING_TAU = .008;
const MAX_TURN_RATE = 15; // rad/s

export function normalizeSensitivity(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_SENSITIVITY;
  const percent = Number(value);
  return Number.isFinite(percent) ? Math.max(10, Math.min(100, Math.round(percent / 5) * 5)) : DEFAULT_SENSITIVITY;
}

export function createMouseLook(value = DEFAULT_SENSITIVITY) {
  let sensitivity = normalizeSensitivity(value);
  let pendingX = 0, pendingY = 0, firstLockedSample = true;

  function reset() {
    pendingX = 0;
    pendingY = 0;
    firstLockedSample = true;
  }

  function push(dx, dy, mode) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const distance = Math.hypot(dx, dy);
    if (!distance) return;
    if (mode === "locked") {
      // Ignore one-off browser cursor jumps, especially just after acquiring the lock.
      if (distance > 1200) return;
      const reacquiring = firstLockedSample;
      firstLockedSample = false;
      if (reacquiring && distance > 140) return;
    }
    // No per-push truncation: the old `min(gain, maxBufferedAngle / distance)`
    // scaled a single large flick down to the queue cap and threw the rest
    // away. The full angle is queued; advance() drains it over frames.
    const gain = LOOK_GAIN * sensitivity / 100;
    pendingX += dx * gain;
    pendingY += dy * gain;
    const queued = Math.hypot(pendingX, pendingY);
    if (queued > MAX_BUFFERED_ANGLE) {
      pendingX *= MAX_BUFFERED_ANGLE / queued;
      pendingY *= MAX_BUFFERED_ANGLE / queued;
    }
  }

  function advance(dt) {
    const queued = Math.hypot(pendingX, pendingY);
    if (!Number.isFinite(dt) || dt <= 0 || queued === 0) return [0, 0];
    if (queued < .00015) {
      pendingX = 0;
      pendingY = 0;
      return [0, 0];
    }
    const blend = Math.min(1 - Math.exp(-dt / SMOOTHING_TAU), MAX_TURN_RATE * dt / queued);
    const x = pendingX * blend, y = pendingY * blend;
    pendingX -= x;
    pendingY -= y;
    return [x, y];
  }

  function setSensitivity(value) {
    sensitivity = normalizeSensitivity(value);
    reset();
    return sensitivity;
  }

  return { push, advance, reset, setSensitivity, get sensitivity() { return sensitivity; } };
}
