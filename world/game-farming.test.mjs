import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mountGame, seedProgress, sharedStorage, v5SaveWithSeeds, v5SaveForCooking, takeHitsUntil, nearestZombieVertex, steerTowardVertex, swingAtNearestZombie } from "./game-harness.mjs";
import { BLOCK, SAVE_KEY, V4_SAVE_KEY, PROGRESS_KEY, createProgression, saveProgress } from "./progression.mjs";
import { SURVIVAL_DIFFICULTY, survivalRoster, hpMultiplier, scaledHp } from "./difficulty.mjs";
import { ENEMIES, defenseWaveRoster } from "./defense.mjs";
import { WORLD, voxelIndex } from "./terrain.mjs";

// Farming, cooking & hunger integration tests: sowing/growth/harvest, watering/fertilizing, farm tab, dishes & buffs, hunger drain/regen. Split from game.test.mjs (batch 108).

function settledAimCell(game, frame) {
  for (let i = 0; i < 60; i++) frame();
  for (let i = 0; i < 6; i++) game.document.emit("mousemove", { movementX: 0, movementY: 65 });
  for (let i = 0; i < 10; i++) frame();
  assert.ok(game.target, "aiming down targets a block");
  const before = game.target.join(",");
  for (let i = 0; i < 5; i++) frame();
  assert.equal(game.target.join(","), before, "the aim is settled");
  return game.target;
}

// The top y of the crop box at this cell in the last actor-mesh upload:
// the crop is the only actor mesh in its cell's footprint, and its top
// is cellY + its cropVisual height for its growth (batch 102: 0.06 for
// seed grains, growing continuously to 0.85 at maturity).

function cropTopY(game, cell) {
  const [x, y, z] = cell;
  let top = -Infinity;
  const vertices = game.actorVertices ?? [];
  for (let v = 0; v + 2 < vertices.length; v += 12) {
    const vx = vertices[v], vy = vertices[v + 1], vz = vertices[v + 2];
    if (vx >= x + .24 && vx <= x + .76 && vz >= z + .24 && vz <= z + .76 && vy > y + .01) {
      top = Math.max(top, vy);
    }
  }
  return top;
}

function probeSoilCell() {
  const probeData = new Map();
  const probeStorage = { getItem: key => probeData.get(key) ?? null, setItem: (key, value) => probeData.set(key, value) };
  const probe = mountGame({ storage: probeStorage, pointerLock: true });
  let probeTime = 16;
  const probeFrame = () => probe.frame(probeTime += 20);
  probe.click("start-button");
  probe.grantPointerLock();
  return settledAimCell(probe, probeFrame);
}

function eatFromBackpack(game, frame, key) {
  game.key("KeyC");
  frame();
  assert.equal(game.get("inventory-screen").hidden, false);
  assert.equal(game.get(`use-${key}`).disabled, false, `${key} must be eatable now`);
  game.click(`use-${key}`);
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("inventory-screen").hidden, true);
}

// The game's own measured ground speed (the speed readout records the
// actual velocity after every physics step), sampled at steady state
// after a settle, walking the spawn view's proven-open eastward path.

function measureSpeedReadout(game, frame, expected) {
  // The spawn ground has trees: a single fixed heading can run into a
  // trunk and read a wall-slide instead of the cap. Try the four
  // headings in turn and keep the first that settles exactly on the
  // expected cap; a blocked or sliding heading never reads the cap.
  let last = 0;
  for (const key of ["KeyD", "KeyW", "KeyA", "KeyS"]) {
    game.key(key);
    for (let i = 0; i < 40; i++) frame();
    last = Number(game.get("speed-current").textContent);
    game.release(key);
    if (Math.abs(last - expected) < 0.005) return last;
    for (let i = 0; i < 15; i++) frame();
  }
  return last;
}

// (No camera-displacement measure: the ground east of spawn is walled
// by a hill face the player slides along, so displacement over a fixed
// window is terrain luck. The speed readout above is the game's own
// per-step velocity record — the same oracle the pre-existing speed
// tests assert on — and it is exact.)

// Pass game time standing still, topping up with a KeyH dressing
// whenever the wave-1 zombies chew the player to 50: circling or
// running out the clock gets the player cornered or killed. Since
// batch 86 food feeds hunger instead of health, the top-up is a
// dressing — KeyH needs no bag detour, so the buff clock never
// pauses and every frame counts.

function passGameTime(game, frame, frames, hp) {
  let passed = 0;
  while (passed < frames) {
    if (hp() <= 50) game.key("KeyH");
    frame();
    passed++;
  }
}

// Turn in small steps until a zombie is in the crosshair AND inside
// sword reach (the status line names zombies beyond reach too, with
// a 超出攻击距离 hint), then swing at it — repeating like the combat
// tests do, since a single click can land between the zombie's steps
// — until a hit message with exactly the expected damage appears.
// The survival sword is the stone sword (27 base damage).

function punchSpitter(game, frame, damageText) {
  const wanted = `命中投掷者 · 伤害 ${damageText}`;
  let holding = false;
  for (let i = 0; i < 3000; i++) {
    frame();
    // The status line keeps its last text when the aim empties (it
    // only hides), so a match counts only while it is visible. The
    // spitter holds its distance, so the player walks to it (the
    // shared steering helpers) until the status reads in-range.
    const statusElement = game.get("target-status");
    const status = statusElement.textContent;
    if (!statusElement.hidden && status.includes("投掷者") && !status.includes("超出攻击距离")) {
      if (holding) { game.release("KeyW"); holding = false; }
      game.get("game").emit("mousedown", { button: 0 });
      if (game.get("message").textContent === wanted) return;
    } else {
      const target = nearestZombieVertex(game);
      if (target) {
        steerTowardVertex(game, target);
        if (!holding) { game.key("KeyW"); holding = true; }
      }
    }
  }
  if (holding) game.release("KeyW");
  assert.fail(`no hit with damage ${damageText} landed within 3000 frames (last message: ${game.get("message").textContent})`);
}

// The whole seconds a HUD buff line currently claims.

function buffSeconds(game, kind) {
  const match = /还剩 (\d+) 秒/.exec(game.get(`hud-buff-${kind}`).textContent);
  return match ? Number(match[1]) : null;
}

