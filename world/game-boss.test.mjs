import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mountGame, seedProgress, sharedStorage, v5SaveWithSeeds, v5SaveForCooking, takeHitsUntil, nearestZombieVertex, steerTowardVertex, swingAtNearestZombie } from "./game-harness.mjs";
import { BLOCK, SAVE_KEY, V4_SAVE_KEY, PROGRESS_KEY, createProgression, saveProgress } from "./progression.mjs";
import { SURVIVAL_DIFFICULTY, survivalRoster, hpMultiplier, scaledHp } from "./difficulty.mjs";
import { ENEMIES, defenseWaveRoster } from "./defense.mjs";
import { WORLD, voxelIndex } from "./terrain.mjs";

// Boss integration tests: arena & trials (save isolation), guardian/colossus fights, segmented health bar and warnings. Split from game.test.mjs (batch 108).

test("the boss arena can be won and replayed, paying its reward without touching the sandbox edits", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const sandbox = createProgression(storage);
  sandbox.editBlock(voxelIndex(WORLD, 17, 4, 16), BLOCK.AIR, BLOCK.DIRT, true);
  const before = storage.getItem(SAVE_KEY);
  const game = mountGame({ storage, pointerLock: true });
  // The win's record merge must write the progress key exactly
  // once (batch 76): the delayed settlement may not double-pay it.
  let progressWrites = 0;
  const rawSetItem = storage.setItem;
  storage.setItem = (key, value) => { if (key === PROGRESS_KEY) progressWrites++; rawSetItem(key, value); };
  const attack = () => game.get("game").emit("mousedown", { button: 0 });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("boss-button");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("boss-health-value").textContent, "520 / 520");
  assert.equal(game.get("vitals").hidden, false);
  assert.equal(game.get("defense-hud").hidden, true);
  game.key("KeyW");
  game.key("Digit7");
  for (let i = 0; i < 58; i++) frame();
  game.release("KeyW");
  assert.match(game.get("weapon-label").textContent, /石斧/);
  attack();
  assert.equal(game.get("boss-health-value").textContent, "520 / 520");
  let overcharged = false, guardianBreakSeen = false, halfHealSeen = 0, halfHealWasShown = false;
  const summonWaves = new Set();
  let jumpPrimed = false;
  const jumpQueue = [];
  let prevHpBot = 100, fireStep = 0;
  let ramParity = 0, wasRamWindup = false;
  for (let i = 0; i < 12000 && game.get("death-screen").hidden && game.get("boss-health-value").textContent !== "0 / 500"; i++) {
    frame();
    if (!guardianBreakSeen && game.get("boss-name").textContent.includes("烈火")) {
      guardianBreakSeen = true;
      assert.equal(game.get("boss-phase-banner").textContent, "守卫进入第二管：火焰变强了！先清随从能打断它放火");
      const first = game.get("boss-health-track").children[0];
      assert.ok(first.classList.contains("broken") && first.classList.contains("shattering"),
        "the guardian's broken segment flashes on the break frame");
    }
    // Bar-3 half heal (batch 68): the message's rising edge
    // fires exactly once, in the last bar, at or below half
    // of that bar, and never inside a windup (the callout
    // reads a warning sentence while a move is winding up).
    const halfShown = game.get("message").textContent.includes("第三管过半");
    if (halfShown && !halfHealWasShown) {
      halfHealSeen++;
      assert.ok(game.get("boss-name").textContent.includes("第 3 / 3 管"), "the half heal fires in the last bar");
      assert.ok(Number(game.get("boss-health-value").textContent.split(" / ")[0]) <= 250, "the half heal fires at or below half of the bar");
      assert.ok(!/要冲|砸地|冲击波|火圈/.test(game.get("boss-callout").textContent), "the half heal never lands inside a windup");
    }
    halfHealWasShown = halfShown;
    // Track the guardian's helmet as it circles between attacks.
    let dx = 0, dz = 0, helmetVertices = 0, bossDistNow = 5;
    const vertices = game.actorVertices;
    for (let v = 0; v < vertices.length; v += 12) {
      if (vertices[v + 1] < 7.6) continue;
      helmetVertices++;
      dx += vertices[v] - game.camera[0];
      dz += vertices[v + 2] - game.camera[2];
    }
    bossDistNow = helmetVertices ? Math.hypot(dx, dz) / helmetVertices : 5;
    // In bars 2-3, aim at the guardian's minions when they are
    // the right target: while it only approaches (the dodge
    // branches all assume the robot faces the boss, so attack
    // charges keep boss aim), and during its recovery when a
    // minion stands adjacent — minions camp at the guardian
    // and their chip damage over a long bar is lethal.
    // Low-band vertices away from the guardian's own cluster
    // are a zombie's model.
    if ((dx || dz) && /烈火|过载/.test(game.get("boss-name").textContent)
      && (game.get("boss-callout").textContent.includes("守卫靠近中")
        || game.get("boss-callout").textContent.includes("现在打"))) {
      const cx = dx / helmetVertices + game.camera[0], cz = dz / helmetVertices + game.camera[2];
      let zx = 0, zz = 0, zn = 0;
      for (let v = 0; v < vertices.length; v += 12) {
        const y = vertices[v + 1];
        if (y < 5.2 || y > 7.1) continue;
        if (Math.hypot(vertices[v] - cx, vertices[v + 2] - cz) < 2.2) continue;
        zx += vertices[v] - game.camera[0];
        zz += vertices[v + 2] - game.camera[2];
        zn++;
      }
      if (zn > 30) {
        const minionDist = Math.hypot(zx, zz) / zn;
        if (game.get("boss-callout").textContent.includes("守卫靠近中")
          || (minionDist < 3.2 && minionDist <= bossDistNow + 0.5)) {
          dx = zx; dz = zz; helmetVertices = zn;
        }
      }
    }
    if (dx || dz) {
      const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
      game.document.emit("mousemove", { movementX: Math.max(-65, Math.min(65, Math.atan2(Math.sin(turn), Math.cos(turn)) / .0013)), movementY: 0 });
      if (Math.hypot(dx, dz) > 1.8 * helmetVertices) game.key("KeyW");
      else game.release("KeyW");
    }
    const ramWindupNow = game.get("boss-callout").textContent.includes("守卫要冲过来了");
    if (ramWindupNow && !wasRamWindup) ramParity ^= 1;
    wasRamWindup = ramWindupNow;
    const exposed = game.get("boss-callout").textContent.includes("现在打");
    const summoned = /第 (\d) \/ 3 管/.exec(game.get("boss-name").textContent);
    if (summoned) summonWaves.add(Number(summoned[1]));
    overcharged ||= game.get("boss-name").textContent.includes("过载");
    const callout = game.get("boss-callout").textContent;
    if (/火球要砸下来了|炉火坠落/.test(callout)) {
      game.release("KeyW");
      game.release("KeyD");
      game.key("KeyS");
      game.key("ShiftLeft");
    } else if (/冲过来了|熔锤冲锋/.test(callout)) {
      // Back away while strafing: at point-blank the guardian's
      // own body blocks a pure sideways escape from the strip.
      game.release("KeyW");
      game.key("KeyS");
      game.key(ramParity ? "KeyA" : "KeyD");
      game.release(ramParity ? "KeyD" : "KeyA");
      game.key("ShiftLeft");
    } else if (/横扫来了|扇形横扫/.test(callout)) {
      game.release("KeyW");
      game.release("KeyS");
      game.release("KeyA");
      game.key("KeyD");
      game.key("ShiftLeft");
    } else if (exposed) {
      game.release("KeyS");
      game.release("KeyA");
      game.release("KeyD");
      if (Math.hypot(dx, dz) > 1.8 * helmetVertices) game.key("ShiftLeft");
      else game.release("ShiftLeft");
    } else {
      game.release("KeyS");
      game.release("KeyA");
      game.key("KeyD");
      game.release("ShiftLeft");
    }
    // Timed jumps, scheduled on the windup hint: the ring leaves
    // the guardian at ~10 units/s, so from the robot's distance
    // estimate it arrives (dist - start) / 10 seconds after the
    // attack starts; jump 0.25s before that so the player is
    // rising through the safe height as the band crosses. The
    // nova's second ring follows 0.82s later (+42 frames).
    const bossDist = bossDistNow;
    if ((callout.includes("守卫要砸地了") || callout.includes("两圈冲击波") || callout.includes("三圈冲击波")) && !jumpPrimed) {
      jumpPrimed = true;
      const nova = callout.includes("两圈冲击波") || callout.includes("三圈冲击波");
      const bar = game.get("boss-name").textContent.includes("过载") ? 3
        : game.get("boss-name").textContent.includes("烈火") ? 2 : 1;
      const wind = nova ? 1.35 * [1, .86, .72][bar - 1] : bar === 2 ? .35 : 1.04 * [1, .86, .72][bar - 1];
      const arrive = (bossDist - (nova ? 1.72 : 1.35)) / 10;
      // The combo shock (bar 2) is primed at its 0.35s gap, not a
      // full windup: the helmet-distance estimate runs ~0.2s long
      // there, so the jump lead grows to keep the takeoff centred
      // in the ring's safe window.
      const lead = bar === 2 && !nova ? .45 : .25;
      const first = i + Math.round((wind + arrive - lead) / 0.02);
      if (nova && bar === 3) {
        jumpQueue.push(first - 2, first + 34, first + 72);
      } else {
        jumpQueue.push(first);
        if (nova) jumpQueue.push(first + 42);
      }
    }
    if (!callout.includes("砸地") && !callout.includes("冲击波") && !callout.includes("· 跳！")) jumpPrimed = false;
    const hpBot = Number(game.get("health-value").textContent);
    if (prevHpBot - hpBot === 1 || prevHpBot - hpBot === 2) fireStep = 25;
    prevHpBot = hpBot;
    if (fireStep > 0) { fireStep--; game.key("KeyA"); }
    if (jumpQueue.length && i >= jumpQueue[0]) {
      jumpQueue.shift();
      game.key("Space");
      game.release("Space");
    }
    if (exposed || /疾行者|破城者/.test(game.get("target-status").textContent)) attack();
  }
  // Death presentation window (batch 76): the killing blow has
  // landed (the last bar reads 0) but the settlement screen waits
  // out the 0.86s presentation — at +0.4s it is still not up, by
  // +1.0s it is, and the win's record was written exactly once.
  assert.equal(game.get("boss-health-value").textContent, "0 / 500");
  assert.equal(game.get("death-screen").hidden, true, "the settlement waits for the death presentation");
  for (let i = 0; i < 20; i++) frame();
  assert.equal(game.get("death-screen").hidden, true, "still presenting 0.4s after the kill");
  for (let i = 0; i < 30; i++) frame();
  assert.equal(game.get("death-screen").hidden, false, "the settlement lands once the presentation has played");
  assert.equal(progressWrites, 1, "the win merges its record exactly once");
  assert.ok(overcharged);
  assert.equal(halfHealSeen, 1, "the bar-3 half heal fires exactly once");
  assert.deepEqual([...summonWaves], [1, 2, 3]);
  assert.equal(game.get("death-title").textContent, "熔炉守卫已击败");
  assert.match(game.get("death-summary").textContent, /获得：熔火核心 ×2/);
  // The win pays its reward into the shared save — 2 ember cores for a
  // first kill — while the sandbox edits and supplies do not move.
  const base = JSON.parse(before);
  const won = JSON.parse(storage.getItem(SAVE_KEY));
  assert.deepEqual(won.edits, base.edits);
  assert.deepEqual(won.materials, base.materials);
  assert.equal(won.axeUnlocked, base.axeUnlocked);
  assert.deepEqual(won.dressings, base.dressings);
  assert.deepEqual(won.rareMaterials, { emberCore: 2, starShard: 0 });
  // The live defeat still lands in the cross-run progress
  // record (this coverage moved here from the seeded
  // challenger test in batch 69, whose robot no longer wins
  // at the tuned bars): defeated flag set, kill count one.
  const progress = JSON.parse(storage.getItem(PROGRESS_KEY));
  assert.equal(progress.bossesDefeated.boss, true);
  assert.equal(progress.bossKills.boss, 1);
  const afterWin = storage.getItem(SAVE_KEY);
  game.click("respawn-button");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("boss-health-value").textContent, "520 / 520");
  assert.equal(game.get("health-value").textContent, "100");
  game.key("Escape");
  game.click("pause-menu-button");
  game.click("build-button");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("boss-hud").hidden, true);
  assert.equal(game.get("vitals").hidden, true);
  assert.equal(storage.getItem(SAVE_KEY), afterWin);
});

