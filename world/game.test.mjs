import test from "node:test";
import assert from "node:assert/strict";
import { initGame } from "./game.js";
import { BLOCK, SAVE_KEY, V4_SAVE_KEY, PROGRESS_KEY, createProgression, saveProgress } from "./progression.mjs";
import { SURVIVAL_DIFFICULTY, survivalRoster, hpMultiplier, scaledHp } from "./difficulty.mjs";
import { ENEMIES, defenseWaveRoster } from "./defense.mjs";
import { WORLD, voxelIndex } from "./terrain.mjs";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    emit(type, data = {}) {
      const event = { preventDefault() {}, ...data };
      for (const listener of listeners.get(type) ?? []) listener(event);
    }
  };
}

function mountGame({ pointerLock = false, storage, now = () => performance.now() } = {}) {
  const noop = () => {};
  let requested, frame, camera, direction, actorVertices, rainVertices, viewModelPass, target, sun, fogDensity, dayFactor;
  let releases = 0, rendererBuilds = 0, draws = 0;
  // 2D paint recording for the block-atlas canvas: createBlockAtlas paints
  // nine 16px tiles onto a 144px-wide canvas, and the test below reads which
  // tile columns were painted.  Only that canvas gets a recording context —
  // every other 2D lookup still returns null, as before — because the stub
  // is only returned for a canvas whose width is exactly 144.
  const atlasPaints = [];
  const gl = new Proxy({
    createProgram() { rendererBuilds++; },
    clear() { draws++; },
    getUniformLocation(_program, name) { return name; },
    uniform1f(name, x) {
      // Day/night wiring: the fog density and daylight factor the renderer
      // sets each frame, so the test below can watch time move them.
      if (name === "uFogDensity") fogDensity = x;
      if (name === "uDay") dayFactor = x;
    },
    uniform3f(name, x, y, z) {
      // drawActors resets uTarget to -1 after the terrain pass, so only a
      // real block cell is recorded: the outline's data flow is what the
      // test below asserts on.
      if (name === "uTarget" && (x !== -1 || y !== -1 || z !== -1)) target = [x, y, z];
      if (name === "uSun") sun = [x, y, z];
      if (name !== "uCamera") return;
      viewModelPass = x === 0 && y === 0 && z === 0;
      if (!viewModelPass) camera = [x, y, z];
    },
    uniformMatrix4fv(name, _transpose, matrix) {
      if (name === "uViewProjection" && !viewModelPass) direction = [matrix[3], matrix[7], matrix[11]];
    },
    bufferSubData(_target, _offset, vertices) {
      if (viewModelPass) return;
      // Rain streaks (surface -13) upload after the actors every frame
      // while it rains, so keeping only the last upload would hide the
      // zombies and the beacon behind the weather. Rain goes to its own
      // slot; every other actor-mesh upload stays in actorVertices.
      let rain = 0;
      for (let v = 9; v < vertices.length; v += 12) if (vertices[v] === -13) rain++;
      if (rain * 2 > vertices.length / 12) { rainVertices = vertices; return; }
      actorVertices = vertices;
    }
  }, {
    get(target, key) { return target[key] ?? (key.startsWith("get") ? () => true : noop); }
  });
  const elements = new Map();
  function element(id) {
    const classes = new Set();
    return Object.assign(eventTarget(), {
      hidden: ["#inventory-screen", "#pause", "#death-screen", "#crosshair"].includes(id),
      value: 0, textContent: "", style: { setProperty: noop }, append: noop,
      focus: noop, setAttribute: noop, replaceChildren: noop,
      classList: { add: name => classes.add(name), contains: name => classes.has(name),
        toggle: (name, force) => force ? classes.add(name) : classes.delete(name) },
      getContext(type) {
        if (type === "webgl2") return gl;
        if (type === "2d" && this.width === 144) {
          return {
            fillStyle: "",
            fillRect(x) { atlasPaints.push(x); }
          };
        }
        return null;
      }
    });
  }
  const document = Object.assign(eventTarget(), {
    hidden: false,
    pointerLockElement: null,
    createElement: element,
    querySelector(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    exitPointerLock() {
      releases++;
      this.pointerLockElement = null;
      this.emit("pointerlockchange");
    }
  });
  const window = Object.assign(eventTarget(), {
    document, performance: { now }, localStorage: storage, innerWidth: 640, innerHeight: 480,
    requestAnimationFrame(draw) { frame = draw; }, setTimeout: () => 0, clearTimeout: noop
  });
  const get = id => document.querySelector(`#${id}`);
  if (pointerLock) get("game").requestPointerLock = () => { requested = true; };
  initGame(window);
  return {
    document, window, get, click: id => get(id).emit("click"),
    key: code => document.emit("keydown", { code }),
    release: code => document.emit("keyup", { code }),
    frame: time => frame(time),
    grantPointerLock() {
      assert.ok(requested, "the game requested pointer lock");
      document.pointerLockElement = get("game");
      document.emit("pointerlockchange");
    },
    get releases() { return releases; },
    get camera() { return camera; },
    get direction() { return direction; },
    get target() { return target; },
    get sun() { return sun; },
    get fogDensity() { return fogDensity; },
    get dayFactor() { return dayFactor; },
    get actorVertices() { return actorVertices; },
    get rainVertices() { return rainVertices; },
    get draws() { return draws; },
    get rendererBuilds() { return rendererBuilds; },
    get atlasTiles() {
      const tiles = new Set();
      for (const x of atlasPaints) tiles.add(Math.floor(x / 16));
      return [...tiles].sort((a, b) => a - b);
    }
  };
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

test("the boss arena can be won and replayed, paying its reward without touching the sandbox edits", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const sandbox = createProgression(storage);
  sandbox.editBlock(voxelIndex(WORLD, 17, 4, 16), BLOCK.AIR, BLOCK.DIRT, true);
  const before = storage.getItem(SAVE_KEY);
  const game = mountGame({ storage, pointerLock: true });
  const attack = () => game.get("game").emit("mousedown", { button: 0 });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("boss-button");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("boss-health-value").textContent, "80 / 80");
  assert.equal(game.get("vitals").hidden, false);
  assert.equal(game.get("defense-hud").hidden, true);
  game.key("KeyW");
  game.key("Digit7");
  for (let i = 0; i < 58; i++) frame();
  game.release("KeyW");
  assert.match(game.get("weapon-label").textContent, /石斧/);
  attack();
  assert.equal(game.get("boss-health-value").textContent, "80 / 80");
  let overcharged = false;
  const summonWaves = new Set();
  for (let i = 0; i < 2200 && game.get("death-screen").hidden; i++) {
    frame();
    // Track the guardian's helmet as it circles between attacks.
    let dx = 0, dz = 0, helmetVertices = 0;
    const vertices = game.actorVertices;
    for (let v = 0; v < vertices.length; v += 12) {
      if (vertices[v + 1] < 7.6) continue;
      helmetVertices++;
      dx += vertices[v] - game.camera[0];
      dz += vertices[v + 2] - game.camera[2];
    }
    if (dx || dz) {
      const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
      game.document.emit("mousemove", { movementX: Math.max(-65, Math.min(65, Math.atan2(Math.sin(turn), Math.cos(turn)) / .0013)), movementY: 0 });
      if (Math.hypot(dx, dz) > 1.8 * helmetVertices) game.key("KeyW");
      else game.release("KeyW");
    }
    const exposed = game.get("boss-callout").textContent.includes("现在反击");
    const summoned = /第 (\d) \/ 3 波.*随从 [1-9]/.exec(game.get("wave-status").textContent);
    if (summoned) summonWaves.add(Number(summoned[1]));
    overcharged ||= game.get("wave-status").textContent.includes("过载");
    const callout = game.get("boss-callout").textContent;
    if (/熔锤冲锋|炉火坠落/.test(callout)) {
      game.release("KeyW");
      game.key("KeyD");
      game.key("ShiftLeft");
    } else {
      game.release("KeyD");
      game.release("ShiftLeft");
    }
    if (!exposed && (callout === "震地波" || callout === "双环星震")) {
      game.key("Space");
      game.release("Space");
    }
    if (exposed || /游荡者|突袭者|破城者/.test(game.get("target-status").textContent)) attack();
  }
  assert.ok(overcharged);
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
  const afterWin = storage.getItem(SAVE_KEY);
  game.click("respawn-button");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("boss-health-value").textContent, "80 / 80");
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
  assert.equal(game.get("boss-health-value").textContent, "440 / 440");
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
  assert.equal(game.get("boss-health-value").textContent, "440 / 440");
  game.release("Digit4");
  game.key("Digit4");
  frames(85);
  assert.equal(game.get("boss-health-value").textContent, "424 / 440");
  frames(115);
  assert.equal(game.get("boss-health-value").textContent, "360 / 440");
});

