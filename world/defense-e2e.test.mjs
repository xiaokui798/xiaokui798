// The defense eight-wave end-to-end run, split out of
// game.test.mjs (batch 107): it is the suite's one long,
// wave-by-wave bot drive (and its one standing red since
// batch 94/99), so module-scoped acceptance runs no longer
// pay for it — run this file alone when the work touches it.
// The test body is verbatim; the shared mountGame fixture
// lives in game-harness.mjs, imported by both files.

import test from "node:test";
import assert from "node:assert/strict";
import { mountGame } from "./game-harness.mjs";
import { BLOCK } from "./progression.mjs";
import { ENEMIES, defenseWaveRoster } from "./defense.mjs";

test("defense runs all eight waves end to end and clears wave 8", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  // A Map-backed storage: without one, every kill's loot is rolled back
  // by the failed save, so leaves never accumulate into dressings.
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  let time = 0;
  // The run is seeded, so its clock must be virtual too: with the
  // wall clock, the sound throttle (320 real-ms windows in game.js)
  // eats a varying number of LCG draws and the same seed lands on
  // different spawn rolls from run to run — a registry-only diff
  // with waves 1-3 untouched was enough to flip this bot's fate.
  const game = mountGame({ storage, pointerLock: true, now: () => time });
  const attack = () => game.get("game").emit("mousedown", { button: 0 });
  const frame = () => game.frame(time += 20);
  game.click("defense-button");
  game.grantPointerLock();
  frame();
  const hp = () => Number(game.get("health-value").textContent);
  const waveStatus = () => game.get("wave-status").textContent;
  const waveNumber = () => {
    const match = /第 (\d+) \/ 8 波/.exec(waveStatus());
    return match ? Number(match[1]) : 0;
  };
  const fighting = () => /剩余/.test(game.get("stage-time").textContent);
  // Zombie vertices are identified by colour *ratios*, not absolute
  // values: drawActors multiplies every part colour by a per-face light
  // (0.46–1.14), so a spitter coat is (0.32, 0.42, 0.22) times an
  // unknown light, but g/b ≈ 1.91 and r/g ≈ 0.76 on every face. The
  // beacon shares the actor buffer, so the plain nearest-vertex aim the
  // survival test uses would lock onto the beacon instead of a zombie
  // standing further away — the ratio filter keeps only zombie parts.
  // The ratio table is scoped to the kinds the current wave can
  // field (plus a roster kind's affiliated offspring), NOT the
  // whole registry — batch 94's lesson, learned by bisect: the
  // registry growing from five kinds to ten put new pairs all over
  // the ratio plane, and the hit flash (red channel +2*hurt, the
  // others +1.2*hurt, clamped) sweeps every part's ratios as it
  // fades, so flashed spitter skin and even the universal leg
  // colour started passing as summoner/whelp/lurker. The lock-on
  // average then included legs and flashed parts it used to
  // exclude, the aim point sank, and the bot lost fights in waves
  // whose rosters never changed. A player identifies targets
  // among the kinds that can actually be present; so does the bot.
  let zombieRatios = [];
  const refreshZombieRatios = wave => {
    const kinds = new Set(defenseWaveRoster(wave - 1));
    if (kinds.has("splitter")) kinds.add("splitling");
    if (kinds.has("summoner")) kinds.add("whelp");
    zombieRatios = [...kinds].flatMap(kind => [ENEMIES[kind].coat, ENEMIES[kind].skin, ENEMIES[kind].eyes])
      .map(([r, g, b]) => [g / b, r / g]);
  };
  refreshZombieRatios(1);
  const isZombieVertex = (r, g, b) => g > 0.08 && b > 0.04
    && zombieRatios.some(([gb, rg]) => Math.abs(g / b - gb) < 0.10 && Math.abs(r / g - rg) < 0.10);
  // The beacon's rotating crystal is the only actor part coloured
  // (0.38, 0.98, 0.92) times a pulse: r/g ≈ 0.39 and g/b ≈ 1.07 on
  // every face, which no zombie part matches. Averaging its vertices
  // gives the beacon's position, so the player can walk back to defend
  // it and repair it. The last known position is kept: a hit washes
  // the colours out for a moment (hurt adds to every channel).
  let beaconPos = null;
  const findBeaconPos = () => {
    const vertices = game.actorVertices;
    if (!vertices?.length) return beaconPos;
    let sx = 0, sz = 0, n = 0;
    for (let v = 0; v < vertices.length; v += 12) {
      const r = vertices[v + 3], g = vertices[v + 4], b = vertices[v + 5];
      if (g < 0.5 || b < 0.4) continue;
      if (Math.abs(g / b - 0.98 / 0.92) > 0.08 || Math.abs(r / g - 0.38 / 0.98) > 0.08) continue;
      sx += vertices[v]; sz += vertices[v + 2]; n++;
    }
    if (n) beaconPos = { x: sx / n, z: sz / n };
    return beaconPos;
  };
  const beaconHp = () => {
    const match = /(\d+) \/ 120/.exec(game.get("beacon-health-value").textContent);
    return match ? Number(match[1]) : 120;
  };
  const remaining = () => {
    const match = /剩余 (\d+) 只/.exec(game.get("stage-time").textContent);
    return match ? Number(match[1]) : 0;
  };
  // The breaker closest to the beacon: the one about to hit it. Breakers
  // walk straight to the beacon whatever the player does, so chasing
  // the zombie closest to the player lets them chew it undefended.
  const nearestToBeacon = () => {
    const beacon = findBeaconPos();
    const vertices = game.actorVertices;
    if (!beacon || !vertices?.length) return null;
    let best = null, bestD = Infinity;
    for (let v = 0; v < vertices.length; v += 12) {
      if (!isZombieVertex(vertices[v + 3], vertices[v + 4], vertices[v + 5])) continue;
      const d = Math.hypot(vertices[v] - beacon.x, vertices[v + 2] - beacon.z);
      if (d < bestD) { bestD = d; best = { x: vertices[v], y: vertices[v + 1], z: vertices[v + 2] }; }
    }
    return best ? { ...best, distance: Math.hypot(best.x - game.camera[0], best.z - game.camera[2]), beaconDistance: bestD } : null;
  };
  // Breakers by colour ratio: their coat (g/b 1.04, r/g 1.04), skin
  // (1.10, 1.00) and eyes (2.86, 2.23) sit apart from every other
  // kind's parts at a 0.10 tolerance (nearest neighbours: spitter
  // skin 1.71/1.07, juggernaut skin 1.17/1.24). They are the only kind that
  // walks to the beacon regardless of the player, so they are killed
  // first whenever one is near it.
  const breakerRatios = [ENEMIES.breaker.coat, ENEMIES.breaker.skin, ENEMIES.breaker.eyes]
    .map(([r, g, b]) => [g / b, r / g]);
  const isBreakerVertex = (r, g, b) => g > 0.08 && b > 0.04
    && breakerRatios.some(([gb, rg]) => Math.abs(g / b - gb) < 0.10 && Math.abs(r / g - rg) < 0.10);
  const nearestBreakerToBeacon = () => {
    const beacon = findBeaconPos();
    const vertices = game.actorVertices;
    if (!beacon || !vertices?.length) return null;
    let best = null, bestD = Infinity;
    for (let v = 0; v < vertices.length; v += 12) {
      if (!isBreakerVertex(vertices[v + 3], vertices[v + 4], vertices[v + 5])) continue;
      const d = Math.hypot(vertices[v] - beacon.x, vertices[v + 2] - beacon.z);
      if (d < bestD) { bestD = d; best = { x: vertices[v], y: vertices[v + 1], z: vertices[v + 2] }; }
    }
    return best ? { ...best, distance: Math.hypot(best.x - game.camera[0], best.z - game.camera[2]), beaconDistance: bestD } : null;
  };
  // Exploders by colour ratio, the breaker finder's pattern: coat
  // (2.00, 2.25), skin (1.73, 1.50) and eyes (3.00, 3.33) sit apart
  // from every other kind's parts at a 0.10 tolerance (nearest
  // neighbours: juggernaut eyes 3.00/2.22, dasher coat 2.18/0.63).
  // An exploder is the one kind that must be killed on sight: left
  // alone it walks up, lights its fuse and takes 18 health off the
  // player — no amount of beacon play refunds that.
  const exploderRatios = [ENEMIES.exploder.coat, ENEMIES.exploder.skin, ENEMIES.exploder.eyes]
    .map(([r, g, b]) => [g / b, r / g]);
  const isExploderVertex = (r, g, b) => g > 0.08 && b > 0.04
    && exploderRatios.some(([gb, rg]) => Math.abs(g / b - gb) < 0.10 && Math.abs(r / g - rg) < 0.10);
  const nearestExploderToPlayer = () => {
    const vertices = game.actorVertices;
    if (!vertices?.length) return null;
    let best = null, bestD = Infinity;
    for (let v = 0; v < vertices.length; v += 12) {
      if (!isExploderVertex(vertices[v + 3], vertices[v + 4], vertices[v + 5])) continue;
      const d = Math.hypot(vertices[v] - game.camera[0], vertices[v + 2] - game.camera[2]);
      if (d < bestD) { bestD = d; best = { x: vertices[v], y: vertices[v + 1], z: vertices[v + 2] }; }
    }
    return best ? { ...best, distance: bestD } : null;
  };
  // Summoners by colour ratio, the exploder finder's pattern: coat
  // (0.41, 1.89), skin (1.47, 1.24) and eyes (0.60, 1.42) sit apart
  // from every other kind's parts at a 0.10 tolerance. A summoner
  // is the one kind that must be hunted down: left alone it stands
  // off at 8–10, refills its whelps forever, and the wave cannot
  // end — it counts, and it never comes to the player.
  // Coat only, here too: the summoner's skin and eyes ratios sit
  // inside .10 of its own whelp's (skin 1.471/1.240 against
  // 1.486/1.231), so a three-part finder keeps "finding" the
  // whelp at the player's feet — the survival summoner test
  // measured its hunt steering at distance 0.2 from a minion for
  // thousands of frames. The coats are far apart (.409/1.889
  // against .625/1.333).
  const summonerRatios = [ENEMIES.summoner.coat]
    .map(([r, g, b]) => [g / b, r / g]);
  const isSummonerVertex = (r, g, b) => g > 0.08 && b > 0.04
    && summonerRatios.some(([gb, rg]) => Math.abs(g / b - gb) < 0.10 && Math.abs(r / g - rg) < 0.10);
  const nearestSummonerToPlayer = () => {
    const vertices = game.actorVertices;
    if (!vertices?.length) return null;
    let best = null, bestD = Infinity;
    for (let v = 0; v < vertices.length; v += 12) {
      if (!isSummonerVertex(vertices[v + 3], vertices[v + 4], vertices[v + 5])) continue;
      const d = Math.hypot(vertices[v] - game.camera[0], vertices[v + 2] - game.camera[2]);
      if (d < bestD) { bestD = d; best = { x: vertices[v], y: vertices[v + 1], z: vertices[v + 2] }; }
    }
    return best ? { ...best, distance: bestD } : null;
  };
  // A spitter vertex by its coat ratio (g/b 1.91, r/g 0.76), the same
  // signature spitterClusters uses. Spitters never close in on their
  // own, so they are the one kind worth walking out to meet.
  const isSpitterVertex = (r, g, b) => g > 0.15 && b > 0.08
    && Math.abs(g / b - 0.42 / 0.22) < 0.18 && Math.abs(r / g - 0.32 / 0.42) < 0.15;
  const nearest = () => {
    const vertices = game.actorVertices;
    if (!vertices?.length) return null;
    let best = null, bestD = Infinity, bestColor = null;
    for (let v = 0; v < vertices.length; v += 12) {
      if (!isZombieVertex(vertices[v + 3], vertices[v + 4], vertices[v + 5])) continue;
      const dx = vertices[v] - game.camera[0], dz = vertices[v + 2] - game.camera[2];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = { x: vertices[v], y: vertices[v + 1], z: vertices[v + 2] }; bestColor = [vertices[v + 3], vertices[v + 4], vertices[v + 5]]; }
    }
    if (!best) return null;
    const beacon = findBeaconPos();
    return { ...best, distance: Math.sqrt(bestD),
      beaconDistance: beacon ? Math.hypot(best.x - beacon.x, best.z - beacon.z) : Infinity,
      spitter: bestColor ? isSpitterVertex(...bestColor) : false };
  };
  const turnToward = ({ x, y, z }, offset = 0) => {
    const dx = x - game.camera[0], dz = z - game.camera[2];
    const turn = Math.atan2(dx, -dz) + offset - Math.atan2(game.direction[0], -game.direction[2]);
    const dist = Math.hypot(dx, dz);
    // The pitch window is wider than the survival test's: a zombie on a
    // hilltop above the player needs up to ~0.6 rad of look-up, and a
    // foot vertex needs a matching look-down. Batch 88 widened it to
    // 1.35: a dasher parked at the player's feet on a slope sits ~75°
    // below the eye line, and at the old 0.9 clamp the ray passed over
    // it forever while it chewed through the player's health — a real
    // player just looks down, so the bot's clamp was the blind spot.
    const desiredPitch = Math.max(-1.35, Math.min(1.35, Math.atan2(y - game.camera[1], dist)));
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, game.direction[1])));
    const clamp = radians => Math.max(-65, Math.min(65, radians / .0013));
    game.document.emit("mousemove", {
      movementX: clamp(Math.atan2(Math.sin(turn), Math.cos(turn))),
      movementY: clamp(-(desiredPitch - currentPitch))
    });
    return dist;
  };
  // Spitters are the only zombies whose coat is (0.32, 0.42, 0.22): the
  // green channel 0.42 and blue 0.22 pick them out of every other coat
  // and skin — as ratios, because drawActors scales every part colour
  // by a per-face light. Their torso vertices cluster within one body,
  // so distinct clusters in a frame are distinct spitters. Only the
  // first 300 fighting frames of wave 6 are sampled: before any
  // spitter can die, so a death burst cannot inflate the count, and
  // before the two have walked together.
  const spitterClusters = () => {
    const vertices = game.actorVertices;
    if (!vertices?.length) return 0;
    const clusters = [];
    for (let v = 0; v < vertices.length; v += 12) {
      const r = vertices[v + 3], g = vertices[v + 4], b = vertices[v + 5];
      if (g < 0.15 || b < 0.08) continue;
      if (Math.abs(g / b - 0.42 / 0.22) > 0.18 || Math.abs(r / g - 0.32 / 0.42) > 0.15) continue;
      const point = [vertices[v], vertices[v + 1], vertices[v + 2]];
      if (!clusters.some(c => Math.hypot(point[0] - c[0], point[1] - c[1], point[2] - c[2]) < 1.2)) clusters.push(point);
    }
    return clusters.length;
  };
  // Target lock: the nearest vertex flips between zombies' parts from
  // frame to frame, so an aim point built from it jumps around and the
  // ray never settles — one hit landed in 8s on a zombie standing 0.6
  // away. Instead, lock onto one zombie and keep aiming at it until it
  // dies or leaves; only then pick a new target. The lock anchors on
  // the vertex closest to the lock position (one zombie's part) and
  // averages only the parts within 0.6 of it, so a neighbour standing
  // next to it cannot drag the aim across — a wide average did exactly
  // that, and the player chased the drift across the map while the
  // beacon died. A centre that jumps more than 1.0 in a frame is a
  // different zombie, so the lock clears instead of following it.
  let lockPos = null;
  let summonerMemory = null;
  const lockCenter = () => {
    if (!lockPos) return null;
    const vertices = game.actorVertices;
    if (!vertices?.length) return null;
    let best = null, bestD = Infinity;
    for (let v = 0; v < vertices.length; v += 12) {
      if (!isZombieVertex(vertices[v + 3], vertices[v + 4], vertices[v + 5])) continue;
      const dx = vertices[v] - lockPos.x, dz = vertices[v + 2] - lockPos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = { x: vertices[v], y: vertices[v + 1], z: vertices[v + 2] }; }
    }
    if (!best || bestD > 1.0 * 1.0) { lockPos = null; return null; }
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let v = 0; v < vertices.length; v += 12) {
      if (!isZombieVertex(vertices[v + 3], vertices[v + 4], vertices[v + 5])) continue;
      const dx = vertices[v] - best.x, dy = vertices[v + 1] - best.y, dz = vertices[v + 2] - best.z;
      if (dx * dx + dy * dy + dz * dz > 0.6 * 0.6) continue;
      sx += vertices[v]; sy += vertices[v + 1]; sz += vertices[v + 2]; n++;
    }
    const center = n ? { x: sx / n, y: sy / n, z: sz / n } : best;
    if (Math.hypot(center.x - lockPos.x, center.z - lockPos.z) > 1.0) { lockPos = null; return null; }
    lockPos = { x: center.x, z: center.z };
    return center;
  };
  const seenWaves = new Set();
  let ratioWave = 1;
  let maxWave = 0, wave6Spitters = 0, wave6Frames = 0, wave6SpitterSeen = false;
  let noNameFrames = 0, gapHandled = false;
  // Stone budget for repairs: every kill pays 1 stone, every repair
  // spends 3, so the repairs issued so far must stay within the kills.
  // The kills are counted live, from drops in the remaining count
  // within one wave: the wave status only shows the previous runs'
  // record (savedProgress loads at run start and merges at run end),
  // so it reads zero all through a fresh run and cannot feed this.
  let repairs = 0, liveKills = 0, prevRem = 0, prevWave = 0, swingStall = 0;
  let lastMidCraft = -1000;
  let waveStartRem = 0;
  let stallRem = -1, stallFrame = 0;
  // Victory margins: the lowest beacon / player HP seen all run. A bot
  // win with the beacon at 5 hp proves far less than a win at 60 — the
  // margins are the number that says how much slack a human has.
  let minBeaconHp = 120, minPlayerHp = 100;
  const kills = () => liveKills;
  // Total healing items on hand, read off the HUD line ("<敷料> ·
  // 树皮绷带 <n> · 树叶大敷料 <n> · ..."): the mid-wave craft below
  // keys on the whole stock, not one recipe — KeyH eats whichever
  // tier is available, so "out of healing" means all three at zero.
  const healingStock = () => {
    const match = /^(\d+) · 树皮绷带 (\d+) · 树叶大敷料 (\d+)/.exec(game.get("hud-dressings").textContent);
    return match ? Number(match[1]) + Number(match[2]) + Number(match[3]) : 99;
  };
  // Stuck detection: the player walks into hill slopes and tree trunks
  // that need a jump or a sidestep to get past. Position is sampled at
  // the top of the loop; if the player meant to walk but has not moved
  // 0.3 units in 120 frames, the next 60 frames strafe sideways (the
  // side alternates each episode) instead of walking straight ahead.
  let lastX = null, lastZ = null, lastMoveFrame = 0, unstickUntil = -1, unstickCount = 0;
  for (let i = 0; i < 36000 && game.get("death-screen").hidden; i++) {
    frame();
    minBeaconHp = Math.min(minBeaconHp, beaconHp());
    minPlayerHp = Math.min(minPlayerHp, hp());
    const [px, , pz] = game.get("coordinates").textContent.match(/-?\d+\.\d+/g).map(Number);
    if (lastX === null || Math.hypot(px - lastX, pz - lastZ) > 0.3) { lastX = px; lastZ = pz; lastMoveFrame = i; }
    let walking = false;
    const hop = () => { if (i % 15 === 0) game.key("Space"); };
    const wave = waveNumber();
    if (wave) { maxWave = Math.max(maxWave, wave); seenWaves.add(wave); }
    if (wave && wave !== ratioWave) { ratioWave = wave; refreshZombieRatios(wave); }
    if (fighting()) {
      const rem = remaining();
      if (wave !== prevWave) waveStartRem = rem;
      if (wave === prevWave && rem < prevRem) { liveKills += prevRem - rem; swingStall = 0; }
      prevRem = rem; prevWave = wave;
      // Strategy stall (batch 94): track the last frame the
      // remaining count moved at all (a split moves it UP — that
      // is progress too). Six hundred frames without a change
      // means the endgame is stuck: batch 94's first case was a
      // splitter route-blocked behind a spitter's firing position
      // while the other survivor held at range — the camp-at-the-
      // beacon rule below then waits forever, because neither foe
      // qualifies as closest-worthy. A player walks over and
      // finishes it; the hunt override makes the bot do the same.
      if (rem !== stallRem) { stallRem = rem; stallFrame = i; }
    }
    if (wave === 6 && fighting() && wave6Frames < 300) {
      wave6Frames++;
      wave6Spitters = Math.max(wave6Spitters, spitterClusters());
    }
    const statusEl = game.get("target-status");
    const status = statusEl.hidden ? "" : statusEl.textContent;
    if (wave === 6 && /投掷者/.test(status)) wave6SpitterSeen = true;
    if (!fighting()) {
      // Between waves: if the beacon is hurt and the player is not
      // already next to it, walk to it first — repairing from across
      // the map just prints a message. Then repair, turn the kill loot
      // into dressings, and skip the prep countdown with B.
      const beacon = findBeaconPos();
      const [bx, , bz] = game.get("coordinates").textContent.match(/-?\d+\.\d+/g).map(Number);
      if (!gapHandled && beacon && beaconHp() < 120 && Math.hypot(bx - beacon.x, bz - beacon.z) > 3) {
        const dx = beacon.x - game.camera[0], dz = beacon.z - game.camera[2];
        const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
        game.document.emit("mousemove", { movementX: Math.max(-65, Math.min(65, Math.atan2(Math.sin(turn), Math.cos(turn)) / .0013)), movementY: 0 });
        game.key("KeyW");
        hop();
        lastMoveFrame = i;
        continue;
      }
      game.release("KeyW");
      game.release("KeyS");
      if (!gapHandled) {
        gapHandled = true;
        // Repair in the gap only when the beacon is really hurt: a
        // repair is +30 for 3 stone, and topping off a beacon at 110
        // wastes stone the later waves need. Stone is the run's whole
        // repair budget (one per kill), and waves 6–8 have two
        // breakers each.
        if (beaconHp() <= 90 && repairs * 3 + 3 <= kills()) { game.key("KeyE"); repairs++; }
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
        game.key("KeyB");
      }
      lastMoveFrame = i;
      continue;
    }
    gapHandled = false;
    // Mid-wave crafting (batch 94 tuning follow-up, HQ-approved
    // with four guardrails): a player who runs out of dressings
    // mid-wave opens the backpack and makes more when nothing is
    // in their face; the gap-only crafter instead starved in wave
    // 5's endgame — measured hp 89 to 15 in 500 frames against the
    // juggernaut and a breaker with KeyH printing "no dressings".
    // Guardrails: only at zero healing stock, only with no foe
    // within 7 (past any kind's closing distance over the crafting
    // seconds), only through the real backpack craft path (real
    // recipe, real leaf cost), and driver-only — no game code is
    // touched. The 300-frame retry gap keeps a leaf-less failure
    // from re-opening the pack every frame instead of fighting.
    if (healingStock() === 0 && i - lastMidCraft > 300) {
      const foe = nearest();
      if (!foe || foe.distance > 7) {
        lastMidCraft = i;
        game.release("KeyW");
        game.key("KeyC");
        frame();
        game.click("craft-dressing");
        game.click("craft-dressing");
        game.click("craft-dressing");
        game.key("KeyC");
        game.grantPointerLock();
        frame();
        lastMoveFrame = i;
        continue;
      }
    }
    if (i - lastMoveFrame > 120 && i >= unstickUntil) { unstickUntil = i + 60; unstickCount++; }
    if (i < unstickUntil) {
      // Sidestep around whatever the straight walk is stuck on.
      game.key("KeyW");
      game.release("KeyS");
      game.key(unstickCount % 2 === 0 ? "KeyA" : "KeyD");
      hop();
      walking = true;
      if (hp() <= 70) game.key("KeyH");
      continue;
    }
    game.release("KeyA");
    game.release("KeyD");
    game.release("KeyS");
    // Pick the foe once per frame, locking onto one zombie until it
    // dies: re-picking from the nearest vertex every frame makes the
    // aim jump between zombies' parts and the ray never settles. A
    // breaker already at the beacon outranks whatever is locked:
    // switch off anything else and go kill it, or the beacon
    // dies while the player finishes the wrong zombie.
    const breakerThreat = nearestBreakerToBeacon();
    const forcedBreaker = breakerThreat && breakerThreat.beaconDistance < 3 && !/破城者/.test(status)
      ? breakerThreat : null;
    if (forcedBreaker) lockPos = { x: forcedBreaker.x, z: forcedBreaker.z };
    // An exploder about to light its fuse outranks an ordinary
    // lock the same way — but only once it is nearly on the player
    // (3.2: inside a second of fuse range, close enough to turn and
    // land two sword hits before it blows). A wider trigger pulled
    // the bot off the beacon to chase sparking zombies across the
    // field, and the breakers ate the beacon behind its back
    // (measured: beacon dead in wave 6). A breaker merely en route
    // to the beacon (inside 8) also keeps its claim — the exploder
    // switch waits until that race is settled.
    const exploderThreat = nearestExploderToPlayer();
    const forcedExploder = !forcedBreaker && !(breakerThreat && breakerThreat.beaconDistance < 8)
      && exploderThreat && exploderThreat.distance < 3.2 && !/爆裂者/.test(status)
      ? exploderThreat : null;
    if (forcedExploder) lockPos = { x: forcedExploder.x, z: forcedExploder.z };
    // A summoner on the field outranks an ordinary lock the same
    // way, at any range the bot can see it: it retreats as the
    // player closes, but the player is four times faster, and
    // every second it lives is another whelp in the fight. Only a
    // breaker at (or already walking to) the beacon or an exploder
    // about to blow pre-empts the hunt — the first version without
    // the en-route clause let wave 5's two breakers chew the
    // beacon to 36 while the bot was across the field hunting. The
    // hunt is also gated on a close summoner: an unguarded
    // full-field chase spent 1500 frames running one down while
    // its whelps and the juggernaut ground the player from 93 to
    // 27, and a thin-field gate (remaining <= 4) dragged the bot
    // to the map corner after the retreating caster while the
    // pack kited it. The pack dies first (it comes to the player
    // anyway); a summoner that wanders close dies on the spot;
    // and a summoner left as the last counting zombie is chased
    // by the ordinary last-foe rule with nothing else competing
    // for the lock. The strategy stall is the final backstop: a
    // summoner is the one kind that can hold a wave open forever
    // (its stream replaces the bot's whelp kills one for one —
    // measured: 600+ frames at remaining 2, hp frozen, the bot on
    // a whelp treadmill at the map's edge), so a stalled count
    // forces the hunt at any range. The half-wave rule (HQ's
    // (alpha), the last driver rule of the night) widens it once
    // more: past the wave's halfway count the hunt is on at any
    // range, because the caster IS this roster's priority target
    // by design — a player kills the source mid-wave instead of
    // mowing whelps until the endgame, and the endgame-only hunt
    // measured too late twice (600 frames of stall, then ~500 of
    // clock at remaining 2 with the caster still at 4.9). The
    // memory steering below follows the same widened gate: a
    // mid-wave hunt loses its target to view culling exactly the
    // way the endgame one did. The endgame rule is the
    // sharpest of the three: at two counting zombies left, the
    // hunt starts immediately, stall or not — measured on the
    // wave-6 clock, where the stall trigger alone fired at
    // remaining 1 with ~600 frames of wave time left and the
    // timer ran out with the caster at 3.9 units and closing.
    // The other zombie walks to the player on its own; the
    // caster never does, and every second spent on its whelps
    // is a second off a 64-second wave.
    const summonerThreat = nearestSummonerToPlayer();
    if (summonerThreat) summonerMemory = { x: summonerThreat.x, z: summonerThreat.z, frame: i };
    const forcedSummoner = !forcedBreaker && !forcedExploder && !(breakerThreat && breakerThreat.beaconDistance < 8)
      && summonerThreat && (summonerThreat.distance < 7 || remaining() <= 2 || remaining() * 2 <= waveStartRem || i - stallFrame > 600) && !/召唤者/.test(status)
      ? summonerThreat : null;
    if (forcedSummoner) lockPos = { x: forcedSummoner.x, z: forcedSummoner.z };
    let foe = lockCenter();
    let foeIsBeaconPoint = false;
    if (!foe) {
      // Intercept a breaker on its way to the beacon: it is the only
      // kind that walks to the beacon, and every second it spends
      // walking is a second it is not hitting it. Two breakers arrive
      // together and the player can only kill one at a time, so
      // waiting at the beacon lets both chew it; meeting one en route
      // means it dies before it ever reaches the beacon, and the
      // other is met as it arrives. Only within 8: further than that
      // the walk out costs more than it saves.
      if (breakerThreat && breakerThreat.beaconDistance < 8) foe = breakerThreat;
      if (!foe) {
        const closest = nearest();
        if (remaining() === 1) foe = closest;
        else if (closest && (closest.spitter || closest.beaconDistance < 6 || i - stallFrame > 600)) foe = closest;
        else {
          const beacon = findBeaconPos();
          if (beacon && Math.hypot(game.camera[0] - beacon.x, game.camera[2] - beacon.z) > 4) {
            foe = { x: beacon.x, y: game.camera[1], z: beacon.z };
            foeIsBeaconPoint = true;
          } else foe = closest;
        }
      }
      if (foe && !foeIsBeaconPoint) lockPos = { x: foe.x, z: foe.z };
    }
    // Last resort in the caster endgame: the finder only sees the
    // summoner while the view faces it — turn to fight the whelp
    // at the player's feet and its coat leaves the vertex set, the
    // lock clears, and the bot goes back to waiting at the beacon
    // while the wave clock runs (measured in wave 6: the caster
    // flickering at 5-9 units for 900 frames, never engaged). At
    // two counting zombies left, steer at the last seen position
    // instead: walking toward it turns the view back onto the
    // caster, the finder re-acquires it, and the ordinary lock
    // takes over. Only when nothing else was chosen this frame —
    // a breaker at the beacon still outranks the memory.
    if ((!foe || foeIsBeaconPoint) && (remaining() <= 2 || remaining() * 2 <= waveStartRem) && summonerMemory && i - summonerMemory.frame < 900
      && Math.hypot(summonerMemory.x - game.camera[0], summonerMemory.z - game.camera[2]) > 2) {
      foe = { x: summonerMemory.x, y: game.camera[1], z: summonerMemory.z };
      foeIsBeaconPoint = false;
    }
    if (foe) {
      foe.distance = Math.hypot(foe.x - game.camera[0], foe.z - game.camera[2]);
      const beacon = findBeaconPos();
      foe.beaconDistance = beacon ? Math.hypot(foe.x - beacon.x, foe.z - beacon.z) : Infinity;
    }
    const named = /破城者|投掷者|爆裂者|分裂者|小分裂体|召唤者|幼体|潜伏者/.test(status);
    if (named) swingStall = 0;
    if (named && !forcedBreaker && !forcedExploder) {
      noNameFrames = 0;
      // Track the locked foe while fighting: the ray stays on one
      // zombie. Do NOT strafe while swinging: strafing moves the eye
      // sideways between swings and the ray (cast from the last
      // rendered view) drifts off, which capped the hit rate near
      // 1/s against a 0.38s cooldown. Standing still, every swing
      // lands; the zombies die in 1–3s, before they can land many
      // hits in return. Movement is for closing distance, not for
      // fighting.
      if (foe) turnToward(foe, 0);
      if (status.includes("超出攻击距离")) {
        // The aimed zombie is not closing in — likely stuck where its
        // route cannot reach — so walk toward it instead of waiting,
        // hopping up any slope in the way.
        game.key("KeyW");
        hop();
        walking = true;
      } else {
        // In range: stand still and swing. Walking in after every hit
        // charges the player into the pack, and the knockback only
        // pushes the zombie a short way — it stays inside sword
        // reach (2.75) for the next swing.
        game.release("KeyW");
        attack();
      }
    } else {
      // No zombie in the sights. Hunt the locked foe: melee zombies
      // come to the player, so chasing one far from the beacon walks
      // the player into the middle of the pack. With one left, chase
      // the closest zombie outright: a lone spitter on a hill never
      // closes in on its own, so waiting for it strands the player
      // under its throws. When no zombie is near the beacon, the foe
      // is the beacon point itself — walk back to it and wait. Either
      // way, hop up any slope in the way. Only when no zombie vertex
      // is found at all does the player sweep the view in a full
      // circle instead of chasing a jumping aim point.
      if (foe) {
        noNameFrames = 0;
        turnToward(foe, 0);
        if (foe.distance > 3) { game.key("KeyW"); hop(); walking = true; }
        else if (!status && ++swingStall > 60) {
          // Anti-stall (batch 88): the foe is in swing range on paper
          // but the sights stay empty — the classic case is a zombie
          // stuck below a ledge, its parts behind the terrain edge the
          // ray stops at. Standing still swings at air forever while
          // the wave cannot clear, so step in and change the geometry
          // (a player walks over and looks down the ledge). The stall
          // counter resets whenever a name shows or a kill lands.
          // Batch 94 dropped the old foe.distance > 0.4 condition:
          // a whelp at the player's feet on a slope sits at 0.27 —
          // inside the excluded band — with its body below the
          // pitch clamp's reach, and the bot swung at air for 400
          // frames while the pack ate it. Point-blank is exactly
          // where the geometry step is needed.
          game.key("KeyW"); hop(); walking = true;
          attack();
        }
        else {
          // In range: swing at any distance, even point-blank — the
          // ray test returns a hit at distance 0 when the eye is
          // inside the zombie's box. Stepping back to open range does
          // not work: the zombie follows at the same speed, the gap
          // never opens, and the player backs off for hundreds of
          // frames without ever swinging while the beacon dies.
          // Stand still while swinging, as in the named branch:
          // strafing moves the eye sideways and the ray drifts off.
          game.release("KeyA");
          game.release("KeyD");
          if (foe.distance > 1.5) { game.key("KeyW"); walking = true; }
          else game.release("KeyW");
          game.release("KeyS");
          attack();
        }
      } else if (++noNameFrames > 40) {
        game.document.emit("mousemove", { movementX: 40, movementY: 0 });
        game.release("KeyW");
      } else {
        game.release("KeyW");
      }
    }
    if (hp() <= 70) game.key("KeyH");
    // Repair only once the beacon is really hurt, and only while the
    // stone budget allows: a repair is +30 for 3 stone, and pressing
    // KeyE every frame while the beacon sits at 119 burns the whole
    // stock for nothing. R9 raised the in-fight threshold from 60 to
    // 80: at 60 the beacon was already at the floor the run is judged
    // by, and the bot's job is to keep it above that, not to rescue it
    // from it.
    if (beaconHp() <= 80 && beaconPos && Math.hypot(game.camera[0] - beaconPos.x, game.camera[2] - beaconPos.z) < 3.1
      && repairs * 3 + 3 <= kills()) { game.key("KeyE"); repairs++; }
    if (!walking) lastMoveFrame = i;
  }
  assert.equal(game.get("death-screen").hidden, false,
    `defense must end on the death screen (reached wave ${maxWave}, hp ${hp()})`);
  assert.equal(game.get("death-title").textContent, "信标守住了");
  assert.match(game.get("death-summary").textContent, /撑过全部 8 波/);
  assert.deepEqual([...seenWaves].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(maxWave, 8);
  assert.ok(wave6SpitterSeen, "wave 6 must show a spitter (投掷者) in the target status");
  assert.equal(wave6Spitters, 3, `wave 6 must spawn three spitters at once (saw at most ${wave6Spitters} clusters)`);
  // Victory margins, seeded run: the batch-90 roster (deletion
  // tables plus the batch-88 kind ramps, the fifth table trimmed to
  // three spitters) bottoms the beacon at 72/120 and the player at
  // 44/100, with 8 repairs — measured on the shipped tables. The
  // floors sit below those, so they trip only when a change really
  // eats the slack — a win at 5 hp would prove almost nothing about
  // a human's chances.
  assert.ok(minBeaconHp >= 60, `beacon must never drop below 60 (bottomed at ${minBeaconHp})`);
  assert.ok(minPlayerHp >= 40, `player must never drop below 40 (bottomed at ${minPlayerHp})`);
  // The run's whole stone income is the kills' drops added up: 44 kills
  // over waves 1–8 pay 52 stone (spitters pay 1 each, breakers 2, the
  // juggernauts 3 each), so the repairs must fit inside it — a bot
  // that repaired on credit would prove nothing about the real economy.
  const stoneFor = kind => (ENEMIES[kind].drops ?? []).filter(([id]) => id === BLOCK.STONE)
    .reduce((sum, [, amount]) => sum + amount, 0);
  const totalStone = [0, 1, 2, 3, 4, 5, 6, 7].reduce((sum, i) =>
    sum + defenseWaveRoster(i).reduce((wave, kind) => wave + stoneFor(kind), 0), 0);
  assert.equal(totalStone, 52);
  assert.ok(repairs * 3 <= totalStone, `repairs (${repairs} × 3 stone) must stay within the ${totalStone} stone the kills earned`);
});