test("KeyF plants a wheat seed on the aimed grass", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds()]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  const soil = settledAimCell(game, frame);
  game.key("KeyF");
  frame();
  assert.equal(game.get("message").textContent, "种下了小麦种子");
  const saved = JSON.parse(data.get(SAVE_KEY));
  assert.equal(saved.seeds.wheatSeed, 4);
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  assert.equal(saved.crops[cropCell].crop, "wheat");
  assert.equal(saved.crops[cropCell].stage, 0);
  assert.equal(saved.crops[cropCell].growth, 0);
  assert.ok(saved.crops[cropCell].plantedAt >= 30);
  assert.equal(saved.stats.cropsPlanted, 1);
  // A second KeyF on the same cell is refused (already planted).
  game.key("KeyF");
  frame();
  assert.equal(game.get("message").textContent, "这里已经种了作物");
});

test("KeyF with no seeds says so instead of planting", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 0, wheat: 0 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  game.key("KeyF");
  frame();
  assert.equal(game.get("message").textContent, "没有小麦种子（投掷者会掉）");
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)).crops, {});
});

// Probe the aim cell in a throwaway game, so the crop under test sits
// where the camera can see it (the terrain and the spawn are fixed, so
// the settled aim is the same in both mounts).

test("a crop grows on game time: its stage flips after one stage of growth", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  // A crop 2s short of stage 1 (growth 118, a stage lasts 120s): the
  // 75-frame settle grows it 1.48s (to 119.48, still stage 0), and the
  // 60 frames below grow it 1.2s more (to 120.68, stage 1).
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 0, wheat: 0 },
    { [cropCell]: { crop: "wheat", stage: 0, plantedAt: 30, growth: 118 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  const cell = [soil[0], soil[1] + 1, soil[2]];
  // Batch 102: the visible height follows growth continuously, not the
  // stage. At growth ~119.5 the stalk is ~0.43 above the soil.
  const topBefore = cropTopY(game, cell);
  assert.ok(Math.abs(topBefore - (cell[1] + .43)) < .02, `growing top is ${topBefore}`);
  // 60 frames is 1.2s of game time: the growth crosses 120s and the
  // stage flips to 1 — but the height must NOT jump (the old stage
  // heights leapt 0.35 -> 0.6 here); it grows by under 0.03.
  for (let i = 0; i < 60; i++) frame();
  const topAfter = cropTopY(game, cell);
  assert.ok(topAfter > topBefore && topAfter - topBefore < .03, `no jump at the stage flip: ${topBefore} -> ${topAfter}`);
});

test("a crop renders as tiny seed grains when sown and full-size when mature (batch 102)", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const cell = [soil[0], soil[1] + 1, soil[2]];
  const mountWith = growth => {
    const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 0, wheat: 0 },
      { [cropCell]: { crop: "wheat", stage: growth >= 240 ? 2 : 0, plantedAt: 30, growth } })]]);
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const game = mountGame({ storage, pointerLock: true });
    let time = 16;
    const frame = () => game.frame(time += 20);
    game.click("start-button");
    game.grantPointerLock();
    settledAimCell(game, frame);
    return game;
  };
  // Just sown: the grains top out at 0.06 above the soil — nowhere near
  // the old 0.35 stage-0 box the player reported.
  const sown = mountWith(0);
  assert.ok(Math.abs(cropTopY(sown, cell) - (cell[1] + .06)) < .02, `sown top is ${cropTopY(sown, cell)}`);
  // Mature: the full 0.85 stalk.
  const mature = mountWith(240);
  assert.ok(Math.abs(cropTopY(mature, cell) - (cell[1] + .85)) < .02, `mature top is ${cropTopY(mature, cell)}`);
});

test("clicking the soil under a mature crop harvests it with the sword in hand", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 1, wheat: 0 },
    { [cropCell]: { crop: "wheat", stage: 2, plantedAt: 30, growth: 240 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  assert.equal(game.target.join(","), soil.join(","), "the aim is the same soil as the probe");
  // No slot switch: the spawn auto-equips the stone sword, and
  // the click harvests instead of swinging (batch 70).
  game.get("game").emit("mousedown", { button: 0 });
  frame();
  assert.equal(game.get("message").textContent, "收获了小麦 +2 · 小麦种子 +1");
  assert.equal(game.get("weapon-recovery").value, 100, "the click harvested; no swing was spent");
  const saved = JSON.parse(data.get(SAVE_KEY));
  assert.equal(saved.seeds.wheat, 2);
  assert.equal(saved.seeds.wheatSeed, 2);
  assert.deepEqual(saved.crops, {});
  assert.equal(saved.stats.cropsHarvested, 1);
  game.document.emit("mouseup", { button: 0 });
});

test("with the sword in hand, clicks away from a mature crop still swing", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  // Case 1: plain soil, no crop — the click swings: nothing
  // mined, nothing harvested, the swing spends the cooldown.
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 1, wheat: 0 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  assert.equal(game.target.join(","), soil.join(","));
  const messageBefore = game.get("message").textContent;
  game.get("game").emit("mousedown", { button: 0 });
  frame();
  assert.ok(game.get("weapon-recovery").value < 100, "the click spent a swing");
  assert.equal(game.get("message").textContent, messageBefore, "a swing writes no block message");
  let saved = JSON.parse(data.get(SAVE_KEY));
  assert.equal(saved.stats.blocksMined, 0);
  assert.deepEqual(saved.edits, []);
  game.document.emit("mouseup", { button: 0 });
  // Case 2: an immature crop's soil — still a swing, so the
  // crop is not uprooted either (only maturity earns the
  // harvest preference).
  const data2 = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 1, wheat: 0 },
    { [cropCell]: { crop: "wheat", stage: 0, plantedAt: 30, growth: 0 } })]]);
  const storage2 = { getItem: key => data2.get(key) ?? null, setItem: (key, value) => data2.set(key, value) };
  const game2 = mountGame({ storage: storage2, pointerLock: true });
  let time2 = 16;
  const frame2 = () => game2.frame(time2 += 20);
  game2.click("start-button");
  game2.grantPointerLock();
  settledAimCell(game2, frame2);
  game2.get("game").emit("mousedown", { button: 0 });
  frame2();
  assert.ok(game2.get("weapon-recovery").value < 100, "the immature crop's click also spent a swing");
  saved = JSON.parse(data2.get(SAVE_KEY));
  assert.deepEqual(Object.keys(saved.crops), [String(cropCell)], "the immature crop survives the sword click");
  assert.equal(saved.stats.blocksMined, 0);
  game2.document.emit("mouseup", { button: 0 });
});