test("the pulse weapon can interrupt the crystal and win the colossus fight through both phases", () => {
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
    const vertices = game.actorVertices;
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
  assert.equal(game.get("boss-health-value").textContent, "440 / 440");
  assert.equal(game.get("weather-status").textContent, "断星天井");
  game.key("Digit8");
  frame();
  assert.match(game.get("pulse-info").textContent, /6 \/ 6/);
  attack();
  frame();
  assert.match(game.get("pulse-info").textContent, /5 \/ 6/);
  assert.equal(game.get("boss-health-value").textContent, "440 / 440");
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
  let dodge = null, dodged = false, dodgeUntil = 0;
  for (let i = 0; i < 2200 && game.get("death-screen").hidden; i++) {
    frame();
    const callout = game.get("boss-callout").textContent;
    secondPhase ||= game.get("wave-status").textContent.includes("裂星");
    shifted ||= callout.includes("正在换位");
    nova ||= callout.includes("双环星震");
    if (dodge && time >= dodgeUntil) {
      game.release(dodge);
      dodge = null;
    }
    if (callout.includes("打碎金色晶体")) {
      aimAtPart(-3);
      const label = game.get("weapon-label").textContent;
      if (label.includes("可攻击")) game.get("game").emit("mousedown", { button: 2 });
      if (label.includes("松开右键发射") && game.get("target-status").textContent === "聚星晶体 42 / 42") {
        game.document.emit("mouseup", { button: 2 });
        frame();
        interrupted = game.get("message").textContent.includes("三轨折光中断");
        assert.match(game.get("pulse-info").textContent, /4 \/ 6/);
        assert.ok(game.get("boss-callout").textContent.includes("攻击青色核心"));
      }
      continue;
    }
    const distance = aimAtPart(-2);
    if (callout.includes("攻击青色核心")) {
      dodged = false;
      if (game.get("target-status").textContent !== "核心暴露") continue;
      const hp = game.get("boss-health-value").textContent;
      attack();
      frame();
      rangedHit ||= distance > 7 && hp !== game.get("boss-health-value").textContent;
    } else {
      if (!dodged && (callout.includes("脚下已锁定") || callout.includes("你在光带中"))) {
        dodge = game.camera[0] > 16.5 ? "KeyA" : "KeyD";
        game.key(dodge);
        dodgeUntil = time + 850;
        dodged = true;
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
  assert.equal(game.get("boss-health-value").textContent, "440 / 440");
  assert.equal(game.get("health-value").textContent, "100");
  game.key("Escape");
  game.click("pause-menu-button");
  game.click("boss-button");
  game.grantPointerLock();
  frame();
  game.key("Digit8");
  frame();
  assert.equal(game.get("pulse-info").hidden, true);
  assert.equal(game.get("boss-health-value").textContent, "80 / 80");
  assert.equal(game.get("weather-status").textContent, "熔炉遗迹");
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

function seedProgress(storage, progress) {
  storage.setItem(PROGRESS_KEY, JSON.stringify({ version: 1, wave: 0, kills: 0,
    bossesDefeated: {}, defense: { wave: 0, cleared: false, bestWave: 0 }, ...progress }));
}

function sharedStorage(data = new Map()) {
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

function loseBossFight(game) {
  game.key("KeyW");
  for (let i = 1; i <= 12; i++) game.frame(i * 100);
  game.release("KeyW");
  for (let i = 13; i < 400 && game.get("death-screen").hidden; i++) game.frame(i * 100);
  assert.equal(game.get("death-screen").hidden, false);
}

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

test("defeating the guardian records the boss in saved progress", t => {
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
  for (let i = 0; i < 2200 && game.get("death-screen").hidden; i++) {
    frame();
    let dx = 0, dz = 0, helmetVertices = 0;
    const vertices = game.actorVertices;
    for (let v = 0; v < vertices.length; v += 12) {
      if (vertices[v + 1] < 7.6) continue;
      helmetVertices++;
      dx += vertices[v] - game.camera[0];
      dz += vertices[v + 2] - game.camera[2];
    }
    if (dx || dz) {
      const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
      game.document.emit("mousemove", { movementX: Math.max(-65, Math.min(65, Math.atan2(Math.sin(turn), Math.cos(turn)) / .0013)), movementY: 0 });
      if (Math.hypot(dx, dz) > 1.8 * helmetVertices) game.key("KeyW");
      else game.release("KeyW");
    }
    const exposed = game.get("boss-callout").textContent.includes("现在反击");
    const callout = game.get("boss-callout").textContent;
    if (/熔锤冲锋|炉火坠落/.test(callout)) {
      game.release("KeyW");
      game.key("KeyD");
      game.key("ShiftLeft");
    } else {
      game.release("KeyD");
      game.release("ShiftLeft");
    }
    if (!exposed && (callout === "震地波" || callout === "双环星震")) {
      game.key("Space");
      game.release("Space");
    }
    if (exposed || /游荡者|突袭者|破城者/.test(game.get("target-status").textContent)) attack();
  }
  assert.equal(game.get("death-title").textContent, "熔炉守卫已击败");
  const progress = JSON.parse(storage.getItem(PROGRESS_KEY));
  assert.equal(progress.wave, 2);
  assert.equal(progress.bossesDefeated.boss, true);
  // The win counts as a kill, not just a defeat: the guardian's kill
  // count goes from the seeded zero to one.
  assert.equal(progress.bossKills.boss, 1);
  // Returning to the menu shows the kill on the main-menu record line.
  game.click("death-menu-button");
  const menuStatus = game.get("menu-status");
  assert.equal(menuStatus.hidden, false);
  assert.match(menuStatus.textContent, /熔炉守卫 1 次/);
  // This deterministic run kills no summoned minions, so the seeded kill
  // total is preserved rather than grown; the merge adds run kills on top
  // of the base by the same addition.
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
  assert.equal(game.get("boss-health-value").textContent, "80 / 80");
});

test("the block atlas paints all nine tiles", () => {
  const game = mountGame();
  game.click("defense-button");
  game.frame(16);
  assert.ok(game.rendererBuilds >= 1, "the renderer was built");
  assert.deepEqual(game.atlasTiles, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("survival wave 6 spawns a spitter whose throw wounds the player", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  // A Map-backed storage: without one, every kill's loot is rolled back
  // by the failed save, so leaves never accumulate into dressings.
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  const attack = () => game.get("game").emit("mousedown", { button: 0 });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  frame();
  const hp = () => Number(game.get("health-value").textContent);
  const waveStatus = () => game.get("wave-status").textContent;
  // The nearest zombie's closest vertex: when zombies are on the field
  // the actor buffer holds only their parts, so the closest vertex
  // belongs to the closest zombie. It is only a coarse aim — a corner
  // of a foot or an arm can sit half a block off the body — so the loop
  // below trusts the game's own target-status instead: once a zombie's
  // name shows, the aim is on it and the player holds still and swings.
  // (With no zombies the buffer keeps stale data from another mesh, so
  // callers only use this during combat.)
  const nearest = () => {
    const vertices = game.actorVertices;
    if (!vertices?.length) return null;
    let best = null, bestD = Infinity;
    for (let v = 0; v < vertices.length; v += 12) {
      const dx = vertices[v] - game.camera[0], dz = vertices[v + 2] - game.camera[2];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = { x: vertices[v], y: vertices[v + 1], z: vertices[v + 2] }; }
    }
    return best ? { ...best, distance: Math.sqrt(bestD) } : null;
  };
  const turnToward = ({ x, y, z }, offset = 0) => {
    const dx = x - game.camera[0], dz = z - game.camera[2];
    const turn = Math.atan2(dx, -dz) + offset - Math.atan2(game.direction[0], -game.direction[2]);
    const dist = Math.hypot(dx, dz);
    // Aim the pitch too: a zombie a block below the player is invisible
    // to a level ray, so point the view at the vertex itself — but clamp
    // the pitch, because a foot vertex would otherwise dive the view
    // into the ground and a head vertex would lift it over the body.
    const desiredPitch = Math.max(-0.55, Math.min(0.35, Math.atan2(y - game.camera[1], dist)));
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, game.direction[1])));
    const clamp = radians => Math.max(-65, Math.min(65, radians / .0013));
    game.document.emit("mousemove", {
      movementX: clamp(Math.atan2(Math.sin(turn), Math.cos(turn))),
      movementY: clamp(-(desiredPitch - currentPitch))
    });
    return dist;
  };
  // Pitch correction toward a vertex, for the sweep branch: it turns the
  // yaw on its own, so it still needs the view kept near the zombie's
  // height while it scans.
  const pitchDelta = ({ x, y, z }) => {
    const dist = Math.hypot(x - game.camera[0], z - game.camera[2]);
    const desiredPitch = Math.max(-0.55, Math.min(0.35, Math.atan2(y - game.camera[1], dist)));
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, game.direction[1])));
    return Math.max(-65, Math.min(65, -(desiredPitch - currentPitch) / .0013));
  };
  let spitterSeen = false;
  // Phase 1: fight waves 1-5 until wave 6 is announced. The player
  // stands their ground and faces the closest zombie: the sword
  // outranges every zombie, and clearing a wave heals 24. Sustaining
  // five waves also needs the dressing loop: kills drop leaves, and
  // between waves (the game pauses while the bag is open) the leaves
  // become dressings; KeyH spends one for 30 health mid-fight.
  let announcedSix = false;
  let maxWave = 0;
  let craftedThisGap = false;
  let noNameFrames = 0;
  for (let i = 0; i < 12000 && game.get("death-screen").hidden && !announcedSix; i++) {
    frame();
    // target-status keeps its old text when hidden, so a name only
    // counts while the element is shown.
    const statusEl = game.get("target-status");
    const status = statusEl.hidden ? "" : statusEl.textContent;
    if (/投掷者/.test(status)) spitterSeen = true;
    const live = /第 (\d+) 波 · 剩余/.exec(waveStatus());
    if (live) {
      maxWave = Math.max(maxWave, Number(live[1]));
      craftedThisGap = false;
    }
    const upcoming = /第 (\d+) 波 · \d+ 秒后/.exec(waveStatus());
    if (upcoming && Number(upcoming[1]) === 6) announcedSix = true;
    if (upcoming && !craftedThisGap && Number(upcoming[1]) > 1) {
      craftedThisGap = true;
      game.key("KeyC");
      frame();
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.click("craft-dressing");
      game.key("KeyC");
      game.grantPointerLock();
      frame();
    }
    const named = /游荡者|突袭者|破城者|投掷者/.test(status);
    if (named) {
      noNameFrames = 0;
      if (status.includes("超出攻击距离")) {
        // The aimed zombie is not closing in — likely stuck where its
        // route cannot reach — so walk toward it instead of waiting.
        game.key("KeyW");
      } else {
        game.release("KeyW");
        attack();
      }
    } else if (live) {
      // No zombie in the sights: turn toward the closest one, and if
      // that finds nothing for a while, sweep the view in a full circle
      // instead of chasing a jumping aim point.
      game.release("KeyW");
      if (++noNameFrames > 40) {
        const foe = nearest();
        game.document.emit("mousemove", { movementX: 40, movementY: foe ? pitchDelta(foe) : 0 });
      } else {
        const foe = nearest();
        if (foe) turnToward(foe, 0);
      }
    } else {
      game.release("KeyW");
    }
    if (hp() <= 70) game.key("KeyH");
  }
  assert.equal(game.get("death-screen").hidden, true, `the player must survive to wave 6 (reached wave ${maxWave})`);
  assert.ok(announcedSix, "wave 6 must be announced");
  // Phase 2: keep fighting while waiting for the throw. Every melee hit
  // deals an even amount (walker 10, runner 6, breaker 14), so only a
  // spitter throw (13) can turn the health odd. The spitter throws from
  // 7.5 units out, so the player cannot reach it before the glob is in
  // the air — walking at it and swinging is safe for the proof. The loop
  // only ends once the throw has landed AND the spitter has been seen:
  // the throw usually lands while the player is still busy with the
  // walkers, and the spitter is only aimed at once they are down.
  let thrown = false;
  let phase2NoName = 0;
  for (let i = 0; i < 2400 && game.get("death-screen").hidden && (!thrown || !spitterSeen); i++) {
    frame();
    const statusEl = game.get("target-status");
    const status = statusEl.hidden ? "" : statusEl.textContent;
    if (/投掷者/.test(status)) spitterSeen = true;
    const live = /第 (\d+) 波 · 剩余/.exec(waveStatus());
    const named = /游荡者|突袭者|破城者|投掷者/.test(status);
    if (named) {
      phase2NoName = 0;
      if (status.includes("超出攻击距离")) {
        game.key("KeyW");
      } else {
        game.release("KeyW");
        attack();
      }
    } else if (live) {
      game.release("KeyW");
      if (++phase2NoName > 40) {
        const foe = nearest();
        game.document.emit("mousemove", { movementX: 40, movementY: foe ? pitchDelta(foe) : 0 });
      } else {
        const foe = nearest();
        if (foe) turnToward(foe, 0);
      }
    } else {
      game.release("KeyW");
    }
    if (hp() <= 70) game.key("KeyH");
    thrown = hp() % 2 === 1;
  }
  assert.ok(spitterSeen, "wave 6 must spawn a spitter (投掷者)");
  assert.ok(thrown, `a spitter throw must land (health turned odd, now ${hp()})`);
  assert.equal(game.get("death-screen").hidden, true, "the player must survive the throw");
});

test("defense runs all eight waves end to end and clears wave 8", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  // A Map-backed storage: without one, every kill's loot is rolled back
  // by the failed save, so leaves never accumulate into dressings.
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  const attack = () => game.get("game").emit("mousedown", { button: 0 });
  let time = 0;
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
  const zombieRatios = Object.values(ENEMIES).flatMap(style => [style.coat, style.skin, style.eyes])
    .map(([r, g, b]) => [g / b, r / g]);
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
  // kind's parts at a 0.10 tolerance (nearest neighbours: runner skin
  // 1.15/1.26, walker eyes 2.81/1.63). They are the only kind that
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
    // foot vertex needs a matching look-down.
    const desiredPitch = Math.max(-0.9, Math.min(0.9, Math.atan2(y - game.camera[1], dist)));
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
  // ray never settles — one hit landed in 8s on a runner standing 0.6
  // away. Instead, lock onto one zombie and keep aiming at it until it
  // dies or leaves; only then pick a new target. The lock anchors on
  // the vertex closest to the lock position (one zombie's part) and
  // averages only the parts within 0.6 of it, so a neighbour standing
  // next to it cannot drag the aim across — a wide average did exactly
  // that, and the player chased the drift across the map while the
  // beacon died. A centre that jumps more than 1.0 in a frame is a
  // different zombie, so the lock clears instead of following it.
  let lockPos = null;
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
  let maxWave = 0, wave6Spitters = 0, wave6Frames = 0, wave6SpitterSeen = false;
  let noNameFrames = 0, gapHandled = false;
  // Stone budget for repairs: every kill pays 1 stone, every repair
  // spends 3, so the repairs issued so far must stay within the kills.
  // The kills are counted live, from drops in the remaining count
  // within one wave: the wave status only shows the previous runs'
  // record (savedProgress loads at run start and merges at run end),
  // so it reads zero all through a fresh run and cannot feed this.
  let repairs = 0, liveKills = 0, prevRem = 0, prevWave = 0;
  // Victory margins: the lowest beacon / player HP seen all run. A bot
  // win with the beacon at 5 hp proves far less than a win at 60 — the
  // margins are the number that says how much slack a human has.
  let minBeaconHp = 120, minPlayerHp = 100;
  const kills = () => liveKills;
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
    if (fighting()) {
      const rem = remaining();
      if (wave === prevWave && rem < prevRem) liveKills += prevRem - rem;
      prevRem = rem; prevWave = wave;
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
    // switch off a walker or runner and go kill it, or the beacon
    // dies while the player finishes the wrong zombie.
    const breakerThreat = nearestBreakerToBeacon();
    const forcedBreaker = breakerThreat && breakerThreat.beaconDistance < 3 && !/破城者/.test(status)
      ? breakerThreat : null;
    if (forcedBreaker) lockPos = { x: forcedBreaker.x, z: forcedBreaker.z };
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
        else if (closest && (closest.spitter || closest.beaconDistance < 6)) foe = closest;
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
    if (foe) {
      foe.distance = Math.hypot(foe.x - game.camera[0], foe.z - game.camera[2]);
      const beacon = findBeaconPos();
      foe.beaconDistance = beacon ? Math.hypot(foe.x - beacon.x, foe.z - beacon.z) : Infinity;
    }
    const named = /游荡者|突袭者|破城者|投掷者/.test(status);
    if (named && !forcedBreaker) {
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
  assert.equal(wave6Spitters, 2, `wave 6 must spawn two spitters at once (saw at most ${wave6Spitters} clusters)`);
  // Victory margins, seeded run (R9): beacon bottomed at 72/120,
  // player at 60/100. The floors sit below those with headroom, so they
  // trip only when a change really eats the slack — a win at 5 hp would
  // prove almost nothing about a human's chances.
  assert.ok(minBeaconHp >= 60, `beacon must never drop below 60 (bottomed at ${minBeaconHp})`);
  assert.ok(minPlayerHp >= 40, `player must never drop below 40 (bottomed at ${minPlayerHp})`);
  // The run's whole stone income is the kills' drops added up: 45 kills
  // over waves 1–8 pay 55 stone (breakers pay 2, and waves 4–8 each
  // bring a spitter), so 8 repairs (24 stone) must fit inside it — a
  // bot that repaired on credit would prove nothing about the real economy.
  const stoneFor = kind => (ENEMIES[kind].drops ?? []).filter(([id]) => id === BLOCK.STONE)
    .reduce((sum, [, amount]) => sum + amount, 0);
  const totalStone = [0, 1, 2, 3, 4, 5, 6, 7].reduce((sum, i) =>
    sum + defenseWaveRoster(i).reduce((wave, kind) => wave + stoneFor(kind), 0), 0);
  assert.equal(totalStone, 55);
  assert.ok(repairs * 3 <= totalStone, `repairs (${repairs} × 3 stone) must stay within the ${totalStone} stone the kills earned`);
});

test("the backpack lists every healing recipe and the HUD shows all three counts", () => {
  // A preloaded v4 save: enough wood and leaves to craft one of each,
  // and one healing item of each recipe already owned.
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 0, 0, 0, 4, 8],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 1, bigDressing: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  // The HUD label already says 敷料, so the dressing count stands bare.
  assert.equal(game.get("hud-dressings").textContent, "1 · 树皮绷带 1 · 树叶大敷料 1");
  game.key("KeyC");
  frame();
  assert.equal(game.get("inventory-screen").hidden, false);
  // Every healing recipe in RECIPES gets a row, with its own cost line
  // and craft / use buttons — not just the dressing row from the markup.
  const rows = game.get("healing-recipes").innerHTML;
  assert.match(rows, /树皮绷带/);
  assert.match(rows, /树叶大敷料/);
  assert.match(rows, /craft-bandage/);
  assert.match(rows, /use-bigDressing/);
  assert.match(game.get("dressing-cost").textContent, /恢复 30 点生命/);
  assert.match(game.get("bandage-cost").textContent, /恢复 20 点生命/);
  assert.match(game.get("bigDressing-cost").textContent, /恢复 50 点生命/);
  assert.equal(game.get("inventory-dressings").textContent,
    "树叶敷料 1 件 · 树皮绷带 1 件 · 树叶大敷料 1 件 · 当前生命 100/100");
  // At full health every use button is disabled, whatever the counts are.
  assert.equal(game.get("use-dressing").disabled, true);
  assert.equal(game.get("use-bandage").disabled, true);
  assert.equal(game.get("use-bigDressing").disabled, true);
  assert.equal(game.get("craft-dressing").disabled, false);
  assert.equal(game.get("craft-bandage").disabled, false);
  assert.equal(game.get("craft-bigDressing").disabled, false);
  game.click("craft-bandage");
  game.click("craft-bigDressing");
  game.click("craft-dressing");
  assert.equal(game.get("inventory-dressings").textContent,
    "树叶敷料 2 件 · 树皮绷带 2 件 · 树叶大敷料 2 件 · 当前生命 100/100");
  assert.equal(game.get("hud-dressings").textContent, "2 · 树皮绷带 2 · 树叶大敷料 2");
  // One leaf left: another big dressing (4 leaves) can no longer be made,
  // and clicking its disabled button changes nothing.
  assert.equal(game.get("craft-bigDressing").disabled, true);
  game.click("craft-bigDressing");
  assert.match(game.get("inventory-dressings").textContent, /树叶大敷料 2 件/);
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("inventory-screen").hidden, true);
});

