import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mountGame, seedProgress, sharedStorage, v5SaveWithSeeds, v5SaveForCooking, takeHitsUntil, nearestZombieVertex, steerTowardVertex, swingAtNearestZombie } from "./game-harness.mjs";
import { BLOCK, SAVE_KEY, V4_SAVE_KEY, PROGRESS_KEY, createProgression, saveProgress } from "./progression.mjs";
import { SURVIVAL_DIFFICULTY, survivalRoster, hpMultiplier, scaledHp } from "./difficulty.mjs";
import { ENEMIES, defenseWaveRoster } from "./defense.mjs";
import { WORLD, voxelIndex } from "./terrain.mjs";

// Equipment integration tests: armor reduction, tools & mining speed, weapon/armor durability, repair, equipment tab. Split from game.test.mjs (batch 108).

function v5SaveWithArmor(armor, techUnlocked = []) {
  return JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 }, rareMaterials: { emberCore: 0, starShard: 0 },
    equipment: { weapon: null, armor, tool: null }, techUnlocked, workbenchBuilt: true, stats: { blocksMined: 0 } });
}

function v5SaveWithTool(tool, techUnlocked = [], durability = null) {
  const piece = durability === null ? tool : { ...tool, durability };
  return JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 }, rareMaterials: { emberCore: 0, starShard: 0 },
    equipment: { weapon: null, armor: null, tool: piece }, techUnlocked, workbenchBuilt: true, stats: { blocksMined: 0 } });
}

// Hold-to-mine breaks the first block on the click and the next one
// after one mining interval. Frames run at 20ms, so the second break
// lands at frame 15 (stone, 0.28s), 11 (ember, 0.20s) or 7 (star,
// 0.14s) — the float sums 0.02×14 and 0.02×10 fall just short of the
// interval, so the window checks the dirt is still there at the
// earliest frame and gone two frames after the latest.