test("clicking the soil under a mature crop harvests it", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 1, wheat: 0 },
    { [cropCell]: { crop: "wheat", stage: 2, plantedAt: 30, growth: 240 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  assert.equal(game.target.join(","), soil.join(","), "the aim is the same soil as the probe");
  // This test keeps the block-slot route covered; since batch
  // 70 the sword in hand harvests too (pinned by the tests
  // below), so the slot switch is a choice here, not a need.
  game.key("Digit1");
  frame();
  game.get("game").emit("mousedown", { button: 0 });
  frame();
  assert.equal(game.get("message").textContent, "收获了小麦 +2 · 小麦种子 +1");
  const saved = JSON.parse(data.get(SAVE_KEY));
  assert.equal(saved.seeds.wheat, 2);
  assert.equal(saved.seeds.wheatSeed, 2);
  assert.deepEqual(saved.crops, {});
  assert.equal(saved.stats.cropsHarvested, 1);
  game.document.emit("mouseup", { button: 0 });
});

test("mining the soil under an immature crop uproots it", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 1, wheat: 0 },
    { [cropCell]: { crop: "wheat", stage: 0, plantedAt: 30, growth: 0 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  game.key("Digit1");
  frame();
  game.get("game").emit("mousedown", { button: 0 });
  frame();
  assert.match(game.get("message").textContent, /作物被连根拔起/);
  assert.notEqual(game.target.join(","), soil.join(","), "the click mines the aimed soil");
  const saved = JSON.parse(data.get(SAVE_KEY));
  assert.deepEqual(saved.crops, {});
  assert.equal(saved.seeds.wheat, 0);
  game.document.emit("mouseup", { button: 0 });
});

test("the watering can is crafted in the farm tab, and watering without it says what is missing", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 2, wheat: 0, fertilizer: 0 },
    { [cropCell]: { crop: "wheat", stage: 0, plantedAt: 30, growth: 0 } }, [0, 0, 0, 0, 3, 2])]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  assert.equal(game.target.join(","), soil.join(","), "the aim is the soil under the crop");
  // No can yet: the watering key names what is missing and where
  // it is made, and the crop stays unwatered.
  game.key("KeyJ");
  frame();
  assert.equal(game.get("message").textContent, "没有洒水壶（木头 3 + 树叶 2，在种田页签制作）");
  // The tab, not the disk, is the honest read here: the save text
  // still holds the seeded record until a write re-serializes it.
  game.key("KeyC");
  frame();
  game.click("tab-btn-farm");
  assert.doesNotMatch(game.get("farm-crops").innerHTML, /已浇水/);
  // Craft it in the farm tab (already open from the check above):
  // the toast names the can, the row flips to owned, the button
  // disables, the save records it.
  assert.match(game.get("farm-watering-can-cost").textContent, /木头 3\/3 · 树叶 2\/2/);
  assert.equal(game.get("craft-watering-can").disabled, false);
  game.click("craft-watering-can");
  frame();
  assert.equal(game.get("craft-toast-name").textContent, "洒水壶");
  assert.equal(game.get("farm-watering-can-cost").textContent, "已拥有 · 对准作物按 J 浇水");
  assert.equal(game.get("craft-watering-can").disabled, true);
  assert.equal(JSON.parse(data.get(SAVE_KEY)).wateringCanOwned, true);
});

test("KeyJ waters the aimed crop once, and refuses a second watering", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const save = JSON.parse(v5SaveWithSeeds({ wheatSeed: 2, wheat: 0, fertilizer: 0 },
    { [cropCell]: { crop: "wheat", stage: 0, plantedAt: 30, growth: 0 } }));
  save.wateringCanOwned = true;
  const data = new Map([[SAVE_KEY, JSON.stringify(save)]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  assert.equal(game.target.join(","), soil.join(","), "the aim is the soil under the crop");
  game.key("KeyJ");
  frame();
  assert.equal(game.get("message").textContent, "给小麦浇了水，长得更快了");
  assert.equal(JSON.parse(data.get(SAVE_KEY)).crops[cropCell].watered, true);
  // A second watering is refused — one lasts the whole cycle.
  game.key("KeyJ");
  frame();
  assert.equal(game.get("message").textContent, "这株作物已经浇过水了");
});

test("KeyE batch-harvests every mature crop in reach and leaves the rest standing", () => {
  const soil = probeSoilCell();
  const near1 = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const near2 = voxelIndex(WORLD, soil[0] + 1, soil[1] + 1, soil[2]);
  const immature = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2] + 1);
  const far = voxelIndex(WORLD, soil[0] + 12, soil[1] + 1, soil[2]);
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 1, wheat: 0, fertilizer: 0 }, {
    [near1]: { crop: "wheat", stage: 2, plantedAt: 30, growth: 240 },
    [near2]: { crop: "wheat", stage: 2, plantedAt: 30, growth: 240 },
    [immature]: { crop: "wheat", stage: 0, plantedAt: 30, growth: 0 },
    [far]: { crop: "wheat", stage: 2, plantedAt: 30, growth: 240 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  game.key("KeyE");
  frame();
  assert.equal(game.get("message").textContent, "批量收获 2 株：小麦 +4 · 小麦种子 +2");
  const saved = JSON.parse(data.get(SAVE_KEY));
  assert.equal(saved.seeds.wheat, 4);
  assert.equal(saved.seeds.wheatSeed, 3);
  assert.equal(saved.stats.cropsHarvested, 2);
  assert.deepEqual(Object.keys(saved.crops).map(Number).sort((a, b) => a - b), [immature, far].sort((a, b) => a - b),
    "the immature crop and the out-of-reach crop are left standing");
  // Nothing mature in reach any more: the key says so instead of
  // silently doing nothing.
  game.key("KeyE");
  frame();
  assert.equal(game.get("message").textContent, "附近没有成熟的作物");
});