test("using a healing item heals by its own recipe amount", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  // One of each healing item, no materials: the test spends what it owns.
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 0, 0, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 1, bigDressing: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  frame();
  const hp = () => Number(game.get("health-value").textContent);
  const openBag = () => { game.key("KeyC"); frame(); assert.equal(game.get("inventory-screen").hidden, false); };
  const closeBag = () => { game.key("KeyC"); game.grantPointerLock(); frame(); assert.equal(game.get("inventory-screen").hidden, true); };
  // Stand still and let wave 1 walkers hit until the health is at most the
  // target: each hit is 12, so the wait stops on a known, unclamped range.
  const takeHitsUntil = target => {
    for (let i = 0; i < 3000 && game.get("death-screen").hidden && hp() > target; i++) frame();
  };
  takeHitsUntil(40);
  assert.equal(game.get("death-screen").hidden, true, "the player must survive the beating");
  assert.ok(hp() <= 50 && hp() > 0, `health must be low enough to prove a 50 heal (now ${hp()})`);
  openBag();
  assert.equal(game.get("use-bigDressing").disabled, false);
  const beforeBig = hp();
  game.click("use-bigDressing");
  assert.equal(hp(), beforeBig + 50, "a big dressing heals 50, not the dressing's 30");
  assert.equal(game.get("inventory-notice").textContent, "生命 +50");
  assert.match(game.get("inventory-dressings").textContent, /树叶大敷料 0 件/);
  closeBag();
  takeHitsUntil(70);
  assert.equal(game.get("death-screen").hidden, true);
  openBag();
  const beforeDressing = hp();
  assert.ok(beforeDressing <= 70, `health must be low enough to prove a 30 heal (now ${beforeDressing})`);
  game.click("use-dressing");
  assert.equal(hp(), beforeDressing + 30, "a dressing heals 30");
  assert.equal(game.get("inventory-notice").textContent, "生命 +30");
  assert.match(game.get("inventory-dressings").textContent, /树叶敷料 0 件/);
  closeBag();
  takeHitsUntil(80);
  assert.equal(game.get("death-screen").hidden, true);
  openBag();
  const beforeBandage = hp();
  assert.ok(beforeBandage <= 80, `health must be low enough to prove a 20 heal (now ${beforeBandage})`);
  game.click("use-bandage");
  assert.equal(hp(), beforeBandage + 20, "a bandage heals 20, not the dressing's 30");
  assert.equal(game.get("inventory-notice").textContent, "生命 +20");
  assert.match(game.get("inventory-dressings").textContent, /树皮绷带 0 件/);
  // Out of bandages: its use button stays disabled even while hurt.
  assert.equal(game.get("use-bandage").disabled, true);
  assert.equal(game.get("use-dressing").disabled, true);
  closeBag();
  takeHitsUntil(90);
  assert.equal(game.get("death-screen").hidden, true);
  // KeyH is the dressing hotkey: with no dressing left it heals nothing.
  const beforeKeyH = hp();
  assert.ok(beforeKeyH < 100, `health must be below full for the KeyH check (now ${beforeKeyH})`);
  game.key("KeyH");
  frame();
  assert.equal(hp(), beforeKeyH, "KeyH with no dressing must not heal");
  assert.equal(game.get("death-screen").hidden, true);
});

