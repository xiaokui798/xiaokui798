export const PHYSICS_STEP = 1 / 120;
export const LANDING_SAMPLE_TIME = .2;

const radius = .28, height = 1.76;
const runSpeed = 4.15, sprintSpeed = 7.1;
const groundAcceleration = 26, brakingAcceleration = 36, airAcceleration = 7;
// Softer ground friction (was 12) and lateral friction (was 14) so releasing
// the keys leaves a short slide instead of stopping almost instantly, and
// changing direction sheds the old sideways velocity more gradually.
const groundFriction = 7, groundStopSpeed = 3.4, lateralFriction = 8;
// Higher air-steering ceiling (was 2.3) so a jump can still be steered into a
// new direction instead of drifting almost straight.
const airProjectionLimit = 3.5, maxAirSpeed = 10.5;
const jumpSpeed = 7.2, gravity = 19.5;
// Jump buffering and coyote time, both kept inside stepPlayer so its call
// signature (and game.js) stays unchanged. game.js still passes jump=true
// for .12s after a keypress; stepPlayer treats the rising edge as the
// request and holds it for .18s from the keypress, so the effective window
// is .18s, not .12 + .18. Coyote time lets a jump fire up to .1s after
// walking off a ledge.
const JUMP_BUFFER_TIME = .18, COYOTE_TIME = .1;
const epsilon = 1e-8;
const X = 1, Y = 2, Z = 4;

export function createSpeedReadout() {
  const readout = { speed: 0, jump: null, landing: null, record, reset };
  let hasTouchedGround = false, wasGrounded = false, trackingJump = false;
  let landingElapsed = 0;

  function reset() {
    readout.speed = 0;
    readout.jump = readout.landing = null;
    hasTouchedGround = wasGrounded = trackingJump = false;
    landingElapsed = 0;
  }

  function record(speed, grounded, takeoffSpeed, dt) {
    readout.speed = speed;
    if (readout.landing?.after === null) {
      landingElapsed += dt;
      if (landingElapsed >= LANDING_SAMPLE_TIME - epsilon) readout.landing.after = speed;
    }
    if (takeoffSpeed !== null) {
      readout.jump = { takeoff: takeoffSpeed, peak: takeoffSpeed };
      trackingJump = true;
    }
    if (trackingJump) readout.jump.peak = Math.max(readout.jump.peak, speed);
    if (grounded && !wasGrounded && hasTouchedGround) {
      readout.landing = { at: speed, after: null };
      landingElapsed = 0;
      trackingJump = false;
    }
    hasTouchedGround ||= grounded;
    wasGrounded = grounded;
  }

  return readout;
}

export function overlapsPlayerBlock(player, x, y, z) {
  return player.x + radius > x + epsilon && player.x - radius < x + 1 - epsilon
    && player.y + height > y + epsilon && player.y < y + 1 - epsilon
    && player.z + radius > z + epsilon && player.z - radius < z + 1 - epsilon;
}

function sweepBox(position, delta, min, max) {
  let enter = -Infinity, leave = Infinity, axes = 0;
  for (let axis = 0; axis < 3; axis++) {
    const p = position[axis], d = delta[axis];
    if (d === 0) {
      if (p <= min[axis] + epsilon || p >= max[axis] - epsilon) return null;
      continue;
    }
    const low = min[axis] - p, high = max[axis] - p;
    const a = Math.abs(low) <= epsilon ? 0 : low / d;
    const b = Math.abs(high) <= epsilon ? 0 : high / d;
    const near = Math.min(a, b), far = Math.max(a, b);
    if (near > enter + epsilon) { enter = near; axes = 1 << axis; }
    else if (Math.abs(near - enter) <= epsilon) axes |= 1 << axis;
    leave = Math.min(leave, far);
    if (leave <= enter + epsilon) return null;
  }
  if (enter < -epsilon || enter > 1 + epsilon || leave <= Math.max(enter, 0) + epsilon) return null;
  return { time: Math.max(0, Math.min(1, enter)), axes };
}

function firstImpact(position, delta, getBlock, obstacle) {
  const [x, y, z] = position;
  const [dx, dy, dz] = delta;
  let closest = null;
  function testBox(x0, y0, z0, x1, y1, z1) {
    const hit = sweepBox(position, delta, [x0 - radius, y0 - height, z0 - radius], [x1 + radius, y1, z1 + radius]);
    if (!hit) return;
    if (!closest || hit.time < closest.time - epsilon) closest = { time: hit.time, faces: 0, edges: 0 };
    if (Math.abs(hit.time - closest.time) > epsilon) return;
    const onEdge = (hit.axes & (hit.axes - 1)) !== 0;
    if (onEdge) closest.edges |= hit.axes;
    else closest.faces |= hit.axes;
  }

  const minX = Math.floor(Math.min(x, x + dx) - radius - epsilon);
  const maxX = Math.floor(Math.max(x, x + dx) + radius + epsilon);
  const minY = Math.floor(Math.min(y, y + dy) - epsilon);
  const maxY = Math.floor(Math.max(y, y + dy) + height + epsilon);
  const minZ = Math.floor(Math.min(z, z + dz) - radius - epsilon);
  const maxZ = Math.floor(Math.max(z, z + dz) + radius + epsilon);
  for (let bx = minX; bx <= maxX; bx++) for (let by = minY; by <= maxY; by++) for (let bz = minZ; bz <= maxZ; bz++) {
    if (getBlock(bx, by, bz)) testBox(bx, by, bz, bx + 1, by + 1, bz + 1);
  }
  if (obstacle) testBox(...obstacle);
  if (!closest) return null;
  // Prefer a face contact over a voxel seam at the same time. If there are
  // only edge contacts, clip one axis and sweep again to find the other face.
  const edgeAxis = closest.edges & Y ? Y : closest.edges & X ? X : Z;
  return { time: closest.time, axes: closest.faces || edgeAxis };
}