test("KeyE batch harvest pays the harvest tech's +1 on every crop", () => {
  const soil = probeSoilCell();
  const near1 = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const near2 = voxelIndex(WORLD, soil[0] + 1, soil[1] + 1, soil[2]);
  const save = JSON.parse(v5SaveWithSeeds({ wheatSeed: 1, wheat: 0, fertilizer: 0 }, {
    [near1]: { crop: "wheat", stage: 2, plantedAt: 30, growth: 240 },
    [near2]: { crop: "wheat", stage: 2, plantedAt: 30, growth: 240 } }));
  save.techUnlocked = ["bountifulHarvest"];
  const data = new Map([[SAVE_KEY, JSON.stringify(save)]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  game.key("KeyE");
  frame();
  // Two crops, each paying the bonused 3 wheat + 2 seeds — the
  // batch settles exactly like two single-crop harvests would.
  assert.equal(game.get("message").textContent, "批量收获 2 株：小麦 +6 · 小麦种子 +4");
  const saved = JSON.parse(data.get(SAVE_KEY));
  assert.equal(saved.seeds.wheat, 6);
  assert.equal(saved.seeds.wheatSeed, 5);
  assert.equal(saved.stats.cropsHarvested, 2);
});

// Farming (R3): the farm tab, sow mode, fertilizer (KeyG), mature notices.

test("the farm tab is fifth and last, with seed counts, sow rows and a crop list", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 5, wheat: 0, fertilizer: 0 },
    { [cropCell]: { crop: "wheat", stage: 0, plantedAt: 30, growth: 100 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  const panel = game.document.querySelector("#inventory-screen .inventory-panel");
  game.click("tab-btn-farm");
  assert.equal(game.get("tab-farm").hidden, false);
  assert.equal(game.get("tab-backpack").hidden, true);
  assert.equal(game.get("tab-tech").hidden, true);
  assert.equal(panel.classList.contains("wide"), false, "the farm tab stays 38rem, not wide");
  assert.equal(game.get("tab-btn-farm").classList.contains("secondary-button"), false);
  // The material strip shows every farm material, 0 included.
  const strip = game.get("farm-materials").innerHTML;
  assert.match(strip, /小麦种子/);
  assert.match(strip, /<dd>5<\/dd>/);
  assert.match(strip, /小麦/);
  assert.match(strip, /腐叶/);
  assert.match(strip, /<dd>0<\/dd>/);
  // The sow row names the seed count; the compost row names its cost.
  assert.equal(game.get("farm-sow-wheatSeed-cost").textContent, "已有 5 粒 · 对准耕地播种");
  assert.equal(game.get("farm-sow-wheatSeed-btn").disabled, false);
  assert.match(game.get("farm-fertilizer-cost").textContent, /树叶 0\/2 · 泥土 10\/1/);
  assert.equal(game.get("craft-fertilizer").disabled, true, "no leaves, so no compost");
  // The planted crop is one row: growth in days, a 42% bar (100/240s).
  const crops = game.get("farm-crops").innerHTML;
  assert.match(crops, /小麦 · 生长中 · 0\.4 \/ 1 天/);
  assert.match(crops, /width: 42%/);
  assert.doesNotMatch(crops, /已成熟/);
  assert.equal(game.get("farm-empty").hidden, true, "a planted crop hides the empty line");
});

test("the farm tab's empty line says why, and the sow button disables with no seeds", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 0, wheat: 0, fertilizer: 0 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  game.click("tab-btn-farm");
  assert.equal(game.get("farm-sow-wheatSeed-cost").textContent, "已有 0 粒 · 投掷者掉落");
  assert.equal(game.get("farm-sow-wheatSeed-btn").disabled, true);
  assert.equal(game.get("farm-empty").hidden, false);
  assert.equal(game.get("farm-empty").textContent, "还没有种子——投掷者掉落小麦种子，开局自带 2 粒");
  assert.equal(game.get("farm-crops").innerHTML, "");
});

test("the farm tab crafts compost from its own row", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 5, wheat: 0, fertilizer: 0 }, {},
    [0, 0, 10, 0, 2, 10])]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  game.click("tab-btn-farm");
  assert.equal(game.get("craft-fertilizer").disabled, false);
  game.click("craft-fertilizer");
  assert.match(game.get("inventory-notice").textContent, /已制作腐叶/);
  assert.match(game.get("farm-materials").innerHTML, /腐叶<\/dt><dd>1<\/dd>/);
  assert.match(game.get("farm-fertilizer-cost").textContent, /树叶 8\/2 · 泥土 9\/1/);
});

test("sow mode plants on a click and the hint goes away", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds()]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  const soil = settledAimCell(game, frame);
  game.key("KeyC");
  frame();
  assert.equal(game.get("inventory-screen").hidden, false);
  game.click("tab-btn-farm");
  game.click("farm-sow-wheatSeed-btn");
  // The bag closes and the HUD hint comes up.
  assert.equal(game.get("inventory-screen").hidden, true);
  assert.equal(game.get("sow-hint").hidden, false);
  assert.match(game.get("sow-hint").innerHTML, /播种：对准耕地/);
  game.grantPointerLock();
  frame();
  // A left-click on the aimed grass plants, spends the seed, ends mode.
  game.get("game").emit("mousedown", { button: 0 });
  frame();
  assert.equal(game.get("message").textContent, "种下了小麦种子");
  assert.equal(game.get("sow-hint").hidden, true);
  const saved = JSON.parse(data.get(SAVE_KEY));
  assert.equal(saved.seeds.wheatSeed, 4);
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  assert.equal(saved.crops[cropCell].crop, "wheat");
  game.document.emit("mouseup", { button: 0 });
});

test("a non-plantable click in sow mode cancels the mode and mines instead", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds()]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  const soil = settledAimCell(game, frame);
  // Place a dirt block on the grass, so the aim above is dirt — not
  // plantable. The placed block sits one cell above the soil.
  game.key("Digit2");
  frame();
  game.get("game").emit("mousedown", { button: 2 });
  frame();
  game.document.emit("mouseup", { button: 2 });
  assert.equal(game.target[1], soil[1] + 1, "the aim is the placed dirt now");
  assert.equal(JSON.parse(data.get(SAVE_KEY)).materials[2], 9, "one dirt spent on the place");
  // F on dirt says so — and arms sow mode, the backup entry.
  game.key("KeyF");
  frame();
  assert.equal(game.get("message").textContent, "只能种在草地上");
  assert.equal(game.get("sow-hint").hidden, false);
  // A left-click on the dirt cancels the mode and mines the dirt: the
  // mode never swallows the action.
  const dirt = game.target;
  game.get("game").emit("mousedown", { button: 0 });
  frame();
  game.document.emit("mouseup", { button: 0 });
  assert.equal(game.get("sow-hint").hidden, true, "the mode is off");
  assert.notEqual(game.target.join(","), dirt.join(","), "the click mined the dirt");
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)).crops, {}, "nothing was planted");
});

