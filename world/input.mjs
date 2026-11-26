// Input wiring split out of game.js (batch 56, split piece 5).
// This module owns the raw event layer — keyboard, mouse buttons,
// drag look on the canvas, the wheel, the sensitivity slider — and
// the held-keys table and drag state that come with it. It produces
// INTENT only: every effect (heal, plant, open the bag, fire) is an
// injected action executed by game.js, and every fact it needs
// about the game (paused? bag open? which fight?) arrives in the
// getState() snapshot taken at the top of each event, so the
// dispatch order below is the game's, read fresh per event.
//
// The pointer-lock lifecycle itself (requesting, the lock attempt,
// suspending on loss) stays in game.js with setMouseMode; this
// module only feeds it: mousemove while locked, drag while not.
// Touch needs no separate layer: the pointer events below are the
// touch path, as before.

import { LOOK_SENSITIVITY_KEY } from "./save.mjs";
import { CROPS } from "./crops.mjs";

export function createInput({ document, canvas, storage, mouseLook, sensitivitySlider, sensitivityValue, getState, actions }) {
  // The held-keys table: written by the key handlers below, read by
  // game.js's movement through held(), cleared through clearKeys()
  // when the game pauses. One table, owned here.
  const keys = new Set();

  document.addEventListener("keydown", event => {
    const state = getState();
    if (state.started && event.code === "KeyM" && !event.repeat) {
      actions.toggleSound();
      return;
    }
    if (state.inventoryOpen && (event.code === "Escape" || (event.code === "KeyC" && !event.repeat))) {
      event.preventDefault();
      // Esc and C both go straight back to the game when the bag was opened
      // from play; when opened from the pause menu both go back there.
      actions.closeInventory(state.inventoryFromPlay);
      return;
    }
    if (state.sowMode && event.code === "Escape") { actions.exitSowMode(); return; }
    if (event.code === "Escape" && (state.mouseMode !== "paused" || state.lockPending)) {
      actions.suspendGame();
      return;
    }
    if (state.mouseMode === "paused") return;
    if (!event.repeat) actions.wakeAudio();
    if (state.colossusFight && (event.code === "Digit1" || event.code === "Digit4")) {
      actions.colossusSkill(event.code, event.repeat);
      return;
    }
    if (event.code === "KeyR" && !event.repeat && state.gunSelected) { actions.rechargePulse(); return; }
    if (event.code === "KeyC" && !event.repeat) { actions.openInventory(); return; }
    if (event.code === "KeyH" && !event.repeat) { actions.healWithDressing(); return; }
    if (event.code === "KeyE" && !event.repeat) { actions.repairBeacon(); return; }
    if (event.code === "KeyF" && !event.repeat) { actions.plantKey(); return; }
    if (event.code === "KeyG" && !event.repeat) { actions.fertilize(); return; }
    if (event.code === "KeyJ" && !event.repeat) { actions.water(); return; }
    if (event.code === "KeyB" && !event.repeat && state.beaconWaiting) { actions.skipCountdown(); return; }
    if (event.code === "KeyT" && !event.repeat && !state.bossPresent) { actions.cycleWeather(); return; }
    keys.add(event.code);
    if (event.code.startsWith("Arrow")) event.preventDefault();
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) actions.bufferJump();
    }
    if (event.code.startsWith("Digit")) actions.selectSlot((Number(event.code.slice(5)) || 10) - 1);
  });
  document.addEventListener("keyup", event => keys.delete(event.code));

  // The look-sensitivity slider: live on input, persisted on change
  // under save.mjs's key (imported, never copied).
  function updateLookControl() {
    const current = mouseLook.sensitivity;
    sensitivitySlider.value = String(current);
    sensitivitySlider.setAttribute("aria-valuetext", `${current}%`);
    sensitivityValue.value = `${current}%`;
  }

  sensitivitySlider.addEventListener("input", () => {
    mouseLook.setSensitivity(sensitivitySlider.value);
    updateLookControl();
  });
  sensitivitySlider.addEventListener("change", () => {
    try { storage?.setItem(LOOK_SENSITIVITY_KEY, String(mouseLook.sensitivity)); } catch { /* Session-local settings still work. */ }
  });

  document.addEventListener("mousemove", event => {
    if (getState().mouseMode === "locked" && document.pointerLockElement === canvas) mouseLook.push(event.movementX, event.movementY, "locked");
  });

  canvas.addEventListener("mousedown", event => {
    const state = getState();
    if (!state.started || !state.playerAlive || (event.button !== 0 && event.button !== 2)) return;
    if (state.mouseMode === "paused") return;
    actions.wakeAudio();
    // Sow mode (farm tab): a right-click cancels the mode instead of
    // placing a block; a left-click plants when the aim is plantable,
    // and otherwise cancels the mode and falls through to the normal
    // action so the mode never swallows a click. A failed plant attempt
    // (no seed, already planted, save conflict) spends the click and
    // keeps the mode armed — the message says why. Click planting needs
    // the pointer lock; in drag mode the click only starts a drag, and
    // F still plants.
    if (state.sowMode) {
      if (event.button === 2) { actions.exitSowMode(); return; }
      if (event.button === 0 && state.mouseMode === "locked") {
        const cropId = Object.keys(CROPS).find(id => CROPS[id].seed === state.sowSeed) ?? "wheat";
        const status = actions.plantSeed(cropId);
        if (status === "planted") { actions.exitSowMode(); return; }
        if (["no-target", "not-grass", "blocked"].includes(status)) actions.exitSowMode();
        else return;
      }
    }
    if (state.mouseMode === "locked" && event.button === 0 && state.gunSelected) actions.setFiring(true);
    if (state.mouseMode === "locked" && event.button === 0) actions.setMouseHeld(true);
    if (state.mouseMode === "locked" || event.button === 2) actions.interact(event.button === 2);
  });
  document.addEventListener("mouseup", event => {
    if (event.button === 0) { actions.setFiring(false); actions.setMouseHeld(false); }
    if (event.button === 2) actions.releasePulse();
  });

  // Drag look: the drag object lives here; game.js's frame loop
  // reads it through getDrag() for the hold-to-fire timing, and
  // setMouseMode cancels it through cancelDrag().
  let drag = null;

  function cancelDrag() {
    if (!drag) return;
    const { pointerId } = drag;
    drag = null;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  canvas.addEventListener("pointerdown", event => {
    if (getState().mouseMode !== "drag" || event.button !== 0 || drag) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, fired: false, holdTime: 0 };
    canvas.setPointerCapture(event.pointerId);
  });

  function trackDrag(event) {
    if (drag?.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    mouseLook.push(dx, dy, "drag");
  }

  canvas.addEventListener("pointermove", trackDrag);
  canvas.addEventListener("pointerup", event => {
    if (drag?.pointerId !== event.pointerId || event.button !== 0) return;
    trackDrag(event);
    const clicked = !drag.moved && !drag.fired;
    actions.setFiring(false);
    cancelDrag();
    if (clicked && getState().mouseMode === "drag") {
      actions.wakeAudio();
      actions.interact(false);
    }
  });
  for (const type of ["pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, event => {
      if (drag?.pointerId === event.pointerId) { actions.setFiring(false); actions.setMouseHeld(false); cancelDrag(); }
    });
  }

  canvas.addEventListener("wheel", event => {
    const state = getState();
    if (state.mouseMode === "paused" || event.deltaY === 0) return;
    event.preventDefault();
    const first = state.wheelFirst, slots = state.wheelSlots;
    actions.selectSlot(first + (state.selected - first + Math.sign(event.deltaY) + slots) % slots);
  }, { passive: false });
  canvas.addEventListener("contextmenu", event => event.preventDefault());

  return {
    held: code => keys.has(code),
    clearKeys: () => keys.clear(),
    getDrag: () => drag,
    cancelDrag,
    updateLookControl
  };
}
