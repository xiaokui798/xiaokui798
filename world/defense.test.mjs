import test from "node:test";
import assert from "node:assert/strict";
import { BEACON, DEFENSE_WAVES, ENEMIES, choosesBeacon, selectWaveSpawns, repairPlan, defenseResult,
  findMeleeTarget } from "./defense.mjs";

test("five authored waves introduce pressure before the combined final wave", () => {
  assert.equal(DEFENSE_WAVES.length, 5);
  assert.deepEqual(DEFENSE_WAVES[0].enemies, ["walker", "runner"]);
  assert.equal(DEFENSE_WAVES[2].enemies[0], "breaker");
  assert.equal(DEFENSE_WAVES[4].enemies.filter(enemy => enemy === "breaker").length, 2);
  assert.ok(DEFENSE_WAVES.every(wave => wave.enemies.length <= 7 && wave.enemies.every(enemy => Boolean(ENEMIES[enemy]))));
  assert.ok(ENEMIES.runner.speed > ENEMIES.walker.speed);
  assert.ok(ENEMIES.breaker.armor && ENEMIES.breaker.strikeDelay > ENEMIES.walker.strikeDelay);
});

test("target selection reflects the enemy role and available routes", () => {
  assert.equal(choosesBeacon("breaker", false, 9, true, false), false);
  assert.equal(choosesBeacon("breaker", true, 2, true, true), true);
  assert.equal(choosesBeacon("breaker", true, 2, true, false), false);
  assert.equal(choosesBeacon("runner", true, 3, true, true), false);
  assert.equal(choosesBeacon("runner", true, 8, true, true), true);
  assert.equal(choosesBeacon("runner", true, 8, true, false), false);
  assert.equal(choosesBeacon("walker", true, 8, true, true), false);
  assert.equal(choosesBeacon("walker", true, 8, false, true), true);
});

test("a wave spawns its whole roster, including in tight terrain", () => {
  const roster = ["breaker", "runner", "walker"];
  const candidates = [0, 1, 2].map(x => ({ x, z: 0, cell: x, side: x % 2 === 0 }));
  assert.deepEqual(selectWaveSpawns(roster, candidates.slice(0, 2), true), []);
  const complete = selectWaveSpawns(roster, candidates, true);
  assert.deepEqual(complete.map(spawn => spawn.kind), roster);
  assert.deepEqual(complete.map(spawn => spawn.cell), [0, 1, 2]);
});

test("repair requires material and cannot overheal", () => {
  assert.deepEqual(repairPlan(BEACON.hp, 5), { reason: "full" });
  assert.deepEqual(repairPlan(90, 2), { reason: "materials" });
  assert.deepEqual(repairPlan(106, 3), { cost: 3, restored: 14 });
  assert.deepEqual(repairPlan(40, 3), { cost: 3, restored: 30 });
});

test("only clearing wave five wins, and all three failure cases end the run", () => {
  assert.equal(defenseResult(4, 0, 80, 64, 0), "playing");
  assert.equal(defenseResult(5, 1, 80, 64, 3), "playing");
  assert.equal(defenseResult(5, 0, 80, 64, 0), "cleared");
  assert.equal(defenseResult(5, 2, 0, 64, 3), "beacon-destroyed");
  assert.equal(defenseResult(5, 2, 80, 0, 3), "player-down");
  assert.equal(defenseResult(5, 2, 80, 64, 0), "timeout");
});

test("melee targets visible body parts and respects terrain and beacon cover", () => {
  const zombie = { x: 0, y: 0, z: -2, kind: "walker", angle: 0, walk: 0 };
  const direction = [0, 0, -1];
  const aim = (origin, limit = 7, beacon = null) => findMeleeTarget(origin, direction, limit, [zombie], beacon, 0);
  assert.equal(aim([0, 1.5, 0]).zombie, zombie);
  assert.equal(aim([.38, .95, 0]).zombie, zombie);
  assert.equal(aim([.38, 1.5, 0]), null);
  assert.equal(aim([0, 1.5, 0], 1.2), null);
  assert.equal(aim([0, 1.5, 0], 7, { x: 0, y: 0, z: -1, hp: 120 }), null);
});