function assertMineInterval(tool, notBrokenAt, brokenBy, techUnlocked = [], durability = null) {
  const data = new Map([[SAVE_KEY, v5SaveWithTool(tool, techUnlocked, durability)]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  // Let the spawn landing dip settle, or the aim slides a cell every
  // dozen frames and the target stops meaning "a block was mined".
  for (let i = 0; i < 60; i++) frame();
  for (let i = 0; i < 6; i++) game.document.emit("mousemove", { movementX: 0, movementY: 65 });
  for (let i = 0; i < 10; i++) frame();
  assert.ok(game.target, "aiming down targets a block");
  // The aim is settled now: prove it before the click.
  const before = game.target.join(",");
  for (let i = 0; i < 5; i++) frame();
  assert.equal(game.target.join(","), before, "the aim is settled before mining");
  // Survival starts on the sword slot, and a click with a weapon
  // selected swings instead of mining — switch to a block slot first.
  game.key("Digit1");
  frame();
  // The click mines the aimed block at once; the aim jumps to the next
  // block along the ray and stays there until the hold-repeat tick.
  // The save is not read here: the first edit writes synchronously but
  // the ticks batch (300ms wall-clock timer), so storage lags the world.
  game.get("game").emit("mousedown", { button: 0 });
  frame();
  assert.notEqual(game.target.join(","), before, "the click mines the aimed block");
  const held = game.target.join(",");
  for (let i = 1; i < notBrokenAt; i++) frame();
  assert.equal(game.target.join(","), held, "the next block waits for one mining interval");
  for (let i = notBrokenAt; i < brokenBy; i++) frame();
  assert.notEqual(game.target.join(","), held, "the hold-repeat tick mines the next block");
  game.document.emit("mouseup", { button: 0 });
}

function v5SaveWithWeapon(weapon, materials = [0, 0, 0, 10, 0, 0], rareMaterials = { emberCore: 2, starShard: 0 }) {
  return JSON.stringify({ version: 5, edits: [], materials, axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 }, rareMaterials,
    equipment: { weapon, armor: null, tool: null }, techUnlocked: [], workbenchBuilt: true, stats: { blocksMined: 0 } });
}

// Start survival and frame until a zombie first hurts the player, so a
// zombie is adjacent. Returns the hp at that point.

function waitForZombieHit(game, frame) {
  let hp = 100;
  for (let i = 0; i < 3000 && hp >= 100; i++) {
    frame();
    hp = Number(game.get("health-value").textContent);
  }
  assert.ok(hp < 100, "a zombie should have reached the player within 60s");
  assert.ok(hp > 0, "the player should still be alive");
  return hp;
}

// Sweep the view until the crosshair is on a zombie in reach, then
// swing. The mouse look drains at most 0.3 rad/frame, so checking the
// crosshair after every frame cannot skip over a zombie (~0.4 rad wide
// at melee range). Frames 25 times after the swing so a buffered attack
// (swung during the cooldown) has time to fire. Returns true when a
// swing was made.

function swingAtAdjacentZombie(game, frame) {
  for (let attempt = 0; attempt < 5; attempt++) {
    // Clear the message so a fresh hit is distinguishable from a stale one.
    game.get("message").textContent = "";
    for (let i = 0; i < 80; i++) {
      if (game.get("crosshair").classList.contains("on-target")) {
        game.get("game").emit("mousedown", { button: 0 });
        frame();
        for (let j = 0; j < 25; j++) frame();
        // A hit (or a killing blow) always shows a message; a miss shows none.
        if (game.get("message").textContent) return true;
        break;
      }
      game.document.emit("mousemove", { movementX: 600, movementY: 0 });
      frame();
    }
  }
  return false;
}


// The nearest zombie's closest actor vertex, or null when no zombie
// is on the field. During combat the actor buffer holds only zombie
// parts, so the closest vertex belongs to the closest zombie; it is
// a coarse aim (a corner can sit half a block off the body), which
// is why the drivers below trust the crosshair, not the vertex, for
// the swing itself.

test("crafting an ember sword puts it in the sword slot with registry damage", () => {
  // A v5 save: workbench built, 2 ember cores, enough stone and wood;
  // progress with one guardian kill unlocks the ember tier.
  const data = new Map([
    [SAVE_KEY, JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 14, 10, 0], axeUnlocked: false,
      dressings: { dressing: 0, bandage: 0, bigDressing: 0 }, rareMaterials: { emberCore: 2, starShard: 0 },
      equipment: { weapon: null, armor: null, tool: null }, techUnlocked: [], workbenchBuilt: true, stats: { blocksMined: 0 } })],
    [PROGRESS_KEY, JSON.stringify({ version: 2, wave: 0, kills: 0, bossesDefeated: { boss: true }, bossKills: { boss: 1 },
      bestWave: 0, defense: { wave: 0, cleared: false, bestWave: 0 } })]
  ]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  game.click("tab-btn-workbench");
  // The guardian kill alone does not open the ember rows — the trunk
  // nodes do. The ember row names its trunk node, the star row its own.
  assert.equal(game.get("craft-emberSword").disabled, true);
  assert.match(game.get("emberSword-cost").textContent, /需先解锁：熔火科技/);
  assert.equal(game.get("craft-starSword").disabled, true);
  assert.match(game.get("starSword-cost").textContent, /需先解锁：断星科技/);
  // Walk the trunk in the tech tab: workbench, stone gear, ember tech,
  // ember gear — each click opens the next.
  game.click("tab-btn-tech");
  game.click("tech-unlock-workbench");
  game.click("tech-unlock-stoneGear");
  assert.equal(game.get("tech-unlock-emberTech").disabled, false);
  assert.match(game.get("tech-cond-emberTech").innerHTML, /击败熔炉守卫 1\/1 次/);
  game.click("tech-unlock-emberTech");
  assert.equal(game.get("tech-unlock-emberGear").disabled, false);
  game.click("tech-unlock-emberGear");
  assert.match(game.get("inventory-notice").textContent, /已解锁熔火阶装备/);
  game.click("tab-btn-workbench");
  assert.equal(game.get("craft-emberSword").disabled, false);
  assert.match(game.get("emberSword-cost").textContent, /石头 14\/8 · 木头 10\/4 · 熔火核心 2\/2/);
  // Select the ember sword row: the detail card shows its materials
  // with the boss source on the rare line.
  game.click("wb-row-emberSword");
  assert.equal(game.get("detail-name").textContent, "熔火剑");
  assert.equal(game.get("detail-tier").textContent, "熔火阶");
  assert.match(game.get("detail-materials").innerHTML, /熔火核心（熔炉守卫掉落） 2\/2/);
  assert.equal(game.get("detail-craft").textContent, "打造熔火剑");
  game.click("detail-craft");
  assert.match(game.get("inventory-notice").textContent, /已制作熔火剑/);
  assert.equal(game.get("detail-craft").textContent, "已拥有");
  // The equipment card shows the crafted weapon with registry damage.
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-weapon-name").textContent, "熔火剑");
  assert.equal(game.get("equip-weapon-info").textContent, "熔火阶 · 伤害 41");
  assert.equal(game.get("equip-weapon-state").textContent, "已装备");
  // And hotbar slot 6 is the ember sword now, not the stone sword.
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  game.key("Digit6");
  frame();
  assert.match(game.get("weapon-label").textContent, /熔火剑 · 可攻击/);
});