test("right-click and Esc cancel sow mode without planting", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds()]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  game.key("KeyC");
  frame();
  game.click("tab-btn-farm");
  game.click("farm-sow-wheatSeed-btn");
  assert.equal(game.get("sow-hint").hidden, false);
  game.grantPointerLock();
  frame();
  // Right-click cancels; no block is placed and nothing is planted.
  game.get("game").emit("mousedown", { button: 2 });
  frame();
  assert.equal(game.get("sow-hint").hidden, true);
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)).crops, {});
  // Arm it again (F on the aimed grass plants directly, so arm it from
  // the tab instead) and cancel with Esc.
  game.key("KeyC");
  frame();
  game.click("tab-btn-farm");
  game.click("farm-sow-wheatSeed-btn");
  assert.equal(game.get("sow-hint").hidden, false);
  game.grantPointerLock();
  frame();
  game.key("Escape");
  frame();
  assert.equal(game.get("sow-hint").hidden, true);
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)).crops, {});
});

test("KeyG fertilizes the aimed crop, and refuses a second dose", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 5, wheat: 0, fertilizer: 2 },
    { [cropCell]: { crop: "wheat", stage: 0, plantedAt: 30, growth: 0 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  assert.equal(game.target.join(","), soil.join(","), "the aim is the soil under the crop");
  game.key("KeyG");
  frame();
  assert.equal(game.get("message").textContent, "给小麦施了腐叶，长得更快了");
  const saved = JSON.parse(data.get(SAVE_KEY));
  assert.equal(saved.seeds.fertilizer, 1);
  assert.equal(saved.crops[cropCell].fertilized, true);
  // A second dose on the same plant is refused, compost unspent.
  game.key("KeyG");
  frame();
  assert.equal(game.get("message").textContent, "这株作物已经施过肥了");
  assert.equal(JSON.parse(data.get(SAVE_KEY)).seeds.fertilizer, 1);
});

test("KeyG with no compost or no crop says so", () => {
  const soil = probeSoilCell();
  const cropCell = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  // A crop, but no compost.
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 5, wheat: 0, fertilizer: 0 },
    { [cropCell]: { crop: "wheat", stage: 0, plantedAt: 30, growth: 0 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  game.key("KeyG");
  frame();
  assert.match(game.get("message").textContent, /没有腐叶/);
  // The farm tab shows the crop still unfertilized (the save text holds
  // the pre-R3 record shape until a write re-serializes it, so the tab
  // — not the disk — is the honest read here).
  game.key("KeyC");
  frame();
  game.click("tab-btn-farm");
  assert.doesNotMatch(game.get("farm-crops").innerHTML, /已施肥/);
  // No crop at all: aiming at bare grass.
  const data2 = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 5, wheat: 0, fertilizer: 2 })]]);
  const storage2 = { getItem: key => data2.get(key) ?? null, setItem: (key, value) => data2.set(key, value) };
  const game2 = mountGame({ storage: storage2, pointerLock: true });
  let time2 = 16;
  const frame2 = () => game2.frame(time2 += 20);
  game2.click("start-button");
  game2.grantPointerLock();
  settledAimCell(game2, frame2);
  game2.key("KeyG");
  frame2();
  assert.equal(game2.get("message").textContent, "对准一株作物再施肥");
});

