import test from "node:test";
import assert from "node:assert/strict";
import { PHYSICS_STEP, createSpeedReadout, overlapsPlayerBlock, stepPlayer } from "./movement.mjs";

const floor = (_, y) => y < 1;
const playerAt = (overrides = {}) => ({ x: .5, y: 1, z: .5, vx: 0, vy: 0, vz: 0, grounded: true, ...overrides });
const tick = (player, input = {}, getBlock = floor, obstacle = null) => stepPlayer(player,
  { forward: 0, side: 0, yaw: 0, sprint: false, jump: false, ...input }, getBlock, obstacle);
function repeat(count, player, input, getBlock) {
  for (let i = 0; i < count; i++) tick(player, input, getBlock);
}
const nearly = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);

test("the speed readout captures takeoff, peak, and 200ms after landing", () => {
  const meters = createSpeedReadout();
  const sample = (speed, grounded, takeoff = null) => meters.record(speed, grounded, takeoff, PHYSICS_STEP);
  sample(0, false);
  sample(0, true);
  assert.equal(meters.landing, null);
  sample(4.15, false, 4.15);
  sample(6.75, false);
  sample(6.5, true);
  assert.deepEqual(meters.jump, { takeoff: 4.15, peak: 6.75 });
  assert.deepEqual(meters.landing, { at: 6.5, after: null });
  for (let i = 0; i < 23; i++) sample(4.1, true);
  assert.equal(meters.landing.after, null);
  sample(3.7, true);
  sample(1, true);
  assert.deepEqual(meters.landing, { at: 6.5, after: 3.7 });
  assert.equal(meters.speed, 1);
  meters.reset();
  assert.equal(meters.speed, 0);
  assert.equal(meters.jump, null);
  assert.equal(meters.landing, null);
});

test("running accelerates, release coasts, and counter-strafing brakes sooner", () => {
  const player = playerAt();
  tick(player, { side: 1 });
  assert.ok(player.vx > 0 && player.vx < 4.15);
  repeat(40, player, { side: 1 });
  nearly(player.vx, 4.15);
  const counter = { ...player };
  const before = player.x;
  tick(player);
  tick(counter, { side: -1 });
  assert.ok(player.x > before && player.vx < 4.15);
  assert.ok(counter.vx < player.vx);
  repeat(6, counter, { side: -1 });
  repeat(6, player);
  assert.ok(counter.vx < 0 && player.vx > 0);
  repeat(45, player);
  nearly(player.vx, 0);
});

test("ground input reaches speed and reverses quickly while coasting to a stop", () => {
  const player = playerAt();
  repeat(7, player, { side: 1 });
  assert.ok(player.vx >= 3.7);
  repeat(15, player, { side: 1 });
  const brake = { ...player };
  const startX = player.x;
  repeat(3, brake, { side: -1 });
  assert.ok(brake.vx <= 0);
  repeat(6, player);
  assert.ok(player.vx > 2);
  // Softer ground friction (12 -> 7) stretches the coast: stopping from full
  // speed now takes ~21 ticks / 0.33 blocks instead of ~12 ticks / 0.2 blocks.
  repeat(15, player);
  nearly(player.vx, 0);
  assert.ok(player.x - startX < .4);
});

test("changing direction drops the old sideways velocity without weakening the new direction", () => {
  const player = playerAt({ vx: 4.15 });
  // Softer lateral friction (14 -> 8) sheds the old velocity more slowly:
  // 25 ticks instead of 13 to drop below .2.
  repeat(25, player, { forward: 1 });
  assert.ok(player.vx < .2);
  assert.ok(player.vz < -4);
});

test("diagonal keys keep the same top speed, and sprint has its own limit", () => {
  const straight = playerAt(), diagonal = playerAt(), sprint = playerAt();
  repeat(90, straight, { forward: 1 });
  repeat(90, diagonal, { forward: 1, side: 1 });
  repeat(90, sprint, { forward: 1, side: 1, sprint: true });
  nearly(Math.hypot(diagonal.vx, diagonal.vz), Math.hypot(straight.vx, straight.vz));
  nearly(Math.hypot(sprint.vx, sprint.vz), 7.1);
});

