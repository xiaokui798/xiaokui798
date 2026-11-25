export const DEFAULT_SENSITIVITY = 40;

export function normalizeSensitivity(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_SENSITIVITY;
  const percent = Number(value);
  return Number.isFinite(percent) ? Math.max(10, Math.min(100, Math.round(percent / 5) * 5)) : DEFAULT_SENSITIVITY;
}

export function createMouseLook(value = DEFAULT_SENSITIVITY) {
  const maxBufferedAngle = .19;
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
    const gain = (mode === "drag" ? .008 : .00325) * sensitivity / 100;
    const scale = Math.min(gain, maxBufferedAngle / distance);
    pendingX += dx * scale;
    pendingY += dy * scale;
    const queued = Math.hypot(pendingX, pendingY);
    if (queued > maxBufferedAngle) {
      pendingX *= maxBufferedAngle / queued;
      pendingY *= maxBufferedAngle / queued;
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
    const blend = Math.min(1 - Math.exp(-dt / .014), .11 / queued, 7.2 * dt / queued);
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
