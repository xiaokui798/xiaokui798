import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mountGame, seedProgress, sharedStorage, v5SaveWithSeeds, v5SaveForCooking, takeHitsUntil, nearestZombieVertex, steerTowardVertex, swingAtNearestZombie } from "./game-harness.mjs";
import { BLOCK, SAVE_KEY, V4_SAVE_KEY, PROGRESS_KEY, createProgression, saveProgress } from "./progression.mjs";
import { SURVIVAL_DIFFICULTY, survivalRoster, hpMultiplier, scaledHp } from "./difficulty.mjs";
import { ENEMIES, defenseWaveRoster } from "./defense.mjs";
import { WORLD, voxelIndex } from "./terrain.mjs";

// Survival combat integration tests: spitter/exploder/splitter/summoner behavior and kill loot. Split from game.test.mjs (batch 108).

test("a spitter's throw wounds the player from range in the first survival wave", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  frame();
  // Since the batch-88 deletion the spitter is the roster's base
  // kind — the first survival wave already fields two, and the old
  // wave-6 staging (fight five waves to reach the first spitter)
  // went with the mix-in rule that delayed it. What this test still
  // guards is the throw itself: the player stands still, no zombie
  // ever gets adjacent, and the first wound is exactly one throw —
  // 13 damage, which turns the even 100 odd. (At full health the
  // satiety regen cannot mask the sample; the exploder's own
  // game-layer test follows below.)
  const hp = () => Number(game.get("health-value").textContent);
  let prev = hp(), firstDrop = 0;
  for (let i = 0; i < 6000 && !firstDrop; i++) {
    frame();
    const now = hp();
    if (now < prev) firstDrop = prev - now;
    prev = now;
  }
  assert.equal(firstDrop, 13, "the first wound is one spitter throw");
  assert.equal(prev % 2, 1, "100 minus a 13-damage throw is odd — no melee hit in this wave can fake it");
  assert.match(game.get("wave-status").textContent, /剩余 2 只/, "both spitters are still on the field — the wound came from range");
});