test("jump keeps takeoff speed, air input steers gradually, and landing allows braking", () => {
  const player = playerAt();
  repeat(40, player, { forward: 1 });
  assert.equal(tick(player, { forward: 1, jump: true }).jumped, true);
  repeat(8, player);
  nearly(player.vz, -4.15);
  tick(player, { side: 1 });
  assert.ok(player.vx > 0 && player.vx < 1 && player.vz < -3.9);
  repeat(20, player, { side: 1 });
  // Air steering ceiling is now 3.5 (was 2.3), so sustained air strafing can
  // build more sideways speed before the cap.
  assert.ok(player.vx > 1 && player.vx <= 3.5 && player.vz < 0);
  for (let i = 0; i < 120 && !player.grounded; i++) tick(player);
  assert.equal(player.grounded, true);
  nearly(player.y, 1);
  const landingSpeed = Math.hypot(player.vx, player.vz);
  repeat(8, player);
  assert.ok(Math.hypot(player.vx, player.vz) < landingSpeed);
});

test("left and right turning strafes build speed above the run cap", () => {
  for (const side of [-1, 1]) {
    const strafe = playerAt({ y: 5, vz: -4.15, vy: 7.2, grounded: false });
    const lookOnly = { ...strafe };
    for (let i = 0; i < 66; i++) {
      const yaw = side * (-.18 + i * .016);
      tick(strafe, { side, yaw });
      tick(lookOnly, { yaw });
    }
    nearly(Math.hypot(lookOnly.vx, lookOnly.vz), 4.15);
    assert.ok(Math.hypot(strafe.vx, strafe.vz) > 6);
    assert.ok(strafe.vx * side > 0);
  }
});

test("a takeoff with released keys preserves carried speed and a landing sheds it gradually", () => {
  const player = playerAt({ vz: -6.75 });
  tick(player, { jump: true });
  nearly(player.vz, -6.75);
  while (!player.grounded) tick(player);
  tick(player, { forward: 1 });
  assert.ok(player.vz < -6 && player.vz > -6.75);
});

test("a fast landing coasts briefly with movement keys released", () => {
  const player = playerAt({ y: 1.025, vx: 6.75, vy: -4, grounded: false });
  tick(player);
  assert.equal(player.grounded, true);
  nearly(player.vx, 6.75);
  const landingX = player.x;
  // Softer ground friction (12 -> 7) stretches the slide to ~29 ticks
  // (0.24s) and ~0.68 blocks instead of ~17 ticks (0.14s) and ~0.35 blocks.
  repeat(29, player);
  nearly(player.vx, 0);
  assert.ok(player.x - landingX < .75);
});

test("sustained air strafing respects its separate speed ceiling", () => {
  const player = playerAt({ y: 1000, vz: -4.15, grounded: false });
  for (let i = 0; i < 300; i++) {
    const yaw = Math.atan2(player.vx, -player.vz) - .16;
    tick(player, { side: 1, yaw });
  }
  nearly(Math.hypot(player.vx, player.vz), 10.5);
});

test("right jump stays lateral in open space and cannot gain backward motion from a wall", () => {
  const wall = (x, y) => y < 1 || x >= 1;
  const yaw = Math.PI / 4, startX = .72;
  const clear = playerAt({ x: startX });
  const blocked = playerAt({ x: startX });
  const input = { yaw, side: 1, jump: true };
  tick(clear, input);
  tick(blocked, input, wall);
  repeat(24, clear, { yaw, side: 1 });
  repeat(24, blocked, { yaw, side: 1 }, wall);
  const forward = player => (player.x - startX) * Math.sin(yaw) - (player.z - .5) * Math.cos(yaw);
  assert.ok(clear.x > startX + .1 && clear.y > 1.5);
  nearly(forward(clear), 0);
  nearly(forward(blocked), 0);
  nearly(blocked.x, startX);
  assert.ok(blocked.y > 1.5);
});