// A v5 save with exactly one armor piece equipped and nothing else,
// for the reduction tests below (the boss fight reads the campaign's
// equipment from the loaded save).

test("stone armor cuts the colossus meteor from 24 to 21", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithArmor({ key: "stoneArmor", tier: "stone" })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  const callout = () => game.get("boss-callout").textContent;
  game.click("colossus-button");
  game.grantPointerLock();
  game.frame(0);
  const start = game.camera;
  assert.match(callout(), /正在逼近/);
  game.key("Escape");
  game.frame(5000);
  assert.match(callout(), /正在逼近/);
  assert.equal(game.get("health-value").textContent, "100");
  game.click("resume-button");
  game.grantPointerLock();
  for (let time = 5000; time < 6400; time += 20) game.frame(time);
  assert.deepEqual(game.camera, start);
  assert.match(callout(), /追星坠落/);
  for (let time = 6400; time < 7900; time += 20) game.frame(time);
  assert.equal(game.get("health-value").textContent, "79");
});

test("ember armor cuts the colossus meteor from 24 to 18", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithArmor({ key: "emberArmor", tier: "ember" })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  const callout = () => game.get("boss-callout").textContent;
  game.click("colossus-button");
  game.grantPointerLock();
  game.frame(0);
  const start = game.camera;
  assert.match(callout(), /正在逼近/);
  game.key("Escape");
  game.frame(5000);
  assert.match(callout(), /正在逼近/);
  assert.equal(game.get("health-value").textContent, "100");
  game.click("resume-button");
  game.grantPointerLock();
  for (let time = 5000; time < 6400; time += 20) game.frame(time);
  assert.deepEqual(game.camera, start);
  assert.match(callout(), /追星坠落/);
  for (let time = 6400; time < 7900; time += 20) game.frame(time);
  assert.equal(game.get("health-value").textContent, "82");
});

test("star armor cuts the colossus meteor from 24 to 14", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithArmor({ key: "starArmor", tier: "star" })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  const callout = () => game.get("boss-callout").textContent;
  game.click("colossus-button");
  game.grantPointerLock();
  game.frame(0);
  const start = game.camera;
  assert.match(callout(), /正在逼近/);
  game.key("Escape");
  game.frame(5000);
  assert.match(callout(), /正在逼近/);
  assert.equal(game.get("health-value").textContent, "100");
  game.click("resume-button");
  game.grantPointerLock();
  for (let time = 5000; time < 6400; time += 20) game.frame(time);
  assert.deepEqual(game.camera, start);
  assert.match(callout(), /追星坠落/);
  for (let time = 6400; time < 7900; time += 20) game.frame(time);
  assert.equal(game.get("health-value").textContent, "86");
});

test("the 坚韧 tech adds 5% reduction on top of stone armor: meteor 24 to 20", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithArmor({ key: "stoneArmor", tier: "stone" }, ["toughness"])]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  const callout = () => game.get("boss-callout").textContent;
  game.click("colossus-button");
  game.grantPointerLock();
  game.frame(0);
  const start = game.camera;
  assert.match(callout(), /正在逼近/);
  game.key("Escape");
  game.frame(5000);
  assert.match(callout(), /正在逼近/);
  assert.equal(game.get("health-value").textContent, "100");
  game.click("resume-button");
  game.grantPointerLock();
  for (let time = 5000; time < 6400; time += 20) game.frame(time);
  assert.deepEqual(game.camera, start);
  assert.match(callout(), /追星坠落/);
  for (let time = 6400; time < 7900; time += 20) game.frame(time);
  // Stone armor alone would leave 79 (24 - 21); 坚韧 adds 5 points of
  // reduction (24 * 0.85 = 20.4, floored to 20), leaving 80.
  assert.equal(game.get("health-value").textContent, "80");
});