test("leaving a boss fight through the pause menu takes the boss hud down with it", () => {
  // Batch 78 (visual batch 74's guardian-trial observation): the
  // pause -> return-to-menu exit left #boss-hud floating over the
  // main menu, because its only hider was the per-frame status
  // refresh and that stops when the run does. All three boss
  // entries share the exit path, so all three are pinned.
  for (const [button, label] of [["trial-guardian-button", "guardian trial"], ["trial-colossus-button", "colossus trial"], ["boss-button", "main boss"]]) {
    const data = new Map();
    const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const game = mountGame({ storage, pointerLock: true });
    let time = 0;
    const frame = () => game.frame(time += 20);
    game.click(button);
    game.grantPointerLock();
    for (let i = 0; i < 5; i++) frame();
    assert.equal(game.get("boss-hud").hidden, false, `${label}: hud up in the fight`);
    game.key("Escape");
    frame();
    assert.equal(game.get("pause-screen").hidden, false, `${label}: pause screen up`);
    game.click("pause-menu-button");
    frame();
    assert.equal(game.get("start-screen").hidden, false, `${label}: back at the menu`);
    assert.equal(game.get("boss-hud").hidden, true, `${label}: boss hud gone at the menu`);
    assert.equal(game.get("boss-warning").hidden, true, `${label}: no stranded warning`);
    assert.equal(game.get("boss-phase-banner").hidden, true, `${label}: no stranded banner`);
  }
});