test("survival difficulty comes from the config table, unchanged", () => {
  // The table itself, verbatim from the values game.js used to carry
  // inline: +5% HP per wave past the first, at most 7 zombies a wave,
  // runners from wave 5, spitters from wave 6, breakers from wave 7.
  assert.deepEqual(SURVIVAL_DIFFICULTY, {
    hpPerWave: 0.05,
    maxZombies: 7,
    mixIns: [
      { kind: "breaker", fromWave: 7, period: 5, offset: 4 },
      { kind: "runner", fromWave: 5, period: 3, offset: 2 },
      { kind: "spitter", fromWave: 6, period: 4, offset: 3 }
    ]
  });
  assert.ok(Object.isFrozen(SURVIVAL_DIFFICULTY));
  assert.ok(Object.isFrozen(SURVIVAL_DIFFICULTY.mixIns));
  for (const rule of SURVIVAL_DIFFICULTY.mixIns) assert.ok(Object.isFrozen(rule));
  // Rosters per wave, exactly as the old inline formula produced them.
  assert.deepEqual(survivalRoster(1), ["walker", "walker"]);
  assert.deepEqual(survivalRoster(2), ["walker", "walker", "walker"]);
  assert.deepEqual(survivalRoster(4), ["walker", "walker", "walker", "walker", "walker"]);
  assert.deepEqual(survivalRoster(5), ["walker", "walker", "runner", "walker", "walker", "runner"]);
  assert.deepEqual(survivalRoster(6), ["walker", "walker", "runner", "spitter", "walker", "runner", "walker"]);
  assert.deepEqual(survivalRoster(7), ["walker", "walker", "runner", "spitter", "breaker", "runner", "walker"]);
  assert.deepEqual(survivalRoster(10), ["walker", "walker", "runner", "spitter", "breaker", "runner", "walker"]);
  assert.equal(survivalRoster(20).length, 7, "the wave-size cap holds past wave 6");
  // Each kind first appears in the same wave as before.
  const firstSeen = kind => {
    for (let wave = 1; wave <= 10; wave++) if (survivalRoster(wave).includes(kind)) return wave;
    return null;
  };
  assert.equal(firstSeen("walker"), 1);
  assert.equal(firstSeen("runner"), 5);
  assert.equal(firstSeen("spitter"), 6);
  assert.equal(firstSeen("breaker"), 7);
  // HP curve: 1 at wave 1, then +5% per wave past it.
  assert.equal(hpMultiplier(1), 1);
  assert.equal(hpMultiplier(2), 1.05);
  assert.equal(hpMultiplier(5), 1.2);
  assert.equal(hpMultiplier(7), 1.3);
  assert.equal(hpMultiplier(0), 1);
  // Scaled HP, rounded the way addEnemies() always has (a wave-5 walker
  // at 84 is what the survival test watches in the target status).
  assert.equal(scaledHp(70, 1), 70);
  assert.equal(scaledHp(70, 2), 74);
  assert.equal(scaledHp(70, 5), 84);
  assert.equal(scaledHp(43, 5), 52);
  assert.equal(scaledHp(55, 6), 69);
  assert.equal(scaledHp(155, 7), 202);
  assert.equal(scaledHp(70), 70);
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
    "树叶敷料 2 件 · 树皮绷带 1 件 · 树叶大敷料 1 件 · 当前生命 100/100");
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
    { ...JSON.parse(imported), version: 5, rareMaterials: { emberCore: 0, starShard: 0 },
      equipment: { weapon: null, armor: null, tool: null }, techUnlocked: [],
      workbenchBuilt: false, stats: { blocksMined: 0 } });
  assert.equal(game.get("start-screen").hidden, false);
  assert.equal(game.get("pause").hidden, true);
  // A fresh game from the menu picks the imported state up: the HUD
  // shows the imported dressing counts.
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  assert.equal(game.get("hud-dressings").textContent, "2 · 树皮绷带 1 · 树叶大敷料 0");
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

