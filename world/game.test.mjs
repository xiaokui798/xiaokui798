import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mountGame, seedProgress, sharedStorage, v5SaveWithSeeds, v5SaveForCooking, takeHitsUntil, nearestZombieVertex, steerTowardVertex, swingAtNearestZombie } from "./game-harness.mjs";
import { BLOCK, SAVE_KEY, V4_SAVE_KEY, PROGRESS_KEY, createProgression, saveProgress } from "./progression.mjs";
import { SURVIVAL_DIFFICULTY, survivalRoster, hpMultiplier, scaledHp } from "./difficulty.mjs";
import { ENEMIES, defenseWaveRoster } from "./defense.mjs";
import { WORLD, voxelIndex } from "./terrain.mjs";

// Core game-loop integration tests: input/pointer lock, movement & camera, rendering basics, wave-status & menu records, save export/import, difficulty config. Split from the old game.test.mjs monolith (batch 108) so module work runs only its own tests.

function loseBossFight(game) {
  game.key("KeyW");
  for (let i = 1; i <= 12; i++) game.frame(i * 100);
  game.release("KeyW");
  for (let i = 13; i < 400 && game.get("death-screen").hidden; i++) game.frame(i * 100);
  assert.equal(game.get("death-screen").hidden, false);
}

test("hiding a pointer-locked tab pauses the wave and releases input", () => {
  const game = mountGame({ pointerLock: true });
  game.click("defense-button");
  game.grantPointerLock();
  assert.equal(game.get("game").classList.contains("playing"), true);
  assert.equal(game.get("crosshair").hidden, false);
  game.frame(32);
  const time = game.get("stage-time").textContent;
  game.document.hidden = true;
  game.document.emit("visibilitychange");
  game.frame(1000);
  assert.equal(game.releases, 1);
  assert.equal(game.get("pause").hidden, false);
  assert.equal(game.get("game").classList.contains("playing"), false);
  assert.equal(game.get("crosshair").hidden, true);
  assert.equal(game.get("stage-time").textContent, time);
});

test("drag look uses the aiming reticle and restores the pointer on pause and inventory", () => {
  const game = mountGame();
  const canvas = game.get("game"), crosshair = game.get("crosshair");
  assert.equal(crosshair.hidden, true);
  game.click("start-button");
  assert.equal(canvas.classList.contains("drag-look"), true);
  assert.equal(canvas.classList.contains("playing"), true);
  assert.equal(crosshair.hidden, false);
  game.key("KeyC");
  assert.equal(canvas.classList.contains("playing"), false);
  assert.equal(crosshair.hidden, true);
  game.key("KeyC");
  assert.equal(canvas.classList.contains("playing"), true);
  assert.equal(crosshair.hidden, false);
  game.key("Escape");
  assert.equal(canvas.classList.contains("playing"), false);
  assert.equal(crosshair.hidden, true);
});

test("a late pointer lock cannot reopen a game after Escape", () => {
  const game = mountGame({ pointerLock: true });
  game.click("start-button");
  game.key("Escape");
  game.grantPointerLock();
  assert.equal(game.releases, 1);
  assert.equal(game.get("pause").hidden, false);
});

test("inventory shortcuts distinguish playing from the pause menu", () => {
  const game = mountGame();
  game.click("start-button");
  game.key("KeyC");
  assert.equal(game.get("inventory-screen").hidden, false);
  game.key("KeyC");
  assert.equal(game.get("inventory-screen").hidden, true);
  assert.equal(game.get("pause").hidden, true);
  // Esc behaves like C when the bag was opened from play: straight back
  // to the game, not to the pause menu.
  game.key("KeyC");
  assert.equal(game.get("inventory-screen").hidden, false);
  game.key("Escape");
  assert.equal(game.get("inventory-screen").hidden, true);
  assert.equal(game.get("pause").hidden, true);
  game.key("Escape");
  game.click("pause-inventory-button");
  game.key("KeyC");
  assert.equal(game.get("inventory-screen").hidden, true);
  assert.equal(game.get("pause").hidden, false);
});

test("the game keeps moving right on takeoff after the D key is released", () => {
  const game = mountGame();
  let time = 0;
  function advance(steps) {
    for (let i = 0; i < steps; i++) game.frame(time += 1000 / 120);
    return game.get("coordinates").textContent.match(/-?\d+\.\d+/g).map(Number);
  }
  game.click("build-button");
  const [startX, startY] = advance(12);
  game.key("KeyD");
  advance(13);
  game.key("Space");
  const [jumpX, jumpY, jumpZ] = advance(4);
  game.release("KeyD");
  game.release("Space");
  const [coastX, coastY, coastZ] = advance(15);
  assert.ok(jumpX > startX && jumpY > startY);
  assert.ok(coastX > jumpX && coastY > jumpY && coastZ < jumpZ);
});