test("boss trial: beating the guardian leaves the main save byte-identical", () => {
  const data = new Map();
  const storage = sharedStorage(data);
  seedProgress(storage, { wave: 3, kills: 42, bossKills: { boss: 2, colossus: 1 } });
  data.set(SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 3, wheat: 1 }));
  const game = mountGame({ storage, pointerLock: true });
  const attack = () => game.get("game").emit("mousedown", { button: 0 });
  let time = 0;
  const frame = () => game.frame(time += 20);
  frame();
  // Snapshot after construction, at the menu: from here on, only
  // the trial may run, and it must not move a single byte.
  const beforeSave = data.get(SAVE_KEY), beforeProgress = data.get(PROGRESS_KEY);
  game.click("trial-guardian-button");
  game.grantPointerLock();
  frame();
  // The trial boss is the real tuned guardian, and the loadout
  // is the star tier, not the player's own gear.
  assert.equal(game.get("boss-health-value").textContent, "520 / 520");
  assert.match(game.get("weapon-label").textContent, /断星剑/);
  let overcharged = false, guardianBreakSeen = false, halfHealSeen = 0, halfHealWasShown = false;
  const summonWaves = new Set();
  let jumpPrimed = false;
  const jumpQueue = [];
  let prevHpBot = 100, fireStep = 0;
  let ramParity = 0, wasRamWindup = false;
  for (let i = 0; i < 12000 && game.get("death-screen").hidden; i++) {
    frame();
    if (!guardianBreakSeen && game.get("boss-name").textContent.includes("烈火")) {
      guardianBreakSeen = true;
      assert.equal(game.get("boss-phase-banner").textContent, "守卫进入第二管：火焰变强了！先清随从能打断它放火");
      const first = game.get("boss-health-track").children[0];
      assert.ok(first.classList.contains("broken") && first.classList.contains("shattering"),
        "the guardian's broken segment flashes on the break frame");
    }
    // Bar-3 half heal (batch 68): the message's rising edge
    // fires exactly once, in the last bar, at or below half
    // of that bar, and never inside a windup (the callout
    // reads a warning sentence while a move is winding up).
    const halfShown = game.get("message").textContent.includes("第三管过半");
    if (halfShown && !halfHealWasShown) {
      halfHealSeen++;
      assert.ok(game.get("boss-name").textContent.includes("第 3 / 3 管"), "the half heal fires in the last bar");
      assert.ok(Number(game.get("boss-health-value").textContent.split(" / ")[0]) <= 250, "the half heal fires at or below half of the bar");
      assert.ok(!/要冲|砸地|冲击波|火圈/.test(game.get("boss-callout").textContent), "the half heal never lands inside a windup");
    }
    halfHealWasShown = halfShown;
    // Track the guardian's helmet as it circles between attacks.
    let dx = 0, dz = 0, helmetVertices = 0, bossDistNow = 5;
    const vertices = game.actorVertices;
    for (let v = 0; v < vertices.length; v += 12) {
      if (vertices[v + 1] < 7.6) continue;
      helmetVertices++;
      dx += vertices[v] - game.camera[0];
      dz += vertices[v + 2] - game.camera[2];
    }
    bossDistNow = helmetVertices ? Math.hypot(dx, dz) / helmetVertices : 5;
    // In bars 2-3, aim at the guardian's minions when they are
    // the right target: while it only approaches (the dodge
    // branches all assume the robot faces the boss, so attack
    // charges keep boss aim), and during its recovery when a
    // minion stands adjacent — minions camp at the guardian
    // and their chip damage over a long bar is lethal.
    // Low-band vertices away from the guardian's own cluster
    // are a zombie's model.
    if ((dx || dz) && /烈火|过载/.test(game.get("boss-name").textContent)
      && (game.get("boss-callout").textContent.includes("守卫靠近中")
        || game.get("boss-callout").textContent.includes("现在打"))) {
      const cx = dx / helmetVertices + game.camera[0], cz = dz / helmetVertices + game.camera[2];
      let zx = 0, zz = 0, zn = 0;
      for (let v = 0; v < vertices.length; v += 12) {
        const y = vertices[v + 1];
        if (y < 5.2 || y > 7.1) continue;
        if (Math.hypot(vertices[v] - cx, vertices[v + 2] - cz) < 2.2) continue;
        zx += vertices[v] - game.camera[0];
        zz += vertices[v + 2] - game.camera[2];
        zn++;
      }
      if (zn > 30) {
        const minionDist = Math.hypot(zx, zz) / zn;
        if (game.get("boss-callout").textContent.includes("守卫靠近中")
          || (minionDist < 3.2 && minionDist <= bossDistNow + 0.5)) {
          dx = zx; dz = zz; helmetVertices = zn;
        }
      }
    }
    if (dx || dz) {
      const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
      game.document.emit("mousemove", { movementX: Math.max(-65, Math.min(65, Math.atan2(Math.sin(turn), Math.cos(turn)) / .0013)), movementY: 0 });
      if (Math.hypot(dx, dz) > 1.8 * helmetVertices) game.key("KeyW");
      else game.release("KeyW");
    }
    const ramWindupNow = game.get("boss-callout").textContent.includes("守卫要冲过来了");
    if (ramWindupNow && !wasRamWindup) ramParity ^= 1;
    wasRamWindup = ramWindupNow;
    const exposed = game.get("boss-callout").textContent.includes("现在打");
    const summoned = /第 (\d) \/ 3 管/.exec(game.get("boss-name").textContent);
    if (summoned) summonWaves.add(Number(summoned[1]));
    overcharged ||= game.get("boss-name").textContent.includes("过载");
    const callout = game.get("boss-callout").textContent;
    if (/火球要砸下来了|炉火坠落/.test(callout)) {
      game.release("KeyW");
      game.release("KeyD");
      game.key("KeyS");
      game.key("ShiftLeft");
    } else if (/冲过来了|熔锤冲锋/.test(callout)) {
      // Back away while strafing: at point-blank the guardian's
      // own body blocks a pure sideways escape from the strip.
      game.release("KeyW");
      game.key("KeyS");
      game.key(ramParity ? "KeyA" : "KeyD");
      game.release(ramParity ? "KeyD" : "KeyA");
      game.key("ShiftLeft");
    } else if (/横扫来了|扇形横扫/.test(callout)) {
      game.release("KeyW");
      game.release("KeyS");
      game.release("KeyA");
      game.key("KeyD");
      game.key("ShiftLeft");
    } else if (exposed) {
      game.release("KeyS");
      game.release("KeyA");
      game.release("KeyD");
      if (Math.hypot(dx, dz) > 1.8 * helmetVertices) game.key("ShiftLeft");
      else game.release("ShiftLeft");
    } else {
      game.release("KeyS");
      game.release("KeyA");
      game.key("KeyD");
      game.release("ShiftLeft");
    }
    // Timed jumps, scheduled on the windup hint: the ring leaves
    // the guardian at ~10 units/s, so from the robot's distance
    // estimate it arrives (dist - start) / 10 seconds after the
    // attack starts; jump 0.25s before that so the player is
    // rising through the safe height as the band crosses. The
    // nova's second ring follows 0.82s later (+42 frames).
    const bossDist = bossDistNow;
    if ((callout.includes("守卫要砸地了") || callout.includes("两圈冲击波") || callout.includes("三圈冲击波")) && !jumpPrimed) {
      jumpPrimed = true;
      const nova = callout.includes("两圈冲击波") || callout.includes("三圈冲击波");
      const bar = game.get("boss-name").textContent.includes("过载") ? 3
        : game.get("boss-name").textContent.includes("烈火") ? 2 : 1;
      const wind = nova ? 1.35 * [1, .86, .72][bar - 1] : bar === 2 ? .35 : 1.04 * [1, .86, .72][bar - 1];
      const arrive = (bossDist - (nova ? 1.72 : 1.35)) / 10;
      // The combo shock (bar 2) is primed at its 0.35s gap, not a
      // full windup: the helmet-distance estimate runs ~0.2s long
      // there, so the jump lead grows to keep the takeoff centred
      // in the ring's safe window.
      const lead = bar === 2 && !nova ? .45 : .25;
      const first = i + Math.round((wind + arrive - lead) / 0.02);
      if (nova && bar === 3) {
        jumpQueue.push(first - 2, first + 34, first + 72);
      } else {
        jumpQueue.push(first);
        if (nova) jumpQueue.push(first + 42);
      }
    }
    if (!callout.includes("砸地") && !callout.includes("冲击波") && !callout.includes("· 跳！")) jumpPrimed = false;
    const hpBot = Number(game.get("health-value").textContent);
    if (prevHpBot - hpBot === 1 || prevHpBot - hpBot === 2) fireStep = 25;
    prevHpBot = hpBot;
    if (fireStep > 0) { fireStep--; game.key("KeyA"); }
    if (jumpQueue.length && i >= jumpQueue[0]) {
      jumpQueue.shift();
      game.key("Space");
      game.release("Space");
    }
    if (exposed || /疾行者|破城者/.test(game.get("target-status").textContent)) attack();
  }
  assert.ok(overcharged);
  assert.deepEqual([...summonWaves], [1, 2, 3]);
  assert.equal(game.get("death-title").textContent, "试炼 · 熔炉守卫已击败");
  assert.match(game.get("death-summary").textContent, /试炼掉落不计入主线/,
    "the trial drop line says the loot stays out of the main save");
  game.click("death-menu-button");
  frame();
  assert.equal(data.get(SAVE_KEY), beforeSave, "the trial win must not touch the main save");
  assert.equal(data.get(PROGRESS_KEY), beforeProgress, "the trial win must not record a boss defeat");
});