test("survival wave 5's exploder detonates on the player and pays no loot", t => {
  // Batch 88, the exploder at game level (parked during the deletion
  // step, restored in batch 90 on the post-deletion rosters): it
  // closes on the player, lights its 1s fuse, and detonates — the
  // blast lands for the registered damage, the exploder dies by its
  // own blast, and a self-detonation pays NO loot (the ember core is
  // paid only when the player lands the kill; progression.test pins
  // that side, and defense.test pins the blast's separate beacon
  // number). The bot fights waves 1-4 with a per-frame walk-to
  // driver — the base kind is ranged now, so standing and swinging
  // never reaches anyone — then in wave 5 holds its fire the first
  // time the exploder is in its sights and stands still, so the
  // fuse runs out next to it.
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  let time = 0;
  const game = mountGame({ storage, pointerLock: true, now: () => time });
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  frame();
  const hp = () => Number(game.get("health-value").textContent);
  const waveStatus = () => game.get("wave-status").textContent;
  const status = () => {
    const el = game.get("target-status");
    return el.hidden ? "" : el.textContent;
  };
  // The walk-to driver, per frame: swing when the crosshair is on a
  // zombie (then cool down while the swing recovers), otherwise
  // steer at the nearest zombie and walk; a camera that stops while
  // walking is wedged on terrain — hop and strafe off the lip. The
  // same logic the shared swingAtNearestZombie runs in blocking
  // form, sliced per frame so the wave and gap checks stay live.
  // Its pitch clamp is wider than the shared steer's: a dasher at
  // the player's feet sits ~75° below the eye line, and at the
  // shared [-0.55, 0.35] clamp the ray passes over it forever while
  // it chews — the defense bot learned the same lesson (1.35).
  let swingCooldown = 0, recovery = 0, stillFrames = 0;
  let lastX = game.camera[0], lastZ = game.camera[2];
  const fightStep = () => {
    if (recovery > 0) { recovery--; return; }
    if (swingCooldown > 0) { swingCooldown--; return; }
    if (game.get("crosshair").classList.contains("on-target")) {
      game.release("KeyW");
      game.get("game").emit("mousedown", { button: 0 });
      swingCooldown = 25;
      return;
    }
    const target = nearestZombieVertex(game);
    if (!target) { game.release("KeyW"); return; }
    if (Math.hypot(game.camera[0] - lastX, game.camera[2] - lastZ) > .05) {
      lastX = game.camera[0]; lastZ = game.camera[2]; stillFrames = 0;
    } else if (++stillFrames > 30) {
      game.release("KeyW");
      game.key("Space");
      game.key("KeyD");
      recovery = 15;
      stillFrames = 0;
      return;
    }
    const dx = target.x - game.camera[0], dz = target.z - game.camera[2];
    const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
    const dist = Math.hypot(dx, dz);
    const desiredPitch = Math.max(-1.35, Math.min(0.35, Math.atan2(target.y - game.camera[1], dist)));
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, game.direction[1])));
    const clampTurn = radians => Math.max(-65, Math.min(65, radians / .0013));
    game.document.emit("mousemove", {
      movementX: clampTurn(Math.atan2(Math.sin(turn), Math.cos(turn))),
      movementY: clampTurn(-(desiredPitch - currentPitch))
    });
    game.key("KeyW");
  };
  const releaseRecoveryKeys = () => { game.release("Space"); game.release("KeyD"); };
  // Phase 1: fight to wave 5, crafting dressings in the gaps.
  let craftedThisGap = false, wave5Live = false, maxWave = 0;
  for (let i = 0; i < 12000 && game.get("death-screen").hidden && !wave5Live; i++) {
    frame();
    if (recovery === 0) releaseRecoveryKeys();
    const live = /第 (\d+) 波 · 剩余/.exec(waveStatus());
    if (live) {
      maxWave = Math.max(maxWave, Number(live[1]));
      craftedThisGap = false;
      if (Number(live[1]) === 5) { wave5Live = true; break; }
    }
    const upcoming = /第 (\d+) 波 · \d+ 秒后/.exec(waveStatus());
    if (upcoming && !craftedThisGap && Number(upcoming[1]) > 1) {
      craftedThisGap = true;
      game.release("KeyW");
      game.key("KeyC");
      frame();
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.key("KeyC");
      game.grantPointerLock();
      frame();
    }
    fightStep();
    if (hp() <= 70) game.key("KeyH");
  }
  game.release("KeyW");
  releaseRecoveryKeys();
  assert.equal(game.get("death-screen").hidden, true, `the player must survive to wave 5 (reached wave ${maxWave})`);
  assert.ok(wave5Live, "wave 5 must go live");
  // Phase 2: clear the crowd with an exploder-blind driver, then
  // stand still and let it fuse. Batch 94 rewrote this staging
  // three times over, and the probes are the documentation:
  // (1) freeze-on-sighting died of the ring — the splitter and its
  // splitlings fill every cell around a stationary player and the
  // exploder waits outside its 2.0 trigger forever; (2) standing
  // still from the start died of the spitter wall — the exploder
  // parked at 7.65 behind the spitters' firing line and never
  // moved again, because only a moving player makes the spitters
  // reposition and opens the route; (3) thinning with the plain
  // driver died of the sword — it killed the exploder point-blank
  // while clearing (熔火核心 +1 in the message line), and no
  // status-text guard can prevent that, because the target-status
  // channel lags the real-time aim. So this driver aims and
  // swings by vertex colour instead: its steering target is the
  // nearest vertex that is not the exploder's, and it never
  // swings at all while the exploder's coat is within 3.0 — the
  // ray might be crossing it. When nothing but the exploder is
  // left, the driver stands down and the hands-off endgame plays
  // as originally staged: an empty ring, a closing exploder, a
  // lit fuse.
  const exploderPartRatios = [ENEMIES.exploder.coat, ENEMIES.exploder.skin, ENEMIES.exploder.eyes]
    .map(([r, g, b]) => [g / b, r / g]);
  const isExploderVertex = (r, g, b) => g > 0.08 && b > 0.04
    && exploderPartRatios.some(([gb, rg]) => Math.abs(g / b - gb) < 0.10 && Math.abs(r / g - rg) < 0.10);
  const exploderDistance = () => {
    const vertices = game.actorVertices;
    if (!vertices?.length) return Infinity;
    let best = Infinity;
    for (let v = 0; v < vertices.length; v += 12) {
      if (!isExploderVertex(vertices[v + 3], vertices[v + 4], vertices[v + 5])) continue;
      best = Math.min(best, Math.hypot(vertices[v] - game.camera[0], vertices[v + 2] - game.camera[2]));
    }
    return best;
  };
  const nearestNonExploderVertex = () => {
    const vertices = game.actorVertices;
    if (!vertices?.length) return null;
    let best = null, bestD = Infinity;
    for (let v = 0; v < vertices.length; v += 12) {
      if (isExploderVertex(vertices[v + 3], vertices[v + 4], vertices[v + 5])) continue;
      const dx = vertices[v] - game.camera[0], dz = vertices[v + 2] - game.camera[2];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = { x: vertices[v], y: vertices[v + 1], z: vertices[v + 2] }; }
    }
    if (!best || bestD > 30 * 30) return null;
    let ySum = 0, yCount = 0;
    for (let v = 0; v < vertices.length; v += 12) {
      if (Math.hypot(vertices[v] - best.x, vertices[v + 2] - best.z) > 1.5) continue;
      ySum += vertices[v + 1]; yCount++;
    }
    return { x: best.x, y: yCount ? ySum / yCount : best.y, z: best.z, distance: Math.sqrt(bestD) };
  };
  let p2SwingCooldown = 0, p2Recovery = 0, p2Still = 0, p2LastX = game.camera[0], p2LastZ = game.camera[2];
  const fightStepP2 = () => {
    if (p2Recovery > 0) {
      if (--p2Recovery === 0) { game.release("Space"); game.release("KeyD"); }
      return;
    }
    if (p2SwingCooldown > 0) { p2SwingCooldown--; return; }
    const target = nearestNonExploderVertex();
    if (!target) { game.release("KeyW"); return; }
    // Swing only when the aim target is nearer than the exploder:
    // the ray then meets the target's body first, so the blade
    // cannot land on the exploder behind it. A blanket no-swing
    // radius deadlocked instead (probe: the exploder parked at
    // coat distance 1.82 — centre ~2.1, a hair outside its 2.0
    // trigger — behind a melee zombie claiming the cell it
    // needed, and with every swing banned the blocker never died
    // and the fuse never lit).
    if (game.get("crosshair").classList.contains("on-target") && target.distance < exploderDistance() - 0.3) {
      game.release("KeyW");
      game.get("game").emit("mousedown", { button: 0 });
      p2SwingCooldown = 25;
      return;
    }
    if (Math.hypot(game.camera[0] - p2LastX, game.camera[2] - p2LastZ) > .05) {
      p2LastX = game.camera[0]; p2LastZ = game.camera[2]; p2Still = 0;
    } else if (++p2Still > 30) {
      game.release("KeyW");
      game.key("Space");
      game.key("KeyD");
      p2Recovery = 15;
      p2Still = 0;
      return;
    }
    // Inside the fuse zone (coat within 2.3) the player holds his
    // ground: the fuse may already be lit, and walking out of the
    // 2.5 radius before it blows pays nothing (probe: blast seen,
    // health dropped 0). The swings above still clear a blocker
    // from standstill — it is in sword reach by definition, since
    // it is close enough to hit the player.
    if (exploderDistance() < 2.3) { game.release("KeyW"); return; }
    const dx = target.x - game.camera[0], dz = target.z - game.camera[2];
    const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
    const dist = Math.hypot(dx, dz);
    const desiredPitch = Math.max(-1.35, Math.min(0.35, Math.atan2(target.y - game.camera[1], dist)));
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, game.direction[1])));
    const clampTurn = radians => Math.max(-65, Math.min(65, radians / .0013));
    game.document.emit("mousemove", {
      movementX: clampTurn(Math.atan2(Math.sin(turn), Math.cos(turn))),
      movementY: clampTurn(-(desiredPitch - currentPitch))
    });
    game.key("KeyW");
  };
  let exploderSeen = false, blastSeen = false, blastDrop = 0;
  let prevHp = hp();
  for (let i = 0; i < 4000 && game.get("death-screen").hidden && !blastSeen; i++) {
    frame();
    if (/爆裂者/.test(status())) exploderSeen = true;
    if (game.get("message").textContent.includes("爆裂者爆炸了")) {
      exploderSeen = true;
      blastSeen = true;
      blastDrop = prevHp - hp();
      break;
    }
    if (nearestNonExploderVertex()) {
      fightStepP2();
      if (hp() <= 70) game.key("KeyH");
    } else {
      game.release("KeyW");
      game.release("Space");
      game.release("KeyD");
      if (hp() <= 45) game.key("KeyH");
    }
    prevHp = hp();
  }
  game.release("KeyW");
  game.release("Space");
  game.release("KeyD");
  assert.ok(exploderSeen, "wave 5 must show an exploder (爆裂者) in the target status");
  assert.ok(blastSeen, "the exploder must detonate next to the player");
  assert.ok(blastDrop >= 18, `the blast must deal at least its registered 18 (health dropped ${blastDrop})`);
  assert.equal(game.get("death-screen").hidden, true, "the player must survive the blast");
  // A few more frames so the run's save settles, then the loot
  // record: the detonation paid no ember core.
  for (let i = 0; i < 30; i++) frame();
  const saved = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(saved.rareMaterials.emberCore, 0, "a self-detonation pays no ember core — the core is kill loot only");
});