test("short stalls still simulate the same distance as faster frames", () => {
  function positionAt(fps) {
    const game = mountGame();
    game.click("build-button");
    for (let i = 0; i <= 12; i++) game.frame(i * 1000 / 60);
    game.key("KeyD");
    for (let i = 1; i <= fps / 3; i++) game.frame(200 + i * 1000 / fps);
    return game.camera;
  }
  const normal = positionAt(60);
  const slow = positionAt(15);
  assert.ok(Math.hypot(normal[0] - slow[0], normal[2] - slow[2]) < .001);
});

test("the camera keeps moving evenly between physics ticks on a 240Hz display", () => {
  const game = mountGame();
  game.click("build-button");
  for (let i = 0; i <= 12; i++) game.frame(i * 1000 / 60);
  game.key("KeyD");
  for (let i = 1; i <= 48; i++) game.frame(200 + i * 1000 / 240);
  let [x, , z] = game.camera;
  for (let i = 49; i <= 60; i++) {
    game.frame(200 + i * 1000 / 240);
    const [nextX, , nextZ] = game.camera;
    assert.ok(Math.abs(Math.hypot(nextX - x, nextZ - z) - 4.15 / 240) < .001);
    x = nextX;
    z = nextZ;
  }
});

test("a frozen scene redraws only when needed and the first resume frame does not catch up idle time", () => {
  const game = mountGame();
  game.click("build-button");
  for (let i = 0; i <= 24; i++) game.frame(i * 16);
  game.key("Escape");
  game.frame(400);
  const frozenDraws = game.draws;
  const frozenCamera = game.camera;
  game.frame(416);
  game.frame(432);
  assert.equal(game.draws, frozenDraws);
  game.window.innerWidth += 50;
  game.frame(448);
  game.frame(464);
  assert.equal(game.draws, frozenDraws + 1);
  game.click("resume-button");
  game.key("KeyD");
  game.frame(3000);
  assert.deepEqual(game.camera, frozenCamera);
  game.frame(3016);
  game.frame(3032);
  assert.ok(game.camera[0] > frozenCamera[0]);
});

test("real gameplay input turns a mouse strafe into a faster jump", () => {
  function fly(strafe) {
    const game = mountGame({ pointerLock: true });
    let time = 0;
    const advance = () => game.frame(time += 10);
    game.click("build-button");
    game.grantPointerLock();
    for (let i = 0; i < 10; i++) advance();
    game.key("KeyW");
    for (let i = 0; i < 12; i++) advance();
    game.key("Space");
    game.release("KeyW");
    if (strafe) game.key("KeyD");
    function turn() {
      game.document.emit("mousemove", { movementX: 14, movementY: 0 });
      advance();
    }
    for (let i = 0; i < 32; i++) turn();
    const [x, , z] = game.camera;
    for (let i = 0; i < 10; i++) turn();
    const [endX, endY, endZ] = game.camera;
    assert.ok(endY > 6, "the sample ends while airborne");
    const [takeoff, peak] = game.get("speed-jump").textContent.split(" → ").map(Number);
    assert.ok(strafe ? peak > takeoff + .6 : peak === takeoff);
    return Math.hypot(endX - x, endZ - z) / .1;
  }
  assert.ok(fly(true) > fly(false) + .6);
});

test("the visible speed and landing sample advance only during play", () => {
  const game = mountGame();
  let time = 0;
  function advance(count) { for (let i = 0; i < count; i++) game.frame(time += 10); }
  const speed = () => Number(game.get("speed-current").textContent);
  const landing = () => game.get("speed-landing").textContent;
  game.click("build-button");
  advance(10);
  game.key("KeyD");
  advance(12);
  assert.equal(speed(), 4.15);
  game.key("Space");
  game.release("KeyD");
  for (let i = 0; i < 100 && landing() === "待落地"; i++) advance(1);
  assert.equal(landing(), "4.15 → …");
  game.key("Escape");
  advance(24);
  assert.equal(landing(), "4.15 → …");
  game.click("resume-button");
  advance(22);
  assert.equal(landing(), "4.15 → 0.00");
});

test("a save from another tab pauses the older run and can be reloaded", () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage });
  game.click("start-button");
  game.key("KeyC");
  const newer = createProgression(storage);
  newer.editBlock(voxelIndex(WORLD, 17, 4, 16), BLOCK.AIR, BLOCK.DIRT, true);
  game.window.emit("storage", { storageArea: storage, key: SAVE_KEY, newValue: storage.getItem(SAVE_KEY) });
  assert.equal(game.get("inventory-screen").hidden, true);
  assert.equal(game.get("pause").hidden, false);
  assert.equal(game.get("resume-button").disabled, true);
  assert.equal(game.get("reload-save-button").hidden, false);
  game.click("reload-save-button");
  assert.equal(game.get("start-screen").hidden, false);
  game.click("start-button");
  assert.equal(game.get("pause").hidden, true);
  assert.equal(game.get("resume-button").disabled, false);
  assert.equal(createProgression(storage).count(BLOCK.DIRT), 9);
});