test("boss trial: falling to the colossus leaves the main save byte-identical", () => {
  const data = new Map();
  const storage = sharedStorage(data);
  seedProgress(storage, { wave: 3, kills: 42, bossKills: { boss: 2, colossus: 1 } });
  data.set(SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 3, wheat: 1 }));
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  frame();
  const beforeSave = data.get(SAVE_KEY), beforeProgress = data.get(PROGRESS_KEY);
  game.click("trial-colossus-button");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("boss-health-value").textContent, "700 / 700");
  // Stand in the sky court's fire until the trial ends in defeat.
  for (let i = 0; i < 15000 && game.get("death-screen").hidden; i++) frame();
  assert.equal(game.get("death-title").textContent, "试炼 · 挑战失败");
  game.click("death-menu-button");
  frame();
  assert.equal(data.get(SAVE_KEY), beforeSave, "the trial loss must not touch the main save");
  assert.equal(data.get(PROGRESS_KEY), beforeProgress, "the trial loss must not touch the main progress");
});

test("boss trial: giving up from the pause menu leaves the main save byte-identical", () => {
  const data = new Map();
  const storage = sharedStorage(data);
  seedProgress(storage, { wave: 3, kills: 42, bossKills: { boss: 2, colossus: 1 } });
  data.set(SAVE_KEY, v5SaveWithSeeds({ wheatSeed: 3, wheat: 1 }));
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  frame();
  const beforeSave = data.get(SAVE_KEY), beforeProgress = data.get(PROGRESS_KEY);
  game.click("trial-guardian-button");
  game.grantPointerLock();
  for (let i = 0; i < 30; i++) frame();
  assert.equal(game.get("boss-health-value").textContent, "520 / 520");
  game.key("Escape");
  frame();
  game.click("pause-menu-button");
  frame();
  assert.equal(game.get("start-screen").hidden, false, "giving up lands back on the main menu");
  assert.equal(data.get(SAVE_KEY), beforeSave, "giving up must not touch the main save");
  assert.equal(data.get(PROGRESS_KEY), beforeProgress, "giving up must not touch the main progress");
});

test("the boss deals fatal damage to an idle target and the retry restores health", () => {
  const game = mountGame();
  game.click("boss-button");
  game.frame(0);
  game.key("KeyW");
  for (let i = 1; i <= 12; i++) game.frame(i * 100);
  game.release("KeyW");
  for (let i = 13; i < 400 && game.get("death-screen").hidden; i++) game.frame(i * 100);
  assert.equal(game.get("death-title").textContent, "挑战失败");
  assert.equal(game.get("health-value").textContent, "0");
  game.click("respawn-button");
  game.frame(41000);
  assert.equal(game.get("death-screen").hidden, true);
  assert.equal(game.get("health-value").textContent, "100");
});

test("the colossus opens the fight before the player moves, and a pause holds the opening", () => {
  const game = mountGame({ pointerLock: true });
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
  assert.equal(game.get("health-value").textContent, "76");
});

test("charging follows hold time and releasing early, swapping or pausing spends no energy", () => {
  let now = 0;
  const game = mountGame({ pointerLock: true, now: () => now });
  let time = 0;
  const advance = frames => { for (let i = 0; i < frames; i++) game.frame(time += 20); };
  const press = () => game.get("game").emit("mousedown", { button: 2 });
  const release = () => game.document.emit("mouseup", { button: 2 });
  const energy = () => game.get("pulse-info").textContent;

  game.click("colossus-button");
  game.grantPointerLock();
  game.key("Digit8");
  advance(1);
  press();
  advance(14);
  assert.match(game.get("weapon-label").textContent, /爆发蓄力中/);
  release();
  advance(1);
  assert.match(energy(), /6 \/ 6/);

  press();
  advance(32);
  assert.match(game.get("weapon-label").textContent, /松开右键发射/);
  game.key("Digit6");
  release();
  game.key("Digit8");
  advance(1);
  assert.match(energy(), /6 \/ 6/);

  press();
  advance(32);
  game.key("Escape");
  release();
  game.click("resume-button");
  game.grantPointerLock();
  advance(2);
  assert.match(energy(), /6 \/ 6/);
  press();
  advance(3);
  now += 650;
  release();
  advance(1);
  assert.match(energy(), /4 \/ 6/);
  assert.equal(game.get("boss-health-value").textContent, "700 / 700");
});

