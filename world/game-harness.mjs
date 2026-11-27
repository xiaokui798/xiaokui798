// Shared headless harness for the game tests (batch 107): the fake
// DOM / WebGL stub and mountGame(), extracted verbatim from
// game.test.mjs so game.test.mjs and defense-e2e.test.mjs drive
// the game through one identical fixture — no duplicated copies
// to drift apart. Test-side only; the game never imports this.

import assert from "node:assert/strict";
import { initGame } from "./game.js";
import { PROGRESS_KEY } from "./progression.mjs";

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

export function mountGame({ pointerLock = false, storage, now = () => performance.now() } = {}) {
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
      value: 0, textContent: "", style: { setProperty: noop },
      children: [],
      append(...nodes) { this.children.push(...nodes); },
      focus: noop, setAttribute: noop,
      replaceChildren(...nodes) { this.children.length = 0; this.children.push(...nodes); },
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

// Shared save/scenario builders and combat steering helpers, moved
// verbatim from game.test.mjs (batch 108) — used by several test files.

export function seedProgress(storage, progress) {
  storage.setItem(PROGRESS_KEY, JSON.stringify({ version: 1, wave: 0, kills: 0,
    bossesDefeated: {}, defense: { wave: 0, cleared: false, bestWave: 0 }, ...progress }));
}

export function sharedStorage(data = new Map()) {
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

export function nearestZombieVertex(game) {
  const vertices = game.actorVertices;
  if (!vertices?.length) return null;
  let best = null, bestD = Infinity;
  for (let v = 0; v < vertices.length; v += 12) {
    const dx = vertices[v] - game.camera[0], dz = vertices[v + 2] - game.camera[2];
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = { x: vertices[v], y: vertices[v + 1], z: vertices[v + 2] }; }
  }
  // Before a wave spawns (or after it clears) the buffer holds stale
  // data from another mesh, sometimes at sentinel distances — a
  // "nearest" that far away is not a zombie.
  if (!best || bestD > 30 * 30) return null;
  // Aim at the cluster's mean height, not the corner's: the nearest
  // vertex can be a foot, and a ray to it passes under the body box.
  let ySum = 0, yCount = 0;
  for (let v = 0; v < vertices.length; v += 12) {
    if (Math.hypot(vertices[v] - best.x, vertices[v + 2] - best.z) > 1.5) continue;
    ySum += vertices[v + 1];
    yCount++;
  }
  return { x: best.x, y: yCount ? ySum / yCount : best.y, z: best.z, distance: Math.sqrt(bestD) };
}

// Turn the view toward a vertex, pitch included (clamped, so a foot
// vertex cannot dive the view into the ground).

export function steerTowardVertex(game, { x, y, z }) {
  const dx = x - game.camera[0], dz = z - game.camera[2];
  const turn = Math.atan2(dx, -dz) - Math.atan2(game.direction[0], -game.direction[2]);
  const dist = Math.hypot(dx, dz);
  const desiredPitch = Math.max(-0.55, Math.min(0.35, Math.atan2(y - game.camera[1], dist)));
  const currentPitch = Math.asin(Math.max(-1, Math.min(1, game.direction[1])));
  const clamp = radians => Math.max(-65, Math.min(65, radians / .0013));
  game.document.emit("mousemove", {
    movementX: clamp(Math.atan2(Math.sin(turn), Math.cos(turn))),
    movementY: clamp(-(desiredPitch - currentPitch))
  });
}

// Close with the nearest zombie and swing. Since the deletion the
// roster's base kind is ranged — a spitter holds its distance and
// never walks into sword reach — so the standing sweep above finds
// nothing; this driver walks the player to the zombie instead.
// Returns true when a swing produced a hit message.

export function swingAtNearestZombie(game, frame) {
  game.get("message").textContent = "";
  let holding = false;
  let lastX = game.camera[0], lastZ = game.camera[2], stillFrames = 0, closeFrames = 0;
  for (let i = 0; i < 3000; i++) {
    if (game.get("crosshair").classList.contains("on-target")) {
      if (holding) { game.release("KeyW"); holding = false; }
      game.get("game").emit("mousedown", { button: 0 });
      frame();
      for (let j = 0; j < 25; j++) frame();
      if (game.get("message").textContent) return true;
      continue;
    }
    const target = nearestZombieVertex(game);
    if (!target) { frame(); continue; }
    // Stuck against terrain (the camera stops while W is held):
    // hop and strafe off the lip, then resume the approach.
    if (Math.hypot(game.camera[0] - lastX, game.camera[2] - lastZ) > .05) {
      lastX = game.camera[0]; lastZ = game.camera[2]; stillFrames = 0;
    } else if (holding && ++stillFrames > 30) {
      game.key("Space");
      game.key("KeyD");
      for (let j = 0; j < 15; j++) frame();
      game.release("Space");
      game.release("KeyD");
      stillFrames = 0;
      continue;
    }
    // Adjacent but never on target (a height gap or the zombie just
    // off-axis): fall back to the standing sweep's rotate-scan.
    if (target.distance < 1.8 && ++closeFrames > 40) {
      if (holding) { game.release("KeyW"); holding = false; }
      for (let j = 0; j < 80; j++) {
        if (game.get("crosshair").classList.contains("on-target")) break;
        game.document.emit("mousemove", { movementX: 600, movementY: 0 });
        frame();
      }
      closeFrames = 0;
      continue;
    }
    steerTowardVertex(game, target);
    if (!holding) { game.key("KeyW"); holding = true; }
    frame();
  }
  if (holding) game.release("KeyW");
  return false;
}

export function v5SaveWithSeeds(seeds = { wheatSeed: 5, wheat: 0 }, crops = {}, materials = [0, 0, 10, 0, 2, 0]) {
  return JSON.stringify({ version: 5, edits: [], materials, axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 }, rareMaterials: { emberCore: 0, starShard: 0 },
    equipment: { weapon: null, armor: null, tool: null }, techUnlocked: [], workbenchBuilt: false,
    stats: { blocksMined: 0, cropsPlanted: 0, cropsHarvested: 0 }, seeds, crops });
}

// Aim the player down at the ground in front of the spawn and return the
// aimed soil cell, settled (the same settle the mining tests use: 60
// frames for the landing dip, then look down, then 5 frames of stability).

export function v5SaveForCooking({ workbenchBuilt = true, techUnlocked = [], dressings = {}, hunger = 100 } = {}) {
  return JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 10, 10, 10], axeUnlocked: false, hunger,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0, ...dressings },
    rareMaterials: { emberCore: 0, starShard: 0 },
    equipment: { weapon: null, armor: null, tool: null }, techUnlocked, workbenchBuilt,
    stats: { blocksMined: 0, cropsPlanted: 0, cropsHarvested: 0 },
    seeds: { wheatSeed: 0, wheat: 6, fertilizer: 0 }, crops: {} });
}

export function takeHitsUntil(game, frame, target) {
  const hp = () => Number(game.get("health-value").textContent);
  for (let i = 0; i < 3000 && game.get("death-screen").hidden && hp() > target; i++) frame();
  assert.equal(game.get("death-screen").hidden, true, "the player must survive the beating");
  assert.ok(hp() <= target && hp() > 0, `health must drop to ${target} or below (now ${hp()})`);
  return hp();
}

// Eat one dish from the backpack tab and close the bag again.