test("the backpack shows the workbench gate, and crafting unlocks the equipment rows", () => {
  // A preloaded v4 save: 14 stone and 10 wood — the bench (5+5), the
  // armor (6+2) and the pickaxe (3+2) all fit, nothing else to spend.
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 0, 0, 14, 10, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } })]]);
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
  // The workbench rows live in the workbench tab, not the backpack tab.
  game.click("tab-btn-workbench");
  assert.equal(game.get("tab-workbench").hidden, false);
  assert.equal(game.get("tab-backpack").hidden, true);
  // The workbench row is buildable; the equipment rows are locked.
  assert.equal(game.get("craft-workbench").disabled, false);
  assert.match(game.get("workbench-cost").textContent, /石头 14\/5 · 木头 10\/5/);
  assert.equal(game.get("craft-stoneArmor").disabled, true);
  assert.equal(game.get("craft-stonePickaxe").disabled, true);
  assert.match(game.get("stoneArmor-cost").textContent, /需先建造工作台/);
  // The ember rows name the workbench first: the tier kill comes second.
  assert.equal(game.get("craft-emberSword").disabled, true);
  assert.match(game.get("emberSword-cost").textContent, /需先建造工作台/);
  // Build the bench: the cost line says built, but the equipment
  // rows stay locked — the workbench alone no longer opens them; the
  // 石阶装备 trunk node does. The stone row names its trunk node, the
  // ember row names its own.
  game.click("craft-workbench");
  assert.match(game.get("inventory-notice").textContent, /已制作工作台/);
  assert.equal(game.get("workbench-cost").textContent, "已建造");
  assert.equal(game.get("craft-workbench").disabled, true);
  assert.equal(game.get("craft-stoneArmor").disabled, true);
  assert.equal(game.get("craft-stonePickaxe").disabled, true);
  assert.match(game.get("stoneArmor-cost").textContent, /需先解锁：工作台/);
  assert.match(game.get("emberSword-cost").textContent, /需先解锁：熔火科技/);
  assert.equal(game.get("detail-name").textContent, "石甲");
  assert.equal(game.get("detail-tier").textContent, "石阶");
  assert.match(game.get("detail-materials").innerHTML, /石头 9\/6/);
  assert.match(game.get("detail-materials").innerHTML, /木头 5\/2/);
  // Unlock the trunk in the tech tab: the stone rows open.
  game.click("tab-btn-tech");
  assert.equal(game.get("tech-unlock-workbench").disabled, false);
  game.click("tech-unlock-workbench");
  assert.match(game.get("inventory-notice").textContent, /已解锁工作台/);
  assert.equal(game.get("tech-unlock-workbench").textContent, "已解锁");
  assert.equal(game.get("tech-unlock-stoneGear").disabled, false);
  assert.match(game.get("tech-cond-stoneGear").innerHTML, /已解锁工作台/);
  game.click("tech-unlock-stoneGear");
  assert.match(game.get("inventory-notice").textContent, /已解锁石阶装备/);
  game.click("tab-btn-workbench");
  assert.equal(game.get("craft-stoneArmor").disabled, false);
  assert.equal(game.get("craft-stonePickaxe").disabled, false);
  // Craft the armor: the row says equipped, and the equipment tab's
  // armor card shows it.
  game.click("craft-stoneArmor");
  assert.match(game.get("stoneArmor-cost").textContent, /已装备石甲/);
  assert.equal(game.get("craft-stoneArmor").disabled, true);
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-weapon-name").textContent, "石剑");
  assert.equal(game.get("equip-weapon-info").textContent, "石阶 · 伤害 27");
  assert.equal(game.get("equip-weapon-state").textContent, "默认武器");
  assert.equal(game.get("equip-armor-name").textContent, "石甲");
  assert.equal(game.get("equip-armor-info").textContent, "石阶 · 减伤 10%");
  assert.equal(game.get("equip-armor-state").textContent, "已装备");
  assert.equal(game.get("equip-tool-name").textContent, "工具");
  assert.equal(game.get("equip-tool-info").textContent, "未获得——在工作台制作");
  assert.equal(game.get("equip-tool-state").textContent, "未获得");
  // And the pickaxe the same way.
  game.click("tab-btn-workbench");
  game.click("craft-stonePickaxe");
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-tool-name").textContent, "石镐");
  assert.equal(game.get("equip-tool-state").textContent, "已装备");
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("inventory-screen").hidden, true);
});