test("losing and restoring WebGL rebuilds the renderer without restarting the run", () => {
  const game = mountGame();
  game.click("defense-button");
  game.frame(16);
  const time = game.get("stage-time").textContent;
  let prevented = false;
  game.get("game").emit("webglcontextlost", { preventDefault() { prevented = true; } });
  assert.ok(prevented, "the browser is allowed to restore the context");
  assert.equal(game.get("graphics-warning").hidden, false);
  assert.equal(game.get("resume-button").disabled, true);
  game.frame(5000);
  game.get("game").emit("webglcontextrestored");
  assert.equal(game.rendererBuilds, 2);
  assert.equal(game.get("graphics-warning").hidden, true);
  assert.equal(game.get("resume-button").disabled, false);
  game.click("resume-button");
  assert.equal(game.get("pause").hidden, true);
  assert.equal(game.get("stage-time").textContent, time);
});

test("the sky is a dome around the camera, not a flat clear colour", () => {
  const game = mountGame();
  game.click("start-button");
  game.frame(16);
  const vertices = game.actorVertices;
  assert.ok(vertices?.length, "the sky dome uploads vertices");
  let dome = 0;
  for (let offset = 0; offset < vertices.length; offset += 12) {
    if (vertices[offset + 9] !== -12) continue;
    dome++;
    // Every dome corner sits 70 blocks from the eye along one axis.
    const dx = vertices[offset] - game.camera[0];
    const dy = vertices[offset + 1] - game.camera[1];
    const dz = vertices[offset + 2] - game.camera[2];
    assert.ok(Math.abs(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) - 70) < 0.01,
      `dome corner ${dx},${dy},${dz} from the eye`);
  }
  assert.equal(dome, 24, "a six-face cube has 24 dome vertices");
});

test("rain falls as world-space streaks around the player", () => {
  const game = mountGame();
  game.click("start-button");
  game.key("KeyT");
  game.key("KeyT"); // 晴朗 -> 薄雾 -> 降雨
  let time = 16;
  for (let i = 0; i < 120; i++) game.frame(time += 20);
  const vertices = game.rainVertices;
  assert.ok(vertices?.length, "rain uploads vertices");
  let drops = 0;
  for (let offset = 0; offset < vertices.length; offset += 12) {
    if (vertices[offset + 9] !== -13) continue;
    drops++;
    // Streaks stay in a field around the player, never across the map.
    assert.ok(Math.abs(vertices[offset] - game.camera[0]) <= 7.5, "drop x near player");
    assert.ok(Math.abs(vertices[offset + 2] - game.camera[2]) <= 7.5, "drop z near player");
  }
  assert.ok(drops > 100, `rain streak vertices: ${drops}`);
});

test("aiming at the ground sets the target-block outline uniform", () => {
  const game = mountGame({ pointerLock: true });
  game.click("start-button");
  game.grantPointerLock();
  let time = 16;
  const frame = () => game.frame(time += 20);
  frame();
  // Look down at the ground in front of the spawn point.
  for (let i = 0; i < 6; i++) game.document.emit("mousemove", { movementX: 0, movementY: 65 });
  for (let i = 0; i < 10; i++) frame();
  const target = game.target;
  assert.ok(target, "the outline uniform points at a block while aiming at the ground");
  assert.equal(target.length, 3);
  for (const value of target) assert.ok(Number.isInteger(value), `target cell ${target} is integral`);
  assert.ok(target[0] >= -16 && target[0] < 48 && target[1] >= 0 && target[1] < 24
    && target[2] >= -16 && target[2] < 48, `target cell ${target} is inside the world`);
});

test("landing after a jump kicks up 3D dust at the player's feet", () => {
  const game = mountGame();
  game.click("start-button");
  let time = 16;
  const frame = () => game.frame(time += 20);
  frame();
  game.key("Space");
  // Particle cubes sample the middle of the stone atlas tile (u = 7/12),
  // which nothing else in the scene uses; the sky dome uploads every frame,
  // so scan after each frame while the dust is alive.
  const isDust = vertices => {
    for (let offset = 0; offset < vertices.length; offset += 12) {
      if (vertices[offset + 9] === 0 && Math.abs(vertices[offset + 10] - 7 / 12) < 0.002
        && vertices[offset + 11] === 0.5) return true;
    }
    return false;
  };
  let sawDust = false;
  for (let i = 0; i < 120 && !sawDust; i++) {
    frame();
    if (game.actorVertices && isDust(game.actorVertices)) sawDust = true;
  }
  assert.ok(sawDust, "dust cubes appear around the landing");
});

