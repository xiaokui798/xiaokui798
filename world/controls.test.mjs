import test from "node:test";
import assert from "node:assert/strict";
import { createMouseLook, normalizeSensitivity } from "./controls.mjs";

function settle(look, dt = 1 / 60) {
  let x = 0, y = 0;
  for (let frame = 0; frame < 24; frame++) {
    const [dx, dy] = look.advance(dt);
    x += dx; y += dy;
  }
  return [x, y];
}

test("sensitivity defaults safely and changes normal mouse movement proportionally", () => {
  assert.equal(normalizeSensitivity(null), 40);
  assert.equal(normalizeSensitivity("invalid"), 40);
  assert.equal(normalizeSensitivity(500), 100);
  const look = createMouseLook();
  look.push(40, -16, "locked");
  const [dx, dy] = settle(look);
  assert.ok(Math.abs(dx - .052) < .0002 && Math.abs(dy + .0208) < .0002);
  look.setSensitivity(20);
  look.push(40, -16, "locked");
  assert.ok(Math.abs(settle(look)[0] - dx / 2) < .0002);
});

test("pointer re-lock and abnormal deltas don't kick the view", () => {
  const look = createMouseLook();
  look.push(260, 3, "locked");
  look.push(Infinity, 1, "locked");
  assert.deepEqual(look.advance(.016), [0, 0]);
  look.push(20, 0, "locked");
  assert.ok(look.advance(.016)[0] > 0);
  look.reset();
  look.push(2200, -700, "locked");
  assert.deepEqual(look.advance(.016), [0, 0]);
});

test("small mouse turns come through promptly without changing sensitivity", () => {
  const look = createMouseLook();
  const fullTurn = 40 * .00325 * .40;
  look.push(40, 0, "locked");
  const [firstFrame] = look.advance(1 / 60);
  assert.ok(firstFrame > fullTurn * .65);
  assert.ok(Math.abs(firstFrame + settle(look)[0] - fullTurn) < .0002);
});

test("a burst of valid deltas is bounded even after a dropped frame", () => {
  const look = createMouseLook(100);
  look.push(20, 10, "locked");
  for (let i = 0; i < 30; i++) look.push(120, -90, "locked");
  // The queue cap is now .75rad (was .19rad): a dropped frame may deliver the
  // whole capped burst at once, but the total turn never exceeds the cap even
  // though 31 pushes queued ~12rad of input.
  const first = Math.hypot(...look.advance(.15));
  assert.ok(first > .7 && first <= .75000001);
  assert.deepEqual(look.advance(.016), [0, 0]);
});

test("a large flick is delivered in full instead of being truncated", () => {
  const look = createMouseLook();
  // Prime the first-sample guard, then drain it so only the flick is measured.
  look.push(10, 0, "locked");
  settle(look);
  look.push(500, 0, "locked");
  // 500px at the default 40% sensitivity is 500 * .00325 * .40 = .65rad;
  // the old .19rad queue cap would have delivered less than a third of it.
  assert.ok(Math.abs(settle(look)[0] - .65) < .0005);
});

test("fast but plausible coalesced events continue to turn at the bounded rate", () => {
  const look = createMouseLook();
  look.push(10, 0, "locked");
  look.advance(.016);
  look.push(580, 0, "locked");
  const [x] = look.advance(.016);
  // 580px at 40% queues ~.75rad (capped); one 60fps frame drains
  // 15rad/s * 1/60s = .25rad of it. The old bound (.07, .11] was the old
  // .11rad/frame cap.
  assert.ok(x > .20 && x <= .25);
});

test("dragging uses the same gain and turn limit as locked look", () => {
  const look = createMouseLook();
  look.push(500, 500, "drag");
  assert.ok(Math.hypot(...look.advance(.05)) <= .75000001);
  look.reset();
  assert.deepEqual(look.advance(.05), [0, 0]);
  // Same hand movement, same turn: drag used to be 2.46x the locked gain.
  const locked = createMouseLook(), drag = createMouseLook();
  for (const [l, mode] of [[locked, "locked"], [drag, "drag"]]) {
    l.push(10, 0, mode);
    l.advance(1 / 60);
    l.push(200, 100, mode);
  }
  const [lx, ly] = settle(locked), [dx, dy] = settle(drag);
  assert.ok(Math.abs(lx - dx) < .0005 && Math.abs(ly - dy) < .0005);
});