test("backpack tabs switch panels and widen the panel for workbench and tech", () => {
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 0, 0, 0, 4, 8],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 1, bigDressing: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  const panel = game.document.querySelector("#inventory-screen .inventory-panel");
  // The backpack tab opens by default, on the narrow panel.
  assert.equal(game.get("tab-backpack").hidden, false);
  assert.equal(game.get("tab-workbench").hidden, true);
  assert.equal(game.get("tab-equipment").hidden, true);
  assert.equal(game.get("tab-tech").hidden, true);
  assert.equal(panel.classList.contains("wide"), false);
  assert.equal(game.get("tab-btn-backpack").classList.contains("secondary-button"), false);
  assert.equal(game.get("tab-btn-workbench").classList.contains("secondary-button"), true);
  // The workbench tab widens the panel and shows its two columns.
  game.click("tab-btn-workbench");
  assert.equal(game.get("tab-workbench").hidden, false);
  assert.equal(game.get("tab-backpack").hidden, true);
  assert.equal(panel.classList.contains("wide"), true);
  assert.equal(game.get("tab-btn-workbench").classList.contains("secondary-button"), false);
  assert.match(game.get("workbench-list").innerHTML, /石阶/);
  assert.match(game.get("workbench-list").innerHTML, /熔火阶/);
  assert.match(game.get("workbench-list").innerHTML, /断星阶/);
  // The equipment tab goes back to the narrow panel.
  game.click("tab-btn-equipment");
  assert.equal(game.get("tab-equipment").hidden, false);
  assert.equal(panel.classList.contains("wide"), false);
  // The tech tab widens again; the tree is real now — the empty-state
  // line shows while nothing is unlocked, and the trunk nodes are there.
  game.click("tab-btn-tech");
  assert.equal(game.get("tab-tech").hidden, false);
  assert.equal(panel.classList.contains("wide"), true);
  assert.match(game.get("inventory-tabs").innerHTML, /完成主干解锁更多分支/);
  assert.equal(game.get("tech-empty").hidden, false);
  assert.match(game.get("tech-list").innerHTML, /熔火科技/);
  assert.match(game.get("tech-list").innerHTML, /坚韧/);
  assert.equal(game.get("tech-unlock-workbench").disabled, false);
  assert.equal(game.get("tech-unlock-stoneGear").disabled, true);
  assert.equal(game.get("tech-unlock-toughness").disabled, true);
  game.click("tab-btn-backpack");
  assert.equal(game.get("tab-backpack").hidden, false);
  assert.equal(panel.classList.contains("wide"), false);
});

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
function v5SaveWithArmor(armor, techUnlocked = []) {
  return JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 }, rareMaterials: { emberCore: 0, starShard: 0 },
    equipment: { weapon: null, armor, tool: null }, techUnlocked, workbenchBuilt: true, stats: { blocksMined: 0 } });
}

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