test("a placed block pops from 0.9 to full size and the overlay is gone after 0.12s", () => {
  const game = mountGame({ pointerLock: true });
  // Creative mode: no survival material check, so placing always succeeds.
  game.click("build-button");
  game.grantPointerLock();
  let time = 16;
  const frame = () => game.frame(time += 20);
  frame();
  // Look down at the ground in front of the spawn point, like the
  // target-outline test, then place with a right-click.
  for (let i = 0; i < 6; i++) game.document.emit("mousemove", { movementX: 0, movementY: 65 });
  for (let i = 0; i < 10; i++) frame();
  assert.ok(game.target, "aiming at the ground first");
  game.get("game").emit("mousedown", { button: 2 });
  frame();
  // The pop overlay is the last non-viewmodel upload this frame, so
  // actorVertices holds its 24 vertices: one box inside a single cell.
  const vertices = game.actorVertices;
  assert.ok(vertices && vertices.length >= 24, "the pop overlay is uploaded right after placing");
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let offset = 0; offset < vertices.length; offset += 12) {
    minX = Math.min(minX, vertices[offset]);
    minY = Math.min(minY, vertices[offset + 1]);
    minZ = Math.min(minZ, vertices[offset + 2]);
    maxX = Math.max(maxX, vertices[offset]);
    maxY = Math.max(maxY, vertices[offset + 1]);
    maxZ = Math.max(maxZ, vertices[offset + 2]);
  }
  const spanX = maxX - minX;
  assert.ok(spanX > 0.85 && spanX < 0.97, `fresh pop spans ${spanX.toFixed(3)} (0.9 scale)`);
  assert.equal(Math.floor(minX), Math.floor(maxX), "the pop fits inside one cell on x");
  assert.equal(Math.floor(minY), Math.floor(maxY), "the pop fits inside one cell on y");
  assert.equal(Math.floor(minZ), Math.floor(maxZ), "the pop fits inside one cell on z");
  const cell = [Math.floor(minX), Math.floor(minY), Math.floor(minZ)];
  assert.ok(Math.abs(cell[0] - game.target[0]) <= 1 && Math.abs(cell[1] - game.target[1]) <= 1
    && Math.abs(cell[2] - game.target[2]) <= 1, `pop cell ${cell} is next to the aimed block ${game.target}`);
  // After 0.12s the overlay is gone: no uploaded vertices remain near the cell.
  for (let i = 0; i < 8; i++) frame();
  let near = false;
  for (let offset = 0; offset < game.actorVertices.length; offset += 12) {
    if (game.actorVertices[offset] > cell[0] - 0.1 && game.actorVertices[offset] < cell[0] + 1.1
      && game.actorVertices[offset + 1] > cell[1] - 0.1 && game.actorVertices[offset + 1] < cell[1] + 1.1
      && game.actorVertices[offset + 2] > cell[2] - 0.1 && game.actorVertices[offset + 2] < cell[2] + 1.1) near = true;
  }
  assert.equal(near, false, "the pop overlay is removed once the animation ends");
});

test("game time drives the sun, daylight and fog uniforms", () => {
  const game = mountGame({ pointerLock: true });
  game.click("build-button");
  game.grantPointerLock();
  let time = 16;
  // 100ms steps are clamped to 0.1s of game time each, so 300 frames is
  // 30s: the game starts mid-morning and reaches noon in that window.
  const frame = () => game.frame(time += 100);
  frame();
  const firstSun = game.sun;
  const firstFog = game.fogDensity;
  assert.ok(firstSun, "the sun direction uniform is set");
  assert.ok(Math.abs(Math.hypot(...firstSun) - 1) < 0.001, "the sun direction is a unit vector");
  assert.ok(firstFog > 0.02 && firstFog < 0.05, `day fog density starts near ${firstFog}`);
  assert.ok(game.dayFactor > 0.9, "the game starts in daylight");
  for (let i = 0; i < 300; i++) frame();
  const laterSun = game.sun;
  assert.ok(laterSun[1] > firstSun[1], "the sun climbs toward noon as time passes");
  const angle = Math.acos(Math.max(-1, Math.min(1,
    firstSun[0] * laterSun[0] + firstSun[1] * laterSun[1] + firstSun[2] * laterSun[2])));
  assert.ok(angle > 0.5, `the sun moved ${angle.toFixed(2)} rad in 30s of game time`);
  assert.ok(game.dayFactor > 0.9, "it is still full daylight at noon");
  // The day-cycle fog is already at its thin daytime value by mid-morning,
  // so it does not thin further toward noon; it stays in the day band even
  // as the weather cycles (clear -> mist thickens it somewhat).
  assert.ok(game.fogDensity > 0.02 && game.fogDensity < 0.1,
    `fog density stays in the day band at ${game.fogDensity}`);
});