test("a wall preserves the velocity along it, including over voxel seams", () => {
  const wall = (x, y) => y < 1 || x >= 1;
  const player = playerAt();
  repeat(90, player, { forward: 1, side: 1 }, wall);
  nearly(player.x, .72);
  nearly(player.vx, 0);
  assert.ok(player.vz < -2 && player.z < -1);
  assert.equal(player.grounded, true);
});

test("a tiny velocity into a touching wall cannot accumulate penetration", () => {
  const wall = (x, y) => y < 1 || x >= 1;
  const player = playerAt({ x: .72, y: 1.08, vy: -2.4, vx: 2.4e-7, vz: 2.5, grounded: false });
  repeat(6, player, {}, wall);
  tick(player, { side: 1, jump: true }, wall);
  nearly(player.x, .72);
  assert.ok(player.y > 1);
});

test("inside corners and low ceilings stop the blocked parts of a jump", () => {
  const corner = (x, y, z) => y < 1 || x >= 1 || z >= 1 || y === 3;
  const player = playerAt();
  tick(player, { forward: -1, side: 1, jump: true }, corner);
  for (let i = 0; i < 90; i++) {
    tick(player, { forward: -1, side: 1 }, corner);
    assert.ok(player.y <= 1.24 + 1e-7);
  }
  nearly(player.x, .72);
  nearly(player.z, .72);
  nearly(player.y, 1);
  assert.equal(player.grounded, true);
});

test("stepping off a ledge removes ground support and placement uses the same bounds", () => {
  const ledge = (x, y) => x < 1 && y < 1;
  const player = playerAt();
  repeat(55, player, { side: 1 }, ledge);
  assert.ok(player.x > 1.28 && player.y < 1 && !player.grounded);
  assert.equal(overlapsPlayerBlock(playerAt({ x: .72 }), 1, 1, 0), false);
  assert.equal(overlapsPlayerBlock(playerAt({ x: .73 }), 1, 1, 0), true);
});

test("walking off a ledge leaves 0.1s of coyote time to jump", () => {
  const ledge = (x, y) => x < 1 && y < 1;
  const player = playerAt();
  let ticks = 0;
  while (player.grounded && ticks < 120) { tick(player, { side: 1 }, ledge); ticks++; }
  assert.ok(!player.grounded);
  // Still inside the 0.1s coyote window, so this jump fires even though the
  // player is already airborne.
  assert.equal(tick(player, { jump: true }, ledge).jumped, true);
  assert.ok(player.vy > 0);
});

test("coyote time expires, so a late jump in mid-air does nothing", () => {
  const ledge = (x, y) => x < 1 && y < 1;
  const player = playerAt();
  let ticks = 0;
  while (player.grounded && ticks < 120) { tick(player, { side: 1 }, ledge); ticks++; }
  assert.ok(!player.grounded);
  repeat(20, player, {}, ledge); // ~0.17s, past the 0.1s window
  assert.equal(tick(player, { jump: true }, ledge).jumped, false);
});

test("a jump pressed just before landing fires on landing (0.18s buffer)", () => {
  // Drop 0.15 blocks: ~0.12s of falling, inside the .18s buffer.
  const player = playerAt({ y: 1.15, vy: 0, grounded: false });
  assert.equal(tick(player, { jump: true }).jumped, false);
  let jumped = false;
  for (let i = 0; i < 30 && !jumped; i++) jumped = tick(player).jumped;
  assert.equal(jumped, true);
});

test("a jump pressed too early expires before landing", () => {
  // Drop 0.6 blocks: ~0.25s of falling, past the .18s buffer.
  const player = playerAt({ y: 1.6, vy: 0, grounded: false });
  assert.equal(tick(player, { jump: true }).jumped, false);
  let jumped = false;
  for (let i = 0; i < 60 && !jumped; i++) jumped = tick(player).jumped;
  assert.equal(jumped, false);
  assert.equal(player.grounded, true);
});

test("the beacon is swept as a solid obstacle from any approach speed", () => {
  const player = playerAt({ x: 0, y: 1.2, vx: 160, grounded: false });
  tick(player, {}, floor, [.6, 1, 0, .8, 2.93, 1]);
  nearly(player.x, .32);
  nearly(player.vx, 0);
});