test("held gunfire stops on release and switching and uses the cannon's two-cell shot", () => {
  const game = mountGame({ pointerLock: true });
  game.click("colossus-button");
  game.grantPointerLock();
  let time = 0;
  const frames = n => { for (let i = 0; i < n; i++) game.frame(time += 20); };
  const rounds = () => game.get("pulse-info").textContent;
  game.key("Digit9");
  frames(2);
  game.get("game").emit("mousedown", {button: 0});
  frames(10);
  assert.match(rounds(), /4 \/ 6/);
  game.document.emit("mouseup", {button: 0});
  frames(15);
  assert.match(rounds(), /4 \/ 6/);
  game.get("game").emit("mousedown", {button: 0});
  game.key("Digit0");
  frames(20);
  assert.match(game.get("weapon-label").textContent, /裂晶重炮/);
  assert.match(rounds(), /3 \/ 6/);
  game.document.emit("mouseup", {button: 0});
  game.get("game").emit("mousedown", {button: 0});
  frames(2);
  assert.match(rounds(), /1 \/ 6/);
});

test("court skills heal after damage and five delayed dragon impacts bypass the shutter", () => {
  const game = mountGame({ pointerLock: true });
  game.click("colossus-button");
  game.grantPointerLock();
  let time = 0;
  const frames = n => { for (let i = 0; i < n; i++) game.frame(time += 20); };
  frames(2);
  game.key("Digit1");
  game.release("Digit1");
  frames(140);
  assert.ok(Number(game.get("health-value").textContent) < 100);
  game.key("Digit1");
  assert.equal(game.get("health-value").textContent, "100");
  game.key("Digit4");
  frames(12);
  assert.equal(game.get("boss-health-value").textContent, "700 / 700");
  game.release("Digit4");
  game.key("Digit4");
  frames(85);
  assert.equal(game.get("boss-health-value").textContent, "684 / 700");
  frames(115);
  assert.equal(game.get("boss-health-value").textContent, "620 / 700");
});