test("a crop maturing announces itself once, several at once in one line", () => {
  const soil = probeSoilCell();
  const cellA = voxelIndex(WORLD, soil[0], soil[1] + 1, soil[2]);
  const cellB = voxelIndex(WORLD, soil[0] + 1, soil[1] + 1, soil[2]);
  // Both crops 2s short of maturity (growth 238): the 75-frame settle
  // grows them 1.48s (to 239.48), and 40 frames more cross 240s.
  const data = new Map([[SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 0, wheat: 0 },
    { [cellA]: { crop: "wheat", stage: 1, plantedAt: 30, growth: 238 },
      [cellB]: { crop: "wheat", stage: 1, plantedAt: 30, growth: 238 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  settledAimCell(game, frame);
  game.get("message").textContent = "";
  for (let i = 0; i < 40; i++) frame();
  assert.equal(game.get("message").textContent, "小麦 ×2 已成熟，到田里收割");
  // It fires once: 40 more frames leave the same line in place.
  for (let i = 0; i < 40; i++) frame();
  assert.equal(game.get("message").textContent, "小麦 ×2 已成熟，到田里收割");
});

// Cooking (R4): dishes are crafted on the workbench tab and eaten from
// the backpack tab. A v5 save with wheat and dish materials, the
// workbench state set by the caller.

test("cooking rows are locked on the workbench tab without a workbench", () => {
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ workbenchBuilt: false })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  assert.equal(game.get("inventory-screen").hidden, false);
  // The backpack food row: effect line only, eating disabled with no
  // dish, and a jump button to the workbench.
  assert.equal(game.get("bakedWheat-effect").textContent, "恢复 40 点饥饿 · 在工作台烹饪");
  assert.equal(game.get("veggieSalad-effect").textContent, "恢复 25 点饥饿 · 移速 +10%（30 秒）");
  assert.equal(game.get("stew-effect").textContent, "恢复 60 点饥饿 · 攻击 +10%（30 秒）");
  assert.equal(game.get("use-bakedWheat").disabled, true);
  game.click("goto-workbench-stew");
  assert.equal(game.get("tab-workbench").hidden, false);
  // The detail card names the dish a dish: tier line 烹饪, lock line set.
  assert.equal(game.get("detail-name").textContent, "炖菜");
  assert.equal(game.get("detail-tier").textContent, "烹饪");
  assert.equal(game.get("detail-lock").textContent, "需先建造工作台");
  assert.equal(game.get("detail-craft").disabled, true);
  assert.match(game.get("detail-materials").innerHTML, /小麦 6\/2/);
  assert.doesNotMatch(game.get("detail-materials").innerHTML, /undefined/);
  // Every dish row carries the lock in its cost line and a dead button.
  for (const key of ["bakedWheat", "veggieSalad", "stew"]) {
    assert.equal(game.get(`craft-${key}`).disabled, true, `${key} must be uncraftable without a workbench`);
    assert.match(game.get(`${key}-cost`).textContent, /^需先建造工作台 · /);
  }
  assert.equal(game.get("bakedWheat-cost").textContent, "需先建造工作台 · 小麦 6/2 · 恢复 40 点饥饿");
  assert.equal(game.get("stew-cost").textContent, "需先建造工作台 · 小麦 6/2 · 木头 10/1 · 恢复 60 点饥饿 · 攻击 +10%（30 秒）");
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("inventory-screen").hidden, true);
});

test("dishes craft at the workbench, eat from the backpack, and KeyH never eats food", t => {
  let seed = 7;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ hunger: 10 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  const hp = () => Number(game.get("health-value").textContent);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  game.click("tab-btn-workbench");
  // Craft one of each dish; the cost lines lose the lock and the
  // counts and materials move exactly by the recipes.
  assert.equal(game.get("craft-bakedWheat").disabled, false);
  game.click("craft-bakedWheat");
  game.click("craft-veggieSalad");
  game.click("craft-stew");
  const saved = JSON.parse(data.get(SAVE_KEY));
  assert.deepEqual(saved.dressings, { dressing: 0, bandage: 0, bigDressing: 0, bakedWheat: 1, veggieSalad: 1, stew: 1 });
  assert.equal(saved.seeds.wheat, 1, "the three dishes spend wheat 2 + 1 + 2 of the 6");
  assert.equal(saved.materials[5], 8, "the salad spends leaves 2");
  assert.equal(saved.materials[4], 9, "the stew spends wood 1");
  assert.equal(game.get("bakedWheat-cost").textContent, "小麦 1/2 · 恢复 40 点饥饿");
  // Eating is gated by hunger, not health (batch 86): at full health
  // but hungry (10), every eat button is live.
  game.click("tab-btn-backpack");
  for (const key of ["bakedWheat", "veggieSalad", "stew"]) assert.equal(game.get(`use-${key}`).disabled, false);
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("inventory-screen").hidden, true);
  // Take hits until health is low enough to prove a dish does not heal.
  for (let i = 0; i < 3000 && game.get("death-screen").hidden && hp() > 50; i++) frame();
  assert.equal(game.get("death-screen").hidden, true, "the player must survive the beating");
  assert.ok(hp() <= 60 && hp() > 0, `health must be low but alive (now ${hp()})`);
  // KeyH eats only the basic dressing: with none owned it heals
  // nothing and spends no food.
  const beforeKeyH = hp();
  game.key("KeyH");
  frame();
  assert.equal(hp(), beforeKeyH, "KeyH must not eat food");
  assert.match(game.get("hud-dressings").textContent, /烤麦饼 1 · 果蔬沙拉 1 · 炖菜 1/);
  // Eat the baked wheat from the backpack: hunger +40, health
  // untouched (food no longer heals), count spent.
  game.key("KeyC");
  frame();
  assert.equal(game.get("use-bakedWheat").disabled, false);
  const beforeEat = hp();
  const hungerBefore = Number(game.get("hunger-value").textContent);
  game.click("use-bakedWheat");
  assert.equal(hp(), beforeEat, "a dish must not heal");
  assert.equal(Number(game.get("hunger-value").textContent), hungerBefore + 40);
  assert.equal(game.get("inventory-notice").textContent, "饥饿 +40");
  assert.match(game.get("inventory-dressings").textContent, /烤麦饼 0 件/);
  assert.equal(game.get("use-bakedWheat").disabled, true, "no dish left: eating disables again");
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("inventory-screen").hidden, true);
});

test("food lines show hunger with no first-aid +10, while dressing lines keep it", () => {
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ techUnlocked: ["firstAid"], dressings: { stew: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  assert.equal(game.get("stew-effect").textContent, "恢复 60 点饥饿 · 攻击 +10%（30 秒）");
  assert.match(game.get("dressing-cost").textContent, /恢复 40 点生命/, "the dressing line still adds the first-aid +10 to its 30");
  game.click("tab-btn-workbench");
  assert.equal(game.get("stew-cost").textContent, "小麦 6/2 · 木头 10/1 · 恢复 60 点饥饿 · 攻击 +10%（30 秒）");
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("inventory-screen").hidden, true);
});

// Food buffs (R5): a salad's speed buff and a stew's attack buff, as
// measured effects — the game's own speed readout and per-hit damage —
// with refresh, coexistence, expiry and reload clearing.

// Stand still and take wave-1 hits until at or below the target health.

test("the salad's speed buff measures +10%, shows on the HUD, and expires back to exactly 4.15", t => {
  let seed = 11;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ dressings: { dressing: 10, veggieSalad: 1, bakedWheat: 20 }, hunger: 60 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  const hp = () => Number(game.get("health-value").textContent);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  assert.equal(game.get("hud-buff-speed").hidden, true);
  takeHitsUntil(game, frame, 70);
  eatFromBackpack(game, frame, "veggieSalad");
  // The HUD line appears with the full 30 seconds; the attack line
  // stays hidden — the salad carries no attack buff.
  assert.equal(game.get("hud-buff-speed").hidden, false);
  assert.equal(game.get("hud-buff-speed").textContent, "移速 +10% · 还剩 30 秒");
  assert.equal(game.get("hud-buff-attack").hidden, true);
  // The game's own speed readout — the actual velocity recorded after
  // every physics step — sits exactly on the buffed cap.
  assert.equal(measureSpeedReadout(game, frame, Number((4.15 * 1.1).toFixed(2))), Number((4.15 * 1.1).toFixed(2)));
  // Run the clock out (the measures spent ~2.5s of the 30).
  passGameTime(game, frame, 1500, hp);
  assert.equal(game.get("hud-buff-speed").hidden, true, "the HUD line disappears at expiry");
  assert.equal(measureSpeedReadout(game, frame, 4.15), 4.15, "expired speed falls back to exactly 4.15");
});