test("starting survival shows the saved progress record in the wave status", () => {
  const storage = sharedStorage();
  seedProgress(storage, { wave: 3, kills: 42 });
  const game = mountGame({ storage, pointerLock: true });
  game.click("start-button");
  game.grantPointerLock();
  game.frame(0);
  assert.match(game.get("wave-status").textContent, /第 1 波 · \d+ 秒后 · 最佳第 3 波 · 累计击退 42 只/);
});

test("the in-game wave status shows boss kill counts in survival", () => {
  const storage = sharedStorage();
  seedProgress(storage, { wave: 3, kills: 42, bossKills: { boss: 2, colossus: 1 } });
  const game = mountGame({ storage, pointerLock: true });
  game.click("start-button");
  game.grantPointerLock();
  game.frame(0);
  const status = game.get("wave-status").textContent;
  assert.match(status, /最佳第 3 波 · 累计击退 42 只/);
  assert.match(status, /熔炉守卫 2 次/);
  assert.match(status, /断星巨像 1 次/);
});

test("the in-game wave status shows boss kill counts in defense", () => {
  const storage = sharedStorage();
  seedProgress(storage, { wave: 0, kills: 7, bossKills: { boss: 1 }, defense: { wave: 2, cleared: false, bestWave: 2 } });
  const game = mountGame({ storage, pointerLock: true });
  game.click("defense-button");
  game.grantPointerLock();
  game.frame(0);
  const status = game.get("wave-status").textContent;
  assert.match(status, /第 1 \/ 8 波/);
  assert.match(status, /最佳第 2 波 · 累计击退 7 只/);
  assert.match(status, /熔炉守卫 1 次/);
  assert.doesNotMatch(status, /断星巨像/);
});

test("the in-game wave status shows a boss kill even with no wave yet", () => {
  const storage = sharedStorage();
  seedProgress(storage, { wave: 0, kills: 0, bossKills: { boss: 1 } });
  const game = mountGame({ storage, pointerLock: true });
  game.click("start-button");
  game.grantPointerLock();
  game.frame(0);
  const status = game.get("wave-status").textContent;
  assert.match(status, /熔炉守卫 1 次/);
  assert.doesNotMatch(status, /最佳第/);
});

test("starting defense shows the best defense wave from saved progress", () => {
  const storage = sharedStorage();
  seedProgress(storage, { wave: 0, kills: 7, defense: { wave: 2, cleared: false, bestWave: 2 } });
  const game = mountGame({ storage, pointerLock: true });
  game.click("defense-button");
  game.grantPointerLock();
  game.frame(0);
  assert.match(game.get("wave-status").textContent, /第 1 \/ \d+ 波 · .* · 最佳第 2 波 · 累计击退 7 只/);
});

test("defense runs eight waves, not five", () => {
  const game = mountGame({ storage: sharedStorage(), pointerLock: true });
  game.click("defense-button");
  game.grantPointerLock();
  game.frame(0);
  assert.match(game.get("wave-status").textContent, /第 1 \/ 8 波/);
});

test("the main menu shows boss kill counts and the best wave", () => {
  const storage = sharedStorage();
  seedProgress(storage, { wave: 5, kills: 42, bossKills: { boss: 2, colossus: 1 } });
  const game = mountGame({ storage });
  const status = game.get("menu-status");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /最佳第 5 波/);
  assert.match(status.textContent, /累计击退 42 只/);
  assert.match(status.textContent, /熔炉守卫 2 次/);
  assert.match(status.textContent, /断星巨像 1 次/);
});

test("the main menu record omits bosses with no kills", () => {
  const storage = sharedStorage();
  seedProgress(storage, { wave: 3, kills: 42 });
  const game = mountGame({ storage });
  const status = game.get("menu-status");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /最佳第 3 波 · 累计击退 42 只/);
  assert.doesNotMatch(status.textContent, /熔炉守卫|断星巨像/);
});

test("the main menu record stays hidden with no progress yet", () => {
  const game = mountGame({ storage: sharedStorage() });
  const status = game.get("menu-status");
  assert.equal(status.hidden, true);
  assert.equal(status.textContent, "");
});

test("the main menu record shows a boss kill even with no wave yet", () => {
  const storage = sharedStorage();
  seedProgress(storage, { wave: 0, kills: 0, bossKills: { boss: 1 } });
  const game = mountGame({ storage });
  const status = game.get("menu-status");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /熔炉守卫 1 次/);
  assert.doesNotMatch(status.textContent, /最佳第/);
});