test("hitting a zombie wears the equipped sword by 1 and the HUD shows the durability", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithWeapon({ key: "emberSword", tier: "ember", durability: 200 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  waitForZombieHit(game, frame);
  assert.ok(swingAtAdjacentZombie(game, frame), "the sweep should find the zombie");
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
  assert.ok(swingAtAdjacentZombie(game, frame), "the sweep should find the zombie");
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
  // First hit: 51 -> 50, exactly 25% — not below, no warning.
  assert.ok(swingAtAdjacentZombie(game, frame), "the sweep should find a zombie");
  assert.doesNotMatch(game.get("message").textContent, /耐久不足/);
  // Second hit: 50 -> 49, 24% — the warning fires once.
  assert.ok(swingAtAdjacentZombie(game, frame), "the sweep should find a zombie again");
  assert.match(game.get("message").textContent, /熔火剑耐久不足（24%），按 C 在工作台修理/);
  // Third hit: 49 -> 48 — already below 25%, no second warning.
  assert.ok(swingAtAdjacentZombie(game, frame), "the sweep should find a zombie a third time");
  assert.doesNotMatch(game.get("message").textContent, /耐久不足/);
});

test("a hit on the player wears the armor by 1; at 0 the reduction is gone", () => {
  const data = new Map([[SAVE_KEY, v5SaveWithArmor({ key: "stoneArmor", tier: "stone", durability: 1 })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  // Record the first two hits the player takes. A walker hits 10 (9
  // with stone armor), a runner 6 (5 with it): a drop of 5 or 9 means
  // the armor was still working, 6 or 10 means it was gone.
  const drops = [];
  let hp = 100;
  for (let i = 0; i < 3000 && drops.length < 2; i++) {
    frame();
    const now = Number(game.get("health-value").textContent);
    if (now < hp) { drops.push(hp - now); hp = now; }
  }
  assert.equal(drops.length, 2, "the player should have taken two hits");
  assert.ok([5, 9].includes(drops[0]), `first hit should be reduced (dropped ${drops[0]})`);
  assert.ok([6, 10].includes(drops[1]), `second hit should be full (dropped ${drops[1]})`);
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