test("the pulse weapon can interrupt the crystal and win the colossus fight through both phases", t => {
  // Seeded random (batch 77): this choreography used to face the
  // raw Math.random stream and intermittently lost the fight under
  // load; on the fixed LCG stream it wins deterministically.
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ pointerLock: true, storage });
  const attack = () => {
    game.get("game").emit("mousedown", { button: 0 });
    game.document.emit("mouseup", { button: 0 });
  };
  let time = 0;
  const frame = () => game.frame(time += 20);
  const advance = frames => { for (let i = 0; i < frames; i++) frame(); };
  function aimAtPart(mark) {
    // The harness keeps the last mesh upload of the frame; a
    // one-frame particle upload can land after the actor mesh and
    // hide it. Rescan on later frames before concluding the part
    // is not rendered (up to 30 frames), then assert as before.
    let vertices = game.actorVertices;
    const scan = () => {
      let found = 0;
      for (let offset = 0; offset < vertices.length; offset += 12) if (vertices[offset + 9] === mark) found++;
      return found;
    };
    for (let attempt = 0; attempt < 30 && !scan(); attempt++) { frame(); vertices = game.actorVertices; }
    const sum = [0, 0, 0];
    let points = 0;
    for (let offset = 0; offset < vertices.length; offset += 12) {
      if (vertices[offset + 9] !== mark) continue;
      sum[0] += vertices[offset];
      sum[1] += vertices[offset + 1];
      sum[2] += vertices[offset + 2];
      points++;
    }
    assert.ok(points, "the colossus renders the part");
    const offsetFromEye = game.camera.map((eye, axis) => sum[axis] / points - eye);
    const [dx, dy, dz] = offsetFromEye;
    const [x, y, z] = game.direction;
    const yaw = Math.atan2(dx, -dz) - Math.atan2(x, -z);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz)) - Math.asin(y);
    const mouseDelta = radians => Math.max(-65, Math.min(65, radians / .0013));
    game.document.emit("mousemove", { movementX: mouseDelta(Math.atan2(Math.sin(yaw), Math.cos(yaw))), movementY: mouseDelta(-pitch) });
    return Math.hypot(...offsetFromEye);
  }
  game.click("colossus-button");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("boss-name").textContent, "断星巨像");
  assert.equal(game.get("boss-health-value").textContent, "700 / 700");
  assert.equal(game.get("weather-status").textContent, "断星天井");
  game.key("Digit8");
  frame();
  assert.match(game.get("pulse-info").textContent, /6 \/ 6/);
  attack();
  frame();
  assert.match(game.get("pulse-info").textContent, /5 \/ 6/);
  assert.equal(game.get("boss-health-value").textContent, "700 / 700");
  game.key("KeyR");
  frame();
  assert.equal(game.get("pulse-info").textContent, "正在充能");
  attack();
  advance(66);
  assert.match(game.get("pulse-info").textContent, /6 \/ 6/);
  game.key("KeyW");
  advance(39);
  game.release("KeyW");
  let secondPhase = false, shifted = false, nova = false, rangedHit = false, interrupted = false;
  let dodge = null, dodgeUntil = 0, dodged = false, strafe = null, dangerWas = false, dragonBlind = 0;
  const barLines = {
    "震星": "断星巨像进入第二管 · 震星：星环会从场地边上收回来，贴近它或跳过环",
    "逐星": "断星巨像进入第三管 · 逐星：它会冲锋、会升炮台，先打碎空中的晶体",
    "碎星": "断星巨像进入最后一管 · 碎星：它要拼命了！断星升空时，数着环跳"
  };
  const barsSeen = new Set();
  let shatterFrame = -1;
  for (let i = 0; i < 16000 && game.get("death-screen").hidden; i++) {
    frame();
    // Bar-change theatre (batch 64): the frame a new bar's
    // name lands, the banner carries that bar's own line and
    // the newly broken segment is mid-flash; 0.45s later the
    // flash is gone and the segment stays broken.
    for (const [mark, line] of Object.entries(barLines)) {
      if (!barsSeen.has(mark) && game.get("boss-name").textContent.includes(mark)) {
        barsSeen.add(mark);
        assert.equal(game.get("boss-phase-banner").textContent, line);
        assert.equal(game.get("boss-phase-banner").hidden, false);
        const broken = game.get("boss-health-track").children.filter(segment => segment.classList.contains("broken"));
        assert.ok(broken.length >= 1 && broken[broken.length - 1].classList.contains("shattering"),
          "the newly broken segment flashes on the break frame");
        if (shatterFrame < 0) shatterFrame = i;
      }
    }
    if (shatterFrame >= 0 && i === shatterFrame + 40) {
      const first = game.get("boss-health-track").children[0];
      assert.ok(first.classList.contains("broken") && !first.classList.contains("shattering"),
        "the flash lifts after 0.45s and the segment stays broken");
    }
    const callout = game.get("boss-callout").textContent;
    if (strafe && !/炮台|星震|断星|星环/.test(callout)) { game.release(strafe); strafe = null; }
    secondPhase ||= game.get("wave-status").textContent.includes("第 2 / 4 管");
    shifted ||= callout.includes("换位置");
    nova ||= callout.includes("双环星震");
    if (dodge && time >= dodgeUntil) {
      game.release(dodge);
      dodge = null;
    }
    if (callout.includes("打碎金色晶体")) {
      aimAtPart(-3);
      const label = game.get("weapon-label").textContent;
      if (label.includes("可攻击")) game.get("game").emit("mousedown", { button: 2 });
      if (label.includes("松开右键发射") && game.get("target-status").textContent === "金色晶体 42 / 42 · 打碎它能停掉光束") {
        game.document.emit("mouseup", { button: 2 });
        frame();
        interrupted = game.get("message").textContent.includes("三轨折光中断");
        assert.match(game.get("pulse-info").textContent, /4 \/ 6/);
        assert.ok(game.get("boss-callout").textContent.includes("露出来的核心"));
      }
      continue;
    }
    // Jump presses must be single clean taps: a press every
    // frame keeps the game's jump buffer permanently open,
    // the physics never sees a new rising edge, and only the
    // first jump of a long attack ever fires. Tap on the
    // danger sentence's arrival, and otherwise every dozen
    // frames so a fresh edge lands soon after each touchdown.
    const dangerNow = callout.includes("震圈逼近");
    if ((callout.includes("跳！") || dangerNow) && ((dangerNow && !dangerWas) || i % 12 === 0)) {
      game.key("Space"); game.release("Space");
    }
    dangerWas = dangerNow;
    if (Number(game.get("health-value").textContent) <= 65) { game.key("Digit1"); game.release("Digit1"); }
    // While the turret battery is up (batch 62), the first
    // live crystal is the target, not the core: two shots
    // each, and the battery ends early when all four fall.
    let aimMark = -2;
    if (callout.includes("炮台")) {
      for (const mark of [-11, -12, -13, -14]) {
        let found = 0;
        const vertices = game.actorVertices;
        for (let o = 0; o < vertices.length; o += 12) if (vertices[o + 9] === mark) found++;
        if (found) { aimMark = mark; break; }
      }
    }
    // During the starfall — and while the dragon volley is
    // in flight — bursts flood the actor snapshot for long
    // stretches; the robot just dodges it out and re-aims
    // on the next move.
    if (dragonBlind > 0) dragonBlind--;
    const distance = callout.includes("断星") || dragonBlind > 0 ? 9 : aimAtPart(aimMark);
    if (callout.includes("露出来的核心")) {
      dodged = false;
      if (game.get("target-status").textContent !== "核心暴露") continue;
      // The dragon volley strikes where the camera aims:
      // loose it only on a verified core aim, then let it
      // fly unaimed while its bursts flood the snapshot.
      if (game.get("boss-skill-dragons").textContent.includes("就绪")) { game.key("Digit4"); game.release("Digit4"); dragonBlind = 300; }
      const hp = game.get("boss-health-value").textContent;
      attack();
      frame();
      rangedHit ||= distance > 7 && hp !== game.get("boss-health-value").textContent;
    } else {
      const inDanger = callout.includes("脚下已锁定") || callout.includes("你在光带中") || callout.includes("你在冲锋线上") || callout.includes("要冲过来了");
      if (!inDanger) dodged = false;
      if (!dodged && inDanger) {
        dodge = game.camera[0] > 16.5 ? "KeyA" : "KeyD";
        game.key(dodge);
        dodgeUntil = time + 850;
        dodged = true;
      }
      if (aimMark !== -2 && game.get("target-status").textContent.startsWith("星尘晶体")) attack();
      // While rings or battery shots are live (batch 62),
      // never stand still: a moving target slips the mini
      // locks and shifts the ring crossings off the jump
      // cycle.
      if (!strafe && !dodge && /炮台|星震|断星|星环/.test(callout)) {
        strafe = game.camera[0] > 16.5 ? "KeyA" : "KeyD";
        game.key(strafe);
      }
      if (callout.includes("断星")) {
        // Point blank is the starfall's blind spot: the
        // rings are born at 1.72, so at the collision gap
        // they cross almost as they spawn — inside a single
        // jump cycle — and the fire rings at 13.6 never
        // reach there. Charge the giant for the whole move.
        game.key("KeyW");
        game.release("KeyS");
      } else if (!dodge) {
        // Hold mid-range: past 11.2 the giant answers
        // every pattern slot with a meteor and the prism
        // never opens; closer than 6 the charge crowds.
        if (distance > 10.5) game.key("KeyW"); else game.release("KeyW");
        if (distance < 6) game.key("KeyS"); else game.release("KeyS");
      } else {
        game.release("KeyW");
        game.release("KeyS");
      }
      if (/能量 [0-5] \/ 6/.test(game.get("pulse-info").textContent)) game.key("KeyR");
    }
  }
  assert.equal(rangedHit, true);
  assert.equal(shifted, true);
  assert.equal(secondPhase, true);
  assert.equal(nova, true);
  assert.equal(interrupted, true);
  assert.equal(game.get("death-title").textContent, "断星巨像已击败");
  assert.match(game.get("death-summary").textContent, /获得：断星碎片 ×2/);
  // A first colossus kill pays 2 star shards into the shared save.
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)).rareMaterials, { emberCore: 0, starShard: 2 });
  game.click("respawn-button");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("boss-health-value").textContent, "700 / 700");
  assert.equal(game.get("health-value").textContent, "100");
  game.key("Escape");
  game.click("pause-menu-button");
  game.click("boss-button");
  game.grantPointerLock();
  frame();
  game.key("Digit8");
  frame();
  assert.equal(game.get("pulse-info").hidden, true);
  assert.equal(game.get("boss-health-value").textContent, "520 / 520");
  assert.equal(game.get("weather-status").textContent, "熔炉遗迹");
});