test("a splitter's death raises the survival remaining count by exactly one", t => {
  // Batch 94, the splitter at game level: it fields in survival
  // wave 5, and when one dies — by any path — two splitlings take
  // its place on the field. The remaining count is the player's
  // own readout of that arithmetic: parent out, two in, net +1,
  // visible as the count rising by exactly one between two
  // consecutive live frames of the same wave (nothing else can
  // raise it mid-wave; spawns happen only at the wave break).
  // defense.test pins the same +1 on the roster side. The wave
  // must then still clear, splitlings and all, which proves the
  // children are ordinary killable zombies that count.
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  let time = 0;
  const game = mountGame({ storage, pointerLock: true, now: () => time });
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  frame();
  const hp = () => Number(game.get("health-value").textContent);
  const waveStatus = () => game.get("wave-status").textContent;
  // The exploder test's per-frame driver, verbatim in behaviour:
  // swing on the crosshair's word, otherwise steer at the nearest
  // zombie vertex and walk, with a hop-and-strafe unstick.
  let swingCooldown = 0, recovery = 0, stillFrames = 0;
  let lastX = game.camera[0], lastZ = game.camera[2];
  const fightStep = () => {
    if (recovery > 0) { recovery--; return; }
    if (swingCooldown > 0) { swingCooldown--; return; }
    if (game.get("crosshair").classList.contains("on-target")) {
      game.release("KeyW");
      game.get("game").emit("mousedown", { button: 0 });
      swingCooldown = 25;
      return;
    }
    const target = nearestZombieVertex(game);
    if (!target) { game.release("KeyW"); return; }
    if (Math.hypot(game.camera[0] - lastX, game.camera[2] - lastZ) > .05) {
      lastX = game.camera[0]; lastZ = game.camera[2]; stillFrames = 0;
    } else if (++stillFrames > 30) {
      game.release("KeyW");
      game.key("Space");
      game.key("KeyD");
      recovery = 15;
      stillFrames = 0;
      return;
    }
    const dx = target.x - game.camera[0], dz = target.z - game.camera[2];
    const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
    const dist = Math.hypot(dx, dz);
    const desiredPitch = Math.max(-1.35, Math.min(0.35, Math.atan2(target.y - game.camera[1], dist)));
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, game.direction[1])));
    const clampTurn = radians => Math.max(-65, Math.min(65, radians / .0013));
    game.document.emit("mousemove", {
      movementX: clampTurn(Math.atan2(Math.sin(turn), Math.cos(turn))),
      movementY: clampTurn(-(desiredPitch - currentPitch))
    });
    game.key("KeyW");
  };
  const releaseRecoveryKeys = () => { game.release("Space"); game.release("KeyD"); };
  let craftedThisGap = false, prevRem = null, splitJump = false, wave6Countdown = false;
  for (let i = 0; i < 16000 && game.get("death-screen").hidden && !wave6Countdown; i++) {
    frame();
    if (recovery === 0) releaseRecoveryKeys();
    const live = /第 (\d+) 波 · 剩余 (\d+) 只/.exec(waveStatus());
    if (live) {
      craftedThisGap = false;
      if (Number(live[1]) === 5) {
        const rem = Number(live[2]);
        if (prevRem !== null && rem === prevRem + 1) splitJump = true;
        prevRem = rem;
      } else prevRem = null;
    }
    if (/第 6 波 · \d+ 秒后/.test(waveStatus())) wave6Countdown = true;
    const upcoming = /第 (\d+) 波 · \d+ 秒后/.exec(waveStatus());
    if (upcoming && !craftedThisGap && Number(upcoming[1]) > 1) {
      craftedThisGap = true;
      game.release("KeyW");
      game.key("KeyC");
      frame();
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.key("KeyC");
      game.grantPointerLock();
      frame();
    }
    fightStep();
    if (hp() <= 70) game.key("KeyH");
  }
  game.release("KeyW");
  releaseRecoveryKeys();
  assert.equal(game.get("death-screen").hidden, true, "the player must survive to the end of wave 5");
  assert.ok(splitJump, "a splitter's death must raise the remaining count by exactly one (parent out, two splitlings in)");
  assert.ok(wave6Countdown, "wave 5 must clear, splitlings included, into the wave-6 countdown");
});