test("dying to the boss writes the merged progress without touching the boss record", () => {
  const storage = sharedStorage();
  seedProgress(storage, { wave: 3, kills: 42 });
  const game = mountGame({ storage, pointerLock: true });
  game.click("boss-button");
  game.grantPointerLock();
  game.frame(0);
  loseBossFight(game);
  assert.equal(game.get("death-title").textContent, "挑战失败");
  assert.deepEqual(JSON.parse(storage.getItem(PROGRESS_KEY)),
    { version: 2, wave: 3, kills: 42, bossesDefeated: {}, bossKills: {}, bestWave: 3, defense: { wave: 0, cleared: false, bestWave: 0 } });
});

test("falling to the tuned guardian records no boss defeat in saved progress", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const storage = sharedStorage();
  seedProgress(storage, { wave: 2, kills: 10 });
  const game = mountGame({ storage, pointerLock: true });
  const attack = () => game.get("game").emit("mousedown", { button: 0 });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("boss-button");
  game.grantPointerLock();
  frame();
  game.key("KeyW");
  game.key("Digit7");
  for (let i = 0; i < 58; i++) frame();
  game.release("KeyW");
  let jumpPrimed = false;
  const jumpQueue = [];
  let prevHpBot = 100, fireStep = 0;
  let ramParity = 0, wasRamWindup = false;
  let deepestBar = 1, halfHealSeen = false;
  for (let i = 0; i < 12000 && game.get("death-screen").hidden; i++) {
    frame();
    const barNow = game.get("boss-name").textContent.includes("过载") ? 3
      : game.get("boss-name").textContent.includes("烈火") ? 2 : 1;
    if (barNow > deepestBar) deepestBar = barNow;
    if (game.get("message").textContent.includes("第三管过半")) halfHealSeen = true;
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
      // Orbit while swinging: in this fight the minions camp
      // on the guardian and a standing robot eats every swing.
      game.key("KeyD");
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
  // Batch 69 re-scope: at the tuned bars (520/420/500) this
  // conservative challenger no longer wins — Kui judges the
  // tuning by playing it himself, and this test now guards
  // the loss path plus how deep the fight still runs: both
  // bars break (both break heals land), the third bar's half
  // heal fires, and the challenger takes over half of the
  // last bar before falling (it ends at 115 / 500).
  assert.equal(game.get("death-title").textContent, "挑战失败");
  assert.equal(deepestBar, 3, "the challenger still breaks both bars");
  assert.ok(halfHealSeen, "the bar-3 half heal fired during the run");
  const finalBossHp = Number(game.get("boss-health-value").textContent.split(" / ")[0]);
  assert.ok(finalBossHp <= 250, `the challenger took over half of the last bar: ${finalBossHp}`);
  // A loss records no defeat and no kill for the boss, while
  // the seeded progress around it is preserved.
  const progress = JSON.parse(storage.getItem(PROGRESS_KEY));
  assert.equal(progress.wave, 2);
  assert.ok(!progress.bossesDefeated.boss, "a loss must not record the boss as defeated");
  assert.ok(!progress.bossKills.boss, "a loss must not record a boss kill");
  game.click("death-menu-button");
  const menuStatus = game.get("menu-status");
  assert.equal(menuStatus.hidden, false);
  assert.ok(!/熔炉守卫 [1-9]/.test(menuStatus.textContent), "the menu shows no guardian kill after a loss");
  assert.ok(progress.kills >= 10, `kills preserved from the fight: ${progress.kills}`);
});

test("a stale progress save at death offers adopting the other tab's progress", () => {
  const data = new Map();
  const storage = sharedStorage(data), other = sharedStorage(data);
  seedProgress(storage, { wave: 3, kills: 42 });
  const game = mountGame({ storage, pointerLock: true });
  game.click("boss-button");
  game.grantPointerLock();
  game.frame(0);
  assert.deepEqual(saveProgress(other, { wave: 5, kills: 100 }), { saved: true });
  loseBossFight(game);
  assert.equal(game.get("death-title").textContent, "进度有更新");
  assert.equal(game.get("respawn-button").textContent, "保留本局进度");
  assert.equal(game.get("death-menu-button").textContent, "采用最新进度");
  assert.match(game.get("death-summary").textContent, /另一标签页已更新了进度/);
  game.click("death-menu-button");
  assert.equal(game.get("death-title").textContent, "挑战失败");
  assert.equal(game.get("death-menu-button").textContent, "返回主菜单");
  assert.deepEqual(JSON.parse(storage.getItem(PROGRESS_KEY)),
    { version: 2, wave: 5, kills: 100, bossesDefeated: {}, bossKills: {}, bestWave: 5, defense: { wave: 0, cleared: false, bestWave: 0 } });
});