test("the equipment tab shows each armor tier's reduction", () => {
  for (const [armor, name, info] of [
    [{ key: "stoneArmor", tier: "stone" }, "石甲", "石阶 · 减伤 10%"],
    [{ key: "emberArmor", tier: "ember" }, "熔火甲", "熔火阶 · 减伤 25%"],
    [{ key: "starArmor", tier: "star" }, "断星甲", "断星阶 · 减伤 40%"]
  ]) {
    const data = new Map([[SAVE_KEY, v5SaveWithArmor(armor)]]);
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const game = mountGame({ storage, pointerLock: true });
    let time = 0;
    const frame = () => game.frame(time += 20);
    game.click("start-button");
    game.grantPointerLock();
    for (let i = 0; i < 5; i++) frame();
    game.key("KeyC");
    frame();
    game.click("tab-btn-equipment");
    assert.equal(game.get("equip-armor-name").textContent, name);
    assert.equal(game.get("equip-armor-info").textContent, info);
    assert.equal(game.get("equip-armor-state").textContent, "已装备");
  }
});

// A v5 save with exactly one tool equipped and empty materials, for the
// mining-timing tests below.

test("stone tools mine one block per 0.28s", () => {
  assertMineInterval({ key: "stonePickaxe", tier: "stone" }, 14, 16);
});

test("ember tools mine one block per 0.20s", () => {
  assertMineInterval({ key: "emberPickaxe", tier: "ember" }, 10, 12);
});

test("star tools mine one block per 0.14s", () => {
  assertMineInterval({ key: "starPickaxe", tier: "star" }, 6, 8);
});

test("the 快手 tech shaves 0.02s off the star pickaxe: one block per 0.12s", () => {
  assertMineInterval({ key: "starPickaxe", tier: "star" }, 5, 7, ["swiftHands"]);
});

test("the equipment tab shows each tool tier's mining speed", () => {
  for (const [tool, name, info] of [
    [{ key: "stonePickaxe", tier: "stone" }, "石镐", "石阶 · 挖掘 0.28 秒/块"],
    [{ key: "emberPickaxe", tier: "ember" }, "熔火镐", "熔火阶 · 挖掘 0.20 秒/块"],
    [{ key: "starPickaxe", tier: "star" }, "断星镐", "断星阶 · 挖掘 0.14 秒/块"]
  ]) {
    const data = new Map([[SAVE_KEY, v5SaveWithTool(tool)]]);
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const game = mountGame({ storage, pointerLock: true });
    let time = 0;
    const frame = () => game.frame(time += 20);
    game.click("start-button");
    game.grantPointerLock();
    for (let i = 0; i < 5; i++) frame();
    game.key("KeyC");
    frame();
    game.click("tab-btn-equipment");
    assert.equal(game.get("equip-tool-name").textContent, name);
    assert.equal(game.get("equip-tool-info").textContent, info);
    assert.equal(game.get("equip-tool-state").textContent, "已装备");
  }
});

