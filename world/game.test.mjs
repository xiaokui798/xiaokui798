import test from "node:test";
import assert from "node:assert/strict";
import { initGame } from "./game.js";
import { BLOCK, SAVE_KEY, createProgression } from "./progression.mjs";
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
  let requested, frame, camera, direction, actorVertices, viewModelPass;
  let releases = 0, rendererBuilds = 0, draws = 0;
  const gl = new Proxy({
    createProgram() { rendererBuilds++; },
    clear() { draws++; },
    getUniformLocation(_program, name) { return name; },
    uniform3f(name, x, y, z) {
      if (name !== "uCamera") return;
      viewModelPass = x === 0 && y === 0 && z === 0;
      if (!viewModelPass) camera = [x, y, z];
    },
    uniformMatrix4fv(name, _transpose, matrix) {
      if (name === "uViewProjection" && !viewModelPass) direction = [matrix[3], matrix[7], matrix[11]];
    },
    bufferSubData(_target, _offset, vertices) { if (!viewModelPass) actorVertices = vertices; }
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
      getContext(type) { return type === "webgl2" ? gl : null; }
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
    get actorVertices() { return actorVertices; },
    get draws() { return draws; },
    get rendererBuilds() { return rendererBuilds; }
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

test("the boss arena can be won and replayed without touching the sandbox save", t => {
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
    for (let v = 0; v < vertices.length; v += 10) {
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
  assert.equal(storage.getItem(SAVE_KEY), before);
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
  assert.equal(storage.getItem(SAVE_KEY), before);
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
  const game = mountGame({ pointerLock: true });
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
    for (let offset = 0; offset < vertices.length; offset += 10) {
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
