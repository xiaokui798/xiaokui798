import test from "node:test";
import assert from "node:assert/strict";
import { initGame } from "./game.js";

// Batch 97: the ?ts=N test-only clock speed hook in game.js.  The mount
// harness below is game.test.mjs's, copied so this file can pass a page
// URL search string; the hook pins are at the bottom.  The sun and
// daylight uniforms are a pure function of dayTime, which accumulates
// nothing but frame dt — so identical dt sequences must land on
// identical uniforms, and a scaled clock must land where an unscaled
// clock lands after proportionally more frame time.

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

function mountGame({ pointerLock = false, storage, now = () => performance.now(), search } = {}) {
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
  if (search !== undefined) window.location = { search };
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

function runClock({ search, stepMs, frames }) {
  const game = mountGame({ pointerLock: true, search });
  game.click("build-button");
  game.grantPointerLock();
  let time = 0;
  for (let i = 0; i < frames; i++) game.frame(time += stepMs);
  return game;
}

test("timescale hook: no parameter (or an invalid one) leaves the clock untouched", () => {
  const base = runClock({ stepMs: 100, frames: 300 });
  assert.ok(base.sun, "the sun direction uniform is set");
  for (const search of ["", "?ts=1", "?ts=abc", "?ts=0", "?ts=-5", "?other=9"]) {
    const game = runClock({ search, stepMs: 100, frames: 300 });
    assert.deepEqual(game.sun, base.sun, `search ${JSON.stringify(search)} must not move the clock`);
    assert.equal(game.dayFactor, base.dayFactor);
  }
});

test("timescale hook: ?ts=10 runs the game clock ten times faster", () => {
  const plain = runClock({ stepMs: 100, frames: 300 });
  const scaled = runClock({ search: "?ts=10", stepMs: 10, frames: 300 });
  assert.deepEqual(scaled.sun, plain.sun,
    "a tenth of the frame time at ?ts=10 lands on the same sun as the plain clock");
  assert.equal(scaled.dayFactor, plain.dayFactor);
  const unscaled = runClock({ stepMs: 10, frames: 300 });
  const angle = Math.acos(Math.max(-1, Math.min(1,
    unscaled.sun[0] * scaled.sun[0] + unscaled.sun[1] * scaled.sun[1] + unscaled.sun[2] * scaled.sun[2])));
  assert.ok(angle > 0.3, `the scaled sun moved ${angle.toFixed(2)} rad past the unscaled one`);
});