test("the 急救 tech heals 40 per dressing in survival, not 30", () => {
  // One dressing, 急救 unlocked; no armor, so the wave-1 zombies hit
  // for full damage. The backpack row already shows the +10.
  const data = new Map([[SAVE_KEY, JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: false,
    dressings: { dressing: 1, bandage: 0, bigDressing: 0 }, rareMaterials: { emberCore: 0, starShard: 0 },
    equipment: { weapon: null, armor: null, tool: null }, techUnlocked: ["firstAid"], workbenchBuilt: true, stats: { blocksMined: 0 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  game.key("KeyC");
  frame();
  assert.match(game.get("dressing-cost").textContent, /恢复 40 点生命/);
  game.key("KeyC");
  game.grantPointerLock();
  // Stand still and let the wave-1 zombies land hits (first wave at
  // 14s) until the +40 heal is distinguishable from +30: at 60 hp or
  // below, +30 stays under 100 while +40 reaches further.
  let hp = 100;
  for (let i = 0; i < 3000; i++) {
    frame();
    hp = Number(game.get("health-value").textContent);
    if (hp <= 60) break;
  }
  assert.ok(hp <= 60, `zombies should have hurt the player within 60s (hp ${hp})`);
  assert.ok(hp > 0, "the player should still be alive to heal");
  game.key("KeyH");
  frame();
  assert.equal(Number(game.get("health-value").textContent), Math.min(100, hp + 40));
  assert.match(game.get("hud-dressings").textContent, /0/);
});

// A v5 save with one weapon equipped at a given durability, and the
// materials to repair an ember piece, for the durability tests below.

test("hitting a zombie wears the equipped sword by 1 and the HUD shows the durability", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithWeapon({ key: "emberSword", tier: "ember", durability: 200 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  waitForZombieHit(game, frame);
  assert.ok(swingAtNearestZombie(game, frame), "the walk-to should reach the zombie");
  // One hit: 200 -> 199, which is 99% of the ember maximum.
  assert.match(game.get("weapon-label").textContent, /耐久 99%/);
  game.key("KeyC");
  frame();
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-weapon-durability-text").textContent, "耐久 99%");
  assert.equal(game.get("equip-weapon-state").textContent, "已装备");
});

test("a sword at 1 durability breaks on the next hit: fist fallback, broken label and card, repair jump", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithWeapon({ key: "emberSword", tier: "ember", durability: 1 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  waitForZombieHit(game, frame);
  assert.ok(swingAtNearestZombie(game, frame), "the walk-to should reach the zombie");
  assert.equal(game.get("weapon-label").textContent, "熔火剑已损坏（按 C 修理）");
  game.key("KeyC");
  frame();
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-weapon-name").textContent, "熔火剑（已损坏，无法使用）");
  assert.equal(game.get("equip-weapon-info").textContent, "失效，回退到石阶 / 拳头 / 0.28 秒");
  assert.equal(game.get("equip-weapon-durability-text").textContent, "耐久 0%");
  assert.equal(game.get("equip-weapon-state").textContent, "在工作台修理（石头 5 + 熔火核心 1）");
  assert.equal(game.get("equip-weapon-state").disabled, false);
  // The state button jumps to the workbench tab, where the repair lives.
  game.click("equip-weapon-state");
  frame();
  assert.equal(game.get("tab-workbench").hidden, false);
  assert.equal(game.get("tab-equipment").hidden, true);
  assert.equal(game.get("repair-row-weapon").hidden, false);
  assert.match(game.get("repair-weapon-cost").textContent, /石头 10\/5 · 熔火核心 2\/1/);
  assert.equal(game.get("repair-weapon").disabled, false);
});

test("repairing at the workbench restores the sword to full and hides the row", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithWeapon({ key: "emberSword", tier: "ember", durability: 150 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  game.key("KeyC");
  frame();
  game.click("tab-btn-workbench");
  assert.equal(game.get("repair-row-weapon").hidden, false);
  assert.match(game.get("repair-weapon-name").textContent, /熔火剑 · 耐久 75%/);
  assert.match(game.get("repair-weapon-cost").textContent, /石头 10\/5 · 熔火核心 2\/1/);
  game.click("repair-weapon");
  frame();
  assert.match(game.get("inventory-notice").textContent, /已修理熔火剑，耐久回满/);
  assert.equal(game.get("repair-row-weapon").hidden, true);
  assert.equal(game.get("repair-empty").hidden, false);
  assert.equal(game.get("repair-empty").textContent, "没有损坏的装备");
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-weapon-durability-text").textContent, "耐久 100%");
  assert.equal(game.get("equip-weapon-state").textContent, "已装备");
});

test("the 25% warning fires once when the sword crosses below 25%", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithWeapon({ key: "emberSword", tier: "ember", durability: 51 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  waitForZombieHit(game, frame);
  // Deterministic swing driver (batch 77). The shared sweep helper
  // reads the message line after a fixed 25-frame settle — exactly
  // when a killing blow's loot line lands (a zombie's death pays
  // out 0.5s after the hit), so the second hit's warning raced the
  // loot for the same line and lost ~1 run in 8. This driver keys
  // everything off the save instead: sweep to a target, swing, then
  // step one frame at a time until the saved durability drops —
  // that frame is the hit's own frame, whose step ends by flushing
  // the pending durability warning, so the message read on that
  // exact frame is the hit's final word, a full 0.5s before any
  // loot can land. A whiff never wears, so re-sweeping after a
  // missed or still-buffered swing cannot skip a step.
  const savedDurability = () => JSON.parse(data.get(SAVE_KEY)).equipment.weapon.durability;
  const swingAndRead = () => {
    let holding = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const before = savedDurability();
      let swung = false;
      // The sweep is a walk-to since the deletion: the roster's base
      // kind is ranged and never steps into a standing sweep's reach.
      for (let i = 0; i < 3000 && !swung; i++) {
        if (game.get("crosshair").classList.contains("on-target")) {
          if (holding) { game.release("KeyW"); holding = false; }
          game.get("game").emit("mousedown", { button: 0 });
          swung = true;
        } else {
          const target = nearestZombieVertex(game);
          if (target) {
            steerTowardVertex(game, target);
            if (!holding) { game.key("KeyW"); holding = true; }
          }
          frame();
        }
      }
      if (holding) { game.release("KeyW"); holding = false; }
      if (!swung) continue;
      // A buffered swing fires when the cooldown ends (<= 0.38s);
      // 40 frames covers it with room to spare.
      for (let i = 0; i < 40; i++) {
        frame();
        if (savedDurability() < before) return game.get("message").textContent;
      }
    }
    return null;
  };
  // First hit: 51 -> 50, exactly 25% — not below, no warning.
  const first = swingAndRead();
  assert.ok(first !== null, "the sweep should find a zombie");
  assert.equal(savedDurability(), 50);
  assert.doesNotMatch(first, /耐久不足/);
  // Second hit: 50 -> 49, 24% — the warning fires once.
  const second = swingAndRead();
  assert.ok(second !== null, "the sweep should find a zombie again");
  assert.equal(savedDurability(), 49);
  assert.match(second, /熔火剑耐久不足（24%），按 C 在工作台修理/);
  // Third hit: 49 -> 48 — already below 25%, no second warning.
  const third = swingAndRead();
  assert.ok(third !== null, "the sweep should find a zombie a third time");
  assert.equal(savedDurability(), 48);
  assert.doesNotMatch(third, /耐久不足/);
});

test("a hit on the player wears the armor by 1; at 0 the reduction is gone", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithArmor({ key: "stoneArmor", tier: "stone", durability: 1 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  // Record the first two hits the player takes. Since the deletion
  // the first hits are a spitter's throws: 13 a hit, 11 while the
  // stone armor still reduces it — a drop of 11 means the armor was
  // working, 13 means it was gone.
  const drops = [];
  let hp = 100;
  for (let i = 0; i < 3000 && drops.length < 2; i++) {
    frame();
    const now = Number(game.get("health-value").textContent);
    if (now < hp) { drops.push(hp - now); hp = now; }
  }
  assert.equal(drops.length, 2, "the player should have taken two hits");
  // A satiety regen tick (+1) can land between the two samples and
  // shave a point off either drop; the bands still separate cleanly,
  // because a reduced throw reads 10-11 and a full one 12-13.
  assert.ok(drops[0] === 10 || drops[0] === 11, `first hit should be reduced (dropped ${drops[0]})`);
  assert.ok(drops[1] === 12 || drops[1] === 13, `second hit should be full (dropped ${drops[1]})`);
  game.key("KeyC");
  frame();
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-armor-name").textContent, "石甲（已损坏，无法使用）");
  assert.equal(game.get("equip-armor-durability-text").textContent, "耐久 0%");
  assert.equal(game.get("equip-armor-state").textContent, "在工作台修理（石头 5）");
});

test("mining wears the pickaxe by 1 per block; at 0 the interval reverts to 0.28s", () => {
  // A star pickaxe at 1 durability: the click mines the first block
  // (durability 0), and the next block waits the 0.28s base interval —
  // frame 15, not the star interval's frame 7.
  assertMineInterval({ key: "starPickaxe", tier: "star" }, 14, 16, [], 1);
});

test("a broken tool's card shows the fallback and the star repair cost", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithTool({ key: "starPickaxe", tier: "star", durability: 0 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-tool-name").textContent, "断星镐（已损坏，无法使用）");
  assert.equal(game.get("equip-tool-info").textContent, "失效，回退到石阶 / 拳头 / 0.28 秒");
  assert.equal(game.get("equip-tool-durability-text").textContent, "耐久 0%");
  assert.equal(game.get("equip-tool-state").textContent, "在工作台修理（石头 5 + 断星碎片 1）");
});

// Farming (R2): planting, growth and harvest in the world.

// A v5 save carrying seeds and planted crops, for the farming tests.

test("a swung weapon reads 冷却中 while it recovers", () => {
  const game = mountGame({ pointerLock: true });
  game.click("start-button");
  game.grantPointerLock();
  game.frame(0);
  game.get("game").emit("mousedown", { button: 0 });
  game.frame(20);
  assert.ok(game.get("weapon-label").textContent.includes("冷却中"));
  assert.ok(!game.get("weapon-label").textContent.includes("收招中"));
});

// ---- Hunger (batch 86) -------------------------------------------------
// Survival-only: the bar drains on game time, food feeds it instead
// of healing, a full belly regens slowly, an empty one starves.