test("boss health bar: segments per bar, the current one drains, broken ones go dark", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const segFill = segment => segment.children.find(child => child.classList.contains("boss-segment-fill"));
  const segGhost = segment => segment.children.find(child => child.classList.contains("boss-segment-ghost"));
  // The colossus gets four segments; the first is current and full,
  // the rest idle, and the hud wears the first bar's colour class.
  {
    const game = mountGame({ pointerLock: true });
    let time = 0;
    const frame = () => game.frame(time += 20);
    game.click("colossus-button");
    game.grantPointerLock();
    frame();
    const segments = game.get("boss-health-track").children;
    assert.equal(segments.length, 4);
    assert.ok(segments[0].classList.contains("bar-1"));
    assert.ok(segments[0].classList.contains("current"));
    assert.equal(segFill(segments[0]).style.width, "100%");
    assert.equal(segGhost(segments[0]).style.width, "100%");
    assert.ok(segments[3].classList.contains("bar-4"));
    assert.ok(segments[3].classList.contains("idle"));
    assert.equal(segFill(segments[3]).style.width, "100%");
    assert.ok(game.get("boss-hud").classList.contains("bar-1"));
  }
  // The guardian gets three. Fight (the win test's robot) until
  // the first bar breaks: mid-bar the current segment's fill tracks
  // the numeric readout exactly; after the break the first segment
  // is broken, the second is current, the third still idle.
  const game = mountGame({ pointerLock: true });
  const attack = () => game.get("game").emit("mousedown", { button: 0 });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("boss-button");
  game.grantPointerLock();
  frame();
  const segments = game.get("boss-health-track").children;
  assert.equal(segments.length, 3);
  assert.ok(segments[0].classList.contains("current"));
  game.key("KeyW");
  game.key("Digit7");
  for (let i = 0; i < 58; i++) frame();
  game.release("KeyW");
  let jumpPrimed = false;
  const jumpQueue = [];
  let prevHpBot = 100, fireStep = 0;
  let ramParity = 0, wasRamWindup = false;
  let fracChecked = false, advanced = false;
  for (let i = 0; i < 6000 && game.get("death-screen").hidden && !advanced; i++) {
    frame();
    let dx = 0, dz = 0, helmetVertices = 0, bossDistNow = 5;
    const vertices = game.actorVertices;
    for (let v = 0; v < vertices.length; v += 12) {
      if (vertices[v + 1] < 7.6) continue;
      helmetVertices++;
      dx += vertices[v] - game.camera[0];
      dz += vertices[v + 2] - game.camera[2];
    }
    bossDistNow = helmetVertices ? Math.hypot(dx, dz) / helmetVertices : 5;
    // In bars 2-3, aim at the guardian's minions when they are
    // the right target: while it only approaches (the dodge
    // branches all assume the robot faces the boss, so attack
    // charges keep boss aim), and during its recovery when a
    // minion stands adjacent — minions camp at the guardian
    // and their chip damage over a long bar is lethal.
    // Low-band vertices away from the guardian's own cluster
    // are a zombie's model.
    if ((dx || dz) && /烈火|过载/.test(game.get("boss-name").textContent)
      && (game.get("boss-callout").textContent.includes("守卫靠近中")
        || game.get("boss-callout").textContent.includes("现在打"))) {
      const cx = dx / helmetVertices + game.camera[0], cz = dz / helmetVertices + game.camera[2];
      let zx = 0, zz = 0, zn = 0;
      for (let v = 0; v < vertices.length; v += 12) {
        const y = vertices[v + 1];
        if (y < 5.2 || y > 7.1) continue;
        if (Math.hypot(vertices[v] - cx, vertices[v + 2] - cz) < 2.2) continue;
        zx += vertices[v] - game.camera[0];
        zz += vertices[v + 2] - game.camera[2];
        zn++;
      }
      if (zn > 30) {
        const minionDist = Math.hypot(zx, zz) / zn;
        if (game.get("boss-callout").textContent.includes("守卫靠近中")
          || (minionDist < 3.2 && minionDist <= bossDistNow + 0.5)) {
          dx = zx; dz = zz; helmetVertices = zn;
        }
      }
    }
    if (dx || dz) {
      const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
      game.document.emit("mousemove", { movementX: Math.max(-65, Math.min(65, Math.atan2(Math.sin(turn), Math.cos(turn)) / .0013)), movementY: 0 });
      if (Math.hypot(dx, dz) > 1.8 * helmetVertices) game.key("KeyW");
      else game.release("KeyW");
    }
    const ramWindupNow = game.get("boss-callout").textContent.includes("守卫要冲过来了");
    if (ramWindupNow && !wasRamWindup) ramParity ^= 1;
    wasRamWindup = ramWindupNow;
    const exposed = game.get("boss-callout").textContent.includes("现在打");
    const callout = game.get("boss-callout").textContent;
    if (/火球要砸下来了|炉火坠落/.test(callout)) {
      game.release("KeyW");
      game.release("KeyD");
      game.key("KeyS");
      game.key("ShiftLeft");
    } else if (/冲过来了|熔锤冲锋/.test(callout)) {
      // Back away while strafing: at point-blank the guardian's
      // own body blocks a pure sideways escape from the strip.
      game.release("KeyW");
      game.key("KeyS");
      game.key(ramParity ? "KeyA" : "KeyD");
      game.release(ramParity ? "KeyD" : "KeyA");
      game.key("ShiftLeft");
    } else if (/横扫来了|扇形横扫/.test(callout)) {
      game.release("KeyW");
      game.release("KeyS");
      game.release("KeyA");
      game.key("KeyD");
      game.key("ShiftLeft");
    } else if (exposed) {
      game.release("KeyS");
      game.release("KeyA");
      game.release("KeyD");
      if (Math.hypot(dx, dz) > 1.8 * helmetVertices) game.key("ShiftLeft");
      else game.release("ShiftLeft");
    } else {
      game.release("KeyS");
      game.release("KeyA");
      game.key("KeyD");
      game.release("ShiftLeft");
    }
    const bossDist = bossDistNow;
    if ((callout.includes("守卫要砸地了") || callout.includes("两圈冲击波") || callout.includes("三圈冲击波")) && !jumpPrimed) {
      jumpPrimed = true;
      const nova = callout.includes("两圈冲击波") || callout.includes("三圈冲击波");
      const bar = game.get("boss-name").textContent.includes("过载") ? 3
        : game.get("boss-name").textContent.includes("烈火") ? 2 : 1;
      const wind = nova ? 1.35 * [1, .86, .72][bar - 1] : bar === 2 ? .35 : 1.04 * [1, .86, .72][bar - 1];
      const arrive = (bossDist - (nova ? 1.72 : 1.35)) / 10;
      // The combo shock (bar 2) is primed at its 0.35s gap, not a
      // full windup: the helmet-distance estimate runs ~0.2s long
      // there, so the jump lead grows to keep the takeoff centred
      // in the ring's safe window.
      const lead = bar === 2 && !nova ? .45 : .25;
      const first = i + Math.round((wind + arrive - lead) / 0.02);
      if (nova && bar === 3) {
        jumpQueue.push(first - 2, first + 34, first + 72);
      } else {
        jumpQueue.push(first);
        if (nova) jumpQueue.push(first + 42);
      }
    }
    if (!callout.includes("砸地") && !callout.includes("冲击波") && !callout.includes("· 跳！")) jumpPrimed = false;
    const hpBot = Number(game.get("health-value").textContent);
    if (prevHpBot - hpBot === 1 || prevHpBot - hpBot === 2) fireStep = 25;
    prevHpBot = hpBot;
    if (fireStep > 0) { fireStep--; game.key("KeyA"); }
    if (jumpQueue.length && i >= jumpQueue[0]) {
      jumpQueue.shift();
      game.key("Space");
      game.release("Space");
    }
    if (exposed || /疾行者|破城者/.test(game.get("target-status").textContent)) attack();
    const hpNow = Number(game.get("boss-health-value").textContent.split(" / ")[0]);
    if (!fracChecked && hpNow < 520) {
      fracChecked = true;
      assert.equal(segFill(segments[0]).style.width, `${Math.round(hpNow / 520 * 1000) / 10}%`);
    }
    advanced = game.get("boss-name").textContent.includes("第 2 / 3 管");
  }
  assert.ok(fracChecked, "the guardian took damage mid-bar");
  assert.ok(advanced, "the first bar broke");
  assert.equal(game.get("boss-health-track").children.length, 3);
  assert.ok(segments[0].classList.contains("broken"));
  assert.equal(segFill(segments[0]).style.width, "0%");
  assert.ok(segments[1].classList.contains("current"));
  assert.ok(segments[2].classList.contains("idle"));
  assert.ok(game.get("boss-hud").classList.contains("bar-2"));
});