test("re-eating refreshes without stacking, buffs coexist, and the stew's punch hits +10% until expiry", t => {
  let seed = 23;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ dressings: { dressing: 10, veggieSalad: 2, stew: 1, bakedWheat: 20 }, hunger: 40 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  const hp = () => Number(game.get("health-value").textContent);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  takeHitsUntil(game, frame, 40);
  eatFromBackpack(game, frame, "veggieSalad");
  assert.equal(game.get("hud-buff-speed").textContent, "移速 +10% · 还剩 30 秒");
  // Ten seconds of game time burn the timer down to about 20 (a frame
  // of slack either way for the bag-close frame).
  passGameTime(game, frame, 500, hp);
  const midway = buffSeconds(game, "speed");
  assert.ok(midway >= 19 && midway <= 21, `ten seconds in, the line must read ~20s left (got ${midway})`);
  // The second salad refreshes to a full 30 — and the speed stays at
  // +10%, never +21%: refresh, not stacking.
  eatFromBackpack(game, frame, "veggieSalad");
  assert.equal(game.get("hud-buff-speed").textContent, "移速 +10% · 还剩 30 秒");
  assert.equal(measureSpeedReadout(game, frame, Number((4.15 * 1.1).toFixed(2))), Number((4.15 * 1.1).toFixed(2)),
    "refreshed speed must stay at the +10% cap, not stack");
  // The stew adds its own buff alongside: both HUD lines show, the
  // speed is untouched by the attack buff, and a punch lands +10%.
  // (The top-ups and salads may have refilled the health bar, and a
  // full bar refuses food — take hits back down first.)
  takeHitsUntil(game, frame, 60);
  eatFromBackpack(game, frame, "stew");
  assert.equal(game.get("hud-buff-speed").hidden, false);
  assert.equal(game.get("hud-buff-attack").hidden, false);
  assert.equal(game.get("hud-buff-attack").textContent, "攻击 +10% · 还剩 30 秒");
  assert.equal(measureSpeedReadout(game, frame, Number((4.15 * 1.1).toFixed(2))), Number((4.15 * 1.1).toFixed(2)),
    "the attack buff must not change the speed");
  punchSpitter(game, frame, "29.7");
  // After both buffs expire the sword is back to its exact base 27.
  passGameTime(game, frame, 1600, hp);
  assert.equal(game.get("hud-buff-speed").hidden, true);
  assert.equal(game.get("hud-buff-attack").hidden, true);
  assert.ok(hp() > 0, "the player must still be alive after the run-out");
  punchSpitter(game, frame, "27");
});

test("buffs never reach the save: a reload starts with none", t => {
  let seed = 31;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ dressings: { veggieSalad: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const first = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => first.frame(time += 20);
  first.click("start-button");
  first.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  takeHitsUntil(first, frame, 70);
  eatFromBackpack(first, frame, "veggieSalad");
  assert.equal(first.get("hud-buff-speed").hidden, false);
  // The save on disk carries no buff state at all.
  assert.ok(!JSON.stringify(JSON.parse(data.get(SAVE_KEY))).includes("buff"), "the save must not mention buffs");
  // A fresh session loading that save has no buff: HUD lines hidden,
  // ground speed exactly the base 4.15.
  const second = mountGame({ storage, pointerLock: true });
  let time2 = 0;
  const frame2 = () => second.frame(time2 += 20);
  second.click("start-button");
  second.grantPointerLock();
  for (let i = 0; i < 5; i++) frame2();
  assert.equal(second.get("hud-buff-speed").hidden, true);
  assert.equal(second.get("hud-buff-attack").hidden, true);
  assert.equal(measureSpeedReadout(second, frame2, 4.15), 4.15, "reloaded speed must be exactly 4.15");
});

test("hunger: the bar shows in survival, drains, and warns at 30 then 10", () => {
  // Two mounts, each crossing one band inside the first wave's
  // approach window, so no zombie timing touches the message line.
  // (The band speaks when the float crosses; the bar shows the
  // floor, so the read waits until the floor is one past the band.)
  const mount = hungerSeed => {
    const data = new Map([[SAVE_KEY, v5SaveForCooking({ hunger: hungerSeed })]]);
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const game = mountGame({ storage, pointerLock: true });
    let time = 0;
    const frame = () => game.frame(time += 20);
    game.click("start-button");
    game.grantPointerLock();
    frame();
    return { game, frame };
  };
  const low = mount(31);
  assert.equal(low.game.get("hunger").hidden, false, "the hunger bar shows in survival");
  assert.equal(low.game.get("hunger-value").textContent, "31");
  for (let i = 0; i < 600 && Number(low.game.get("hunger-value").textContent) > 29; i++) low.frame();
  assert.equal(low.game.get("message").textContent, "肚子饿了 · 吃点东西补充体力");
  assert.equal(low.game.get("hunger").classList.contains("low"), true);

  const critical = mount(11);
  for (let i = 0; i < 600 && Number(critical.game.get("hunger-value").textContent) > 9; i++) critical.frame();
  assert.equal(critical.game.get("message").textContent, "饿得发慌 · 再不吃东西就要掉血了");
  assert.equal(critical.game.get("hunger").classList.contains("critical"), true);
});

test("hunger: an empty belly bleeds exactly 1 hp per 2 seconds", () => {
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ hunger: 0 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  // dt is capped at 0.1s per frame: 70 frames is 6-7 game seconds,
  // inside the first wave's 14-second countdown — no zombie can
  // interfere, so the drop is starvation alone: 3 ticks of 1 hp.
  const frame = () => game.frame(time += 100);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 70; i++) frame();
  assert.equal(game.get("hunger-value").textContent, "0");
  assert.equal(game.get("health-value").textContent, "97");
  assert.equal(game.get("death-screen").hidden, true);
});