test("the wave-6 summoner's whelps appear but never count toward the remaining total", t => {
  // Batch 94, the summoner at game level: it fields in survival
  // wave 6 and summons whelps on its 6-second clock. Two player-
  // visible facts are pinned here: whelp coat vertices appear on
  // the field (a summon happened — the coat is the only safe
  // finder, since the whelp's skin and eyes ratios sit inside
  // .10 of the summoner's own), and the remaining count never
  // rises above the wave's roster size of 7 while they do
  // (whelps are pressure, not progress — killing one must never
  // move the count, and the count is sampled every live frame).
  // What this test does NOT cover, stated plainly: the wave-end
  // sweep that takes the whelps with the wave, and the lurker's
  // mound at game level. Both need a wave-6-or-later clear, which
  // this driver cannot do (it dies in wave 6 — the wave fields a
  // juggernaut, an exploder, a splitter and the caster together);
  // the sweep is six lines on the same kill path the splitter
  // test above exercises, the lurker's numbers and its
  // untargetable-while-burrowed rule are pinned in defense.test,
  // and the game-level sightings are staged to join the defense
  // end-to-end run once its wave-5 tuning is settled (batch 94
  // report). The run below ends once wave 6 has been live long
  // enough for several summons, with the player still standing.
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  let time = 0;
  const game = mountGame({ storage, pointerLock: true, now: () => time });
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  frame();
  const hp = () => Number(game.get("health-value").textContent);
  const waveStatus = () => game.get("wave-status").textContent;
  const whelpCoatRatios = [ENEMIES.whelp.coat].map(([r, g, b]) => [g / b, r / g]);
  const whelpCoats = () => {
    const vertices = game.actorVertices;
    if (!vertices?.length) return 0;
    let count = 0;
    for (let v = 0; v < vertices.length; v += 12) {
      const r = vertices[v + 3], g = vertices[v + 4], b = vertices[v + 5];
      if (g > 0.08 && b > 0.04 && whelpCoatRatios.some(([gb, rg]) => Math.abs(g / b - gb) < .10 && Math.abs(r / g - rg) < .10)) count++;
    }
    return count;
  };
  let swingCooldown = 0, recovery = 0, stillFrames = 0;
  let lastX = game.camera[0], lastZ = game.camera[2];
  const fightStep = () => {
    if (recovery > 0) { recovery--; return; }
    if (swingCooldown > 0) { swingCooldown--; return; }
    if (game.get("crosshair").classList.contains("on-target")) {
      game.release("KeyW");
      game.get("game").emit("mousedown", { button: 0 });
      swingCooldown = 25;
      return;
    }
    const target = nearestZombieVertex(game);
    if (!target) { game.release("KeyW"); return; }
    if (Math.hypot(game.camera[0] - lastX, game.camera[2] - lastZ) > .05) {
      lastX = game.camera[0]; lastZ = game.camera[2]; stillFrames = 0;
    } else if (++stillFrames > 30) {
      game.release("KeyW");
      game.key("Space");
      game.key("KeyD");
      recovery = 15;
      stillFrames = 0;
      return;
    }
    const dx = target.x - game.camera[0], dz = target.z - game.camera[2];
    const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
    const dist = Math.hypot(dx, dz);
    const desiredPitch = Math.max(-1.35, Math.min(0.35, Math.atan2(target.y - game.camera[1], dist)));
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, game.direction[1])));
    const clampTurn = radians => Math.max(-65, Math.min(65, radians / .0013));
    game.document.emit("mousemove", {
      movementX: clampTurn(Math.atan2(Math.sin(turn), Math.cos(turn))),
      movementY: clampTurn(-(desiredPitch - currentPitch))
    });
    game.key("KeyW");
  };
  const releaseRecoveryKeys = () => { game.release("Space"); game.release("KeyD"); };
  let craftedThisGap = false, whelpSeen = false, wave6RemMax = 0, wave6Frames = 0;
  for (let i = 0; i < 20000 && game.get("death-screen").hidden; i++) {
    frame();
    if (recovery === 0) releaseRecoveryKeys();
    const live = /第 (\d+) 波 · 剩余 (\d+) 只/.exec(waveStatus());
    if (live) {
      craftedThisGap = false;
      if (Number(live[1]) === 6) {
        wave6Frames++;
        wave6RemMax = Math.max(wave6RemMax, Number(live[2]));
        if (whelpCoats() > 0) whelpSeen = true;
        if (whelpSeen && wave6Frames > 900) break;
      }
    }
    const upcoming = /第 (\d+) 波 · \d+ 秒后/.exec(waveStatus());
    if (upcoming && !craftedThisGap && Number(upcoming[1]) > 1) {
      craftedThisGap = true;
      game.release("KeyW");
      game.key("KeyC");
      frame();
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.key("KeyC");
      game.grantPointerLock();
      frame();
    }
    fightStep();
    if (hp() <= 70) game.key("KeyH");
  }
  game.release("KeyW");
  releaseRecoveryKeys();
  assert.equal(game.get("death-screen").hidden, true, "the player must still be standing in wave 6");
  assert.ok(wave6Frames > 900, `wave 6 must be observed live for several summons (saw ${wave6Frames} frames)`);
  assert.ok(whelpSeen, "the wave-6 summoner must summon at least one whelp (its coat vertices appear)");
  assert.ok(wave6RemMax <= 7, `whelps must never count toward the remaining total (wave 6 peaked at ${wave6RemMax})`);
});

test("a kill's loot message names every drop, never \"undefined\"", () => {
  // The message is built from the kind's drop table (the same line that
  // now also renders a spitter's seed via FARM_MATERIALS); a string id
  // read through blockNames would print "undefined +1".
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 16;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 60; i++) frame();
  // Wait for the first survival wave and kill its first zombie with
  // the walk-to helper, then read the loot message. Hit messages do
  // not count: the loop only stops at the defeat line itself, which
  // is the one that names the drops.
  game.key("Digit6");
  frame();
  let looted = null;
  for (let attempt = 0; attempt < 30 && !looted; attempt++) {
    swingAtNearestZombie(game, frame);
    const text = game.get("message").textContent;
    // The loot line is the drop list itself; only it names the seed.
    if (text.includes("小麦种子")) looted = text;
  }
  assert.ok(looted, "a zombie was killed and its loot messaged");
  assert.ok(!looted.includes("undefined"), `loot names every drop: ${looted}`);
  assert.ok(looted.includes("石头 +1") && looted.includes("树叶 +2"), `the whole spitter table is named: ${looted}`);
});

// Farming (R6): the watering can (KeyJ), batch harvest (KeyE away
// from the beacon), and the harvest tech branch paying through both.