test("boss warnings: the guardian's status line, central warning and in-danger feedback speak plainly", () => {
  const game = mountGame({ pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  const callout = () => game.get("boss-callout").textContent;
  game.click("boss-button");
  game.grantPointerLock();
  frame();
  // The right-top line is minions + one tip; the wave lives only in
  // the boss hud, under its new name; the debug coordinates yield.
  assert.equal(game.get("wave-status").textContent, "场上随从 0 只 · 守卫蓄力时绕到背后打核心");
  assert.equal(game.get("boss-name").textContent, "熔炉守卫 · 第 1 / 3 管 · 起火");
  assert.equal(game.get("coordinates").hidden, true);
  // The first windup (shock) puts the plain sentence in the callout
  // and, word for word, in the big central warning.
  let sawWindup = false;
  for (let i = 0; i < 200 && !sawWindup; i++) {
    frame();
    if (callout() === "守卫要砸地了！红圈扩到你脚下时跳起来") {
      sawWindup = true;
      assert.equal(game.get("boss-warning").hidden, false);
      assert.equal(game.get("boss-warning").textContent, "⚠ 守卫要砸地了！红圈扩到你脚下时跳起来");
    }
  }
  assert.ok(sawWindup, "the shock windup callout must appear");
  // The second attack is the sweep; the guardian closes to its
  // standoff and the standing player is inside the sector, so the
  // danger variant and both in-danger classes must engage.
  let sawDanger = false;
  for (let i = 0; i < 900 && !sawDanger; i++) {
    frame();
    if (callout() === "扇形横扫 · 你在红扇子里，从侧边跑出去") {
      sawDanger = true;
      assert.equal(game.get("hud").classList.contains("in-danger"), true);
      assert.equal(game.get("boss-hud").classList.contains("in-danger"), true);
      assert.equal(game.get("boss-warning").textContent, "⚠ 扇形横扫 · 你在红扇子里，从侧边跑出去");
    }
  }
  assert.ok(sawDanger, "standing in the sweep sector must raise the danger callout");
});

test("boss warnings: the colossus shows phase and skill chips, and its meteor telegraph grows", () => {
  const game = mountGame({ pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  const callout = () => game.get("boss-callout").textContent;
  game.click("colossus-button");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("wave-status").textContent, "第 1 / 4 管 · 裂星");
  assert.equal(game.get("boss-skills").hidden, false);
  assert.equal(game.get("boss-skill-heal").textContent, "[1] 回血 · 就绪");
  assert.equal(game.get("boss-skill-dragons").textContent, "[4] 五龙冲击 · 就绪");
  assert.equal(game.get("coordinates").hidden, true);
  // The meteor locks onto the standing player: the danger variant
  // fires, and the telegraph's fill disc grows toward a rim that
  // has promised the full circle (over a black underlay) all along.
  const mark = { x: 16.5, z: 28.15 };
  const spread = (want, minR, maxR) => {
    const vertices = game.actorVertices;
    let found = false;
    for (let v = 0; v + 11 < vertices.length; v += 12) {
      const [r, g, b] = [vertices[v + 3], vertices[v + 4], vertices[v + 5]];
      if (!want(r, g, b)) continue;
      const d = Math.hypot(vertices[v] - mark.x, vertices[v + 2] - mark.z);
      if (d >= minR && d <= maxR) found = true;
    }
    return found;
  };
  const fillReach = () => {
    const vertices = game.actorVertices;
    let max = 0;
    for (let v = 0; v + 11 < vertices.length; v += 12) {
      if (Math.abs(vertices[v + 3] - .55) > .02 || Math.abs(vertices[v + 4] - .26) > .02 || Math.abs(vertices[v + 5] - .50) > .02) continue;
      max = Math.max(max, Math.hypot(vertices[v] - mark.x, vertices[v + 2] - mark.z));
    }
    return max;
  };
  let early = null, dangerSeen = false;
  for (let i = 0; i < 400 && (early === null || !dangerSeen); i++) {
    frame();
    if (callout() === "追星坠落 · 脚下已锁定，立刻跑开") dangerSeen = true;
    // Standing on the mark, the danger variant replaces the windup
    // sentence from the first frame — either text opens the windup.
    if (early === null && (callout().includes("陨石要砸你站的地方了") || dangerSeen)) {
      for (let j = 0; j < 8; j++) frame();
      early = fillReach();
      // Rim at full reach and black underlay beyond it, frame one.
      // (The player is standing in this hazard, so the rim burns
      // solid white instead of pulsing pink — either is the rim.)
      assert.ok(spread((r, g, b) => (r > .9 && g > .9 && b > .9) || (r > .7 && g > .3 && g < .5 && b > .45 && b < .65), 2.6, 2.9), "the rim must promise the full circle at once");
      assert.ok(spread((r, g, b) => r < .05 && g < .05 && b < .05, 3.0, 3.3), "the black underlay must extend past the rim");
    }
  }
  assert.ok(dangerSeen, "standing on the meteor mark must raise the danger callout");
  assert.ok(early !== null && early < 1.2, `the fill must start small (got ${early})`);
  let late = 0;
  for (let i = 0; i < 70 && late < 2.3; i++) { frame(); late = Math.max(late, fillReach()); }
  assert.ok(late > 2.3 && late <= 2.86, `the fill must grow to the rim (got ${late})`);
});