test("hunger: the game loop drains the saved belly at the walking rate", () => {
  const data = new Map([[SAVE_KEY, v5SaveForCooking({})]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 100);
  game.click("start-button");
  game.grantPointerLock();
  // 100 frames at the 0.1s dt cap = 10 game seconds = 10 * 50/240
  // hunger. Pausing flushes the save, so the float is readable.
  for (let i = 0; i < 100; i++) frame();
  game.key("Escape");
  frame();
  const saved = JSON.parse(data.get(SAVE_KEY)).hunger;
  assert.ok(Math.abs(saved - (100 - 10 * 50 / 240)) < 0.05, `the saved hunger drains at the set rate (got ${saved})`);
});

test("hunger: frozen and hidden in a boss trial and in beacon defense", () => {
  const trialData = new Map([[SAVE_KEY, v5SaveForCooking({})]]);
  const trialStorage = { getItem: key => trialData.get(key) ?? null, setItem: (key, value) => trialData.set(key, value) };
  const trial = mountGame({ storage: trialStorage, pointerLock: true });
  let t1 = 0;
  const trialFrame = () => trial.frame(t1 += 100);
  trial.click("trial-guardian-button");
  trial.grantPointerLock();
  trialFrame();
  assert.equal(trial.get("hunger").hidden, true, "no hunger bar in a trial");
  for (let i = 0; i < 300; i++) trialFrame();
  assert.equal(trial.get("hunger-value").textContent, "100", "30 game seconds in a trial drain nothing");

  const defenseData = new Map([[SAVE_KEY, v5SaveForCooking({ hunger: 55 })]]);
  const defenseStorage = { getItem: key => defenseData.get(key) ?? null, setItem: (key, value) => defenseData.set(key, value) };
  const defense = mountGame({ storage: defenseStorage, pointerLock: true });
  let t2 = 0;
  const defenseFrame = () => defense.frame(t2 += 20);
  defense.click("defense-button");
  defense.grantPointerLock();
  defenseFrame();
  assert.equal(defense.get("hunger").hidden, true, "no hunger bar in defense");
  for (let i = 0; i < 600; i++) defenseFrame();
  assert.equal(defense.get("hunger-value").textContent, "55", "defense freezes hunger where it was");
});

test("hunger: eating feeds the bar, caps at full, and a full belly refuses", () => {
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ hunger: 30, dressings: { bakedWheat: 1, stew: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  frame();
  game.key("KeyC");
  frame();
  game.click("use-bakedWheat");
  assert.equal(game.get("inventory-notice").textContent, "饥饿 +40");
  assert.equal(game.get("hunger-value").textContent, "70");
  assert.equal(game.get("health-value").textContent, "100", "the dish did not heal");
  game.click("use-stew");
  assert.equal(game.get("inventory-notice").textContent, "饥饿 +30", "the stew's 60 caps at a full belly");
  assert.equal(game.get("hunger-value").textContent, "100");
  game.key("KeyC");
  game.grantPointerLock();
  frame();

  const fullData = new Map([[SAVE_KEY, v5SaveForCooking({ hunger: 100, dressings: { stew: 1 } })]]);
  const fullStorage = { getItem: key => fullData.get(key) ?? null, setItem: (key, value) => fullData.set(key, value) };
  const full = mountGame({ storage: fullStorage, pointerLock: true });
  let t2 = 0;
  const fullFrame = () => full.frame(t2 += 20);
  full.click("start-button");
  full.grantPointerLock();
  fullFrame();
  full.key("KeyC");
  fullFrame();
  assert.equal(full.get("use-stew").disabled, true, "a full belly locks the eat button");
  full.click("use-stew");
  assert.equal(full.get("inventory-notice").textContent, "已经吃饱了");
  assert.match(full.get("inventory-dressings").textContent, /炖菜 1 件/, "the refused bite spends nothing");
});

test("hunger: a belly a fraction under full still refuses the bite and keeps the dish", () => {
  // Batch 89 (visual group, batch 87): at a displayed-full belly
  // the old >= 100 guard never fired — hunger had already drained
  // to 99.9x — so the click spent the whole dish on +0.02 while
  // the notice claimed +1. The refusal now judges the gain.
  const run = (hunger, dressings) => {
    const data = new Map([[SAVE_KEY, v5SaveForCooking({ hunger, dressings })]]);
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const game = mountGame({ storage, pointerLock: true });
    let time = 0;
    const frame = () => game.frame(time += 20);
    game.click("start-button");
    game.grantPointerLock();
    frame();
    game.key("KeyC");
    frame();
    return game;
  };
  // 99.98 with a baked wheat roll: the button locks, and even a
  // forced click refuses without spending the dish.
  const near = run(99.98, { bakedWheat: 1 });
  assert.equal(near.get("use-bakedWheat").disabled, true, "a bite worth under 1 hunger locks the eat button");
  near.click("use-bakedWheat");
  assert.equal(near.get("inventory-notice").textContent, "已经吃饱了");
  assert.match(near.get("inventory-dressings").textContent, /烤麦饼 1 件/, "the refused bite spends nothing");
  // Half a point short of full: refused the same way.
  const half = run(99.5, { stew: 1 });
  half.click("use-stew");
  assert.equal(half.get("inventory-notice").textContent, "已经吃饱了");
  assert.match(half.get("inventory-dressings").textContent, /炖菜 1 件/);
  // A real bite at 60 reports the real gain: +40, exactly.
  const sixty = run(60, { bakedWheat: 1 });
  assert.equal(sixty.get("use-bakedWheat").disabled, false);
  sixty.click("use-bakedWheat");
  assert.equal(sixty.get("inventory-notice").textContent, "饥饿 +40");
  assert.equal(sixty.get("hunger-value").textContent, "100");
});

test("hunger: a belly at 80 slowly restores health, one at 65 does not", () => {
  const run = dishes => {
    const data = new Map([[SAVE_KEY, v5SaveForCooking({ hunger: 0, dressings: dishes })]]);
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const game = mountGame({ storage, pointerLock: true });
    let time = 0;
    const frame = () => game.frame(time += 100);
    const hp = () => Number(game.get("health-value").textContent);
    game.click("start-button");
    game.grantPointerLock();
    // Starve 6 game seconds (inside the wave countdown): hp 97.
    for (let i = 0; i < 70; i++) frame();
    assert.equal(hp(), 97);
    // Eat the dishes from the bag (paused: no time passes), which
    // sets the belly to an exact mark, then watch 8 game seconds —
    // still ahead of the first zombie's arrival.
    game.key("KeyC");
    frame();
    for (const [key, count] of Object.entries(dishes)) for (let i = 0; i < count; i++) game.click(`use-${key}`);
    game.key("KeyC");
    game.grantPointerLock();
    frame();
    for (let i = 0; i < 80; i++) frame();
    return hp();
  };
  assert.equal(run({ bakedWheat: 2 }), 100, "hunger exactly 80 regens back to full");
  assert.equal(run({ bakedWheat: 1, veggieSalad: 1 }), 97, "hunger 65 does not regen");
});

test("hunger: starving to death ends the run, and respawn refills the belly", () => {
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ hunger: 0 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  // Starvation alone kills at 200 game seconds; the wave's zombies
  // only hasten it. Either way the run ends on the death screen.
  for (let i = 0; i < 14000 && game.get("death-screen").hidden; i++) frame();
  assert.equal(game.get("death-screen").hidden, false, "an empty belly ends the run");
  game.click("respawn-button");
  frame();
  assert.equal(game.get("health-value").textContent, "100");
  assert.equal(game.get("hunger-value").textContent, "100", "respawn refills hunger with health");
});