test("a stale progress save at death offers keeping this run's progress instead", () => {
  const data = new Map();
  const storage = sharedStorage(data), other = sharedStorage(data);
  seedProgress(storage, { wave: 3, kills: 42 });
  const game = mountGame({ storage, pointerLock: true });
  game.click("boss-button");
  game.grantPointerLock();
  game.frame(0);
  assert.deepEqual(saveProgress(other, { wave: 5, kills: 100 }), { saved: true });
  loseBossFight(game);
  assert.equal(game.get("death-title").textContent, "进度有更新");
  game.click("respawn-button");
  assert.equal(game.get("death-title").textContent, "挑战失败");
  assert.equal(game.get("respawn-button").textContent, "再挑战");
  // The forced save overwrote the other tab's newer progress.
  assert.deepEqual(JSON.parse(storage.getItem(PROGRESS_KEY)),
    { version: 2, wave: 3, kills: 42, bossesDefeated: {}, bossKills: {}, bestWave: 3, defense: { wave: 0, cleared: false, bestWave: 0 } });
  game.click("respawn-button");
  game.grantPointerLock();
  game.frame(0);
  assert.equal(game.get("death-screen").hidden, true);
  assert.equal(game.get("boss-health-value").textContent, "520 / 520");
});

test("the block atlas paints all nine tiles", () => {
  const game = mountGame();
  game.click("defense-button");
  game.frame(16);
  assert.ok(game.rendererBuilds >= 1, "the renderer was built");
  assert.deepEqual(game.atlasTiles, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("survival difficulty comes from the config table, unchanged", () => {
  // The table itself, verbatim: +5% HP per wave past the first, at
  // most 7 zombies a wave, and — since the batch-88 deletion — the
  // spitter as the fill kind (the deleted walker's seat), the
  // batch-88 mechanism kinds on their original mix-in slots, and
  // breakers from wave 7. The deleted runner's rule is gone — its
  // slots fall through to the fill. Batch 94 adds its three kinds:
  // the splitter on slot 3 from wave 5, the summoner on slot 5 from
  // wave 6, and the lurker — listed first so its slot-6 claim beats
  // the dasher's period-6 repeat — on slot 6 from wave 7.
  assert.deepEqual(SURVIVAL_DIFFICULTY, {
    hpPerWave: 0.05,
    maxZombies: 7,
    mixIns: [
      { kind: "lurker", fromWave: 7, period: 8, offset: 6 },
      { kind: "dasher", fromWave: 4, period: 6, offset: 0 },
      { kind: "exploder", fromWave: 5, period: 6, offset: 1 },
      { kind: "juggernaut", fromWave: 6, period: 7, offset: 2 },
      { kind: "splitter", fromWave: 5, period: 7, offset: 3 },
      { kind: "summoner", fromWave: 6, period: 8, offset: 5 },
      { kind: "breaker", fromWave: 7, period: 5, offset: 4 }
    ]
  });
  assert.ok(Object.isFrozen(SURVIVAL_DIFFICULTY));
  assert.ok(Object.isFrozen(SURVIVAL_DIFFICULTY.mixIns));
  for (const rule of SURVIVAL_DIFFICULTY.mixIns) assert.ok(Object.isFrozen(rule));
  // Rosters per wave, exactly as the old inline formula produced them.
  assert.deepEqual(survivalRoster(1), ["spitter", "spitter"]);
  assert.deepEqual(survivalRoster(2), ["spitter", "spitter", "spitter"]);
  assert.deepEqual(survivalRoster(4), ["dasher", "spitter", "spitter", "spitter", "spitter"]);
  assert.deepEqual(survivalRoster(5), ["dasher", "exploder", "spitter", "splitter", "spitter", "spitter"]);
  assert.deepEqual(survivalRoster(6), ["dasher", "exploder", "juggernaut", "splitter", "spitter", "summoner", "dasher"]);
  assert.deepEqual(survivalRoster(7), ["dasher", "exploder", "juggernaut", "splitter", "breaker", "summoner", "lurker"]);
  assert.deepEqual(survivalRoster(10), ["dasher", "exploder", "juggernaut", "splitter", "breaker", "summoner", "lurker"]);
  assert.equal(survivalRoster(20).length, 7, "the wave-size cap holds past wave 6");
  // Each kind first appears in the same wave as before.
  const firstSeen = kind => {
    for (let wave = 1; wave <= 10; wave++) if (survivalRoster(wave).includes(kind)) return wave;
    return null;
  };
  assert.equal(firstSeen("spitter"), 1);
  assert.equal(firstSeen("dasher"), 4);
  assert.equal(firstSeen("exploder"), 5);
  assert.equal(firstSeen("juggernaut"), 6);
  assert.equal(firstSeen("breaker"), 7);
  assert.equal(firstSeen("splitter"), 5);
  assert.equal(firstSeen("summoner"), 6);
  assert.equal(firstSeen("lurker"), 7);
  // The affiliated kinds never appear in a roster at all: they only
  // exist as a summoner's summons or a splitter's split.
  assert.equal(firstSeen("whelp"), null);
  assert.equal(firstSeen("splitling"), null);

  // HP curve: 1 at wave 1, then +5% per wave past it.
  assert.equal(hpMultiplier(1), 1);
  assert.equal(hpMultiplier(2), 1.05);
  assert.equal(hpMultiplier(5), 1.2);
  assert.equal(hpMultiplier(7), 1.3);
  assert.equal(hpMultiplier(0), 1);
  // Scaled HP, rounded the way addEnemies() always has, on the
  // surviving kinds' base numbers.
  assert.equal(scaledHp(35, 1), 35);
  assert.equal(scaledHp(35, 2), 37);
  assert.equal(scaledHp(35, 5), 42);
  assert.equal(scaledHp(30, 5), 36);
  assert.equal(scaledHp(55, 6), 69);
  assert.equal(scaledHp(155, 7), 202);
  assert.equal(scaledHp(35), 35);
});

test("the pause menu exports the save and imports a file back", async () => {
  // A preloaded v4 save: enough wood and leaves to craft a dressing.
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 0, 0, 0, 4, 8],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 1, bigDressing: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  // Craft a dressing first, so the export reflects a live change.
  game.key("KeyC");
  frame();
  game.click("craft-dressing");
  assert.equal(game.get("inventory-dressings").textContent,
    "树叶敷料 2 件 · 树皮绷带 1 件 · 树叶大敷料 1 件 · 烤麦饼 0 件 · 果蔬沙拉 0 件 · 炖菜 0 件 · 当前生命 100/100");
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  // Pause: the export/import row is in the pause menu.
  game.key("Escape");
  frame();
  assert.equal(game.get("pause").hidden, false);
  // Export: the link carries the save as a data URL, identical to the
  // save on disk after the craft.
  game.click("export-save-button");
  const href = game.get("export-save-link").href;
  assert.equal(game.get("export-save-link").download, "block-world-save.json");
  assert.match(href, /^data:application\/json;charset=utf-8,/);
  assert.deepEqual(JSON.parse(decodeURIComponent(href.split(",", 2)[1])), JSON.parse(data.get(SAVE_KEY)));
  assert.equal(JSON.parse(data.get(SAVE_KEY)).dressings.dressing, 2);
  assert.equal(game.get("save-io-note").textContent, "存档已导出");
  // Import a different save: the game goes back to the menu, and the
  // storage holds the imported save re-saved as the current version.
  const imported = JSON.stringify({ version: 4, edits: [[0, 10, 0, BLOCK.WOOD]], materials: [0, 0, 5, 2, 9, 3],
    axeUnlocked: true, dressings: { dressing: 2, bandage: 1, bigDressing: 0 } });
  game.get("import-save-file").files = [{ text: async () => imported }];
  game.get("import-save-file").emit("change");
  await new Promise(resolve => setImmediate(resolve));
  // An imported file from before the v5 fields gains them at their
  // defaults, and is re-saved as the current version; everything else
  // comes back verbatim.
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)),
    { ...JSON.parse(imported), version: 5, wateringCanOwned: false, hunger: 100, rareMaterials: { emberCore: 0, starShard: 0 },
      dressings: { dressing: 2, bandage: 1, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 },
      equipment: { weapon: null, armor: null, tool: null }, techUnlocked: [],
      workbenchBuilt: false, stats: { blocksMined: 0, cropsPlanted: 0, cropsHarvested: 0 },
      seeds: { wheatSeed: 2, wheat: 0, fertilizer: 0 }, crops: {} });
  assert.equal(game.get("start-screen").hidden, false);
  assert.equal(game.get("pause").hidden, true);
  // A fresh game from the menu picks the imported state up: the HUD
  // shows the imported dressing counts.
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  assert.equal(game.get("hud-dressings").textContent, "2 · 树皮绷带 1 · 树叶大敷料 0 · 烤麦饼 0 · 果蔬沙拉 0 · 炖菜 0");
  // A bad file changes nothing and stays paused with an error note.
  game.key("Escape");
  frame();
  assert.equal(game.get("pause").hidden, false);
  const beforeDisk = data.get(SAVE_KEY);
  game.get("import-save-file").files = [{ text: async () => "not json at all" }];
  game.get("import-save-file").emit("change");
  await new Promise(resolve => setImmediate(resolve));
  assert.match(game.get("save-io-note").textContent, /导入失败/);
  assert.equal(data.get(SAVE_KEY), beforeDisk);
  assert.equal(game.get("pause").hidden, false);
  assert.equal(game.get("start-screen").hidden, true);
});