function steer(player, forward, side, sin, cos, sprint, onGround, dt) {
  const maxSpeed = sprint ? sprintSpeed : runSpeed;
  const speed = Math.hypot(player.vx, player.vz);
  let carriedSpeed = speed;
  if (onGround && speed > epsilon) {
    carriedSpeed = Math.max(0, speed - Math.max(speed, groundStopSpeed) * groundFriction * dt);
    player.vx *= carriedSpeed / speed;
    player.vz *= carriedSpeed / speed;
  }
  const amount = Math.hypot(forward, side);
  if (!amount) return;
  const wishX = (sin * forward + cos * side) / amount;
  const wishZ = (-cos * forward + sin * side) / amount;
  const projected = player.vx * wishX + player.vz * wishZ;
  if (onGround) {
    // Damp sideways carry when the input direction changes on the ground.
    const perpendicular = player.vx * wishZ - player.vz * wishX;
    const removed = perpendicular * Math.min(1, lateralFriction * dt);
    player.vx -= removed * wishZ;
    player.vz += removed * wishX;
  }
  const acceleration = onGround ? (projected < 0 ? brakingAcceleration : groundAcceleration) * maxSpeed
    : airAcceleration * runSpeed;
  const target = onGround ? maxSpeed : airProjectionLimit;
  const added = Math.max(0, Math.min(target - projected, acceleration * dt));
  player.vx += added * wishX;
  player.vz += added * wishZ;

  // Air acceleration is limited along the input direction rather than at run
  // speed, so turning into a strafe can add real speed. Keep a separate safety
  // cap and let ground friction shed excess speed when the player lands.
  const limit = onGround ? Math.max(maxSpeed, carriedSpeed) : maxAirSpeed;
  const nextSpeed = Math.hypot(player.vx, player.vz);
  if (nextSpeed > limit) {
    player.vx *= limit / nextSpeed;
    player.vz *= limit / nextSpeed;
  }
}

export function stepPlayer(player, { forward, side, yaw, sprint, jump }, getBlock, obstacle, dt = PHYSICS_STEP) {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const state = playerState(player);
  // Rising edge of the jump input starts the .18s buffer. Refreshing it on
  // every jump=true tick would stretch the window to .12s (game.js) + .18s.
  if (jump && !state.prevJump) state.buffer = JUMP_BUFFER_TIME;
  state.prevJump = jump;
  if (state.buffer > 0) state.buffer = Math.max(0, state.buffer - dt);
  if (player.grounded) state.coyote = COYOTE_TIME;
  const jumped = state.buffer > 0 && (player.grounded || state.coyote > 0);
  if (jumped) state.buffer = 0;
  steer(player, forward, side, sin, cos, sprint, player.grounded && !jumped, dt);
  if (jumped) player.vy = jumpSpeed;
  player.vy -= gravity * dt;
  player.grounded = false;
  let landingSpeed = 0, remaining = dt;
  const position = [player.x, player.y, player.z];

  for (let contact = 0; contact < 3 && remaining > epsilon; contact++) {
    const delta = [player.vx * remaining, player.vy * remaining, player.vz * remaining];
    const impact = firstImpact(position, delta, getBlock, obstacle);
    const fraction = impact?.time ?? 1;
    for (let axis = 0; axis < 3; axis++) position[axis] += delta[axis] * fraction;
    if (!impact) break;
    remaining *= 1 - fraction;

    const forwardBefore = player.vx * sin - player.vz * cos;
    if (impact.axes & X) player.vx = 0;
    if (impact.axes & Z) player.vz = 0;
    if ((impact.axes & (X | Z)) && side && !forward && forwardBefore >= -epsilon
      && player.vx * sin - player.vz * cos < -epsilon) {
      // A pure strafe into an angled wall may stop, but should not push the
      // player backwards relative to the view. Existing backward momentum is kept.
      player.vx = player.vz = 0;
    }
    if (impact.axes & Y) {
      if (player.vy < 0) {
        landingSpeed = -player.vy;
        player.grounded = true;
      }
      player.vy = 0;
    }
  }

  if (player.grounded && !firstImpact(position, [0, -.0001, 0], getBlock, obstacle)) {
    player.grounded = false;
  }
  [player.x, player.y, player.z] = position;
  // Coyote time only ticks down while airborne; standing on the ground
  // refreshes it at the start of the next call.
  if (player.grounded) state.coyote = COYOTE_TIME;
  else state.coyote = Math.max(0, state.coyote - dt);
  state.lastX = player.x; state.lastY = player.y; state.lastZ = player.z;
  return { jumped, landingSpeed };
}

// Per-player jump state, keyed by the player object so stepPlayer keeps its
// signature. A teleport (respawn/arena switch moves the player far more than
// physics can in one tick) clears any buffered jump, so a jump pressed just
// before dying cannot fire on its own after respawning.
const playerStates = new WeakMap();
function playerState(player) {
  let state = playerStates.get(player);
  if (!state) {
    state = { buffer: 0, coyote: 0, prevJump: false, lastX: player.x, lastY: player.y, lastZ: player.z };
    playerStates.set(player, state);
    return state;
  }
  if (Math.abs(player.x - state.lastX) > 2 || Math.abs(player.y - state.lastY) > 2
    || Math.abs(player.z - state.lastZ) > 2) {
    state.buffer = 0;
    state.coyote = 0;
    state.prevJump = false;
  }
  return state;
}
