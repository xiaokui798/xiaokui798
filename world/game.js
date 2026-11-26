import { BLOCK, RECIPES, HEALING_KEYS, COOKING_KEYS, BOSS_DROPS, RARE_MATERIALS, SAVE_KEY, PREVIOUS_SAVE_KEY, LEGACY_KEY, createProgression } from "./progression.mjs";
import { LOOK_SENSITIVITY_KEY, applyBlockEdits, mergeRunProgressRecord, saveImportFailureReason } from "./save.mjs";
import { createHud } from "./hud.mjs";
import { createInventoryUi, BUFF_LABELS } from "./inventory-ui.mjs";
import { createBossRender } from "./boss-render.mjs";
import { createInput } from "./input.mjs";
import { WORLD, CHUNK_SIZE, FACES as faces, contains, voxelIndex, voxelPosition,
  seeded, generateTerrain, createChunkGrid, distanceSquared, buildChunkMesh,
  ATLAS_TILES, atlasTileFor, faceUV,
  crackStage, crackPolylines, faceCorners, createBurst, stepParticles,
  POP_DURATION, popScale, dayCycle, fogDensityForRange, DAY_LENGTH } from "./terrain.mjs";
import { ENEMIES, DEFENSE_WAVES, DEFENSE_TOTAL_WAVES, BEACON, choosesBeacon, defenseWaveRoster, selectWaveSpawns, repairPlan, defenseResult, defenseCleared,
  actorRay, findMeleeTarget, zombieParts, beaconParts } from "./defense.mjs";
import { survivalRoster, scaledHp } from "./difficulty.mjs";
import { WEAPONS, weaponBase } from "./weapons.mjs";
import { armorReduction } from "./armor.mjs";
import { miningInterval } from "./tools.mjs";
import { TECH, TECH_EFFECTS, canUnlockTech, techConditions, techDisplayOrder, techForRecipe, techLockReason } from "./tech.mjs";
import { durabilityMax, repairCost } from "./durability.mjs";
import { CROPS, FARM_MATERIALS, isMature } from "./crops.mjs";
import { createMouseLook } from "./controls.mjs";
import { PHYSICS_STEP, LANDING_SAMPLE_TIME, createSpeedReadout, overlapsPlayerBlock, stepPlayer } from "./movement.mjs";
import { ARENA_PALETTE, BOSS, GUARDIAN_WAVES, COLOSSUS, BAR_COLORS, BOSS_ATTACKS, buildBossTerrain, createBossFight, advanceBoss, strikeBoss, guardianBackOpen, interruptFurnace, damagePrism, damageTurret,
  bossParts, posedGuardian, forgeStageParts, posedColossus, insideHazard, modelFaces, modelHit, pulseViewModel, meleeViewModel, dragonImpact, bossBar } from "./boss.mjs";

import { renderForgeCue } from "./forge-audio.mjs";

export function initGame(window) {
  const { document, performance } = window;
  const canvas = document.querySelector("#game");
  const startScreen = document.querySelector("#start-screen");
  const startButton = document.querySelector("#start-button");
  const defenseButton = document.querySelector("#defense-button");
  const bossButton = document.querySelector("#boss-button");
  const colossusButton = document.querySelector("#colossus-button");
  const bossHud = document.querySelector("#boss-hud");
  const bossName = document.querySelector("#boss-name");
  const bossHealthValue = document.querySelector("#boss-health-value");
  const bossCallout = document.querySelector("#boss-callout");
  const bossWarning = document.querySelector("#boss-warning");
  const bossSkills = document.querySelector("#boss-skills");
  const bossSkillHeal = document.querySelector("#boss-skill-heal");
  const bossSkillDragons = document.querySelector("#boss-skill-dragons");
  const bossHealthTrack = document.querySelector("#boss-health-track");
  const bossPhaseBanner = document.querySelector("#boss-phase-banner");
  const menuStatus = document.querySelector("#menu-status");
  const buildButton = document.querySelector("#build-button");
  const soundButton = document.querySelector("#sound-button");
  const pauseSoundButton = document.querySelector("#pause-sound-button");
  const speedToggleButton = document.querySelector("#speed-toggle-button");
  const hud = document.querySelector("#hud");
  const pause = document.querySelector("#pause");
  const resumeButton = document.querySelector("#resume-button");
  const pauseMenuButton = document.querySelector("#pause-menu-button");
  const pauseNote = document.querySelector("#pause-note");
  const pauseInventoryButton = document.querySelector("#pause-inventory-button");
  const reloadSaveButton = document.querySelector("#reload-save-button");
  const saveWarning = document.querySelector("#save-warning");
  const graphicsWarning = document.querySelector("#graphics-warning");
  const sensitivitySlider = document.querySelector("#look-sensitivity");
  const sensitivityValue = document.querySelector("#look-sensitivity-value");
  const coordinates = document.querySelector("#coordinates");
  const currentSpeed = document.querySelector("#speed-current");
  const jumpSpeed = document.querySelector("#speed-jump");
  const landingSpeedLabel = document.querySelector("#speed-landing-label");
  const landingSpeedValue = document.querySelector("#speed-landing");
  const message = document.querySelector("#message");
  const hotbar = document.querySelector("#hotbar");
  const lookHint = document.querySelector("#look-hint");
  const fxCanvas = document.querySelector("#effects");
  const fx = fxCanvas.getContext("2d");
  const health = document.querySelector("#health");
  const healthValue = document.querySelector("#health-value");
  const vitals = document.querySelector("#vitals");
  const weaponState = document.querySelector("#weapon-state");
  const weaponLabel = document.querySelector("#weapon-label");
  const weaponRecovery = document.querySelector("#weapon-recovery");
  const pulseInfo = document.querySelector("#pulse-info");
  const pulseHint = document.querySelector("#pulse-hint");
  const waveStatus = document.querySelector("#wave-status");
  const stageTime = document.querySelector("#stage-time");
  const defenseHud = document.querySelector("#defense-hud");
  const beaconHealth = document.querySelector("#beacon-health");
  const beaconHealthValue = document.querySelector("#beacon-health-value");
  const beaconBearing = document.querySelector("#beacon-bearing");
  const defenseActions = document.querySelector("#defense-actions");
  const weatherStatus = document.querySelector("#weather-status");
  const targetStatus = document.querySelector("#target-status");
  const crosshair = document.querySelector("#crosshair");
  const deathScreen = document.querySelector("#death-screen");
  const deathTitle = document.querySelector("#death-title");
  const deathSummary = document.querySelector("#death-summary");
  const respawnButton = document.querySelector("#respawn-button");
  const deathMenuButton = document.querySelector("#death-menu-button");
  const inventoryScreen = document.querySelector("#inventory-screen");
  const inventoryResume = document.querySelector("#inventory-resume");
  const inventoryMaterials = document.querySelector("#inventory-materials");
  const inventoryNotice = document.querySelector("#inventory-notice");
  const inventoryDressings = document.querySelector("#inventory-dressings");
  const hudDressings = document.querySelector("#hud-dressings");
  const survivalSupplies = document.querySelector("#survival-supplies");
  const craftDressingButton = document.querySelector("#craft-dressing");
  const useDressingButton = document.querySelector("#use-dressing");
  const dressingCost = document.querySelector("#dressing-cost");

  // The inventory / workbench UI (inventory-ui.mjs, split piece 3)
  // builds the inventory screen's dynamic DOM here — healing rows,
  // tab panels, workbench list, tech tree, repair and farm rows, the
  // sow hint — and owns its refresh. The actions it wires its buttons
  // to stay in this file (they move game state); the module calls
  // them through the injected actions object.
  const inventoryUi = createInventoryUi({
    document,
    base: { inventoryMaterials, inventoryDressings, dressingCost, craftDressingButton, useDressingButton },
    buffLabels: BUFF_LABELS,
    actions: { craftItem, healWithDressing, unlockTech, repairEquipment, enterSowMode,
      onEquipStateClick: slot => {
        const piece = campaign.equipment[slot];
        if (piece && piece.durability <= 0) inventoryUi.selectInventoryTab("workbench");
      } },
    refresh: () => updateInventory()
  });
  // The food-buff HUD lines (R5): one per buff kind, placed directly
  // under the weapon state row in a real DOM (the harness stub has no
  // `after`, so there they just register by id, like the sow hint).
  // Same small print as the supplies row, inline for the same reason.
  const buffLines = {};
  {
    let anchor = weaponState;
    for (const kind of ["speed", "attack"]) {
      const line = document.querySelector(`#hud-buff-${kind}`) ?? (() => {
        const el = document.createElement("div");
        el.id = `hud-buff-${kind}`;
        return el;
      })();
      line.setAttribute("style", "margin: 0 0 .42rem; color: #e2e8f7; font-size: .75rem;");
      line.hidden = true;
      if (anchor && typeof anchor.after === "function") anchor.after(line);
      else document.querySelector("#hud")?.append?.(line);
      anchor = line;
      buffLines[kind] = line;
    }
  }
  // The HUD write-out layer (hud.mjs, split piece 2): this file
  // decides what the HUD says; hud.mjs owns writing it to the DOM.
  const hudUi = createHud({ hud, bossHud, bossName, bossHealthValue, bossHealthTrack,
    bossCallout, bossWarning, bossPhaseBanner, bossSkills, bossSkillHeal, bossSkillDragons,
    waveStatus, coordinates, message, buffLines, document },
    { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) });
  const showMessage = hudUi.showMessage;

  // Establish the initial tab state explicitly (the panels' hidden flags
  // in the markup are the browser default; the harness reads the flags
  // this call sets, so both agree the backpack tab is open).
  inventoryUi.selectInventoryTab("backpack");

  // Save export/import lives in the pause menu, built here because
  // index.html is not touched by this change: a second menu-actions row
  // with an export button, an import button, the hidden file input the
  // import reads, the hidden anchor the export downloads through, and a
  // status line for the import result.
  const saveActions = document.querySelector("#save-actions") ?? (() => {
    const actions = document.createElement("div");
    actions.id = "save-actions";
    actions.className = "menu-actions";
    resumeButton.parentElement?.after?.(actions);
    return actions;
  })();
  saveActions.innerHTML = `
    <button id="export-save-button" class="secondary-button" type="button">导出存档</button>
    <button id="import-save-button" class="secondary-button" type="button">导入存档</button>
    <input id="import-save-file" type="file" accept="application/json,.json" hidden>
    <a id="export-save-link" hidden download="block-world-save.json"></a>
    <p id="save-io-note" class="menu-note" role="status"></p>`;
  const exportSaveButton = document.querySelector("#export-save-button");
  const importSaveButton = document.querySelector("#import-save-button");
  const importSaveFile = document.querySelector("#import-save-file");
  const exportSaveLink = document.querySelector("#export-save-link");
  const saveIoNote = document.querySelector("#save-io-note");

  function exportSaveFile() {
    // Pause already flushed (setMouseMode), so the download matches the
    // save on disk; flush again so an export right after building does
    // too. The link carries the save as a data URL, so the download
    // needs no Blob or object URL.
    campaign.flush?.();
    exportSaveLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(campaign.exportSave())}`;
    exportSaveLink.download = "block-world-save.json";
    exportSaveLink.click?.();
    setText(saveIoNote, "存档已导出");
  }
  exportSaveButton.addEventListener("click", exportSaveFile);

  importSaveButton.addEventListener("click", () => importSaveFile.click?.());
  importSaveFile.addEventListener("change", async () => {
    const file = importSaveFile.files?.[0];
    if (!file) return;
    let text;
    try { text = await file.text(); } catch {
      setText(saveIoNote, "导入失败：读取文件失败");
      importSaveFile.value = "";
      return;
    }
    const result = campaign.importSave(text);
    if (!result.imported) {
      const reason = saveImportFailureReason(result.reason);
      setText(saveIoNote, `导入失败：${reason ?? "未知原因"}`);
      importSaveFile.value = "";
      return;
    }
    importSaveFile.value = "";
    // Rebuild the world from the imported save (the next start would
    // pick it up anyway, but the menu backdrop should not keep showing
    // the old blocks), then go back to the menu.
    loadLatestSave(true);
    returnToMenu();
  });
  const gl = canvas.getContext("webgl2", { antialias: true });

  if (!gl) {
    startButton.disabled = defenseButton.disabled = bossButton.disabled = colossusButton.disabled = buildButton.disabled = soundButton.disabled = true;
    menuStatus.hidden = false;
    menuStatus.textContent = "图形渲染需要启用 WebGL 2 的浏览器。";
    return;
  }

  const { minX, minZ, width: W, height: H, depth: D } = WORLD;
  const maxX = minX + W, maxZ = minZ + D;
  const renderDistance = 26;
  const prefetchDistance = renderDistance + CHUNK_SIZE / 4;
  const chunkGrid = createChunkGrid(WORLD);
  const chunkMeshes = new Map();
  let nearbyChunks = [], chunkAnchorX, chunkAnchorZ;
  const maxRenderPixels = 2300000;
  const firstWaveDelay = 14;
  const spawnView = { yaw: -.52, pitch: -.14 };
  const { AIR, GRASS, DIRT, STONE, WOOD, LEAF } = BLOCK;
  const blockNames = ["", "草方块", "泥土", "石头", "木头", "树叶"];
  const blockColors = [
    [0, 0, 0], [0.29, 0.60, 0.22], [0.49, 0.30, 0.16],
    [0.43, 0.46, 0.43], [0.48, 0.29, 0.12], [0.22, 0.47, 0.18], ...ARENA_PALETTE
  ];
  const palette = [GRASS, DIRT, STONE, WOOD, LEAF];
  // Every weapon number lives in weapons.mjs: the hotbar slots hold
  // registry references, never literals. Slots 6/7 are the sword and
  // axe; refreshWeapons() swaps in a crafted weapon for its base slot
  // (a crafted sword replaces the stone sword, a crafted axe the stone
  // axe), so the slot count and the boss guns never move.
  const pulseWeapon = WEAPONS.pulseWeapon;
  const pulseBurst = WEAPONS.pulseBurst;
  const weapons = [
    WEAPONS.stoneSword,
    WEAPONS.stoneAxe,
    pulseWeapon,
    WEAPONS.rapid,
    WEAPONS.cannon
  ];
  const punch = WEAPONS.punch;
  const interactionReach = 7;
  const slotCount = palette.length + weapons.length;
  const isGun = weapon => weapon && ["pulse", "rapid", "cannon"].includes(weapon.style);
  let firing = false;
  const weatherTypes = [
    { name: "晴朗", sky: [.52, .73, .78], fog: [16, 25], light: 1, rain: 0, seconds: 30 },
    { name: "薄雾", sky: [.56, .65, .62], fog: [5, 16], light: .82, rain: 0, seconds: 22 },
    { name: "降雨", sky: [.30, .39, .45], fog: [8, 22], light: .68, rain: 1, seconds: 27 }
  ];
  const weather = { index: 0, elapsed: 0, sky: [...weatherTypes[0].sky], fog: [...weatherTypes[0].fog], light: 1, rain: 0, phase: 0 };
  // Day clock, seconds into the 240s cycle.  The game starts mid-morning
  // (30s in) so the first impression is the familiar bright day; dusk
  // arrives about a minute and a half later.  Boss arenas ignore it — they
  // keep their own fixed sky and light.
  let dayTime = 30;
  const homeWorld = generateTerrain(WORLD, BLOCK);
  const arenaWorlds = new Map();
  let world = homeWorld, boss = null;
  // Boss health ghost (batch 48): the white segment on the boss bar
  // that trails real damage, draining to the new value over 0.6s so
  // the size of a hit reads on the bar itself.
  let bossGhostHp = 0, bossGhostRate = 0;
  // Ground decals (batch 49): short-lived dark marks a boss attack
  // leaves on the arena floor — slam crack rings, impact scorch,
  // the rift's torn strip, the phase-shift shock ring. Presentation
  // only; they age in advanceWorld and draw in drawActors.
  const groundDecals = [];
  // Boss impact bursts live in their own particle list (batch 49):
  // the shared particles3D uploads after the actor pass, and boss
  // bursts are far too frequent to ride that slot — these draw
  // before the actors instead. Stepped with stepParticles.
  const bossParticles = [];
  // The windup-end pose's ghost, kept for 0.12s after a strike.
  // Phase-change show state (batch 49): the last phase updateStatus
  // saw, and the banner it is currently holding up.
  let bossPhaseSeen = 0, phaseBanner = null;
  let storage;
  try { storage = window.localStorage; } catch { /* A blocked store does not prevent play. */ }
  const sensitivityKey = LOOK_SENSITIVITY_KEY;
  let savedSensitivity;
  try { savedSensitivity = storage?.getItem(sensitivityKey); } catch { /* Use the default. */ }
  const mouseLook = createMouseLook(savedSensitivity);
  let campaign = createProgression(storage, WORLD);
  const sound = createWorldAudio();
  let selected = 0;
  const pulse = { rounds: pulseWeapon.capacity, recharge: 0, charge: null, chargeStarted: 0, shot: null };
  let actorMesh, viewModelMesh, skyMesh, rainMesh;
  let started = false, lastTime = null;
  let finished = false;
  let mouseMode = "paused";
  let lockAttempt = null;
  let saveConflict = false;
  // Progress v1 record (S4): the last progress this tab loaded or merged.
  // Loaded at startWorld, merged at finishRun, and shown in the wave
  // status between waves. Null until the first startWorld.
  let savedProgress = null;
  // The boss this run defeated, if any; merged into savedProgress at
  // finishRun. Cleared at every startWorld.
  let runBossDefeated = null;
  // The merged record for the run that just finished. Cached so a stale
  // choice at the death screen can force-save the same merge instead of
  // merging the run's kills twice. Cleared at every startWorld.
  let mergedProgress = null;
  // { title, summary, action } while the death screen is asking whether
  // to keep this run's progress or adopt the other tab's. The two death
  // screen buttons answer it (respawn = keep, menu = adopt); both are
  // intercepted while this is set.
  let pendingProgressChoice = null;
  let inventoryFromPlay = false;
  let graphicsLost = false;
  let { yaw, pitch } = spawnView;
  let jumpBuffer = 0;
  let movementTime = 0;
  let previousEye = null, renderedView = null;
  let sceneDirty = true;
  const speedReadout = createSpeedReadout();
  let stepDistance = 0;
  let landDip = 0;
  let fovBoost = 0;
  // Floating damage numbers and block-break debris, both in world space.
  const damageNumbers = [];
  const debris = [];
  // 3D particle cubes (death debris, landing dust), also in world space.
  // They share one array and one mesh; the helpers in terrain.mjs own the
  // spawn/step maths, this file only decides when a burst happens.
  const particles3D = [];
  let particleMesh;
  let burstCounter = 0;
  // Placement pops: one entry per freshly placed block, aged out after
  // 0.12s.  The chunk already holds the block at full size, so the pop is
  // a scaled overlay box drawn on top of it (see drawPops).
  const pops = [];
  let popMesh;
  // Planted crops: one entry per crop in the campaign's crops field,
  // drawn as their own mesh (see drawCrops) — a crop is not a block, so
  // it never goes through the chunk mesh.
  let cropMesh;

  function floorUnder(x, y, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let yy = Math.min(H - 1, Math.floor(y)); yy >= 0; yy--) {
      if (get(cx, yy, cz)) return yy + 1;
    }
    return 0;
  }

  function spawnBurst3D(x, y, z, count, options) {
    particles3D.push(...createBurst(x, y, z, count, { ...options, seed: ++burstCounter * 7919 }));
    if (particles3D.length > 160) particles3D.splice(0, particles3D.length - 160);
  }
  let mouseHeld = false, mouseHeldRepeat = 0;
  let effectsVisible = false;
  // These are presentation-only impulses.  Keeping them out of the fight
  // state means the timing and hit rules stay deterministic while the boss
  // can still have a proper sense of weight on every beat.
  const guardianFx = { charge: 0, strike: 0, exposed: 0, hit: 0, kind: null };
  const blockSprites = new Map();
  const blockActionTime = .18;
  const player = { x: 16.5, y: 10, z: 16.5, vx: 0, vy: 0, vz: 0, grounded: false, hp: 100, hurt: 0,
    cooldown: 0, recoveryTime: 1, hitConfirm: 0, swing: 0, handAction: 0, invulnerable: 0, attackBuffered: false };
  // Food buffs (R5): runtime only, never written to the save — a
  // reload starts with both empty. Eating the same kind again only
  // refreshes the timer (the percent never stacks); the two kinds run
  // independently. The clock is game time, ticked in advanceWorld, so
  // a paused game does not burn a buff down.
  const buffs = {
    speed: { pct: 0, remaining: 0 },
    attack: { pct: 0, remaining: 0 }
  };
  function applyBuff(buff) {
    if (!buff) return;
    buffs[buff.kind] = { pct: buff.pct, remaining: buff.seconds };
  }
  function activeBuff(kind) {
    return buffs[kind].remaining > 0 ? buffs[kind] : null;
  }
  const survival = { enabled: false, wave: 0, kills: 0, countdown: firstWaveDelay, zombies: [], projectiles: [],
    routes: new Int32Array(world.length), recalc: 0, goal: -1, routesDirty: true };
  const defense = { beacon: null, routes: null, seconds: 0, elapsed: 0, victory: false };

  function createWorldAudio() {
    const preferenceKey = "block-world:sound:v1";
    const masterVolume = .72;
    const surfaces = {
      [GRASS]: { filterHz: 940, pitchHz: 105 },
      [DIRT]: { filterHz: 460, pitchHz: 90 },
      [STONE]: { filterHz: 1750, pitchHz: 205 },
      [WOOD]: { filterHz: 680, pitchHz: 155 },
      [LEAF]: { filterHz: 2600, pitchHz: 125 }
    };
    const effects = {
      ready: { seconds: .28, noiseGain: .035, toneGain: .24, pitch: 3.4, endPitch: 1.28 },
      step:  { seconds: .13, noiseGain: .25, toneGain: .07, pitch: 1.15, endPitch: .64 },
      jump:  { seconds: .09, noiseGain: .12, toneGain: .025, pitch: 1, endPitch: 1.40 },
      land:  { seconds: .16, noiseGain: .29, toneGain: .085, pitch: .86, endPitch: .53 },
      break: { seconds: .23, noiseGain: .34, toneGain: .050, pitch: 1.13, endPitch: .58 },
      place: { seconds: .12, noiseGain: .16, toneGain: .120, pitch: .97, endPitch: .54 },
      swing: { seconds: .15, noiseGain: .25, toneGain: .025, pitch: 1.6, endPitch: .36 },
      hit: { seconds: .21, noiseGain: .36, toneGain: .21, pitch: 1.25, endPitch: .48 },
      hurt: { seconds: .24, noiseGain: .27, toneGain: .20, pitch: .96, endPitch: .36 },
      defeat: { seconds: .34, noiseGain: .26, toneGain: .13, pitch: .84, endPitch: .32 },
      "boss-charge": { seconds: .48, noiseGain: .12, toneGain: .22, pitch: .48, endPitch: 2.45 },
      "boss-strike": { seconds: .39, noiseGain: .48, toneGain: .30, pitch: .70, endPitch: .36 },
      "forge-sweep": { seconds: .32, noiseGain: .40, toneGain: .07, pitch: 1.35, endPitch: .48, band: 780, endBand: 3400 },
      "forge-flare": { seconds: .42, noiseGain: .32, toneGain: .12, pitch: 1.7, endPitch: 1.85, band: 2700, endBand: 850 },
      "forge-ram": { seconds: .54, noiseGain: .20, toneGain: .32, pitch: .39, endPitch: 3.4, band: 390, endBand: 1050 },
      "forge-ring": { seconds: .34, noiseGain: .28, toneGain: .36, pitch: .95, endPitch: .34, band: 1250, endBand: 440 },
      "forge-echo": { seconds: .48, noiseGain: .33, toneGain: .40, pitch: .65, endPitch: .38, band: 920, endBand: 240 },
      "boss-exposed": { seconds: .32, noiseGain: .08, toneGain: .19, pitch: 2.2, endPitch: 1.38 },
      // A rising pair of tones reads as the guardian changing furnace modes,
      // while a bright, short ping rewards a hit during the real damage window.
      "boss-shift": { seconds: .58, noiseGain: .18, toneGain: .30, pitch: .52, endPitch: 2.65 },
      "core-hit": { seconds: .20, noiseGain: .10, toneGain: .24, pitch: 3.15, endPitch: 1.72 },
      "boss-move": { seconds: .34, noiseGain: .14, toneGain: .17, pitch: 1.1, endPitch: .62 },
      "pulse-shot": { seconds: .16, noiseGain: .25, toneGain: .20, pitch: 2.65, endPitch: .42 },
      "pulse-windup": { seconds: .58, noiseGain: .04, toneGain: .14, pitch: .8, endPitch: 3.1 },
      "pulse-ready": { seconds: .15, noiseGain: .02, toneGain: .19, pitch: 4.5, endPitch: 3.7 },
      "pulse-burst": { seconds: .30, noiseGain: .37, toneGain: .33, pitch: 1.9, endPitch: .24 },
      "pulse-crystal": { seconds: .41, noiseGain: .36, toneGain: .26, pitch: 4.4, endPitch: 1.32 },
      "pulse-recharge": { seconds: .22, noiseGain: .04, toneGain: .15, pitch: 1.6, endPitch: 1.75 }
    };
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    let context, output, noiseBuffer, rainGain, pendingEffect;
    const samples = new Map();
    const gunLayers = {
      "rapid-fire": [["impactMetal_001", .52, 1.24, 0, .071], ["laserSmall_003", .24, .86, .006, .088]],
      "cannon-fire": [["explosionCrunch_002", .78, .94, 0, .96], ["lowFrequency_explosion_001", .58, .82, .022, .93],
        ["impactMetal_001", .22, .72, .082, .16], ["explosionCrunch_002", .15, .73, .157, .57]]
    };
    function preloadGunAudio(audioContext) {
      samples.clear();
      for (const file of new Set(Object.values(gunLayers).flat().map(layer => layer[0]))) {
        window.fetch("./assets/" + file + ".ogg").then(response => {
          if (!response.ok) throw Error(response.statusText);
          return response.arrayBuffer();
        }).then(bytes => audioContext.decodeAudioData(bytes)).then(buffer => {
          if (context === audioContext) samples.set(file, buffer);
        }).catch(() => {}); // The synthesized shot covers loading or unavailable audio.
      }
    }
    let rainLevel = 0, roar;
    function setRoar(on) {
      if (on && (!enabled || !output || context.state !== "running")) return;
      if (Boolean(roar) === Boolean(on)) return;
      const now = context.currentTime;
      if (!on) {
        roar.gain.gain.setTargetAtTime(0, now, .035);
        for (const voice of roar.voices) voice.stop(now + .18);
        const ending = roar;
        ending.voices[0].onended = () => ending.nodes.forEach(node => node.disconnect());
        roar = null;
        return;
      }
      const wind = context.createBufferSource(), bass = context.createOscillator();
      const beat = context.createOscillator(), modulation = context.createGain();
      const filter = context.createBiquadFilter(), gain = context.createGain();
      wind.buffer = noiseBuffer;
      wind.loop = true;
      filter.type = "lowpass";
      filter.frequency.value = 780;
      wind.connect(filter).connect(gain);
      bass.type = "triangle";
      bass.frequency.value = 49;
      bass.connect(gain);
      beat.frequency.value = 3.2;
      modulation.gain.value = 18;
      beat.connect(modulation).connect(bass.frequency);
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(.30, now, .075);
      gain.connect(output);
      const voices = [wind, bass, beat];
      for (const voice of voices) voice.start();
      roar = { gain, voices, nodes: [...voices, modulation, gain, filter] };
    }
    let enabled = true;
    const available = typeof AudioContext === "function";
    try { enabled = storage?.getItem(preferenceKey) !== "off"; } catch { /* Optional preference. */ }

    function syncState() {
      updateSoundButton();
      if (!enabled || context?.state !== "running" || !pendingEffect) return;
      const { name, material, expires } = pendingEffect;
      pendingEffect = undefined;
      if (performance.now() <= expires) play(name, material);
    }

    function activate(preview = false) {
      if (!enabled || !available) return;
      try {
        if (!context || context.state === "closed") {
          context = new AudioContext();
          context.addEventListener("statechange", syncState);
          output = context.createGain();
          output.gain.value = masterVolume;
          output.connect(context.destination);
          if (window.fetch) preloadGunAudio(context);
          rainGain = undefined;
          rainLevel = 0;
          noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
          const samples = noiseBuffer.getChannelData(0);
          for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        }
        if (preview) play("ready", WOOD);
        if (context.state !== "running") context.resume().then(syncState, syncState);
      } catch {
        output = undefined;
        context?.close().catch(() => {});
        context = undefined;
      }
      syncState();
    }

    function setEnabled(value, remember = true) {
      if (!value) setRoar(false);
      enabled = value;
      pendingEffect = undefined;
      if (output) output.gain.setTargetAtTime(enabled ? masterVolume : 0, context.currentTime, .012);
      if (remember) {
        try { storage?.setItem(preferenceKey, enabled ? "on" : "off"); } catch { /* Optional preference. */ }
        if (enabled) activate(true);
      }
    }

    window.addEventListener("storage", event => {
      if (event.storageArea !== storage || (event.key !== preferenceKey && event.key !== null)) return;
      setEnabled(event.newValue !== "off", false);
      updateSoundButton();
    });

    function setRain(value) {
      if (!output || context.state !== "running") return;
      const target = value < .008 ? 0 : value;
      if (rainLevel === target || (target > 0 && Math.abs(target - rainLevel) < .008)) return;
      if (!rainGain && value > 0) {
        const source = context.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 1750;
        rainGain = context.createGain();
        rainGain.gain.value = 0;
        source.connect(filter);
        filter.connect(rainGain);
        rainGain.connect(output);
        source.start();
      }
      rainLevel = target;
      rainGain?.gain.setTargetAtTime(target * .15, context.currentTime, .12);
    }

    function connectEnvelope(source, gain, now, duration) {
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(.0001, now);
      envelope.gain.linearRampToValueAtTime(gain, now + .006);
      envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
      source.connect(envelope);
      envelope.connect(output);
    }

    const shotBuffers = new Map();
    const forgeBuffers = new Map();
    function playGun(name) {
      const layers = gunLayers[name];
      if (layers?.every(([file]) => samples.has(file))) {
        const now = context.currentTime, variation = .94 + Math.random() * .12;
        const heavy = name === "cannon-fire";
        // A short downward sweep gives the attack weight even on small speakers.
        const body = context.createOscillator(), bodyGain = context.createGain();
        const decay = heavy ? .34 : .078;
        body.frequency.setValueAtTime((heavy ? 151 : 218) * variation, now);
        body.frequency.exponentialRampToValueAtTime(heavy ? 49 : 101, now + decay * .70);
        bodyGain.gain.setValueAtTime(.0001, now);
        bodyGain.gain.exponentialRampToValueAtTime(heavy ? .46 : .37, now + .003);
        bodyGain.gain.exponentialRampToValueAtTime(.0001, now + decay);
        body.connect(bodyGain).connect(output);
        body.onended = () => { body.disconnect(); bodyGain.disconnect(); };
        body.start(now);
        body.stop(now + decay);
        for (const [file, volume, rate, delay, tail] of layers) {
          const voice = context.createBufferSource(), envelope = context.createGain();
          voice.buffer = samples.get(file);
          voice.playbackRate.value = rate * variation;
          const start = now + delay, end = start + Math.min(tail, voice.buffer.duration / voice.playbackRate.value);
          envelope.gain.setValueAtTime(volume, start);
          envelope.gain.setValueAtTime(volume, start + (end-start)*.62);
          envelope.gain.exponentialRampToValueAtTime(.0001, end);
          voice.connect(envelope).connect(output);
          voice.onended = () => { voice.disconnect(); envelope.disconnect(); };
          voice.start(start); voice.stop(end);
        }
        return;
      }
      const heavy = name === "cannon-fire", rapid = name === "rapid-fire";
      const rate = context.sampleRate;
      const key = name + rate + Math.floor(Math.random() * 3);
      let buffer = shotBuffers.get(key);
      if (!buffer) {
        const duration = heavy ? .85 : rapid ? .16 : .33;
        buffer = context.createBuffer(1, Math.ceil(rate * duration), rate);
        const samples = buffer.getChannelData(0);
        let low = 0, middle = 0, previous = 0, phase = 0;
        const pitch = (heavy ? 57 : rapid ? 143 : 96) * (.94 + Math.random()*.12);
        const echo = Math.round(rate * (heavy ? .089 : .039));
        for (let i = 0; i < samples.length; i++) {
          const t = i / rate, noise = Math.random()*2-1;
          low += (noise-low) * (1-Math.exp(-2*Math.PI*380/rate));
          middle += (noise-middle) * (1-Math.exp(-2*Math.PI*2200/rate));
          phase += 2*Math.PI*pitch*(1+1.9*Math.exp(-t*48))/rate;
          const crack = (noise-previous)*.30*Math.exp(-t*(rapid ? 230 : 140));
          const body = (.52*Math.sin(phase)+1.8*low)*Math.exp(-t*(heavy ? 8 : 32));
          const latch = t-(rapid ? .052 : .11);
          const action = latch < 0 ? 0 : (middle+.19*Math.sin(latch*5200))*Math.exp(-latch*105);
          const blast = middle*Math.exp(-t*(heavy ? 10 : 43));
          const reflection = i >= echo ? samples[i-echo]*(heavy ? .29 : .16) : 0;
          samples[i] = Math.tanh(crack+body+action+blast+reflection)*Math.min(1,t*3200,(duration-t)*120);
          previous = noise;
        }
        shotBuffers.set(key,buffer);
      }
      const shot = context.createBufferSource();
      const level = context.createGain();
      level.gain.value = heavy ? .82 : rapid ? .48 : .62;
      shot.buffer = buffer;
      shot.playbackRate.value = .97+Math.random()*.06;
      shot.connect(level).connect(output);
      shot.onended = () => { shot.disconnect(); level.disconnect(); };
      shot.start();
    }

    function play(name, material) {
      if (!enabled || !context || !output) return;
      if (context.state !== "running") {
        if (pendingEffect?.name !== "ready" || name === "ready" || pendingEffect.expires < performance.now()) {
          pendingEffect = { name, material, expires: performance.now() + (name === "ready" ? 1400 : 320) };
        }
        return;
      }
      if (name.endsWith("-fire")) { playGun(name); return; }
      if (!effects[name]) {
        let buffer = forgeBuffers.get(name);
        if (!buffer) {
          const pcm = renderForgeCue(name, context.sampleRate);
          if (!pcm) return;
          buffer = context.createBuffer(1, pcm.length, context.sampleRate);
          buffer.getChannelData(0).set(pcm);
          forgeBuffers.set(name, buffer);
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(output);
        source.onended = () => source.disconnect();
        source.start();
        return;
      }
      const { seconds, noiseGain, toneGain, pitch, endPitch, band, endBand } = effects[name];
      const { filterHz, pitchHz } = surfaces[material] ?? surfaces[DIRT];
      const now = context.currentTime;
      const variation = .87 + Math.random() * .26;
      const noise = context.createBufferSource();
      noise.buffer = noiseBuffer;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime((band ?? filterHz) * variation, now);
      if (endBand) filter.frequency.exponentialRampToValueAtTime(endBand * variation, now + seconds);
      filter.Q.value = .65;
      noise.connect(filter);
      connectEnvelope(filter, noiseGain, now, seconds);
      noise.start(now, Math.random() * .6);
      noise.stop(now + seconds);

      const tone = context.createOscillator();
      tone.type = material === WOOD || material === STONE ? "triangle" : "sine";
      const startHz = pitchHz * pitch * variation;
      tone.frequency.setValueAtTime(startHz, now);
      tone.frequency.exponentialRampToValueAtTime(startHz * endPitch, now + seconds * .6);
      connectEnvelope(tone, toneGain, now, seconds * .62);
      tone.start(now);
      tone.stop(now + seconds * .62);
    }

    return { activate, play, setEnabled, setRain, setRoar, available,
      get enabled() { return enabled; }, get playing() { return Boolean(output && context.state === "running"); } };
  }

  const vertexSource = `#version 300 es
    precision highp float;
    in vec3 aPosition;
    in vec3 aColor;
    in vec4 aFace;
    in vec2 aUV;
    uniform mat4 uViewProjection;
    uniform vec3 uCamera;
    out vec3 vColor;
    out float vDistance;
    out vec3 vPosition;
    out vec2 flameUV;
    out vec2 vUV;
    out vec3 metalNormal;
    flat out vec4 vFace;
    void main() {
      vColor = aColor;
      vDistance = distance(aPosition, uCamera);
      vPosition = aPosition;
      vFace = aFace;
      flameUV = aFace.xy;
      vUV = aUV;
      metalNormal = aFace.xyz;
      gl_Position = uViewProjection * vec4(aPosition, 1.0);
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    in vec3 vColor;
    in float vDistance;
    in vec3 vPosition;
    in vec2 flameUV;
    in vec2 vUV;
    in vec3 metalNormal;
    flat in vec4 vFace;
    uniform vec3 uTarget;
    uniform vec3 uSky;
    uniform vec3 uCamera;
    uniform float uFogDensity;
    uniform vec3 uSun;
    uniform float uDay;
    uniform float uLight;
    uniform vec4 uFurnace;
    uniform float uTime;
    uniform sampler2D uAtlas;
    uniform float uUseAtlas;
    out vec4 outColor;
    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    void main() {
      if (vFace.w == -13.0) {
        // 3D rain streak: a translucent pale quad, blended over the scene.
        outColor = vec4(vColor, 0.45);
        return;
      }
      if (vFace.w == -12.0) {
        // Sky dome: gradient by view direction (warm horizon, cool zenith),
        // a sun disc with a soft glow, and slow value-noise clouds that
        // drift with uTime.  The dome is a cube around the camera, so
        // vPosition - uCamera is the view direction for every sky pixel.
        vec3 dir = normalize(vPosition - uCamera);
        float h = clamp(dir.y, -1.0, 1.0);
        vec3 horizon = mix(uSky, vec3(1.0, 0.80, 0.52), 0.30 * uDay);
        vec3 zenith = mix(uSky * 0.82, vec3(0.16, 0.40, 0.78), 0.55 * uDay);
        vec3 skyCol = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
        skyCol = mix(skyCol, uSky * 0.55, smoothstep(0.0, -0.25, h));
        vec3 sunDir = uSun;
        float sunAmt = max(dot(dir, sunDir), 0.0);
        skyCol += vec3(1.0, 0.85, 0.55) * pow(sunAmt, 350.0) * 1.4;
        skyCol += vec3(1.0, 0.75, 0.40) * pow(sunAmt, 8.0) * 0.18;
        if (h > 0.03) {
          vec2 cuv = dir.xz / (h + 0.18) * 0.55 + vec2(uTime * 0.008, uTime * 0.003);
          float cl = vnoise(cuv) * 0.6 + vnoise(cuv * 2.13) * 0.28 + vnoise(cuv * 4.31) * 0.12;
          float cover = smoothstep(0.52, 0.72, cl) * smoothstep(0.03, 0.12, h) * 0.55;
          skyCol = mix(skyCol, vec3(0.96, 0.97, 1.0) * (0.25 + 0.75 * uDay), cover);
        }
        outColor = vec4(skyCol, 1.0);
        return;
      }
      if (vFace.w == -8.0 || vFace.w == -9.0) {
        float radius = dot(flameUV, flameUV);
        float glow = max(0.0, 1.0-radius);
        float fade = smoothstep(1.0, 3.2, vDistance);
        outColor = vec4(vColor * glow * glow * fade * 0.68, 1.0);
        return;
      }
      if (vFace.w == -11.0) {
        float river = .52 + .48 * sin(uTime * 4.0 + vPosition.x * 3.7 - vPosition.z * 2.4);
        float grain = fract(sin(dot(floor(vPosition * 9.0), vec3(12.91, 37.31, 8.17))) * 1537.21);
        vec3 magma = mix(vec3(.22, .006, .001), vec3(1.0, .12, .006), river * (.72 + grain * .28));
        outColor = vec4(magma, 1.0);
        return;
      }
      if (vFace.w == -10.0) {
        float shimmer = .82 + .18 * sin(uTime * 9.0 + vPosition.y * 6.0 + vPosition.x * 2.0);
        outColor = vec4(vColor * (1.35 + shimmer * .95), 1.0);
        return;
      }
      vec3 interior = vPosition - vFace.xyz * 0.001;
      vec3 pixel = floor(interior * 16.0);
      float grain = fract(sin(dot(pixel, vec3(37.17, 23.53, 17.91))) * 4271.75);
      vec3 color = vColor;
      // Terrain faces (w >= 0) get the procedural atlas: the tiles are
      // detail modulation around white, so they speckle the vertex colour
      // instead of replacing it.  Grass side faces keep their dirt band,
      // now driven by the tile's v instead of world height, so the fringe
      // lines up with the painted tile.  When no atlas could be built
      // (uUseAtlas == 0) the old flat-colour path below runs unchanged.
      if (vFace.w >= 0.0 && uUseAtlas > 0.5) {
        vec3 tex = texture(uAtlas, vUV).rgb;
        color *= tex * 1.15;
        if (vFace.w > 0.0) {
          float dirtBand = smoothstep(0.28, 0.38, vUV.y);
          color = mix(color, vec3(0.49, 0.30, 0.16) * vFace.w * tex * 1.6, dirtBand);
        }
      }
      if (vFace.w == -6.0 || vFace.w == -7.0) {
        vec3 n = normalize(metalNormal);
        if (vFace.w == -7.0) color *= .55 + .44*max(dot(n,vec3(-.38,.79,.48)),0.0);
        vec3 eye = normalize(-vPosition);
        vec3 halfVector = normalize(eye + vec3(-.48,.75,.45));
        float highlight = pow(max(dot(n, halfVector),0.0),24.0);
        float rim = pow(1.0-clamp(dot(n,eye),0.0,1.0),3.0);
        color += vec3(.67,.74,.81)*highlight + vec3(.10,.14,.17)*rim;
      }
      // The forge is a local light source, not a red filter over the entire
      // scene.  Stone close to the guardian catches a live orange rim while
      // the far wall can stay in smoke and shadow.
      vec3 furnaceDelta = vPosition - uFurnace.xyz;
      float furnaceDistance = dot(furnaceDelta, furnaceDelta);
      float furnacePulse = .86 + .14 * sin(uTime * 7.0 + vPosition.x * 1.7 + vPosition.z * 1.2);
      float furnaceGlow = min(.88, uFurnace.w * furnacePulse / (1.0 + furnaceDistance * .19));
      color += vec3(.34, .035, .004) * furnaceGlow;
      if (vFace.w > 0.0 && uUseAtlas < 0.5 && fract(vPosition.y) < 0.75 + 0.10 * grain) {
        color = vec3(0.49, 0.30, 0.16) * vFace.w;
      }
      if (vFace.w >= 0.0) color *= 0.89 + 0.21 * grain;
      // Squared-distance fog: 1 - exp(-(density * distance)^2).  Fog used
      // to be a linear smoothstep between two ranges; the squared falloff
      // keeps nearby blocks crisp and thickens faster far away, the way
      // real haze does.  Fog fades to uSky, so it takes the sky's colour.
      float amount = 1.0 - exp(-uFogDensity * uFogDensity * vDistance * vDistance);
      vec3 uv = fract(vPosition);
      vec3 edges = min(uv, 1.0 - uv) + abs(vFace.xyz);
      // Target block outline: a bright frame on every visible face of the
      // aimed block, so the faces together read as one complete box.  The
      // old version only darkened the same pixels, which was easy to miss
      // against dark stone.
      if (all(equal(floor(interior), uTarget)) && min(edges.x, min(edges.y, edges.z)) < 0.045) {
        color = mix(color, vec3(1.0, 0.85, 0.35), 0.85);
      }
      outColor = vec4(mix(color * uLight, uSky, amount), 1.0);
    }`;

  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  }
  let program, positionLocation, colorLocation, faceLocation, uvLocation, viewProjectionLocation, cameraLocation,
    targetLocation, skyLocation, fogDensityLocation, sunLocation, dayLocation, lightLocation, furnaceLocation, timeLocation, atlasLocation, useAtlasLocation;
  let atlasTexture = null, atlasDetailed = false;

  // Procedural 16x16-per-tile atlas, nine tiles in a row: grass top, grass
  // side, dirt, stone, wood, leaf, mossy stone, cracked stone, flower.
  // Every tile is detail modulation around white (see terrain.mjs): the
  // shader multiplies it onto the vertex colour, so a tile must never carry
  // the block colour itself.  Any failure — no 2D context, no texture, a
  // thrown GL call — returns { texture: null, detailed: false } and the
  // caller falls back to a 1x1 white texture with uUseAtlas off, i.e. the
  // previous flat rendering.  The noise is deterministic (seeded) so the
  // atlas is identical every run.
  function createBlockAtlas() {
    const paint = (ctx, tile, draw) => {
      const x0 = tile * 16;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const [r, g, b] = draw(x, y);
        ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        ctx.fillRect(x0 + x, y, 1, 1);
      }
    };
    const speckle = (x, y, salt, base, dark) => {
      const n = seeded(x * 3 + salt, y * 5 + salt * 7);
      return n > .93 ? dark : base.map(v => v * (.86 + n * .22));
    };
    try {
      const atlas = document.createElement("canvas");
      atlas.width = 144; atlas.height = 16;
      const ctx = atlas.getContext("2d");
      if (!ctx) return { texture: null, detailed: false };
      paint(ctx, 0, (x, y) => speckle(x, y, 11, [.80, .98, .78], [.52, .74, .52])); // grass top
      paint(ctx, 1, (x, y) => y < 4 + Math.floor(seeded(x, 3) * 2)
        ? speckle(x, y, 11, [.80, .98, .78], [.52, .74, .52])
        : speckle(x, y, 23, [.95, .85, .70], [.68, .58, .46])); // grass side
      paint(ctx, 2, (x, y) => speckle(x, y, 23, [.95, .85, .70], [.66, .55, .42])); // dirt
      paint(ctx, 3, (x, y) => { // stone: grey speckle plus dark cracks
        const crack = seeded(x, y * 3 + 5) > .965 || seeded(x * 2 + 9, y) > .975;
        return crack ? [.52, .54, .56] : speckle(x, y, 31, [.84, .86, .88], [.60, .62, .64]);
      });
      paint(ctx, 4, (x, y) => { // wood: vertical bark stripes
        const stripe = seeded(x, 77) > .72 ? [.62, .48, .32] : speckle(x, y, 41, [.96, .80, .58], [.70, .55, .38]);
        return stripe;
      });
      paint(ctx, 5, (x, y) => speckle(x, y, 53, [.74, .96, .68], [.42, .64, .38])); // leaf
      paint(ctx, 6, (x, y) => { // mossy stone: grey stone with green moss patches
        const moss = seeded(x * 2 + 7, y * 3 + 13) > .78;
        return moss ? [.58, .82, .55] : speckle(x, y, 31, [.84, .86, .88], [.60, .62, .64]);
      });
      paint(ctx, 7, (x, y) => { // cracked stone: grey speckle plus heavier dark cracks
        const crack = seeded(x * 3 + 5, y + 7) > .93 || seeded(x + 11, y * 2 + 3) > .94;
        return crack ? [.42, .44, .46] : speckle(x, y, 31, [.84, .86, .88], [.60, .62, .64]);
      });
      paint(ctx, 8, (x, y) => { // flower: pale leaf with bright petal dots
        const n = seeded(x * 5 + 3, y * 7 + 1);
        if (n > .9) return [.99, .93, .72]; // pale yellow blossom
        if (n > .82) return [.98, .98, .95]; // white blossom
        return speckle(x, y, 53, [.82, .97, .76], [.55, .72, .48]);
      });
      const texture = gl.createTexture();
      if (!texture) return { texture: null, detailed: false };
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return { texture, detailed: true };
    } catch {
      return { texture: null, detailed: false };
    }
  }

  function createWhiteTexture() {
    try {
      const texture = gl.createTexture();
      if (!texture) return null;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return texture;
    } catch {
      return null;
    }
  }

  function initRenderer() {
    program = gl.createProgram();
    const vertex = shader(gl.VERTEX_SHADER, vertexSource), fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    positionLocation = gl.getAttribLocation(program, "aPosition");
    colorLocation = gl.getAttribLocation(program, "aColor");
    faceLocation = gl.getAttribLocation(program, "aFace");
    uvLocation = gl.getAttribLocation(program, "aUV");
    viewProjectionLocation = gl.getUniformLocation(program, "uViewProjection");
    cameraLocation = gl.getUniformLocation(program, "uCamera");
    targetLocation = gl.getUniformLocation(program, "uTarget");
    skyLocation = gl.getUniformLocation(program, "uSky");
    fogDensityLocation = gl.getUniformLocation(program, "uFogDensity");
    sunLocation = gl.getUniformLocation(program, "uSun");
    dayLocation = gl.getUniformLocation(program, "uDay");
    lightLocation = gl.getUniformLocation(program, "uLight");
    furnaceLocation = gl.getUniformLocation(program, "uFurnace");
    timeLocation = gl.getUniformLocation(program, "uTime");
    atlasLocation = gl.getUniformLocation(program, "uAtlas");
    useAtlasLocation = gl.getUniformLocation(program, "uUseAtlas");
    // Rebuilt on context restore too, so a lost context never leaves the
    // terrain sampling a texture from the old context.
    const atlas = createBlockAtlas();
    atlasTexture = atlas.texture ?? createWhiteTexture();
    atlasDetailed = atlas.detailed;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.viewport(0, 0, canvas.width, canvas.height);
    chunkMeshes.clear();
    actorMesh = viewModelMesh = skyMesh = rainMesh = particleMesh = popMesh = undefined;
    bossRender.resetMeshes();
    sceneDirty = true;
  }

  function index(x, y, z) { return voxelIndex(WORLD, x, y, z); }
  function inside(x, y, z) { return contains(WORLD, x, y, z); }
  function get(x, y, z) { return inside(x, y, z) ? world[index(x, y, z)] : STONE; }
  function set(x, y, z, type) {
    if (!inside(x, y, z)) return;
    const i = index(x, y, z);
    world[i] = type;
    // A mined or replaced cell loses its generation variant, so a block
    // placed where a flower or ruin stone stood renders with its own tile.
    if (world.variants) world.variants[i] = 0;
  }

  function loadEdits() {
    applyBlockEdits(homeWorld, campaign.blockEdits());
  }

  function selectTerrain() {
    if (boss && !arenaWorlds.has(boss.profile)) arenaWorlds.set(boss.profile, buildBossTerrain(boss.profile, WORLD));
    const next = boss ? arenaWorlds.get(boss.profile) : homeWorld;
    if (next === world) return;
    world = next;
    for (const mesh of chunkMeshes.values()) {
      gl.deleteVertexArray(mesh.vao);
      gl.deleteBuffer(mesh.vertices);
      gl.deleteBuffer(mesh.indices);
    }
    chunkMeshes.clear();
    sceneDirty = true;
  }

  function placePlayerAtSpawn() {
    Object.assign(player, { x: 16.5, z: 16.5, vx: 0, vy: 0, vz: 0, grounded: false });
    speedReadout.reset();
    previousEye = renderedView = null;
    sceneDirty = true;
    if (boss) {
      const { x, floor, spawnZ } = boss.profile.arena;
      Object.assign(player, { x, y: floor, z: spawnZ, grounded: true });
      return true;
    }
    for (let y = H - 1; y >= 0; y--) {
      if (!get(16, y, 16)) continue;
      // If a tower reaches the ceiling, choose the nearest free two-block column.
      if (y + 2 < H) { player.y = y + 1.01; return true; }
      break;
    }
    let nearest = Infinity, spawn = null;
    for (let x = minX; x < maxX; x++) for (let z = minZ; z < maxZ; z++) {
      const distance = (x - 16) ** 2 + (z - 16) ** 2;
      if (distance >= nearest) continue;
      const cell = groundCell(x, H - 2, z);
      if (cell < 0) continue;
      nearest = distance;
      spawn = cellPosition(cell);
    }
    if (!spawn) return false;
    Object.assign(player, { x: spawn[0] + .5, y: spawn[1] + .01, z: spawn[2] + .5 });
    return true;
  }

  function uploadChunk(chunk) {
    // The chunk mesh reads the generation variants off the active world, so
    // ruin stones and flowers get their tiles; arena worlds carry no
    // variants record and fall back to the plain tile for the block type.
    const { vertices, indices } = buildChunkMesh(WORLD, chunk, get, blockColors,
      { grass: GRASS, leaf: LEAF, dirt: DIRT, stone: STONE, wood: WOOD },
      (x, y, z) => world.variants ? world.variants[voxelIndex(WORLD, x, y, z)] : 0);
    let mesh = chunkMeshes.get(chunk.id);
    if (!mesh) {
      mesh = { chunk, vao: gl.createVertexArray(), vertices: gl.createBuffer(), indices: gl.createBuffer(), count: 0, dirty: true };
      chunkMeshes.set(chunk.id, mesh);
    }
    gl.bindVertexArray(mesh.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertices);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    bindVertexLayout();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    mesh.count = indices.length;
    mesh.dirty = false;
  }

  function invalidateChunks(x, z) {
    for (const chunk of chunkGrid.affected(x, z)) {
      const mesh = chunkMeshes.get(chunk.id);
      if (mesh) mesh.dirty = true;
    }
    sceneDirty = true;
  }

  function prepareTerrain(budget) {
    const x = Math.floor(player.x), z = Math.floor(player.z);
    if (x !== chunkAnchorX || z !== chunkAnchorZ) {
      chunkAnchorX = x; chunkAnchorZ = z;
      nearbyChunks = chunkGrid.nearby(x, z, prefetchDistance);
      const keepDistance = renderDistance + CHUNK_SIZE;
      for (const [id, mesh] of chunkMeshes) {
        if (distanceSquared(mesh.chunk, x, z) <= keepDistance * keepDistance) continue;
        gl.deleteVertexArray(mesh.vao);
        gl.deleteBuffer(mesh.vertices);
        gl.deleteBuffer(mesh.indices);
        chunkMeshes.delete(id);
      }
    }
    for (const chunk of nearbyChunks) {
      const mesh = chunkMeshes.get(chunk.id);
      if (mesh && !mesh.dirty) continue;
      uploadChunk(chunk);
      if (--budget === 0) return true;
    }
    return false;
  }

  // Sky dome: a cube around the camera, drawn first so nearer terrain
  // overwrites it.  Its faces carry marker -12, so the shader shades them
  // by view direction (gradient + sun + clouds) instead of as blocks.
  // Boss arenas keep their flat sky: a sun and drifting clouds would read
  // wrong inside the furnace and the sky court.
  // Rain as world-space streaks: thin vertical quads billboarded around
  // Y, in a field centred on the player, so they stay with the player as
  // they move and vanish where the terrain occludes them.  Drawn after the
  // actors with blending on and depth writes off, so a streak never hides
  // a zombie behind it and never z-fights the ground.
  // 3D particle cubes: one small box per particle, built into a shared
  // mesh each frame like the forge floor.  UVs point at the middle of the
  // stone atlas tile, whose detail is near-grey, so a cube keeps its own
  // colour instead of picking up a grass tint from tile 0.  Cubes shrink
  // and dim slightly as they age, then stepParticles removes them at 0.6s.
  // The boss bursts' own draw pass (batch 49): same cube maths as
  // drawParticles3D, but on the private list and mesh, drawn before
  // the actor pass.
  // Boss rendering (boss-render.mjs, split piece 4): the boss's
  // draw functions live there; this file keeps the fight itself.
  const bossRender = createBossRender({ gl, createActorMesh, uploadActorMesh, appendModel });

  function drawParticles3D() {
    if (!particles3D.length) return;
    particleMesh ??= createActorMesh(256);
    const { vertices } = particleMesh;
    let used = 0;
    for (const p of particles3D) {
      if (used + 288 > vertices.length) break;
      const fade = 1 - 0.55 * (p.age / p.life);
      for (const { d, v, light } of faces) {
        for (const corner of v) {
          vertices[used++] = p.x + (corner[0] - 0.5) * p.size;
          vertices[used++] = p.y + (corner[1] - 0.5) * p.size;
          vertices[used++] = p.z + (corner[2] - 0.5) * p.size;
          vertices[used++] = p.color[0] * light * fade;
          vertices[used++] = p.color[1] * light * fade;
          vertices[used++] = p.color[2] * light * fade;
          vertices[used++] = d[0];
          vertices[used++] = d[1];
          vertices[used++] = d[2];
          vertices[used++] = 0;
          vertices[used++] = 7 / 12;
          vertices[used++] = 0.5;
        }
      }
    }
    uploadActorMesh(particleMesh, used);
  }

  // Placement pop: a box at the placed cell, scaled 0.9 -> 1 over 0.12s,
  // using the same per-face colours, light and atlas UVs as the chunk mesh
  // so it looks like the block itself growing, not a coloured ghost.  The
  // chunk already drew this block at full size, so a smaller pop box would
  // be hidden inside it with the depth test on; the pop is drawn on top
  // instead (no depth test, no depth writes).  At 0.12s the only cost is
  // that a pop can show through a wall for a blink, and at scale 1 it
  // coincides with the real block, so removing it is invisible.
  function drawPops() {
    if (!pops.length) return;
    popMesh ??= createActorMesh(96);
    const { vertices } = popMesh;
    let used = 0;
    for (const pop of pops) {
      if (used + 288 > vertices.length) break;
      const scale = popScale(pop.age);
      const color = blockColors[pop.type];
      const cx = pop.x + 0.5, cy = pop.y + 0.5, cz = pop.z + 0.5;
      for (const { d, v, light } of faces) {
        const tile = atlasTileFor(pop.type, d, { grass: GRASS, leaf: LEAF, dirt: DIRT, stone: STONE, wood: WOOD });
        const grassSide = pop.type === GRASS && d[1] === 0 ? light : 0;
        const shade = light * (pop.type === LEAF ? .92 : 1);
        for (const corner of v) {
          const [fu, fv] = faceUV(d, corner);
          vertices[used++] = cx + (corner[0] - 0.5) * scale;
          vertices[used++] = cy + (corner[1] - 0.5) * scale;
          vertices[used++] = cz + (corner[2] - 0.5) * scale;
          vertices[used++] = color[0] * shade;
          vertices[used++] = color[1] * shade;
          vertices[used++] = color[2] * shade;
          vertices[used++] = d[0];
          vertices[used++] = d[1];
          vertices[used++] = d[2];
          vertices[used++] = grassSide;
          vertices[used++] = (tile + fu) / ATLAS_TILES;
          vertices[used++] = fv;
        }
      }
    }
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    uploadActorMesh(popMesh, used);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  // Crops (R2): one small box per planted crop, drawn from the
  // campaign's crops field — a thin box that grows taller and turns from
  // pale green to gold as it matures. Follows the pop mesh (the same
  // per-face colours and LEAF atlas tile), one mesh rebuilt each frame.
  // The mesh holds 256 quads (42 crops); a field bigger than that draws
  // its first 42 and the rest wait for the next frame — a field that big
  // is a later-round problem, not an R2 one.
  function drawCrops() {
    const entries = Object.entries(campaign.crops);
    if (!entries.length) return;
    cropMesh ??= createActorMesh(256);
    const { vertices } = cropMesh;
    let used = 0;
    const stageColors = [[.55, .75, .35], [.35, .62, .25], [.85, .72, .30]];
    const stageHeights = [.35, .6, .85];
    const width = .5;
    for (const [cell, crop] of entries) {
      if (used + 288 > vertices.length) break;
      const [x, y, z] = voxelPosition(WORLD, Number(cell));
      const height = stageHeights[crop.stage] ?? .35;
      const color = stageColors[crop.stage] ?? stageColors[0];
      const cx = x + .5, cy = y + height / 2, cz = z + .5;
      for (const { d, v, light } of faces) {
        const tile = atlasTileFor(LEAF, d, { grass: GRASS, leaf: LEAF, dirt: DIRT, stone: STONE, wood: WOOD });
        for (const corner of v) {
          const [fu, fv] = faceUV(d, corner);
          vertices[used++] = cx + (corner[0] - .5) * width;
          vertices[used++] = cy + (corner[1] - .5) * height;
          vertices[used++] = cz + (corner[2] - .5) * width;
          vertices[used++] = color[0] * light;
          vertices[used++] = color[1] * light;
          vertices[used++] = color[2] * light;
          vertices[used++] = d[0];
          vertices[used++] = d[1];
          vertices[used++] = d[2];
          vertices[used++] = 0;
          vertices[used++] = (tile + fu) / ATLAS_TILES;
          vertices[used++] = fv;
        }
      }
    }
    uploadActorMesh(cropMesh, used);
  }

  function drawRain3D(rain) {
    if (rain <= .02) return;
    rainMesh ??= createActorMesh(200);
    const { vertices } = rainMesh;
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const count = Math.floor(rainDrops.length * rain);
    const fallHeight = 11;
    let used = 0;
    for (let i = 0; i < count; i++) {
      const drop = rainDrops[i];
      const cycle = (weather.phase * drop.speed + drop.phase) % 1;
      const top = player.y + 7 - cycle * fallHeight;
      const x = player.x + drop.x, z = player.z + drop.z;
      const hw = .02, len = drop.length;
      for (const [side, y] of [[-1, top], [1, top], [1, top - len], [-1, top - len]]) {
        vertices.set([x + rightX * hw * side, y, z + rightZ * hw * side,
          .78, .88, .93, rightX, 0, rightZ, -13, 0, 0], used);
        used += 12;
      }
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    uploadActorMesh(rainMesh, used);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function drawSkyDome(eye, sky) {
    if (boss) return;
    skyMesh ??= createActorMesh(6);
    const { vertices } = skyMesh;
    const R = 70, [ex, ey, ez] = eye;
    let used = 0;
    const quad = (a, b, c, d) => {
      for (const [x, y, z] of [a, b, c, d]) {
        vertices.set([ex + x * R, ey + y * R, ez + z * R, ...sky, 0, 0, 0, -12, 0, 0], used);
        used += 12;
      }
    };
    quad([1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]);
    quad([-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]);
    quad([-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]);
    quad([-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]);
    quad([-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]);
    quad([1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]);
    gl.disable(gl.CULL_FACE); // the camera sits inside the cube
    uploadActorMesh(skyMesh, used);
    gl.enable(gl.CULL_FACE);
  }

  function drawTerrain() {
    sceneDirty = prepareTerrain(3);
    for (const chunk of nearbyChunks) {
      if (distanceSquared(chunk, player.x, player.z) > renderDistance * renderDistance) continue;
      const mesh = chunkMeshes.get(chunk.id);
      if (!mesh?.count) continue;
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return out;
  }
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
  }
  function lookAt(ex, ey, ez, tx, ty, tz) {
    let zx = ex - tx, zy = ey - ty, zz = ez - tz;
    const zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
    let xx = zz, xy = 0, xz = -zx;
    const xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yzv = zx * xy - zy * xx;
    return new Float32Array([xx,yx,zx,0, xy,yy,zy,0, xz,yzv,zz,0, -(xx*ex+xy*ey+xz*ez),-(yx*ex+yy*ey+yzv*ez),-(zx*ex+zy*ey+zz*ez),1]);
  }

  function movePlayer(dt) {
    const lookRate = mouseLook.sensitivity / 40;
    if (input.held("ArrowLeft")) yaw -= 1.9 * lookRate * dt;
    if (input.held("ArrowRight")) yaw += 1.9 * lookRate * dt;
    if (input.held("ArrowUp")) adjustPitch(1.6 * lookRate * dt);
    if (input.held("ArrowDown")) adjustPitch(-1.6 * lookRate * dt);
    const sprinting = input.held("ShiftLeft") || input.held("ShiftRight");
    const oldX = player.x, oldZ = player.z;
    const wasGrounded = player.grounded;
    const takeoffSpeed = wasGrounded && jumpBuffer > 0 ? Math.hypot(player.vx, player.vz) : null;
    const forward = Number(input.held("KeyW")) - Number(input.held("KeyS"));
    const side = Number(input.held("KeyD")) - Number(input.held("KeyA"));
    const solidActor = boss ?? defense.beacon;
    const { radius, height } = boss ? boss.profile : BEACON;
    const obstacle = solidActor && [solidActor.x - radius, solidActor.y, solidActor.z - radius,
      solidActor.x + radius, solidActor.y + height, solidActor.z + radius];
    const speedBuff = activeBuff("speed");
    const { jumped, landingSpeed } = stepPlayer(player, {
      forward, side, yaw, sprint: sprinting, jump: jumpBuffer > 0,
      speedScale: speedBuff ? 1 + speedBuff.pct / 100 : 1
    }, get, obstacle, dt);
    speedReadout.record(Math.hypot(player.vx, player.vz), player.grounded, jumped ? takeoffSpeed : null, dt);
    if (jumped) {
      sound.play("jump", materialUnderfoot());
      jumpBuffer = 0;
    }
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if (player.grounded && !wasGrounded && landingSpeed > 2.6) {
      sound.play("land", materialUnderfoot());
      landDip = Math.min(.09, landingSpeed * .012);
      // Landing dust: a few small tan cubes kicked out at the feet, more
      // of them the harder the landing.  They rest on the ground the
      // player just landed on.
      const dustCount = Math.max(3, Math.min(10, Math.floor(landingSpeed * 1.2)));
      spawnBurst3D(player.x, player.y + 0.06, player.z, dustCount,
        { colors: [[.62, .57, .48], [.55, .50, .42], [.70, .65, .55]],
          speed: 1.4, up: 1.1, size: 0.06, life: 0.45, gravity: 6, floor: player.y });
    }
    if (!player.grounded || !wasGrounded) {
      stepDistance = 0;
      return;
    }
    stepDistance += Math.hypot(player.x - oldX, player.z - oldZ);
    const stride = sprinting ? 2.0 : 1.55;
    if (stepDistance >= stride) {
      stepDistance -= stride;
      sound.play("step", materialUnderfoot());
    }
  }
  function materialUnderfoot() {
    return get(Math.floor(player.x), Math.floor(player.y - .075), Math.floor(player.z));
  }
  function adjustPitch(amount) { pitch = Math.max(-1.48, Math.min(1.48, pitch + amount)); }
  function eye() { return [player.x, player.y + 1.6, player.z]; }
  function viewDirection() { return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]; }
  function raycast(origin = eye(), direction = viewDirection(), reach = interactionReach) {
    const cell = origin.map(Math.floor);
    const step = direction.map(Math.sign);
    const interval = direction.map(component => component === 0 ? Infinity : Math.abs(1 / component));
    const crossing = cell.map((value, axis) => {
      if (!step[axis]) return Infinity;
      const boundary = step[axis] > 0 ? value + 1 : value;
      return (boundary - origin[axis]) / direction[axis];
    });
    let previous = null;
    let distance = 0;
    let face = null;
    while (distance <= reach && inside(...cell)) {
      if (get(...cell)) return { hit: cell, place: previous, distance, face };
      previous = [...cell];
      const axis = crossing.indexOf(Math.min(...crossing));
      distance = crossing[axis];
      // The face the ray entered through: opposite the step just taken.
      face = [0, 0, 0];
      face[axis] = -step[axis];
      cell[axis] += step[axis];
      crossing[axis] += interval[axis];
    }
    return null;
  }

  function bossHasCover() {
    if (!boss || boss.profile !== COLOSSUS) return false;
    const origin = [boss.x, boss.y + 4.1, boss.z];
    const target = [player.x - origin[0], player.y + 1.35 - origin[1], player.z - origin[2]];
    const reach = Math.hypot(...target);
    return reach > .01 && Boolean(raycast(origin, target.map(value => value / reach), reach));
  }

  function standable(x, y, z) {
    return y > 0 && inside(x, y + 1, z) && get(x, y - 1, z) && !get(x, y, z) && !get(x, y + 1, z);
  }

  function groundCell(x, y, z, accept = null) {
    const candidate = height => standable(x, height, z) && (!accept || accept(index(x, height, z)));
    for (let offset = 0; offset < H; offset++) {
      if (candidate(y - offset)) return index(x, y - offset, z);
      if (offset && candidate(y + offset)) return index(x, y + offset, z);
    }
    return -1;
  }

  function cellPosition(cell) {
    return voxelPosition(WORLD, cell);
  }

  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function canStep(x, y, z, toX, toY, toZ) {
    return standable(toX, toY, toZ) && (y === toY
      || (y < toY ? !get(x, y + 2, z) : !get(toX, toY + 2, toZ)));
  }

  function rebuildRoutes(routes, goal) {
    routes.fill(-1);
    if (goal < 0) return;
    const queue = [goal];
    routes[goal] = goal;
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      const [x, y, z] = cellPosition(cell);
      for (const [dx, dz] of neighbors) {
        const nextX = x + dx, nextZ = z + dz;
        for (const dy of [0, 1, -1]) {
          const nextY = y + dy;
          if (!canStep(x, y, z, nextX, nextY, nextZ)) continue;
          const next = index(nextX, nextY, nextZ);
          if (routes[next] !== -1) continue;
          routes[next] = cell;
          queue.push(next);
        }
      }
    }
  }

  function locateBeacon() {
    const origin = eye();
    const direction = viewDirection();
    let best = null, bestScore = -Infinity;
    for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
      const x = Math.floor(player.x) + dx, z = Math.floor(player.z) + dz;
      const distance = Math.hypot(dx, dz);
      if (distance < 2.8 || !inside(x, 1, z)) continue;
      const cell = groundCell(x, Math.round(player.y), z);
      if (cell < 0) continue;
      const y = cellPosition(cell)[1];
      const target = [x + .5 - origin[0], y + 1.4 - origin[1], z + .5 - origin[2]];
      const reach = Math.hypot(...target);
      const visible = !raycast(origin, target.map(value => value / reach), reach);
      const score = (visible ? 12 : 0) - Math.abs(distance - 4) - Math.abs(y - player.y) * 2
        + 3 * (dx * direction[0] + dz * direction[2]) / distance;
      if (score <= bestScore) continue;
      bestScore = score;
      best = { x: x + .5, y, z: z + .5, cell, hp: BEACON.hp, hurt: 0 };
    }
    return best;
  }

  function repairBeacon() {
    const beacon = defense.beacon;
    if (!beacon || finished) return;
    const origin = eye();
    const delta = [beacon.x - origin[0], beacon.y + 1.1 - origin[1], beacon.z - origin[2]];
    const distance = Math.hypot(...delta);
    if (distance > BEACON.repairRange || raycast(origin, delta.map(value => value / distance), distance)) {
      showMessage("靠近信标，并让视线避开墙体");
      return;
    }
    const plan = repairPlan(beacon.hp, campaign.count(STONE));
    if (plan.reason) { showMessage(plan.reason === "full" ? "信标完整" : `维修需要 ${BEACON.repairCost} 个石头`); return; }
    const result = campaign.spendMaterial(STONE, plan.cost);
    if (!result || checkSaveConflict(result)) return;
    beacon.hp += plan.restored;
    updateHotbar();
    sound.play("place", STONE);
    showMessage(`信标 +${plan.restored} · 石头 −${plan.cost}${result.saved ? "" : " · 未保存"}`);
  }

  function waveCandidates(center, radius) {
    const forward = viewDirection();
    const origin = eye();
    const candidates = [];
    const startX = Math.max(minX, Math.floor(center.x - radius));
    const endX = Math.min(maxX, Math.ceil(center.x + radius));
    const startZ = Math.max(minZ, Math.floor(center.z - radius));
    const endZ = Math.min(maxZ, Math.ceil(center.z + radius));
    const reachable = cell => survival.routes[cell] >= 0 || defense.routes?.[cell] >= 0;
    for (let x = startX; x < endX; x++) for (let z = startZ; z < endZ; z++) {
      const dx = x + .5 - player.x, dz = z + .5 - player.z;
      const distance = Math.hypot(x + .5 - center.x, z + .5 - center.z);
      const playerDistance = Math.hypot(dx, dz);
      if (distance < 5 || distance > radius || playerDistance < 3.2) continue;
      const cell = groundCell(x, Math.round(center.y), z, reachable);
      if (cell < 0) continue;
      const front = (forward[0] * dx + forward[2] * dz) / playerDistance;
      const target = [dx, cellPosition(cell)[1] + 1.3 - origin[1], dz];
      const sightDistance = Math.hypot(...target);
      const visible = sightDistance <= 16 && front > .35 && !raycast(origin, target.map(component => component / sightDistance), sightDistance);
      const score = (visible ? 2 : 0) + 2 * front - distance * .08 + Math.random() * 1.2;
      const side = (x + .5 - center.x) * forward[0] + (z + .5 - center.z) * forward[2] >= 0;
      candidates.push({ cell, x, z, score, side });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  function spawnWave() {
    const center = defense.beacon ?? player;
    const nextWave = survival.wave + 1;
    const wave = defense.beacon ? DEFENSE_WAVES[nextWave - 1] : null;
    // Survival difficulty (which kinds join when, +5% HP per wave) lives
    // in difficulty.mjs; defense rosters come from defenseWaveRoster,
    // which adds spitters from wave 4 on — one on waves 4-5, two from
    // wave 6 — and the configured roster in waves.mjs stays verbatim.
    // Past the configured waves the final wave repeats: the roster comes
    // from defenseWaveRoster (which repeats the last wave with two
    // spitters) and the timer repeats the last wave's seconds, so wave 6
    // does not time out the moment it starts.
    const roster = defense.beacon ? defenseWaveRoster(nextWave - 1) : survivalRoster(nextWave);
    const alternate = Boolean(defense.beacon && nextWave >= 4);
    let spawns = selectWaveSpawns(roster, waveCandidates(center, 12), alternate);
    if (!spawns.length) spawns = selectWaveSpawns(roster, waveCandidates(center, 24), alternate);
    if (!spawns.length) {
      survival.countdown = 5;
      showMessage(defense.beacon ? "没有足够的刷怪空间，试着打通信标周围的通路" : "没有足够的刷怪空间，请移到开阔处");
      return;
    }
    addEnemies(spawns, nextWave);
    survival.wave = nextWave;
    survival.countdown = defense.beacon ? 17 : 8;
    defense.seconds = defense.beacon
      ? (wave?.seconds ?? DEFENSE_WAVES[DEFENSE_WAVES.length - 1].seconds)
      : 0;
    showMessage(wave ? wave.name : `第 ${nextWave} 波来了`);
  }

  function addEnemies(spawns, wave = 1) {
    for (const { kind, cell, x, z } of spawns) {
      survival.zombies.push({ kind, cell, next: -1, travel: 0, x: x + .5, y: cellPosition(cell)[1], z: z + .5,
        hp: scaledHp(ENEMIES[kind].hp, wave), angle: 0, cooldown: .65, windup: 0, hurt: 0, walk: 0 });
    }
  }

  function resetSurvival() {
    Object.assign(survival, { wave: 0, kills: 0, countdown: firstWaveDelay, recalc: 0, goal: -1, routesDirty: true });
    survival.zombies.length = 0;
    survival.projectiles.length = 0;
    survival.routes.fill(-1);
    Object.assign(pulse, { rounds: pulseWeapon.capacity, recharge: 0, charge: null, shot: null });
    Object.assign(player, { hp: 100, hurt: 0, cooldown: 0, recoveryTime: 1, hitConfirm: 0, swing: 0, handAction: 0, invulnerable: 0, attackBuffered: false });
    updateHealth();
  }

  function updateHealth() {
    health.value = player.hp;
    healthValue.textContent = String(player.hp);
  }

  // Total damage reduction: the armor registry rate plus the 坚韧 tech
  // bonus when unlocked. The floor/min-1 shape mirrors reducedDamage
  // (armor.mjs); the bonus enters here because it adds to the rate,
  // not to the amount.
  function damageAfterArmor(amount) {
    const armor = campaign.equipment.armor;
    const rate = (armor && armor.durability > 0 ? armorReduction(armor.tier) : 0)
      + (campaign.techUnlocked.includes("toughness") ? TECH_EFFECTS.toughnessReduction : 0);
    return Math.max(1, Math.floor(amount * (1 - rate)));
  }

  // The weapon's low-durability warning, pending until the frame ends:
  // attack() shows its hit message after the wear, and showMessage
  // replaces the text, so a warning shown during the hit would be
  // overwritten before anyone reads it. The frame loop shows it once,
  // after every hit message, and clears it.
  let pendingDurabilityWarning = null;

  // Wear one equipped piece by 1 (floor 0). The campaign owns the save;
  // this wrapper only adds the weapon's low-durability warning — which
  // fires once when the weapon crosses below 25% — and refreshes the
  // hotbar, so a weapon that just broke falls back to the fist at once.
  // A failed write rolls the -1 back in memory, so after still equals
  // before and no warning fires for a wear that did not stick.
  function wearEquipped(slot) {
    const before = campaign.equipment[slot]?.durability;
    if (before === undefined || before <= 0) return;
    campaign.wearEquipment(slot);
    const after = campaign.equipment[slot]?.durability ?? 0;
    if (slot === "weapon") {
      updateHotbar();
      const max = durabilityMax(campaign.equipment.weapon.tier);
      if (before / max >= .25 && after / max < .25) {
        pendingDurabilityWarning = `${WEAPONS[campaign.equipment.weapon.key].name}耐久不足（${Math.floor(after / max * 100)}%），按 C 在工作台修理`;
      }
    }
  }

  // A landed hit wears the equipped weapon by 1 — but only the crafted
  // weapon itself. The default stone sword and the fist have no
  // durability to wear, and the boss-only guns are not equipment.
  function wearWeaponOnHit(weapon) {
    const equipped = campaign.equipment.weapon;
    if (!equipped || !weapon || weapon !== WEAPONS[equipped.key]) return;
    wearEquipped("weapon");
  }

  function takeDamage(amount) {
    if (!player.hp || player.invulnerable > 0) return;
    // Armor reduces the hit before it lands: amount * (1 - rate),
    // rounded down, at least 1. The beacon and the boss never go through
    // here, so their numbers are untouched.
    player.hp = Math.max(0, player.hp - damageAfterArmor(amount));
    wearEquipped("armor");
    player.hurt = .42;
    player.invulnerable = .5;
    sound.play("hurt", DIRT);
    updateHealth();
    if (player.hp > 0) return;
    if (boss) return finishBoss(false);
    if (defense.beacon) return finishDefense("player-down");
    finishRun("你倒下了", `撑到第 ${survival.wave} 波，击退 ${survival.kills} 只僵尸。建筑和背包会保留。`, "重生");
  }

  // Merge this run into the progress record: best wave is a max, kills
  // accumulate, a boss win adds its id, and a defense run updates the
  // defense record. Cached per run so finishRun and the stale choice
  // that may follow it merge the run's kills exactly once.
  function mergeRunProgress() {
    if (mergedProgress) return mergedProgress;
    const base = savedProgress ?? campaign.loadProgress();
    // The record shape lives in save.mjs; the per-run cache and the
    // savedProgress slot stay here. The merge is cached, so a stale
    // choice that re-merges after the first merge was discarded
    // counts the same win exactly once.
    mergedProgress = mergeRunProgressRecord(base, {
      wave: survival.wave,
      kills: survival.kills,
      bossDefeated: runBossDefeated,
      defense: defense.beacon ? { wave: survival.wave, victory: defense.victory } : null
    });
    savedProgress = mergedProgress;
    return mergedProgress;
  }

  // Write the merged record. A refused (stale) write still leaves the
  // merged record in savedProgress, so the next run merges from it even
  // though the disk is behind.
  function saveRunProgress(force = false) {
    return campaign.saveProgress(mergeRunProgress(), force ? { force: true } : undefined);
  }

  function resolveProgressChoice(keepLocal) {
    const pending = pendingProgressChoice;
    pendingProgressChoice = null;
    deathMenuButton.textContent = "返回主菜单";
    if (keepLocal) {
      // Explicit player choice: this run's record overwrites the other
      // tab's newer progress.
      campaign.saveProgress(mergedProgress, { force: true });
    } else {
      // Re-read the other tab's progress and merge this run into it.
      savedProgress = null;
      mergedProgress = null;
      saveRunProgress();
    }
    showDeathScreen(pending.title, pending.summary, pending.action);
  }

  function showDeathScreen(title, summary, action) {
    deathTitle.textContent = title;
    deathSummary.textContent = summary;
    respawnButton.textContent = action;
    deathScreen.hidden = false;
    suspendGame();
    respawnButton.focus({ preventScroll: true });
  }

  function finishRun(title, summary, action) {
    finished = true;
    const result = saveRunProgress();
    if (result?.saved === false && result.reason === "stale") {
      // Another tab saved progress since this run started. Do not drop
      // the run silently: let the player choose on the death screen.
      pendingProgressChoice = { title, summary, action };
      deathTitle.textContent = "进度有更新";
      deathSummary.textContent = `${summary} 另一标签页已更新了进度：点“保留本局进度”用本局覆盖对方，或点“采用最新进度”重新读取再合并。`;
      respawnButton.textContent = "保留本局进度";
      deathMenuButton.textContent = "采用最新进度";
      deathScreen.hidden = false;
      suspendGame();
      respawnButton.focus({ preventScroll: true });
      return;
    }
    showDeathScreen(title, `${summary}${result?.saved === false ? "（进度未保存）" : ""}`, action);
  }

  function finishBoss(won) {
    if (won) runBossDefeated = boss.profile.id;
    // The drop line on the end screen, e.g. " · 熔火核心 +2": only when
    // the win actually paid, so a failed save never advertises a reward
    // the player does not own.
    let bossDropText = "";
    if (won) {
      // A boss win pays its rare material — 2 for a first kill, 1 for a
      // repeat. The record used here is the one from before this win
      // (mergeRunProgress has not run yet), so a first kill reads as
      // first. The drop goes through change(), so a failed save rolls it
      // back like any other reward instead of vanishing on reload.
      const bossId = boss.profile.id;
      const first = !(savedProgress ?? campaign.loadProgress()).bossesDefeated?.[bossId];
      const count = first ? 2 : 1;
      const dropResult = campaign.grantBossLoot(bossId, count);
      if (dropResult?.saved) bossDropText = ` · 获得：${RARE_MATERIALS[BOSS_DROPS[bossId]]} ×${count}`;
    }
    if (won) {
      sound.play(boss.profile === BOSS ? "forge-collapse" : "defeat", STONE);
      // Boss death debris: a bigger burst from the core as it goes down —
      // furnace-hot for the guardian, cold crystal for the colossus.  The
      // colossus collapse keeps rendering for 0.86s, so its burst plays out
      // in full; the guardian's is caught in the end-screen frame.
      const hot = boss.profile === BOSS;
      spawnBurst3D(boss.x, boss.y + 1.8, boss.z, 18,
        { colors: hot ? [[1, .32, .06], [.55, .58, .62], [.2, .16, .14]] : [[.75, .85, 1], [.45, .62, .95], [.3, .34, .44]],
          speed: 3.6, up: 4, size: 0.13, life: 0.6, gravity: 14, floor: boss.profile.arena.floor });
    }
    finishRun(won ? `${boss.profile.name}已击败` : "挑战失败",
      `${Math.floor(boss.elapsed)} 秒 · 命中 ${boss.hits} 次 · ${won ? `剩余生命 ${player.hp}` : `${boss.profile.name}剩余 ${boss.hp} 点生命`}${bossDropText}`,
      "再挑战");
  }

  function finishDefense(result) {
    if (finished || result === "playing") return;
    const title = {
      "cleared": "信标守住了",
      "beacon-destroyed": "信标失守",
      "player-down": "守卫倒下了",
      "timeout": "防守超时"
    }[result];
    const progress = result === "cleared" ? `撑过全部 ${DEFENSE_TOTAL_WAVES} 波` : `进行到第 ${survival.wave || 1} 波`;
    defense.victory = result === "cleared";
    finishRun(title, `${progress}，击退 ${survival.kills} 只敌人，信标剩余 ${defense.beacon.hp} 点。建筑与物资保留。`, "再挑战");
  }

  function damageBeacon(amount) {
    if (!defense.beacon || finished) return;
    defense.beacon.hp = Math.max(0, defense.beacon.hp - amount);
    defense.beacon.hurt = .35;
    sound.play("hit", STONE);
    showMessage(`信标受损 −${amount}`);
    if (!defense.beacon.hp) finishDefense("beacon-destroyed");
  }

  // A ranged zombie lobs one glob at the point its goal stood when the
  // throw was released: the glob flies straight at profile.projectileSpeed
  // and is dodged by moving, not by outrunning the throw itself.
  function throwProjectile(zombie, profile, atBeacon) {
    const goal = atBeacon ? defense.beacon : player;
    const origin = [zombie.x, zombie.y + 1.26 * profile.height, zombie.z];
    const aim = [goal.x, goal.y + 1.2, goal.z];
    const delta = aim.map((value, i) => value - origin[i]);
    const distance = Math.hypot(...delta) || 1;
    const speed = profile.projectileSpeed ?? 6;
    survival.projectiles.push({ x: origin[0], y: origin[1], z: origin[2], hurt: 0,
      vx: delta[0] / distance * speed, vy: delta[1] / distance * speed, vz: delta[2] / distance * speed,
      target: atBeacon ? "beacon" : "player", damage: profile.damage, traveled: 0, maxTravel: distance + 2 });
  }

  // Thrown globs fly straight: one hits when it reaches its target's
  // current position, a solid block stops it, and it fizzles past its
  // range instead of flying on. Damage is skipped once the run is over.
  function stepProjectiles(dt) {
    for (const shot of survival.projectiles) {
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.z += shot.vz * dt;
      shot.traveled += Math.hypot(shot.vx, shot.vy, shot.vz) * dt;
    }
    const live = [];
    for (const shot of survival.projectiles) {
      const target = shot.target === "beacon" ? defense.beacon : player;
      const center = target ? [target.x, target.y + 1, target.z] : null;
      if (center && Math.hypot(shot.x - center[0], shot.y - center[1], shot.z - center[2]) <= .7) {
        if (!finished) {
          if (shot.target === "beacon") damageBeacon(shot.damage);
          else takeDamage(shot.damage);
        }
        continue;
      }
      if (get(Math.floor(shot.x), Math.floor(shot.y), Math.floor(shot.z)) !== 0 || shot.traveled >= shot.maxTravel) continue;
      live.push(shot);
    }
    survival.projectiles.splice(0, survival.projectiles.length, ...live);
  }

  function walkZombie(zombie, dt, routes, profile) {
    if (zombie.next === -1) {
      if (!standable(...cellPosition(zombie.cell))) {
        const cell = groundCell(Math.floor(zombie.x), Math.floor(zombie.y), Math.floor(zombie.z));
        if (cell < 0) return;
        zombie.cell = cell;
        zombie.y = cellPosition(cell)[1];
      }
      const next = routes[zombie.cell];
      if (next < 0 || next === zombie.cell || survival.zombies.some(other => other !== zombie && (other.cell === next || other.next === next))) return;
      zombie.next = next;
      zombie.travel = 0;
    }
    const from = cellPosition(zombie.cell), to = cellPosition(zombie.next);
    if (!canStep(...from, ...to)) {
      Object.assign(zombie, { x: from[0] + .5, y: from[1], z: from[2] + .5, next: -1 });
      return;
    }
    const pace = profile.speed + Math.min(survival.wave, 7) * .035;
    const t = zombie.travel = Math.min(1, zombie.travel + dt * pace);
    // Ease in-out so the zombie accelerates out of a cell and decelerates
    // into the next instead of sliding at constant speed.
    const eased = t * t * (3 - 2 * t);
    zombie.x = from[0] + .5 + (to[0] - from[0]) * eased;
    zombie.z = from[2] + .5 + (to[2] - from[2]) * eased;
    // Knockback velocity (set on hit, decayed in updateCombat) pushes the
    // zombie off its path for a fraction of a second.
    zombie.x += (zombie.kx ?? 0) * dt;
    zombie.z += (zombie.kz ?? 0) * dt;
    const rise = to[1] - from[1];
    const heightBlend = rise > 0 ? Math.min(t * 3, 1) : Math.max(0, t * 3 - 2);
    zombie.y = from[1] + rise * heightBlend;
    zombie.walk += dt * 7 * pace;
    if (t === 1) { zombie.cell = zombie.next; zombie.next = -1; }
  }

  // Effective mining interval: the equipped tool's registry interval,
  // minus the 快手 tech bonus when unlocked. The tick and the crosshair
  // ring both read this, so they stay in sync; the equipment card shows
  // the tool's own registry interval instead.
  function currentMiningInterval() {
    const tool = campaign.equipment.tool;
    const base = tool && tool.durability > 0 ? miningInterval(tool.tier) : 0.28;
    return Math.max(.05, base
      - (campaign.techUnlocked.includes("swiftHands") ? TECH_EFFECTS.swiftHandsSeconds : 0));
  }

  function updateCombat(dt) {
    guardianFx.charge = Math.max(0, guardianFx.charge - dt / .52);
    guardianFx.strike = Math.max(0, guardianFx.strike - dt / .34);
    guardianFx.exposed = Math.max(0, guardianFx.exposed - dt / .74);
    guardianFx.hit = Math.max(0, guardianFx.hit - dt / .22);
    player.cooldown = Math.max(0, player.cooldown - dt);
    // Floating damage numbers rise and fade over 0.9s; debris flies out
    // with gravity and is gone in 0.6s.
    for (const number of damageNumbers) number.age += dt;
    for (const decal of groundDecals) decal.age += dt;
    if (groundDecals.some(decal => decal.age >= decal.ttl)) {
      groundDecals.splice(0, groundDecals.length, ...groundDecals.filter(decal => decal.age < decal.ttl));
    }
    if (damageNumbers.some(number => number.age > .9)) {
      damageNumbers.splice(0, damageNumbers.length, ...damageNumbers.filter(number => number.age <= .9));
    }
    for (const piece of debris) {
      piece.age += dt;
      piece.x += piece.vx * dt; piece.y += piece.vy * dt; piece.z += piece.vz * dt;
      piece.vy -= 12 * dt;
    }
    if (debris.some(piece => piece.age > .6)) {
      debris.splice(0, debris.length, ...debris.filter(piece => piece.age <= .6));
    }
    stepParticles(particles3D, dt);
    stepParticles(bossParticles, dt);
    for (const pop of pops) pop.age += dt;
    if (pops.some(pop => pop.age >= POP_DURATION)) {
      pops.splice(0, pops.length, ...pops.filter(pop => pop.age < POP_DURATION));
    }
    // Fire a buffered attack the moment the cooldown ends.
    if (player.cooldown <= 0 && player.attackBuffered) {
      player.attackBuffered = false;
      interact(false);
      if (finished) return;
    }
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.hitConfirm = Math.max(0, player.hitConfirm - dt);
    player.swing = Math.max(0, player.swing - dt);
    player.handAction = Math.max(0, player.handAction - dt);
    player.hurt = Math.max(0, player.hurt - dt);
    if (pulse.shot && (pulse.shot.age += dt) >= pulse.shot.duration) pulse.shot = null;
    if (pulse.charge !== null && pulse.charge < pulseBurst.windup) {
      const heldSeconds = (performance.now() - pulse.chargeStarted) / 1000;
      pulse.charge = Math.min(pulseBurst.windup, Math.max(pulse.charge + dt, heldSeconds));
      if (pulse.charge === pulseBurst.windup) sound.play("pulse-ready", STONE);
    }
    if (pulse.recharge > 0) {
      pulse.recharge = Math.max(0, pulse.recharge - dt);
      if (pulse.recharge <= 1e-8) {
        pulse.recharge = 0;
        pulse.rounds = pulseWeapon.capacity;
        sound.play("pulse-recharge", STONE);
      }
    }
    const drag = input.getDrag();
    if (drag && isGun(weapons[selected - palette.length]) && !drag.moved && !drag.fired) {
      drag.holdTime += dt;
      if (drag.holdTime >= .22) firing = drag.fired = true;
    }
    if (firing && !finished && player.hp && isGun(weapons[selected - palette.length])) {
      firePulse(false);
      if (finished) return;
    }
    // Hold left mouse to keep mining / attacking instead of clicking per block.
    // Only repeat when there is actually something to hit or mine: repeating
    // an air swing would put the weapon on cooldown and waste a real damage
    // window (e.g. a boss's exposed core).
    if (mouseHeld && !finished && player.hp && !isGun(weapons[selected - palette.length])) {
      mouseHeldRepeat += dt;
      if (mouseHeldRepeat >= currentMiningInterval()) {
        mouseHeldRepeat = 0;
        const { origin, direction } = renderedView ?? { origin: eye(), direction: viewDirection() };
        const target = raycast(origin, direction, interactionReach);
        if (target || aimEnemy(origin, direction, target, interactionReach)) interact(false);
        if (finished) return;
      }
    }
    if (boss) {
      for (const dragon of boss.dragons.slice()) {
        if (boss.elapsed < dragon.start) continue;
        const old = [dragon.x, dragon.y, dragon.z];
        const t = Math.min(1, (boss.elapsed - dragon.start) / dragon.duration);
        const fan = Math.sin(Math.PI * t) * dragon.lane;
        dragon.x = dragon.ox + (boss.x - dragon.ox) * t + dragon.c * fan;
        dragon.z = dragon.oz + (boss.z - dragon.oz) * t - dragon.s * fan;
        dragon.y = dragon.oy + (boss.y + 3 - dragon.oy) * t + 1.7 * Math.sin(Math.PI * t);
        const wave = Math.sin(t * 9 + dragon.lane) * Math.sin(Math.PI * t) * .55;
        dragon.x += dragon.c * wave;
        dragon.z -= dragon.s * wave;
        if (!dragon.trail.length || boss.elapsed - dragon.trail[0].time >= .018) {
          dragon.trail.unshift({x:dragon.x, y:dragon.y, z:dragon.z, time:boss.elapsed});
          if (dragon.trail.length > 32) dragon.trail.pop();
        }
        const delta = [dragon.x - old[0], dragon.y - old[1], dragon.z - old[2]];
        const length = Math.hypot(...delta);
        const horizontal = Math.hypot(delta[0], delta[2]);
        if (horizontal > .001) {
          dragon.headingS = delta[0] / horizontal;
          dragon.headingC = delta[2] / horizontal;
        }
        const blocked = length > 0 && raycast(old, delta.map(v => v / length), length);
        if (blocked || t === 1) boss.dragons.splice(boss.dragons.indexOf(dragon), 1);
        if (!blocked && t === 1) {
          dragonImpact(boss, { x: dragon.ox, z: dragon.oz });
          player.hitConfirm = .25;
          sound.play("boss-strike", STONE);
          if (!boss.hp) { boss.dragons.length = 0; finishBoss(true); return; }
        }
        if (!boss.dragons.length) showMessage(boss.dragonHits
          ? `五龙冲击 · 命中 ${boss.dragonHits}/5 · ${16 * boss.dragonHits} 伤害`
          : "火龙被掩体挡住了");
      }
      const covered = bossHasCover();
      const lastFootfall = Math.floor(boss.stride / Math.PI);
      const { cue, damage, push, fire } = advanceBoss(boss, { ...player, covered }, dt);
      // Ghost bookkeeping: a fresh drop (re)starts the 0.6s drain
      // from wherever the ghost currently sits; a heal or a new
      // phase (hp jumps up) snaps it straight to the real value.
      if (boss.hp >= bossGhostHp) { bossGhostHp = boss.hp; bossGhostRate = 0; }
      else if (!bossGhostRate) bossGhostRate = (bossGhostHp - boss.hp) / .6;
      if (bossGhostRate) bossGhostHp = Math.max(boss.hp, bossGhostHp - bossGhostRate * dt);
      if (!cue && boss.profile === BOSS && Math.floor(boss.stride / Math.PI) > lastFootfall) sound.play("forge-step", STONE);
      if (cue) {
        let voice = cue;
        if (boss.profile === BOSS && boss.attack) {
          const { kind, waves } = boss.attack;
          if (cue === "boss-charge" && kind === "ram") voice = "forge-ram";
          if (cue === "boss-charge" && kind === "flare") voice = "forge-flare";
          if (cue === "boss-strike" && kind === "sweep") voice = "forge-sweep";
          if (cue === "boss-strike" && kind === "shock") voice = "forge-impact";
          if (cue === "boss-strike" && kind === "nova") voice = waves[1].radius === null ? "forge-ring" : "forge-echo";
        }
        sound.play(voice, STONE);
        cueGuardianFx(cue);
        if (cue === "boss-strike") cueBossImpact();
        if (cue === "boss-charge" && boss.attack?.kind === "starfall") {
          phaseBanner = { text: "断星！数着环跳", until: boss.elapsed + 1.5 };
        }
      }
      if (damage) {
        takeDamage(damage);
        if (boss.profile === BOSS) guardianFx.strike = Math.max(guardianFx.strike, .92);
        if (push) { player.vx = push.x; player.vz = push.z; }
      }
      if (fire && player.hp) {
        // Fire zones burn on the environmental channel (batch
        // 61): no armor reduction, no hurt stagger, no
        // invulnerability window — a drain, not a hit.
        player.hp = Math.max(0, player.hp - fire);
        updateHealth();
        if (!player.hp) finishBoss(false);
      }
      if (boss.profile !== BOSS || finished) return;
    }
    if (!survival.enabled && !boss) return;
    if (defense.beacon) {
      defense.elapsed += dt;
      defense.beacon.hurt = Math.max(0, defense.beacon.hurt - dt);
      if (survival.zombies.length) defense.seconds = Math.max(0, defense.seconds - dt);
      const result = defenseResult(survival.wave, survival.zombies.length, defense.beacon.hp, player.hp, defense.seconds);
      if (result !== "playing") { finishDefense(result); return; }
    }
    survival.recalc -= dt;
    if (survival.recalc <= 0) {
      const goal = groundCell(Math.floor(player.x), Math.round(player.y), Math.floor(player.z));
      if (survival.routesDirty || goal !== survival.goal) {
        rebuildRoutes(survival.routes, goal);
        survival.goal = goal;
      }
      if (survival.routesDirty && defense.beacon) rebuildRoutes(defense.routes, defense.beacon.cell);
      survival.routesDirty = false;
      survival.recalc = .35;
    }
    if (boss && boss.attacks > 0 && boss.summonedWave !== boss.phase) {
      const roster = GUARDIAN_WAVES[boss.phase - 1].minions;
      const sites = waveCandidates(boss, 8).filter(site => !survival.zombies.some(z => z.cell === site.cell || z.next === site.cell));
      const spawns = selectWaveSpawns(roster, sites, false);
      if (spawns.length) {
        addEnemies(spawns);
        boss.summonedWave = boss.phase;
        showMessage(`守卫召唤了${spawns.map(s => ENEMIES[s.kind].name).join("、")}`);
      }
    }
    if (!boss && !survival.zombies.length) {
      survival.countdown -= dt;
      if (survival.countdown <= 0) spawnWave();
    }
    for (const zombie of survival.zombies) {
      zombie.hurt = Math.max(0, zombie.hurt - dt);
      zombie.cooldown -= dt;
      // Knockback velocity decays exponentially.
      zombie.kx = (zombie.kx ?? 0) * Math.exp(-dt * 4);
      zombie.kz = (zombie.kz ?? 0) * Math.exp(-dt * 4);
      // Dying zombies sink for 0.5s instead of vanishing instantly.
      if (zombie.dying !== undefined) {
        zombie.dying -= dt;
        zombie.y -= dt * 1.2;
        continue;
      }
      const profile = ENEMIES[zombie.kind] ?? ENEMIES.walker;
      // Ranged kinds (attack: "ranged") throw from profile.range instead
      // of closing to melee reach; kinds without an attack field stay
      // melee — a missing field is never read as ranged.
      const ranged = profile.attack === "ranged";
      const attackRange = ranged ? profile.range : profile.reach;
      const playerDistance = Math.hypot(player.x - zombie.x, player.z - zombie.z);
      const atBeacon = choosesBeacon(zombie.kind, Boolean(defense.beacon), playerDistance,
        survival.routes[zombie.cell] >= 0, defense.routes?.[zombie.cell] >= 0);
      const goal = atBeacon ? defense.beacon : player;
      if (zombie.windup && zombie.attackingBeacon !== atBeacon) zombie.windup = 0;
      const dx = goal.x - zombie.x, dz = goal.z - zombie.z;
      const distance = Math.hypot(dx, dz);
      // Turn toward the goal at most 2.6 rad/s instead of snapping instantly.
      const targetAngle = Math.atan2(dx, dz);
      const angleDelta = Math.atan2(Math.sin(targetAngle - zombie.angle), Math.cos(targetAngle - zombie.angle));
      zombie.angle += Math.max(-2.6 * dt, Math.min(2.6 * dt, angleDelta));
      const origin = [zombie.x, zombie.y + 1.26 * profile.height, zombie.z];
      const delta = [dx, goal.y + 1.2 - origin[1], dz];
      const reach = Math.hypot(...delta);
      // The height window is a melee rule: a thrown glob flies in 3D, so
      // ranged attacks only need the line of sight to be clear.
      if (distance <= attackRange && (ranged || Math.abs(goal.y - zombie.y) <= 1.06) && reach > .01
        && !raycast(origin, delta.map(value => value / reach), reach)) {
        if (zombie.windup > 0) {
          zombie.windup = Math.max(0, zombie.windup - dt);
          if (zombie.windup > 0) continue;
          zombie.cooldown = profile.cooldown;
          if (ranged) throwProjectile(zombie, profile, atBeacon);
          else {
            if (atBeacon) damageBeacon(profile.damage);
            else takeDamage(profile.damage);
            if (finished) break;
          }
        } else if (zombie.cooldown <= 0) {
          zombie.windup = profile.strikeDelay;
          zombie.attackingBeacon = atBeacon;
        }
      } else {
        zombie.windup = 0;
        walkZombie(zombie, dt, atBeacon ? defense.routes : survival.routes, profile);
      }
    }
    // Remove zombies whose death sink finished.
    if (survival.zombies.some(zombie => zombie.dying !== undefined && zombie.dying <= 0)) {
      survival.zombies = survival.zombies.filter(zombie => !(zombie.dying !== undefined && zombie.dying <= 0));
    }
    stepProjectiles(dt);
  }

  function aimEnemy(origin, direction, blockHit, range) {
    const reach = blockHit?.distance ?? range;
    if (!boss) return findMeleeTarget(origin, direction, reach, survival.zombies, defense.beacon, defense.elapsed);
    if (!boss.hp) return null;
    if (boss.profile === COLOSSUS) return modelHit(renderedView?.bossModel ?? posedColossus(boss), origin, direction, reach);
    const hit = actorRay(origin, direction, boss, boss.angle);
    let distance = reach;
    bossParts(boss, (...part) => { distance = Math.min(distance, hit(...part)); });
    return findMeleeTarget(origin, direction, distance, survival.zombies, null, 0) ?? (distance < reach ? { distance } : null);
  }

  function rechargePulse() {
    if (pulse.recharge > 0 || pulse.rounds === pulseWeapon.capacity) return;
    pulse.charge = null;
    pulse.recharge = pulseWeapon.recharge;
  }

  function startPulseCharge() {
    if (pulse.recharge > 0 || pulse.charge !== null || player.cooldown > 0) return;
    if (pulse.rounds < pulseBurst.cost) {
      showMessage("爆发需要 2 格能量 · 按 R 充能");
      return;
    }
    pulse.charge = 0;
    pulse.chargeStarted = performance.now();
    sound.play("pulse-windup", STONE);
  }

  function firePulse(charged) {
    if (pulse.recharge > 0 || pulse.charge !== null) return;
    const gun = weapons[selected - palette.length];
    if (!isGun(gun)) return;
    const profile = charged ? pulseBurst : gun;
    const cost = profile.cost ?? 1;
    if (player.cooldown > 0) return;
    if (pulse.rounds < cost) { rechargePulse(); return; }
    const { origin, direction } = renderedView ?? { origin: eye(), direction: viewDirection() };
    const block = raycast(origin, direction, profile.reach);
    const aim = aimEnemy(origin, direction, block, profile.reach);
    const impact = aim?.distance ?? block?.distance;
    const endpoint = origin.map((value, i) => value + direction[i] * (impact ?? profile.reach));
    pulse.rounds -= cost;
    const heavy = charged || gun.style === "cannon";
    pulse.shot = { style: gun.style, seed: Math.random() * Math.PI * 2, charged: heavy, endpoint, age: 0, duration: heavy ? .39 : .24,
      impact: aim?.crystal || aim?.turret != null ? "crystal" : aim ? (aim.weak && boss.state === "recovery" ? "core" : "armor") : block ? "stone" : null };
    sound.play(heavy ? "cannon-fire" : gun.style === "rapid" ? "rapid-fire" : "pulse-fire", STONE);
    attack(gun, aim, profile);
  }

  function attack(weapon, aim, profile = weapon ?? punch) {
    // Cooldown no longer silently eats the click: buffer one attack and fire
    // it from updateCombat the moment the cooldown ends.
    if (player.cooldown > 0) { player.attackBuffered = true; return; }
    player.attackBuffered = false;
    const pulseShot = isGun(weapon);
    player.cooldown = profile.cooldown;
    player.recoveryTime = profile.cooldown;
    if (!pulseShot) {
      if (weapon) player.swing = .27;
      else player.handAction = blockActionTime;
    }
    if (!aim || aim.distance > profile.reach) {
      if (!pulseShot) sound.play("swing", LEAF);
      return;
    }
    // The stew's attack buff (R5) scales every hit this swing lands,
    // computed as damage * (100 + pct) / 100 so a 14-damage punch reads
    // exactly 15.4, not a long float.
    const attackBuff = activeBuff("attack");
    const hitDamage = attackBuff ? profile.damage * (100 + attackBuff.pct) / 100 : profile.damage;
    if (boss && !aim.zombie) {
      if (aim.crystal) {
        const remaining = damagePrism(boss, hitDamage);
        if (remaining !== null) {
          wearWeaponOnHit(weapon);
          player.hitConfirm = .25;
          sound.play(remaining ? "hit" : "pulse-crystal", STONE);
          showMessage(remaining ? `命中晶体 · 剩余 ${remaining}` : "晶体破碎 · 三轨折光中断");
          return;
        }
      }
      if (aim.turret != null) {
        const remaining = damageTurret(boss, aim.turret, hitDamage);
        if (remaining !== null) {
          wearWeaponOnHit(weapon);
          player.hitConfirm = .25;
          const allDown = boss.attack.turrets.every(crystal => crystal.hp <= 0);
          sound.play(remaining ? "hit" : "pulse-crystal", STONE);
          showMessage(allDown ? "星尘炮台全碎 · 提前熄火" : remaining ? `命中星尘晶体 · 剩余 ${remaining}` : "星尘晶体破碎");
          return;
        }
      }
      const oldPhase = boss.phase;
      const damage = strikeBoss(boss, hitDamage, aim.weak, player);
      const hitSound = boss.profile === BOSS ? "core-hit" : "hit";
      const blockedSound = boss.profile === BOSS ? "forge-armor" : "place";
      sound.play(damage ? hitSound : blockedSound, STONE);
      if (damage) wearWeaponOnHit(weapon);
      if (!damage) {
        showMessage(boss.state === "recovery" ? "瞄准青色核心"
          : boss.profile === COLOSSUS && boss.state === "ready" ? "巨像正在逼近，留意第一击" : "护甲挡住了攻击，等核心暴露");
        return;
      }
      player.hitConfirm = .25;
      if (boss.profile === BOSS) {
        guardianFx.hit = Math.min(1, guardianFx.hit + (profile === pulseBurst ? 1 : .72));
        if (boss.state === "recovery") guardianFx.exposed = Math.max(guardianFx.exposed, .72);
      }
      // The floater is born at the hit point, one block above it
      // (batch 48): the old boss-top spawn sat outside a melee
      // player's view. Core hits render as big gold text in
      // drawEffects, told apart by the core flag.
      const view = renderedView;
      const hitPoint = view && aim.distance != null
        ? [view.origin[0] + view.direction[0] * aim.distance,
           view.origin[1] + view.direction[1] * aim.distance,
           view.origin[2] + view.direction[2] * aim.distance]
        : [boss.x, boss.y + 1.6, boss.z];
      damageNumbers.push({ x: hitPoint[0], y: hitPoint[1] + 1.0, z: hitPoint[2], text: `-${damage}`, age: 0, core: true });
      if (boss.phase !== oldPhase) {
        survival.zombies.length = 0;
        const healed = Math.min(30, 100 - player.hp);
        player.hp += healed;
        updateHealth();
        sound.play(boss.phase === 2 ? "forge-ignite" : "forge-overload", STONE);
        showMessage(`击破第 ${oldPhase} 管血 · 生命 +${healed} · 第 ${boss.phase} 波开始`);
      }
      else if (boss.hp) showMessage(`${profile === pulseBurst ? "爆发命中核心" : "命中核心"} · 伤害 ${damage}`);
      else finishBoss(true);
      return;
    }
    const zombie = aim.zombie;
    const damage = Math.min(zombie.hp, hitDamage);
    zombie.hp -= damage;
    wearWeaponOnHit(weapon);
    player.hitConfirm = .25;
    zombie.hurt = .23;
    damageNumbers.push({ x: zombie.x, y: zombie.y + 1.9 * (ENEMIES[zombie.kind]?.height ?? 1), z: zombie.z,
      text: `-${damage}`, age: 0 });
    // Knockback: away from the player, ~2.2 u/s decaying over ~0.25s.
    const kx = zombie.x - player.x, kz = zombie.z - player.z, kl = Math.hypot(kx, kz) || 1;
    zombie.kx = kx / kl * 2.2; zombie.kz = kz / kl * 2.2;
    if (!ENEMIES[zombie.kind]?.armor) {
      zombie.cooldown = Math.max(zombie.cooldown, .38);
      zombie.windup = 0;
    }
    sound.play("hit", STONE);
    if (zombie.hp > 0) {
      showMessage(`命中${(ENEMIES[zombie.kind] ?? ENEMIES.walker).name} · 伤害 ${damage}`);
      return;
    }
    // Death is a 0.5s sink instead of an instant splice; the zombie stays in
    // the array with `dying` set until updateCombat removes it, so the wave
    // is only "cleared" when nothing is left alive.
    zombie.dying = .5;
    zombie.kx = 0; zombie.kz = 0;
    // Death debris: coat- and skin-coloured cubes burst out of the body as
    // it starts to sink, and land on the ground under it.
    const style = ENEMIES[zombie.kind] ?? ENEMIES.walker;
    spawnBurst3D(zombie.x, zombie.y + 1.1 * (style.height ?? 1), zombie.z, 12,
      { colors: [style.coat, style.skin, [.16, .14, .12]], speed: 2.6, up: 3.2,
        size: 0.10, life: 0.6, gravity: 14, floor: floorUnder(zombie.x, zombie.y, zombie.z) });
    survival.kills++;
    const alive = survival.zombies.filter(other => other.dying === undefined).length;
    if (boss) {
      sound.play("defeat", DIRT);
      if (interruptFurnace(boss)) {
        sound.play("forge-vent", STONE);
        guardianFx.exposed = 1;
        showMessage("供火中断 · 守卫熄火，趁现在近身");
        return;
      }
      showMessage(`击退${ENEMIES[zombie.kind].name} · 剩余随从 ${alive}`);
      return;
    }
    const lootResult = campaign.grantLoot(zombie.kind);
    if (checkSaveConflict(lootResult)) return;
    updateHotbar();
    sound.play("defeat", DIRT);
    // The message lists what this kind actually dropped, from the same
    // registry table grantLoot just paid — a breaker pays 2 stone and a
    // runner pays a wood, so the old fixed "石头 +1 · 树叶 +1" would lie.
    // A string id is a farm or rare material, not a block, so it reads
    // its display name from the matching table instead of blockNames.
    const drops = ENEMIES[zombie.kind]?.drops ?? [[STONE, 1], [LEAF, 1]];
    const loot = `${drops.map(([id, amount]) => `${typeof id === "string" ? (FARM_MATERIALS[id] ?? RARE_MATERIALS[id]) : blockNames[id]} +${amount}`).join(" · ")}${lootResult.saved ? "" : " · 未保存"}`;
    if (!alive) {
      if (defense.beacon && defenseCleared(survival.wave, alive)) { finishDefense("cleared"); return; }
      const healed = Math.min(24, 100 - player.hp);
      player.hp += healed;
      updateHealth();
      showMessage(`${healed ? `本波清空 · 生命 +${healed}` : "本波清空"} · ${loot}`);
    } else {
      showMessage(loot);
    }
  }

  function createActorMesh(quadCount) {
    const vertices = new Float32Array(quadCount * 4 * 12);
    const indices = new Uint16Array(quadCount * 6);
    for (let quad = 0; quad < quadCount; quad++) {
      const base = quad * 4;
      indices.set([base, base + 2, base + 1, base, base + 3, base + 2], quad * 6);
    }
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    return { vertices, vertexBuffer, indexBuffer };
  }

  function appendModel(vertices, used, parts, hurt = 0, heldGun = false) {
    modelFaces(parts, (points, normal, color, target, glow, cornerNormals) => {
      const [a, b, c, d = c] = points;
      const [r, g, bChannel] = color;
      const red = Math.min(1, r + hurt * .94);
      // Target IDs stay intact for aiming/raycast tests; only decorative glow
      // surfaces use the emissive material marker.
      const surface = cornerNormals ? -7 : heldGun ? -6 : target > 0 ? -1 - target : glow ? -10 : -1;
      const corners = [a,d,c,b];
      for (let i = 0; i < corners.length; i++) {
        const point = corners[i];
        const n = cornerNormals?.[[0,2,2,1][i]] ?? normal;
        vertices[used++] = point[0];
        vertices[used++] = point[1];
        vertices[used++] = point[2];
        vertices[used++] = red;
        vertices[used++] = g;
        vertices[used++] = bChannel;
        vertices[used++] = n[0];
        vertices[used++] = n[1];
        vertices[used++] = n[2];
        vertices[used++] = surface;
        // Models and glow quads are not terrain: their face code is
        // negative, so the shader never samples the atlas for them.  The
        // UV slot still has to exist — the layout is shared with terrain.
        vertices[used++] = 0;
        vertices[used++] = 0;
      }
    });
    return used;
  }

  function uploadActorMesh(mesh, used) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.vertices.subarray(0, used));
    bindVertexLayout();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
    gl.drawElements(gl.TRIANGLES, used / 48 * 6, gl.UNSIGNED_SHORT, 0);
  }

  function drawActors(bossModel) {
    if (!survival.zombies.length && !defense.beacon && !boss) return;
    // 4096 quads (batch 65): a measured guardian flare frame
    // with minions up wrote 2138 quads into the old 2048 mesh
    // and silently lost its tail — the boss model alone is
    // ~830, its afterimage another ~830, and telegraphs,
    // fire zones and minions share the same pen.
    actorMesh ??= createActorMesh(4096);
    const { vertices } = actorMesh;
    // One pen for the whole pass: the boss section (boss-render.mjs)
    // writes through it too, so the mesh's contents and order are
    // unchanged from the fused pass.
    const pen = { vertices, used: 0 };
    function box(actor, s, c, x, y, z, width, height, depth, red, green, blue) {
      const body = ENEMIES[actor.kind];
      const horizontal = body?.width ?? 1, vertical = body?.height ?? 1;
      for (const { d, v, light } of faces) {
        // Hit flash: red plus a white wash so the hit reads even on dark coats.
        const shadeR = Math.min(1, red * light + actor.hurt * 2);
        const shadeG = Math.min(1, green * light + actor.hurt * 1.2);
        const shadeB = Math.min(1, blue * light + actor.hurt * 1.2);
        const nx = d[0] * c + d[2] * s;
        const nz = -d[0] * s + d[2] * c;
        for (const [vx, vy, vz] of v) {
          const px = (x + vx * width) * horizontal, pz = (z + vz * depth) * horizontal;
          vertices[pen.used++] = actor.x + px * c + pz * s;
          vertices[pen.used++] = actor.y + (y + vy * height) * vertical;
          vertices[pen.used++] = actor.z - px * s + pz * c;
          vertices[pen.used++] = shadeR;
          vertices[pen.used++] = shadeG;
          vertices[pen.used++] = shadeB;
          vertices[pen.used++] = nx;
          vertices[pen.used++] = d[1];
          vertices[pen.used++] = nz;
          vertices[pen.used++] = 0;
          vertices[pen.used++] = 0;
          vertices[pen.used++] = 0;
        }
      }
    }
    if (boss) {
      bossRender.drawBossSection(pen, { boss, bossModel, player, finished, covered: bossHasCover(), decals: groundDecals, box });
    }
    for (const zombie of survival.zombies) {
      const style = ENEMIES[zombie.kind] ?? ENEMIES.walker;
      const s = Math.sin(zombie.angle), c = Math.cos(zombie.angle);
      zombieParts(zombie, style, (...part) => box(zombie, s, c, ...part));
    }
    // Thrown globs are small bright-green cubes, so the player can see
    // the throw coming and dodge it.
    for (const shot of survival.projectiles) {
      box(shot, 0, 1, -.12, -.12, -.12, .24, .24, .24, .45, .85, .30);
    }
    const beacon = defense.beacon;
    if (beacon) {
      const s = Math.sin(defense.elapsed * .82), c = Math.cos(defense.elapsed * .82);
      beaconParts(beacon, defense.elapsed, (...part) => box(beacon, 0, 1, ...part), (...part) => box(beacon, s, c, ...part));
    }
    gl.uniform3f(targetLocation, -1, -1, -1);
    uploadActorMesh(actorMesh, pen.used);
  }

  function cycleWeather() {
    weather.index = (weather.index + 1) % weatherTypes.length;
    weather.elapsed = 0;
  }

  function updateWeather(dt) {
    const target = weatherTypes[weather.index];
    weather.elapsed += dt;
    dayTime += dt;
    if (weather.elapsed >= target.seconds) cycleWeather();
    const blend = 1 - Math.exp(-2.1 * dt);
    weather.sky = weather.sky.map((v, i) => v + (target.sky[i] - v) * blend);
    weather.fog = weather.fog.map((v, i) => v + (target.fog[i] - v) * blend);
    weather.light += (target.light - weather.light) * blend;
    weather.rain += (target.rain - weather.rain) * blend;
    weather.phase += dt;
  }

  function underRoof() {
    const x = Math.floor(player.x), z = Math.floor(player.z);
    for (let y = Math.ceil(player.y + 1.6); y < H; y++) {
      const type = get(x, y, z);
      if (type && type !== LEAF) return true;
    }
    return false;
  }

  // 3D rain: one seeded streak per drop, in a 14x14 field that follows
  // the player.  `phase`/`speed` drive the fall cycle against
  // weather.phase, so a drop falls, vanishes below the ground (the terrain
  // occludes it), and restarts at the top.
  const rainDrops = Array.from({ length: 180 }, (_, i) => ({
    phase: seeded(i, 21), speed: .5 + seeded(i, 7) * .5,
    x: (seeded(i, 15) - .5) * 14, z: (seeded(i, 29) - .5) * 14,
    length: .35 + .3 * seeded(i, 43)
  }));

  function heldSprite(type) {
    if (blockSprites.has(type)) return blockSprites.get(type);
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 96;
    const texture = sprite.getContext("2d");
    if (!texture) return null;
    const colors = blockColors[type];

    function face(points, shade, side) {
      const [origin, right, , down] = points;
      texture.save();
      texture.transform((right[0] - origin[0]) / 16, (right[1] - origin[1]) / 16,
        (down[0] - origin[0]) / 16, (down[1] - origin[1]) / 16, ...origin);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const soil = type === GRASS && side && y > 2 + Math.floor(seeded(x, 19) * 2);
        const base = soil ? blockColors[DIRT] : colors;
        const variation = .83 + seeded(x + type * 17, y + (side ? 11 : 29)) * .27;
        const rgb = base.map(value => Math.round(Math.min(1, value * shade * variation) * 255));
        texture.fillStyle = `rgb(${rgb.join(",")})`;
        texture.fillRect(x, y, 1.016, 1.016);
      }
      texture.restore();
      texture.beginPath();
      texture.moveTo(...origin);
      for (const point of points.slice(1)) texture.lineTo(...point);
      texture.closePath();
      texture.strokeStyle = "rgba(21, 26, 22, .48)";
      texture.lineWidth = 1.1;
      texture.stroke();
    }

    const left = [10, 29], top = [48, 8], right = [86, 29], front = [48, 50];
    const bottomLeft = [10, 67], bottomFront = [48, 88], bottomRight = [86, 67];
    face([left, front, bottomFront, bottomLeft], .78, true);
    face([front, right, bottomRight, bottomFront], .62, true);
    face([left, top, right, front], 1.19, false);
    blockSprites.set(type, sprite);
    return sprite;
  }

  function drawHeldBlock(type, width, height) {
    const size = Math.min(height * .27, width * .225);
    const motion = Math.sin(Math.PI * (1 - player.handAction / blockActionTime));
    fx.save();
    fx.translate(width * .842 - size * motion * .13, height * .928 + size * motion * .13);
    fx.rotate(-.14 - .10 * motion);
    fx.fillStyle = "#33454a";
    fx.fillRect(size * .035, size * .055, size * .37, size * .50);
    fx.fillStyle = "#a48262";
    fx.fillRect(size * .008, -size * .055, size * .33, size * .16);
    fx.fillStyle = "#c2a188";
    fx.fillRect(size * .008, -size * .055, size * .29, size * .055);
    fx.restore();
    const sprite = type === AIR ? null : heldSprite(type);
    if (!sprite) return;
    fx.save();
    fx.imageSmoothingEnabled = false;
    fx.drawImage(sprite, width * .842 - size * (.60 + motion * .13),
      height * .905 + size * motion * .13 - size * .78, size, size);
    fx.restore();
  }

  function projectEffect(vp, [x, y, z], width, height) {
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (w < .07) return null;
    const screenX = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w;
    const screenY = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w;
    return [(1 + screenX) * width * .5, (1 - screenY) * height * .5, w];
  }

  // Impact dressing on the strike frame (batch 49): slam cracks and
  // stone bursts for the shockwaves, impact bursts and scorch for
  // the falling attacks, the torn strip for the rift. All of it is
  // presentation — decals and particles, never fight state.
  function cueBossImpact() {
    if (!boss?.attack) return;
    const action = boss.attack, plan = BOSS_ATTACKS[action.kind];
    const floor = boss.y;
    const burst = (x, y, z, count, options) => {
      bossParticles.push(...createBurst(x, y, z, count, { ...options, seed: ++burstCounter * 7919 }));
      if (bossParticles.length > 160) bossParticles.splice(0, bossParticles.length - 160);
    };
    if (action.kind === "shock" || action.kind === "nova") {
      groundDecals.push({ kind: "cracks", x: action.x, z: action.z, radius: plan.reach * .35, age: 0, ttl: 1 });
      burst(boss.x, floor + .15, boss.z, 12,
        { colors: [[.29, .075, .022], [.075, .086, .105], [.62, .34, .16]], speed: 2.6, up: 2.4, size: .11, life: .7, floor });
    } else if (action.kind === "flare" || action.kind === "meteor") {
      const marks = action.marks ?? [action];
      const colors = boss.profile === COLOSSUS ? [[.55, .30, .90], [.75, .45, 1]] : [[1, .45, .10], [1, .65, .20]];
      for (const mark of marks) {
        burst(mark.x, floor + .2, mark.z, 14, { colors, speed: 2.8, up: 2.8, size: .11, life: .7, floor });
        groundDecals.push({ kind: "scorch", x: mark.x, z: mark.z, radius: plan.reach * .8, age: 0, ttl: 2 });
      }
    } else if (action.kind === "rift") {
      groundDecals.push({ kind: "rift", x: action.x, z: action.z, angle: action.angle,
        width: action.width, length: plan.reach, age: 0, ttl: 1.5 });
    }
  }

  function cueGuardianFx(cue) {
    if (boss?.profile !== BOSS) return;
    guardianFx.kind = boss.attack?.kind ?? null;
    if (cue === "boss-charge") guardianFx.charge = 1;
    if (cue === "boss-strike") guardianFx.strike = 1;
    if (cue === "boss-exposed") guardianFx.exposed = 1;
  }

  function drawGuardianCinematic(vp, width, height) {
    if (!boss || boss.profile !== BOSS) return;
    const core = projectEffect(vp, [boss.x, boss.y + 1.9, boss.z], width, height);
    const crown = projectEffect(vp, [boss.x, boss.y + 3.08, boss.z], width, height);
    if (!core || !crown) return;
    const [x, y, depth] = core;
    const unit = Math.max(5, Math.min(30, 160 / depth));
    const action = boss.attack;
    const winding = boss.state === "windup" && action;
    const striking = boss.state === "attack" && action;
    const vulnerable = boss.state === "recovery";
    const windup = winding ? 1 - boss.time / action.windup : 0;
    const release = striking ? 1 - boss.time / BOSS_ATTACKS[action.kind].duration : 0;
    const heat = vulnerable ? [83, 255, 218] : boss.phase === 1 ? [255, 75, 22]
      : boss.phase === 2 ? [255, 113, 25] : [255, 176, 44];
    const color = `rgb(${heat.join(",")})`;
    const pale = vulnerable ? "#d6fff0" : "#fff1ca";
    fx.save();
    fx.globalCompositeOperation = "lighter";
    // A breathing core plus tilted fragments makes the charge read as a
    // volume of heat and rotating hardware, not another UI-shaped circle.
    if (winding || striking || vulnerable) {
      const charge = winding ? windup : striking ? 1 - release * .62 : .52;
      const aura = unit * (2.2 + charge * 2.6);
      const gradient = fx.createRadialGradient(x, y, 0, x, y, aura);
      gradient.addColorStop(0, `rgba(${heat.join(",")},${.36 + charge * .34})`);
      gradient.addColorStop(.28, `rgba(${heat.join(",")},${.13 + charge * .14})`);
      gradient.addColorStop(1, `rgba(${heat.join(",")},0)`);
      fx.fillStyle = gradient;
      fx.fillRect(x - aura, y - aura, aura * 2, aura * 2);
      const fragments = 8 + boss.phase * 2;
      fx.lineCap = "round";
      for (let i = 0; i < fragments; i++) {
        const angle = boss.elapsed * (2.4 + boss.phase * .38) + i * 2.39996;
        const orbit = unit * (1.15 + charge * 1.65 + (i % 3) * .25);
        const tail = unit * (.42 + charge * .9) * (i % 2 ? 1 : .64);
        const sx = x + Math.cos(angle) * orbit, sy = y + Math.sin(angle) * orbit * .62;
        fx.globalAlpha = .25 + charge * .48;
        fx.strokeStyle = i % 3 ? color : pale;
        fx.lineWidth = Math.max(1, unit * (.08 + (i % 3) * .025));
        fx.beginPath();
        fx.moveTo(sx - Math.cos(angle) * tail, sy - Math.sin(angle) * tail * .62);
        fx.lineTo(sx + Math.cos(angle) * tail * .26, sy + Math.sin(angle) * tail * .16);
        fx.stroke();
      }
      // Heat columns link the chest and crown during a wind-up.
      if (winding && action.kind !== "ram") {
        const ribbons = 3 + boss.phase;
        for (let i = 0; i < ribbons; i++) {
          const t = (boss.elapsed * 1.8 + i / ribbons) % 1;
          const sway = Math.sin(boss.elapsed * 8 + i * 2.7) * unit * .75;
          fx.globalAlpha = .14 + windup * .26;
          fx.strokeStyle = color;
          fx.lineWidth = Math.max(1, unit * .055);
          fx.beginPath();
          fx.moveTo(x + sway, y + unit * (1.35 - t));
          fx.quadraticCurveTo(x - sway * .55, (y + crown[1]) * .5, crown[0] + sway * .28, crown[1] + unit * .18);
          fx.stroke();
        }
      }
    }
    const impact = Math.max(guardianFx.strike, guardianFx.hit);
    if (impact > .001) {
      const p = 1 - impact;
      const radius = unit * (2 + p * 10);
      const blast = fx.createRadialGradient(x, y, 0, x, y, radius);
      blast.addColorStop(0, `rgba(255,244,205,${impact * .48})`);
      blast.addColorStop(.22, `rgba(${heat.join(",")},${impact * .34})`);
      blast.addColorStop(1, `rgba(${heat.join(",")},0)`);
      fx.fillStyle = blast;
      fx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      fx.globalAlpha = impact * .65;
      fx.strokeStyle = pale;
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2 + boss.elapsed * .8;
        const inner = unit * (1.1 + (i % 3) * .22), outer = radius * (.7 + (i % 4) * .075);
        fx.lineWidth = Math.max(1, unit * .05 * impact);
        fx.beginPath();
        fx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        fx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
        fx.stroke();
      }
    }
    if (guardianFx.exposed > .001) {
      const p = 1 - guardianFx.exposed;
      fx.globalAlpha = guardianFx.exposed * .5;
      fx.strokeStyle = "#a5fff0";
      fx.lineWidth = Math.max(1.5, unit * .11);
      for (let i = 0; i < 3; i++) {
        fx.beginPath();
        fx.ellipse(x, y, unit * (1.3 + p * 3.8 + i * .48), unit * (.44 + p * 1.2 + i * .14), -.23, 0, Math.PI * 2);
        fx.stroke();
      }
    }
    // Attack-specific overlays use projected world positions, so the energy
    // belongs to the move's path rather than sitting as a decorative HUD ring.
    if (action && (winding || striking)) {
      const floor = boss.profile.arena.floor + .08;
      const progress = winding ? windup : release;
      fx.lineCap = "round";
      if (action.kind === "ram") {
        const plan = BOSS_ATTACKS.ram;
        const s = Math.sin(action.angle), c = Math.cos(action.angle);
        const length = striking ? Math.max(.6, action.travelled) : action.length;
        for (let lane = -2; lane <= 2; lane++) {
          const side = lane * .24;
          const from = projectEffect(vp, [action.x + c * side, floor + .20, action.z - s * side], width, height);
          const to = projectEffect(vp, [action.x + s * length + c * side, floor + .25, action.z + c * length - s * side], width, height);
          if (!from || !to) continue;
          const head = striking ? 1 : Math.min(1, .14 + progress * 1.12);
          fx.globalAlpha = (striking ? .24 : .14 + progress * .20) * (lane === 0 ? 1 : .62);
          fx.strokeStyle = lane === 0 ? "#ffe0a3" : color;
          fx.lineWidth = Math.max(1, unit * (.035 + (2 - Math.abs(lane)) * .018));
          fx.beginPath();
          fx.moveTo(from[0], from[1]);
          fx.lineTo(from[0] + (to[0] - from[0]) * head, from[1] + (to[1] - from[1]) * head);
          fx.stroke();
        }
      } else if (action.kind === "flare" && action.marks) {
          for (const mark of action.marks) {
          const ground = projectEffect(vp, [mark.x, floor, mark.z], width, height);
            if (!ground) continue;
          if (striking) {
            fx.globalAlpha = .58 * (1 - release);
            const burst = unit * (2 + release * 8);
            const fire = fx.createRadialGradient(ground[0], ground[1], 0, ground[0], ground[1], burst);
            fire.addColorStop(0, "#fff3bc"); fire.addColorStop(.22, "#ff7024"); fire.addColorStop(1, "rgba(255,42,8,0)");
            fx.fillStyle = fire; fx.fillRect(ground[0] - burst, ground[1] - burst, burst * 2, burst * 2);
          }
        }
      } else if (action.kind === "shock" && striking) {
        const points = [];
        for (let i = 0; i <= 40; i++) {
          const angle = i / 40 * Math.PI * 2;
          const point = projectEffect(vp, [action.x + Math.sin(angle) * action.radius, floor + .12, action.z + Math.cos(angle) * action.radius], width, height);
          if (point) points.push(point);
        }
        if (points.length > 8) {
          fx.globalAlpha = .33;
          fx.strokeStyle = "#ffc166";
          fx.lineWidth = Math.max(1.5, unit * .12);
          fx.beginPath();
          points.forEach(([px, py], i) => i ? fx.lineTo(px, py) : fx.moveTo(px, py));
          fx.closePath(); fx.stroke();
        }
      }
    }
    fx.restore();
  }

  function drawPulseShot(vp, width, height, muzzleX, muzzleY, unit) {
    if (!pulse.shot) return;
    const { charged, endpoint, age, duration, impact, seed, style } = pulse.shot;
    const screen = projectEffect(vp, endpoint, width, height);
    if (!screen) return;
    const [x, y, depth] = screen;
    const fade = 1 - age / duration;
    const rapid = style === "rapid" && !charged;
    const beam = charged ? "#ffd19a" : rapid ? "#bcff99" : "#83e9f3";
    fx.save();
    if (age < (charged ? .15 : .065)) {
      fx.globalAlpha = fade * .85;
      fx.beginPath();
      const head = rapid ? Math.min(1, .32 + age * 23) : 1;
      const tail = rapid ? Math.max(0, head - .36) : 0;
      fx.moveTo(muzzleX + (x - muzzleX) * tail, muzzleY + (y - muzzleY) * tail);
      fx.lineTo(muzzleX + (x - muzzleX) * head, muzzleY + (y - muzzleY) * head);
      fx.lineWidth = unit * (charged ? 2.5 : .8);
      fx.strokeStyle = beam;
      fx.stroke();
      fx.globalAlpha = fade;
      fx.lineWidth *= .32;
      fx.strokeStyle = "#f6ffff";
      fx.stroke();
    }
    if (impact) {
      const sparks = charged ? 14 : 7;
      const tint = impact === "core" ? "#90fcf6" : impact === "crystal" ? "#ffd29a" : impact === "armor" ? "#d3a0ff" : "#a2b1c9";
      const size = Math.min(5, Math.max(.9, 22 / depth)) * unit * .30;
      fx.globalAlpha = fade;
      fx.strokeStyle = tint;
      fx.lineCap = "round";
      for (let i = 0; i < sparks; i++) {
        const angle = seed + i * 2.39996;
        const spread = age * size * (17 + i % 4 * 4);
        const spark = size * (1.25 - i % 3 * .22) * fade;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const drop = age * age * size * 16;
        fx.beginPath();
        fx.moveTo(x + dx * spread * .72, y + dy * spread * .72 + drop);
        fx.lineTo(x + dx * spread, y + dy * spread + drop);
        fx.lineWidth = Math.max(.5, spark);
        fx.stroke();
      }
      if (charged || impact === "core") {
        fx.beginPath();
        fx.arc(x, y, (1 + age * 23) * size, 0, 2 * Math.PI);
        fx.strokeStyle = tint;
        fx.lineWidth = Math.max(1, size * .36 * fade);
        fx.stroke();
      }
    }
    fx.restore();
  }

  function drawPulseWeapon(projection) {
    const width = fxCanvas.width, height = fxCanvas.height;
    const charge = (pulse.charge ?? 0) / pulseBurst.windup;
    const shot = pulse.shot;
    let recoil = 0;
    if (shot && shot.style === weapons[selected - palette.length]?.style) {
      const settle = shot.charged ? .37 : shot.style === "rapid" ? .12 : .21;
      const t = Math.min(1, shot.age / settle);
      const kick = shot.charged ? 1.75 : shot.style === "rapid" ? .65 : 1;
      recoil = kick * Math.pow(1 - t, 2) * Math.cos(t * 4.4);
    }
    const gait = Math.min(1, Math.hypot(player.vx, player.vz) / 4.2);
    const gun = pulseViewModel({
      style: weapons[selected - palette.length]?.style,
      charge, recharge: pulse.recharge / pulseWeapon.recharge, recoiling: recoil, ammo: pulse.rounds,
      charged: charge === 1 || Boolean(pulse.shot?.charged),
      bob: [Math.sin(stepDistance * 3) * gait * .012, Math.cos(stepDistance * 6) * gait * .010]
    });
    viewModelMesh ??= createActorMesh(2600);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform3f(cameraLocation, 0, 0, 0);
    gl.uniformMatrix4fv(viewProjectionLocation, false, projection);
    gl.uniform1f(fogDensityLocation, 0);
    const used = appendModel(viewModelMesh.vertices, 0, gun.parts, 0, true);
    uploadActorMesh(viewModelMesh, used);
    return projectEffect(projection, gun.muzzle, width, height);
  }

  function drawMeleeWeapon(projection) {
    const gait = Math.min(1, Math.hypot(player.vx, player.vz) / 4.2);
    const weapon = weapons[selected - palette.length];
    const model = meleeViewModel({
      style: weapon?.style ?? "sword",
      swing: player.swing,
      bob: [Math.sin(stepDistance * 3) * gait * .012, Math.cos(stepDistance * 6) * gait * .010]
    });
    viewModelMesh ??= createActorMesh(2600);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform3f(cameraLocation, 0, 0, 0);
    gl.uniformMatrix4fv(viewProjectionLocation, false, projection);
    gl.uniform1f(fogDensityLocation, 0);
    const used = appendModel(viewModelMesh.vertices, 0, model.parts, 0, true);
    uploadActorMesh(viewModelMesh, used);
    return null;
  }

  function drawPulseMuzzle(muzzle, vp, width, height) {
    if (!muzzle) return;
    const [x, y] = muzzle, unit = Math.min(width, height) / 150;
    const amount = (pulse.charge ?? 0) / pulseBurst.windup;
    drawPulseShot(vp, width, height, x, y, unit);
    if (amount > 0) {
      fx.beginPath();
      fx.arc(x, y, unit * (2.4 + amount * 1.4), -.5 * Math.PI, (-.5 + 2 * amount) * Math.PI);
      fx.lineWidth = Math.max(1.5, unit * .26);
      fx.strokeStyle = amount >= 1 ? "#ffd29a" : "#77e5e3";
      fx.stroke();
    }
    const shot = pulse.shot;
    if (!shot || shot.style !== weapons[selected - palette.length]?.style) return;
    const flashTime = shot.charged ? .145 : shot.style === "rapid" ? .055 : .085;
    if (shot.age >= flashTime) return;
    const t = shot.age / flashTime;
    const radius = unit * (shot.charged ? 7 : 3.4) * (1 - .55 * t);
    const target = projectEffect(vp, shot.endpoint, width, height);
    const angle = target ? Math.atan2(target[1] - y, target[0] - x) : -2.4;
    const hue = shot.charged ? "255,125,38" : shot.style === "rapid" ? "156,255,90" : "83,226,246";
    fx.save();
    fx.translate(x, y);
    fx.rotate(angle);
    fx.globalCompositeOperation = "lighter";
    fx.globalAlpha = 1 - t;
    const flare = fx.createRadialGradient(0, 0, 0, 0, 0, radius);
    flare.addColorStop(0, "#fffbe9");
    flare.addColorStop(.24, "rgba(" + hue + ",.8)");
    flare.addColorStop(1, "rgba(" + hue + ",0)");
    fx.fillStyle = flare;
    fx.fillRect(-radius, -radius, 2 * radius, 2 * radius);
    const jets = shot.charged ? 5 : 3;
    for (let i = 0; i < jets; i++) {
      fx.save();
      fx.rotate((i - (jets - 1) / 2) * (shot.charged ? .43 : .19));
      fx.scale(1.15 + .65 * Math.sin(shot.seed + i * 2.4), .13 + .08 * (i % 2));
      fx.fillRect(0, -radius, radius, radius * 2);
      fx.restore();
    }
    fx.restore();
  }

  // Mining cracks: jagged seeded lines on the hit face of the block being
  // mined, clipped to that face's projected quad so they never spill onto
  // neighbouring blocks.  The lines are deterministic per block and each
  // stage only adds lines, so cracks grow while the player holds the
  // button instead of jumping around.
  function drawMiningCracks(hit, progress, vp, width, height) {
    const stage = crackStage(progress);
    if (!stage || !hit.face) return;
    const projected = faceCorners(hit.hit, hit.face)
      .map(corner => projectEffect(vp, corner, width, height));
    if (projected.some(point => !point)) return;
    const at = ([u, v]) => {
      const top = [projected[0][0] + (projected[1][0] - projected[0][0]) * u,
        projected[0][1] + (projected[1][1] - projected[0][1]) * u];
      const bottom = [projected[3][0] + (projected[2][0] - projected[3][0]) * u,
        projected[3][1] + (projected[2][1] - projected[3][1]) * u];
      return [top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v];
    };
    fx.save();
    fx.beginPath();
    fx.moveTo(projected[0][0], projected[0][1]);
    for (const point of projected.slice(1)) fx.lineTo(point[0], point[1]);
    fx.closePath();
    fx.clip();
    fx.strokeStyle = "rgba(22, 15, 10, 0.85)";
    fx.lineWidth = Math.max(1.5, height / 360);
    fx.lineJoin = "round";
    for (const line of crackPolylines(hit.hit[0], hit.hit[1], hit.hit[2], stage)) {
      fx.beginPath();
      line.forEach(([u, v], i) => {
        const [sx, sy] = at([u, v]);
        if (i) fx.lineTo(sx, sy); else fx.moveTo(sx, sy);
      });
      fx.stroke();
    }
    fx.restore();
  }

  function drawEffects(weapon, block, rain, vp, muzzle) {
    if (!fx) return;
    const width = fxCanvas.width, height = fxCanvas.height;
    const hasEffects = started && (rain > .02 || player.hurt > 0 || player.hp > 0);
    if (effectsVisible) fx.clearRect(0, 0, width, height);
    effectsVisible = hasEffects;
    if (!hasEffects) return;
    drawGuardianCinematic(vp, width, height);
    if (boss?.profile === BOSS) {
      // Subtle soot vignette and heat lift give the whole encounter one visual
      // language, while leaving the central warning area clear for play.
      const soot = fx.createRadialGradient(width * .5, height * .50, height * .18, width * .5, height * .52, Math.hypot(width, height) * .68);
      soot.addColorStop(0, "rgba(13,4,2,0)");
      soot.addColorStop(.62, "rgba(18,5,2,.025)");
      soot.addColorStop(1, "rgba(8,2,1,.22)");
      fx.fillStyle = soot;
      fx.fillRect(0, 0, width, height);
      const heat = Math.min(1, boss.state === "attack" ? .85 : boss.state === "windup" ? .48 : .18);
      fx.globalCompositeOperation = "lighter";
      fx.globalAlpha = heat * .12;
      const glow = fx.createLinearGradient(0, height, 0, height * .38);
      glow.addColorStop(0, "rgba(255,55,8,.55)");
      glow.addColorStop(1, "rgba(255,55,8,0)");
      fx.fillStyle = glow;
      fx.fillRect(0, height * .38, width, height * .62);
      // Near-camera ash fills the otherwise empty upper volume.  It is slow
      // and sparse enough not to compete with the danger indicators.
      fx.globalCompositeOperation = "lighter";
      fx.lineCap = "round";
      for (let i = 0; i < 58; i++) {
        const seed = i * 12.9898;
        const fall = (boss.elapsed * (.055 + (i % 5) * .009) + i * .173) % 1;
        const x = ((Math.sin(seed) * .5 + .5 + fall * (.05 + (i % 3) * .014)) % 1) * width;
        const y = fall * height * 1.13 - height * .08;
        const drift = Math.sin(boss.elapsed * .9 + seed) * (5 + i % 7 * 1.6);
        const alpha = .08 + (i % 4) * .026;
        fx.globalAlpha = alpha * (.55 + heat * .45);
        fx.strokeStyle = i % 7 ? "#ff6b22" : "#ffe0a2";
        fx.lineWidth = i % 7 ? 1 : 1.8;
        fx.beginPath();
        fx.moveTo(x, y);
        fx.lineTo(x + drift, y + 3 + (i % 5) * 1.8);
        fx.stroke();
      }
      fx.globalAlpha = 1;
      fx.globalCompositeOperation = "source-over";
    }
    if (player.hurt > 0) {
      const vignette = fx.createRadialGradient(width * .5, height * .5, height * .24, width * .5, height * .5, Math.hypot(width, height) * .52);
      vignette.addColorStop(0, "rgba(151,34,26,0)");
      vignette.addColorStop(1, `rgba(151,34,26,${player.hurt * 1.75})`);
      fx.fillStyle = vignette;
      fx.fillRect(0, 0, width, height);
    }
    // Damage numbers float up from the hit point; debris flies out of a
    // broken block; the ring around the crosshair shows hold-to-mine
    // progress toward the next block break.
    for (const number of damageNumbers) {
      const screen = projectEffect(vp, [number.x, number.y + number.age * 1.4, number.z], width, height);
      if (!screen) continue;
      fx.globalAlpha = Math.max(0, 1 - number.age / .9);
      // A floor on the size (batch 48): a floater never renders
      // under an 18px equivalent however far the hit was, and a
      // core hit is big gold so it cannot be mistaken for a
      // zombie number.
      fx.font = `700 ${number.core ? Math.max(24, Math.floor(height / 28)) : Math.max(18, Math.floor(height / 40))}px sans-serif`;
      fx.textAlign = "center";
      fx.fillStyle = number.core ? "#ffcf3f" : "#ffd166";
      fx.fillText(number.text, screen[0], screen[1]);
    }
    for (const piece of debris) {
      const screen = projectEffect(vp, [piece.x, piece.y, piece.z], width, height);
      if (!screen) continue;
      const size = Math.max(2, Math.min(8, 60 / screen[2]));
      fx.globalAlpha = Math.max(0, 1 - piece.age / .6);
      fx.fillStyle = piece.color;
      fx.fillRect(screen[0] - size / 2, screen[1] - size / 2, size, size);
    }
    fx.globalAlpha = 1;
    if (mouseHeld && player.hp && !isGun(weapon)) {
      const { origin, direction } = renderedView ?? { origin: eye(), direction: viewDirection() };
      const hit = raycast(origin, direction, interactionReach);
      if (hit) {
        const progress = Math.min(1, mouseHeldRepeat / currentMiningInterval());
        drawMiningCracks(hit, progress, vp, width, height);
        fx.beginPath();
        fx.arc(width / 2, height / 2, Math.max(10, height / 45), -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        fx.strokeStyle = "#ffd166";
        fx.lineWidth = Math.max(2, height / 240);
        fx.stroke();
      }
    }
    if (!player.hp) return;
    if (!weapon) { drawHeldBlock(block, width, height); return; }
    if (isGun(weapon)) { drawPulseMuzzle(muzzle, vp, width, height); return; }
    // Melee weapons are 3D view models now (drawMeleeWeapon); nothing to
    // draw on the 2D overlay for them.
  }

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  // The progress record shown after the wave line, between waves: best
  // wave and total kills, plus each boss's kill count. A part is shown
  // only when it is nonzero, so a record with no boss kills reads
  // exactly as before; a boss kill with no wave yet still shows
  // ("熔炉守卫 1 次"), the same rule menuRecordText uses.
  function recordSuffix(bestWave) {
    if (!savedProgress) return "";
    const parts = [];
    if (bestWave > 0) parts.push(`最佳第 ${bestWave} 波`, `累计击退 ${savedProgress.kills} 只`);
    for (const [id, count] of Object.entries(savedProgress.bossKills ?? {})) {
      if (count > 0) parts.push(`${bossDisplayName(id)} ${count} 次`);
    }
    return parts.length ? ` · ${parts.join(" · ")}` : "";
  }

  // The display name for a boss id, falling back to the id itself so a
  // future boss still shows.
  function bossDisplayName(id) {
    return id === BOSS.id ? BOSS.name : id === COLOSSUS.id ? COLOSSUS.name : id;
  }

  // The progress record on the main menu: furthest wave, total kills,
  // and per-boss kill counts. A part is shown only when it is nonzero,
  // so a fresh record renders as an empty line (hidden); a boss kill
  // with no wave yet still shows ("熔炉守卫 1 次").
  function menuRecordText(record) {
    if (!record) return "";
    const parts = [];
    const bestWave = record.bestWave ?? record.wave;
    if (bestWave > 0) parts.push(`最佳第 ${bestWave} 波`);
    if (record.kills > 0) parts.push(`累计击退 ${record.kills} 只`);
    for (const [id, count] of Object.entries(record.bossKills ?? {})) {
      if (count > 0) parts.push(`${bossDisplayName(id)} ${count} 次`);
    }
    return parts.join(" · ");
  }

  // Show the saved progress record on the main menu. Errors write their
  // own text into the same line and win: while the graphics are lost the
  // notice stays on the line, and any error set afterwards overwrites it.
  function showMenuRecord() {
    if (graphicsLost) {
      menuStatus.hidden = false;
      return;
    }
    const text = menuRecordText(campaign.loadProgress());
    menuStatus.hidden = text === "";
    setText(menuStatus, text);
  }

  function updateStatus(aim, weapon) {
    const { speed, jump, landing } = speedReadout;
    setText(currentSpeed, speed.toFixed(2));
    setText(jumpSpeed, jump ? `${jump.takeoff.toFixed(2)} → ${jump.peak.toFixed(2)}` : "待起跳");
    setText(landingSpeedValue, landing ? `${landing.at.toFixed(2)} → ${landing.after?.toFixed(2) ?? "…"}` : "待落地");
    setText(weatherStatus, boss ? boss.profile.arena.name : weatherTypes[weather.index].name);
    const enemiesLeft = survival.zombies.length;
    const beacon = defense.beacon;
    defenseHud.hidden = !beacon;
    stageTime.hidden = !beacon;
    hudUi.setBossVisible(Boolean(boss));
    if (boss) {
      const wave = boss.profile === BOSS ? GUARDIAN_WAVES[boss.phase - 1] : null;
      const bar = bossBar(boss);
      const maxHp = bar.maxHp;
      // The right-top line carries one job per boss (batch 48): the
      // guardian shows its minion count and one plain-language tip —
      // the wave itself is reported only in the boss hud — and the
      // colossus shows just its phase, its skills living on the two
      // chips under the health bar instead of crowding this line.
      const statusText = wave
        ? `场上随从 ${enemiesLeft} 只 · ${["守卫蓄力时绕到背后打核心", "先打倒随从，能打断守卫放火", "躲开冲锋，它撞空后反击时间更长"][boss.phase - 1]}`
        : `第 ${bar.index} / ${bar.count} 管 · ${bar.name}`;
      const bossNameText = wave ? `熔炉守卫 · 第 ${boss.phase} / ${GUARDIAN_WAVES.length} 管 · ${wave.name}` : null;
      const attack = boss.attack && BOSS_ATTACKS[boss.attack.kind];
      // The bar-3 nova is a three-ring move (batch 61); its name
      // and hint say so wherever the shared table would say two.
      const tripleNova = boss.profile === BOSS && boss.phase === 3 && boss.attack?.kind === "nova";
      const giantTriple = boss.profile === COLOSSUS && boss.phase === 4 && boss.attack?.kind === "nova";
      const quadPrism = boss.profile === COLOSSUS && boss.phase === 4 && boss.attack?.kind === "prism";
      const chain = boss.profile === COLOSSUS && boss.attack?.kind === "meteor" ? boss.attack.chainTotal ?? 1 : 1;
      const attackName = tripleNova || giantTriple ? "三环星震"
        : quadPrism ? "四轨折光"
        : boss.attack?.pending ? "追星坠落 · 连珠"
        : attack?.name;
      const attackHint = tripleNova ? "三圈冲击波！前两圈慢、第三圈快，数着节奏跳三次"
        : giantTriple ? "三圈冲击波！前两圈往外扩、第三圈往回收，数着节奏跳三次"
        : quadPrism ? "四道光束要亮了！站到光束之间的空地，或打碎金色晶体"
        : boss.attack?.pending ? "还有陨石要落！别停在原地，继续跑"
        : chain > 1 ? "陨石连着砸！每一颗落下，下一颗会锁你新的位置，继续跑" : attack?.hint;
      const covered = bossHasCover();
      const danger = !finished && insideHazard(boss, { ...player, covered });
      const phaseShiftHint = boss.profile === BOSS && boss.phaseShift > 0
        ? { 2: "守卫进入第二管：火焰变强了！先清随从能打断它放火", 3: "守卫进入第三管：小心它的冲锋，躲开后反击更久" }[boss.phase]
        : null;
      // The colossus's bar-change lines (batch 64), in the
      // guardian's praised shape: the new threat, then the
      // answer to it. The last bar carries the finisher.
      const colossusPhaseLine = boss.profile === COLOSSUS
        ? { 2: "断星巨像进入第二管 · 震星：星环会从场地边上收回来，贴近它或跳过环",
            3: "断星巨像进入第三管 · 逐星：它会冲锋、会升炮台，先打碎空中的晶体",
            4: "断星巨像进入最后一管 · 碎星：它要拼命了！断星升空时，数着环跳" }[boss.phase]
        : null;
      // Phase-change show (batch 49): the first frame of a new
      // phase fires a shock ring out to the arena edge and raises
      // the big banner with the phase sentence; the health bar
      // wears the phase colour for the whole phase. The ring and
      // the banner state live here; hud.mjs only writes them out.
      if (bossPhaseSeen && boss.phase !== bossPhaseSeen) {
        survival.zombies.length = 0;
        groundDecals.push({ kind: "phasering", x: boss.x, z: boss.z, radius: boss.profile.arena.radius, age: 0, ttl: .9,
          color: boss.profile === COLOSSUS ? BAR_COLORS.colossus[boss.phase - 1] : [1, .6, .25] });
        phaseBanner = { text: boss.profile === COLOSSUS ? colossusPhaseLine ?? "" : phaseShiftHint ?? "", until: boss.elapsed + 1.5 };
      }
      bossPhaseSeen = boss.phase;
      // Danger sentences per kind: the plan's kept variants first,
      // the rest in the same "where you are, then what to do" shape.
      const dangerHint = boss.attack && {
        repel: "退到圆圈外",
        nova: "震圈逼近，准备起跳",
        meteor: "脚下已锁定，立刻跑开",
        rift: "你在光带中，向侧面闪避",
        sweep: "你在红扇子里，从侧边跑出去",
        flare: "你在火圈里，快跑出去",
        shock: "震圈到脚下了，跳！",
        ram: "你在冲锋线上，往侧边躲",
        prism: "你在光束里，站到空地上",
        charge: "你在冲锋线上，往侧边躲",
        converge: "震圈逼近，准备起跳",
        starfall: "震圈逼近，准备起跳",
        turret: "脚下已锁定，立刻跑开"
      }[boss.attack.kind];
      const callout = finished ? "挑战结束"
        : phaseShiftHint ? phaseShiftHint
        : boss.state === "ready" ? (boss.profile === COLOSSUS ? "巨像正在逼近，准备闪避" : "守卫靠近中，看它抬手就准备躲")
          : boss.state === "reposition" ? (boss.travel.pursuit ? "巨像追过来了，往侧面跑，别直着后退" : "巨像在换位置，下一招马上来")
          : boss.state === "recovery" ? (boss.profile === COLOSSUS ? "巨像下来了！打中间露出来的核心" : "核心张开了！现在打，伤害最高")
            : boss.attack.kind === "prism" && covered ? `${attackHint} · 掩体遮住折光，换侧瞄准晶体`
            : boss.attack.kind === "prism" && boss.state === "windup" ? attackHint
            : danger ? `${attackName} · ${dangerHint}`
            : boss.state === "attack" && ["shock", "nova", "starfall", "converge"].includes(boss.attack.kind) ? `${attackName} · 跳！`
            : attackHint;
      // The big central warning mirrors the callout for as long as
      // the attack is telegraphed or landing — the moment the
      // player most needs it — and clears with the recovery.
      const warningOn = !finished && (boss.state === "windup" || boss.state === "attack");
      hudUi.updateBossHud({
        name: bossNameText,
        bar: { index: bar.index, count: bar.count, frac: boss.hp / maxHp, ghostFrac: bossGhostHp / maxHp },
        healthText: `${boss.hp} / ${maxHp}`,
        statusText, skillsHidden: boss.profile !== COLOSSUS,
        healReadyAt: boss.healReady, dragonsReadyAt: boss.dragonsReady, elapsed: boss.elapsed,
        callout, warningOn, vulnerable: boss.state === "recovery", danger,
        bannerVisible: Boolean(phaseBanner && phaseBanner.text && boss.elapsed < phaseBanner.until),
        bannerText: phaseBanner?.text ?? ""
      });
    } else if (beacon) {
      const wave = Math.min(DEFENSE_TOTAL_WAVES, enemiesLeft || finished ? survival.wave : survival.wave + 1);
      const plan = DEFENSE_WAVES[Math.min(Math.max(0, wave - 1), DEFENSE_WAVES.length - 1)];
      hudUi.setWaveStatus(`第 ${wave || 1} / ${DEFENSE_TOTAL_WAVES} 波 · ${plan.name}${recordSuffix(savedProgress?.defense.bestWave)}`);
      setText(stageTime, finished ? "防守结束" : enemiesLeft
        ? `剩余 ${enemiesLeft} 只 · 限时 ${Math.ceil(defense.seconds)} 秒`
        : `准备 ${Math.ceil(survival.countdown)} 秒 · 按 B 提前迎敌`);
      if (beaconHealth.value !== beacon.hp) beaconHealth.value = beacon.hp;
      setText(beaconHealthValue, `${beacon.hp} / ${BEACON.hp}`);
      const dx = beacon.x - player.x, dz = beacon.z - player.z;
      const turn = Math.PI * 2;
      const bearing = ((Math.atan2(dx, -dz) - yaw) % turn + turn) % turn;
      const direction = bearing < .70 || bearing > Math.PI * 2 - .70 ? "前方" : bearing < 2.45 ? "右侧" : bearing > 3.83 ? "左侧" : "后方";
      setText(beaconBearing, `信标在${direction} ${Math.hypot(dx, dz).toFixed(1)} 米`);
      setText(defenseActions, `E 维修 · 石头 ${campaign.count(STONE)} / ${BEACON.repairCost}`);
    } else {
      hudUi.setWaveStatus(!survival.enabled ? "自由建造" : enemiesLeft
        ? `第 ${survival.wave} 波 · 剩余 ${enemiesLeft} 只`
        : `第 ${survival.wave + 1} 波 · ${Math.max(1, Math.ceil(survival.countdown))} 秒后${recordSuffix(savedProgress?.wave)}`);
    }
    // The debug coordinates yield to the fight (batch 48): hidden
    // while a boss is up, the arena name beside them stays.
    if (!boss) hudUi.clearBossAlerts();
    hudUi.updateCoordinates(`X ${player.x.toFixed(1)} · Y ${player.y.toFixed(1)} · Z ${player.z.toFixed(1)}`, Boolean(boss));
    const charging = weapon === pulseWeapon && pulse.charge !== null;
    const inReach = aim && aim.distance <= (charging ? pulseBurst : weapon ?? punch).reach;
    const target = aim?.zombie;
    targetStatus.hidden = !aim;
    const backOpen = boss && guardianBackOpen(boss, player);
    const exposed = backOpen || boss?.state === "recovery" && (boss.profile !== COLOSSUS || aim?.weak);
    crosshair.classList.toggle("on-target", Boolean(inReach && (!boss || target || exposed || aim.crystal || aim.turret != null)));
    crosshair.classList.toggle("hit-confirm", player.hitConfirm > 0);
    crosshair.classList.toggle("charged", charging && pulse.charge === pulseBurst.windup);
    const showRecovery = weapon || aim || player.cooldown > 0;
    weaponState.hidden = !showRecovery;
    const hasPulseEquipped = isGun(weapon);
    const recharging = hasPulseEquipped && pulse.recharge > 0;
    pulseInfo.hidden = !hasPulseEquipped;
    pulseHint.hidden = !hasPulseEquipped;
    if (hasPulseEquipped) setText(pulseHint, weapon === pulseWeapon ? "按住左键连射 · 按住右键蓄力爆发" : "按住左键连射 · R 充能");
    if (hasPulseEquipped) setText(pulseInfo, recharging ? "正在充能" : `能量 ${pulse.rounds} / ${pulseWeapon.capacity} · R 充能`);
    if (showRecovery) {
      const availability = recharging ? "充能中" : charging ? (pulse.charge === pulseBurst.windup ? "松开右键发射" : "爆发蓄力中")
        : hasPulseEquipped && !pulse.rounds ? "能量耗尽" : player.cooldown > 0 ? "冷却中" : "可攻击";
      const equipped = campaign.equipment.weapon;
      if (equipped && equipped.durability <= 0 && weapon === punch) {
        setText(weaponLabel, `${WEAPONS[equipped.key].name}已损坏（按 C 修理）`);
        weaponLabel.style.setProperty("color", "#f0d285");
      } else {
        const durabilityText = equipped && weapon === WEAPONS[equipped.key]
          ? ` · 耐久 ${Math.floor(equipped.durability / durabilityMax(equipped.tier) * 100)}%` : "";
        setText(weaponLabel, `${weapon?.name ?? "徒手"} · ${availability}${durabilityText}`);
        weaponLabel.style.setProperty("color", "");
      }
      const remaining = recharging ? pulse.recharge / pulseWeapon.recharge
        : charging ? 1 - pulse.charge / pulseBurst.windup : player.cooldown / player.recoveryTime;
      const recovery = Math.round(100 * (1 - remaining));
      if (weaponRecovery.value !== recovery) weaponRecovery.value = recovery;
    }
    // Food-buff lines (R5) sit under the weapon state row: one per
    // active kind, whole seconds remaining (ceiling, so a live buff
    // never reads 0), gone the frame the buff expires.
    for (const kind of ["speed", "attack"]) {
      const buff = activeBuff(kind);
      hudUi.updateBuffLine(kind, buff ? { label: BUFF_LABELS[kind], pct: buff.pct, remaining: buff.remaining } : null);
    }
    if (boss && aim && !aim.zombie) {
      setText(targetStatus, !inReach ? "超出攻击距离" : aim.crystal ? `金色晶体 ${boss.attack.crystalHp} / ${BOSS_ATTACKS.prism.crystalHp} · 打碎它能停掉光束`
        : aim.turret != null ? `星尘晶体 ${boss.attack.turrets[aim.turret].hp} / ${BOSS_ATTACKS.turret.crystalHp} · 打碎它能停掉炮台`
        : backOpen ? "背部炉门暴露" : exposed ? "核心暴露" : boss.state === "recovery" ? "瞄准青色核心" : "护甲生效中 · 现在打不动，等核心张开");
    } else if (target) {
      const style = ENEMIES[target.kind] ?? ENEMIES.walker;
      const hint = !inReach ? " · 超出攻击距离" : target.windup > 0 ? " · 蓄力" : "";
      setText(targetStatus, `${style.name} ${target.hp} / ${style.hp}${hint}`);
    }
  }
  function updateSoundButton() {
    const label = !sound.available ? "音效不可用" : !sound.enabled ? "音效关闭" : sound.playing ? "音效开启" : "音效待启动";
    for (const button of [soundButton, pauseSoundButton]) {
      button.disabled = !sound.available;
      button.setAttribute("aria-label", `游戏音效，${label}`);
      button.setAttribute("aria-pressed", String(sound.available && sound.enabled));
      setText(button, label);
    }
  }
  function toggleSound() {
    if (!sound.available) return;
    sound.setEnabled(!sound.enabled);
    updateSoundButton();
    if (started) showMessage(soundButton.textContent);
  }
  // Point the sword/axe hotbar slots at the equipped weapon: a crafted
  // sword replaces the stone sword in slot 6, a crafted axe replaces the
  // stone axe in slot 7, and no crafted weapon leaves both slots on
  // their stone defaults. Runs from updateHotbar, so every craft, load
  // and import re-resolves the slots.
  function refreshWeapons() {
    const equipped = campaign.equipment.weapon;
    const stats = equipped ? WEAPONS[equipped.key] : null;
    const broken = equipped && equipped.durability <= 0;
    const sword = stats && weaponBase(equipped.key) === "stoneSword" ? (broken ? punch : stats) : WEAPONS.stoneSword;
    const axe = stats && weaponBase(equipped.key) === "stoneAxe" ? (broken ? punch : stats) : WEAPONS.stoneAxe;
    if (weapons[0] !== sword) weapons[0] = sword;
    if (weapons[1] !== axe) weapons[1] = axe;
  }
  function axeAvailable() {
    if (!survival.enabled || campaign.axeUnlocked) return true;
    const equipped = campaign.equipment.weapon;
    return equipped ? weaponBase(equipped.key) === "stoneAxe" : false;
  }
  function encounterSlots() { return boss?.profile === COLOSSUS ? slotCount : palette.length + 2; }

  function selectSlot(slot) {
    if (slot >= encounterSlots() || (boss && slot < palette.length)) return;
    if (weapons[slot - palette.length]?.style === "axe" && !axeAvailable()) {
      showMessage("石斧需要制作，按 C 打开背包");
      return;
    }
    if (selected === slot) return;
    firing = false;
    input.cancelDrag();
    pulse.charge = null;
    selected = slot;
    updateHotbar();
  }

  function updateHotbar() {
    refreshWeapons();
    const first = boss ? palette.length : 0;
    hotbar.replaceChildren(...Array.from({ length: encounterSlots() - first }, (_, offset) => {
      const i = first + offset;
      const slot = document.createElement("div");
      slot.className = `slot${i === selected ? " selected" : ""}`;
      const weapon = weapons[i - palette.length];
      if (weapon) {
        if (weapon.style === "axe" && !axeAvailable()) {
          slot.classList.add("locked");
          slot.title = "石斧待制作";
          slot.setAttribute("aria-label", "7 石斧，待制作");
        }
        const equipped = campaign.equipment.weapon;
        const durabilityBar = equipped && weapon === WEAPONS[equipped.key]
          ? `<span style="display: block; height: 3px; background: ${equipped.durability / durabilityMax(equipped.tier) < .25 ? "#e4725c" : "#f0d285"}; width: ${Math.floor(equipped.durability / durabilityMax(equipped.tier) * 100)}%;"></span>` : "";
        slot.innerHTML = `<b>${(i + 1) % 10}</b><span class="weapon-swatch ${isGun(weapon) ? "pulse" : weapon.style}-swatch" aria-hidden="true"></span>${weapon.name}${durabilityBar}`;
        return slot;
      }
      const type = palette[i];
      const color = blockColors[type].map(channel => Math.round(channel * 255));
      slot.style.setProperty("--block-color", `rgb(${color.join(" ")})`);
      const quantity = survival.enabled ? `<span class="slot-count">${campaign.count(type)}</span>` : "";
      slot.innerHTML = `<b>${i + 1}</b>${quantity}<span class="swatch" aria-hidden="true"></span>${blockNames[type]}`;
      return slot;
    }));
    setText(hudDressings, healingCountsLabel());
  }

  // Counts of every healing recipe, from the campaign: the HUD label
  // already says 敷料, so the dressing count stands bare and the other
  // recipes are named.
  function healingCountsLabel() {
    const counts = campaign.dressingsByRecipe;
    return HEALING_KEYS.map(key => key === "dressing" ? String(counts[key]) : `${RECIPES[key].name} ${counts[key]}`).join(" · ");
  }

  // Unlock one tech node from its card. A null result means the node
  // was already unlocked or its requirements are not met (the button
  // is disabled then); a conflict pauses the run like a craft does.
  function unlockTech(id) {
    const result = campaign.unlockTech(id);
    if (!result || checkSaveConflict(result)) return;
    updateInventory();
    setText(inventoryNotice, `已解锁${TECH[id].name}${result.saved ? "" : " · 未保存"}`);
  }


  // Repair one equipped piece to full, from the workbench tab's repair
  // rows. The campaign refuses when the piece is full, the materials
  // are short, or there is no workbench yet; a failed write is reported
  // by the save-conflict flow like any other inventory action.
  function repairEquipment(slot) {
    const piece = campaign.equipment[slot];
    if (!piece) return;
    const result = campaign.repairEquipment(slot);
    if (!result) {
      setText(inventoryNotice, piece.durability >= durabilityMax(piece.tier) ? "已满耐久" : "材料不足，无法修理");
      return;
    }
    if (checkSaveConflict(result)) return;
    updateInventory();
    setText(inventoryNotice, `已修理${inventoryUi.equipmentPieceName(piece, slot)}，耐久回满`);
  }

  // The inventory refresh lives in inventory-ui.mjs (split piece
  // 3); this wrapper hands it the live campaign and the frame's
  // facts (hp, rain, shelter, palette) it cannot know itself.
  function updateInventory() {
    inventoryUi.updateInventory(campaign, {
      playerHp: player.hp,
      raining: weather.rain > .02,
      roofed: weather.rain > .02 && underRoof(),
      palette, blockNames
    });
  }

  function craftItem(key) {
    if (inventoryScreen.hidden || !survival.enabled) return;
    const result = campaign.craft(key);
    if (!result || checkSaveConflict(result)) return;
    updateInventory();
    updateHotbar();
    setText(inventoryNotice, `已制作${RECIPES[key].name}${result.saved ? "" : " · 未保存"}`);
    if (key === "axe") inventoryResume.focus({ preventScroll: true });
  }

  function healWithDressing(key = "dressing") {
    if (!survival.enabled || !player.hp) return;
    let notice;
    if (player.hp >= 100) notice = "生命已满";
    else {
      const result = campaign.useDressing(key);
      if (checkSaveConflict(result)) return;
      if (!result) notice = `背包里没有${RECIPES[key]?.name ?? "治疗品"}，按 C 制作`;
      else if (!result.saved) notice = `使用${RECIPES[key]?.name ?? "治疗品"}失败 · 未保存`;
      else {
        // The healed amount comes back from the campaign per recipe — it
        // is only present when the use actually saved. A failed save
        // rolls the count back, so there is nothing to heal for: healing
        // anyway would spend a dressing the player still owns.
        const healed = Math.min(100 - player.hp, result.healed);
        player.hp += healed;
        updateHealth();
        updateHotbar();
        // A dish with a buff applies it now (R5): the heal went through
        // the campaign's dressing path, the buff is game-side runtime.
        applyBuff(RECIPES[key]?.buff);
        notice = `生命 +${healed}`;
      }
    }
    if (inventoryScreen.hidden) showMessage(notice);
    else {
      updateInventory();
      setText(inventoryNotice, notice);
    }
  }

  function openInventory(tab) {
    if (!started || finished || !player.hp) return;
    if (!survival.enabled) {
      showMessage(boss ? (boss.profile === COLOSSUS ? "6 石剑 · 7 石斧 · 8 星脉枪" : "挑战武器可用 6、7 或滚轮切换") : "自由建造的方块不限量");
      return;
    }
    if (tab) inventoryUi.selectInventoryTab(tab);
    inventoryFromPlay = mouseMode !== "paused";
    inventoryScreen.hidden = false;
    suspendGame();
    setText(inventoryNotice, "");
    updateInventory();
    inventoryResume.focus({ preventScroll: true });
  }

  function closeInventory(resume) {
    inventoryScreen.hidden = true;
    setMouseMode("paused");
    if (resume) requestMouse();
    else pauseInventoryButton.focus({ preventScroll: true });
  }
  function spawnDebris(cell, block) {
    const color = blockColors[block] ?? [.5, .5, .5];
    const css = `rgb(${color.map(value => Math.round(value * 255)).join(",")})`;
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 1.8;
      debris.push({ x: cell[0] + .5, y: cell[1] + .5, z: cell[2] + .5,
        vx: Math.cos(angle) * speed, vy: 2 + Math.random() * 2.5, vz: Math.sin(angle) * speed,
        age: 0, color: css });
    }
    if (debris.length > 48) debris.splice(0, debris.length - 48);
  }
  // Sow mode (farm tab, R3): armed from a sow button, or by pressing F
  // when there is nothing plantable under the crosshair. While armed the
  // HUD hint stays up; a left-click plants when the aim is plantable and
  // otherwise cancels the mode and falls through to the normal action,
  // a right-click or Esc cancels it. Only one seed kind exists in R3,
  // but the mode remembers which seed it was armed with.
  let sowMode = false;
  let sowSeed = "wheatSeed";
  function enterSowMode(seed) {
    if (!inventoryUi.farmSeeds.includes(seed) || campaign.count(seed) < 1) return;
    sowMode = true;
    sowSeed = seed;
    inventoryUi.sowHint.hidden = false;
    if (!inventoryScreen.hidden) closeInventory(true);
  }
  function exitSowMode() {
    sowMode = false;
    inventoryUi.sowHint.hidden = true;
  }
  // The cell a seed would go into, or why not: raycast from the rendered
  // view, the soil must be GRASS with AIR above and no crop there.
  // Returns { above } when plantable, else { reason } — plantSeed maps
  // each reason to its message, and the sow-mode click uses the reason
  // to decide whether the click falls through to the normal action.
  function plantTarget() {
    const { origin, direction } = renderedView ?? { origin: eye(), direction: viewDirection() };
    const target = raycast(origin, direction, interactionReach);
    if (!target) return { reason: "no-target" };
    const [x, y, z] = target.hit;
    if (get(x, y, z) !== GRASS) return { reason: "not-grass" };
    if (get(x, y + 1, z) !== AIR) return { reason: "blocked" };
    const above = index(x, y + 1, z);
    if (campaign.cropAt(above)) return { reason: "occupied" };
    return { above };
  }
  // Plant one seed in the cell above the aimed soil (KeyF, the backup
  // for the farming tab's sow mode): the soil must be GRASS with AIR
  // above (the canPlant rule, read at runtime), the cell must be empty,
  // and the player must hold a seed. Seeds are not in the palette, so
  // this is a dedicated action — adding a palette slot would shift the
  // weapon slots. The crop defaults to wheat (R2's one crop); the sow
  // mode passes the crop for the seed it was armed with. Returns
  // "planted" on success, else the failure reason ("no-target",
  // "not-grass", "blocked", "occupied", "no-seed", "conflict",
  // "unavailable") — the sow-mode click and the F key read it instead
  // of parsing the message.
  function plantSeed(cropId = "wheat") {
    if (boss || !player.hp) return "unavailable";
    const def = CROPS[cropId];
    if (!def) return "unavailable";
    const found = plantTarget();
    if (found.reason === "no-target") { showMessage("对准一块草地再种"); return "no-target"; }
    if (found.reason === "not-grass") { showMessage("只能种在草地上"); return "not-grass"; }
    if (found.reason === "blocked") { showMessage("上面被挡住了"); return "blocked"; }
    if (found.reason === "occupied") { showMessage("这里已经种了作物"); return "occupied"; }
    const result = campaign.plantCrop(found.above, cropId, dayTime);
    if (!result) { showMessage(campaign.count(def.seed) < 1 ? "没有小麦种子（投掷者会掉）" : "种不下"); return "no-seed"; }
    if (checkSaveConflict(result)) return "conflict";
    showMessage(result.saved ? "种下了小麦种子" : "种下了小麦种子 · 本次改动无法保存");
    return "planted";
  }
  // Fertilize the crop under the crosshair (KeyG, R3): the ray passes
  // through the crop's AIR cell and hits the soil below, so the crop is
  // the cell above the hit — the same aim as the harvest branch. One
  // compost per plant, for the crop's whole cycle; a second dose on the
  // same plant is refused, it would not stack.
  function fertilizeCropAtAim() {
    if (boss || !player.hp) return;
    const { origin, direction } = renderedView ?? { origin: eye(), direction: viewDirection() };
    const target = raycast(origin, direction, interactionReach);
    if (!target) { showMessage("对准一株作物再施肥"); return; }
    const [x, y, z] = target.hit;
    const above = index(x, y + 1, z);
    const crop = campaign.cropAt(above);
    if (!crop) { showMessage("对准一株作物再施肥"); return; }
    if (crop.fertilized) { showMessage("这株作物已经施过肥了"); return; }
    if (campaign.count("fertilizer") < 1) { showMessage("没有腐叶（树叶 2 + 泥土 1，在种田页签制作）"); return; }
    const result = campaign.fertilizeCrop(above);
    if (!result) { showMessage("施不上肥"); return; }
    if (checkSaveConflict(result)) return;
    showMessage(result.saved ? `给${CROPS[crop.crop].name}施了腐叶，长得更快了` : `给${CROPS[crop.crop].name}施了腐叶 · 本次改动无法保存`);
  }

  function interact(place) {
    const weapon = weapons[selected - palette.length];
    if (isGun(weapon)) {
      if (place && weapon === pulseWeapon) startPulseCharge();
      if (!place) firePulse(false);
      return;
    }
    if (place && weapon) return;
    const { origin, direction } = renderedView ?? { origin: eye(), direction: viewDirection() };
    const range = interactionReach;
    const target = raycast(origin, direction, range);
    if (!place) {
      const aim = aimEnemy(origin, direction, target, range);
      if (weapon || aim) { attack(weapon, aim); return; }
    }
    if (!target) return;
    const cell = place ? target.place : target.hit;
    if (!cell || (!place && cell[1] === 0)) return;
    const beacon = defense.beacon;
    if (beacon && cell[0] === Math.floor(beacon.x) && cell[2] === Math.floor(beacon.z)
      && cell[1] >= beacon.y - 1 && cell[1] <= beacon.y + 1) {
      showMessage("要保留信标和它的基座");
      return;
    }
    const type = place ? palette[selected] : AIR;
    const before = get(...cell);
    if (place && survival.enabled && campaign.count(type) < 1) {
      showMessage(`${blockNames[type]}用完了，挖掘可补充`);
      return;
    }
    const effectMaterial = place ? type : before;
    if (place && overlapsPlayerBlock(player, ...cell)) {
      showMessage("不能放在这里");
      return;
    }
    const [x, y, z] = cell;
    if (place && survival.zombies.some(zombie => {
      const style = ENEMIES[zombie.kind] ?? ENEMIES.walker;
      const r = .38 * style.width;
      return zombie.x + r > x && zombie.x - r < x + 1 && zombie.z + r > z && zombie.z - r < z + 1
        && zombie.y + 1.74 * style.height > y && zombie.y < y + 1;
    })) {
      showMessage("这里有僵尸");
      return;
    }
    // A mature crop above the aimed soil is harvested instead of mining
    // the soil: the ray passes through the crop's AIR cell and hits the
    // soil below, so the crop is the cell above the hit. An immature
    // crop falls through to the mining path below — mining its soil
    // uproots it (see the uproot below).
    if (!place) {
      const above = index(x, y + 1, z);
      if (campaign.isCropMature(above)) {
        const result = campaign.harvestCrop(above);
        if (!result || checkSaveConflict(result)) return;
        const got = result.yield.map(([id, amount]) =>
          `${typeof id === "string" ? (FARM_MATERIALS[id] ?? RARE_MATERIALS[id]) : blockNames[id]} +${amount}`).join(" · ");
        showMessage(result.saved ? `收获了${got}` : `收获了${got} · 本次改动无法保存`);
        return;
      }
    }
    const result = campaign.editBlock(index(x, y, z), before, type, survival.enabled);
    if (!result || checkSaveConflict(result)) return;
    set(...cell, type);
    if (!place && survival.enabled) wearEquipped("tool");
    // A crop needs its soil: mining the soil out from under a crop
    // uproots it, with no yield. The mining message below carries the
    // note so the loss is not silent.
    let uprooted = false;
    if (!place) {
      const above = index(x, y + 1, z);
      if (campaign.cropAt(above)) { campaign.removeCrop(above); uprooted = true; }
    }
    if (place) {
      pops.push({ x, y, z, type, age: 0 });
      if (pops.length > 16) pops.shift();
    }
    player.handAction = blockActionTime;
    if (!place) spawnDebris(cell, before);
    survival.recalc = 0;
    survival.routesDirty = true;
    sound.play(place ? "place" : "break", effectMaterial);
    if (survival.enabled) updateHotbar();
    const action = place ? `已放置${blockNames[type]}` : survival.enabled ? `${blockNames[before]} +1` : "已破坏方块";
    showMessage(result.saved ? (uprooted ? `${action} · 作物被连根拔起` : action) : `${action}，本次改动无法保存`);
    invalidateChunks(x, z);
  }
  function resize() {
    const viewWidth = Math.max(1, window.innerWidth), viewHeight = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(maxRenderPixels / (viewWidth * viewHeight)));
    const width = Math.max(1, Math.floor(viewWidth * dpr)), height = Math.max(1, Math.floor(viewHeight * dpr));
    const resized = canvas.width !== width || canvas.height !== height;
    if (resized) { canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height); }
    if (fxCanvas.width !== width || fxCanvas.height !== height) { fxCanvas.width = width; fxCanvas.height = height; }
    return resized;
  }

  function bindVertexLayout() {
    // 12 floats per vertex: position 3, colour 3, face 4, atlas UV 2.
    gl.enableVertexAttribArray(positionLocation); gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 48, 0);
    gl.enableVertexAttribArray(colorLocation); gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 48, 12);
    gl.enableVertexAttribArray(faceLocation); gl.vertexAttribPointer(faceLocation, 4, gl.FLOAT, false, 48, 24);
    gl.enableVertexAttribArray(uvLocation); gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 48, 40);
  }
  function advanceWorld(dt) {
    const [lookX, lookY] = mouseLook.advance(dt);
    yaw += lookX;
    adjustPitch(-lookY);
    // Let movement recover from short stalls without giving combat a large step.
    for (let elapsed = dt; elapsed > 0 && mouseMode !== "paused";) {
      const interval = Math.min(elapsed, .05);
      movementTime += interval;
      while (movementTime >= PHYSICS_STEP) {
        previousEye = eye();
        movePlayer(PHYSICS_STEP);
        movementTime -= PHYSICS_STEP;
      }
      updateCombat(interval);
      if (mouseMode !== "paused" && !boss) updateWeather(interval);
      elapsed -= interval;
    }
    // Food buffs tick on game time, once per frame like the crops:
    // paused and hidden-tab frames never reach advanceWorld, so a
    // buff cannot burn down behind a menu.
    for (const buff of Object.values(buffs)) {
      if (buff.remaining > 0) {
        buff.remaining = Math.max(0, buff.remaining - dt);
        if (!buff.remaining) buff.pct = 0;
      }
    }
    // Crops grow on game time, once per frame (not per substep): paused,
    // boss-fight and hidden-tab frames never reach advanceWorld, so a
    // crop does not grow while the day clock is frozen.
    if (!boss) updateCrops(dt);
  }

  // Growth tick (R2): rain doubles the rate; the shelter check is the
  // player's underRoof, the same signal the rain mesh uses — per-crop
  // shelter waits for R3's watering can, when water becomes a per-crop
  // state. The campaign batches the write, so a frame's tick never
  // serializes the save. A crop that crosses into maturity this frame is
  // announced once, several at once merged into one line (the farm tab
  // lists them any time after).
  function updateCrops(dt) {
    const immature = new Set(Object.keys(campaign.crops).filter(cell => !campaign.isCropMature(Number(cell))));
    campaign.advanceCrops(dt, weather.rain > .02 && !underRoof());
    const newly = Object.keys(campaign.crops).filter(cell => immature.has(cell) && campaign.isCropMature(Number(cell)));
    if (newly.length) {
      const name = CROPS[campaign.cropAt(Number(newly[0])).crop].name;
      showMessage(newly.length === 1 ? `${name}已成熟，到田里收割` : `${name} ×${newly.length} 已成熟，到田里收割`);
    }
  }

  function render(time) {
    window.requestAnimationFrame(render);
    const dt = lastTime === null ? 0 : Math.min(.1, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    if (graphicsLost || document.hidden) return;
    const resized = resize();
    if (mouseMode !== "paused" && dt > 0) advanceWorld(dt);
    const active = mouseMode !== "paused";
    const settling = boss?.profile === COLOSSUS && boss.state === "defeated" && boss.collapse < 1;
    if (settling) boss.collapse = Math.min(1, boss.collapse + dt / .86);
    if (!active && !sceneDirty && !resized && !settling) return;
    const rain = boss ? 0 : weather.rain;
    const sheltered = rain > .002 && underRoof();
    sound.setRain(active ? rain * (sheltered ? .25 : 1) : 0);
    const position = eye(), d = viewDirection();
    const mix = movementTime / PHYSICS_STEP;
    const origin = active && previousEye ? position.map((value, axis) => previousEye[axis] + (value - previousEye[axis]) * mix) : position;
    const viewOrigin = [...origin];
    const impactShake = boss?.profile === BOSS ? Math.max(guardianFx.strike, guardianFx.hit * .46) : 0;
    if (impactShake) {
      const kick = impactShake * impactShake * .035;
      viewOrigin[0] += Math.sin((boss.elapsed + 1.1) * 77) * kick;
      viewOrigin[1] += Math.cos((boss.elapsed + .4) * 93) * kick * .7;
      viewOrigin[2] += Math.sin((boss.elapsed + 2.3) * 61) * kick;
    }
    // Camera feel: head bob while walking, a dip on landing, and a shake on hurt.
    const speed2d = Math.hypot(player.vx, player.vz);
    const bobAmount = player.grounded ? Math.min(1, speed2d / 4.15) : 0;
    viewOrigin[1] += Math.sin(stepDistance * 3.6) * .028 * bobAmount;
    viewOrigin[0] += Math.cos(stepDistance * 3.6) * .014 * bobAmount;
    landDip *= Math.exp(-dt * 7);
    viewOrigin[1] -= landDip;
    if (player.hurt > 0) {
      const kick = player.hurt * player.hurt * .06;
      viewOrigin[0] += Math.sin(time * .11) * kick;
      viewOrigin[1] += Math.cos(time * .13) * kick * .6;
    }
    const sprinting = (input.held("ShiftLeft") || input.held("ShiftRight")) && player.grounded && speed2d > 4.5;
    fovBoost += ((sprinting ? 1 : 0) - fovBoost) * Math.min(1, dt * 5);
    const [ex, ey, ez] = viewOrigin;
    const bossModel = !boss ? null : boss.profile === COLOSSUS ? posedColossus(boss) : posedGuardian(boss);
    renderedView = { origin, direction: d, bossModel };
    const aspect = canvas.width / canvas.height;
    // Boss attacks ask the player to read silhouettes and ground space at the
    // same time.  A slightly wider arena lens keeps the raised weapon and its
    // incoming hazard in frame without changing aiming or collision rules.
    const fov = boss ? Math.PI * .4 : Math.PI / 3 + fovBoost * .10;
    const vp = multiply(perspective(fov, aspect, .06, 90), lookAt(ex, ey, ez, ex + d[0], ey + d[1], ez + d[2]));
    const night = Boolean(defense.beacon) && !defense.victory;
    const arena = boss?.profile.arena;
    let sky = arena?.sky ?? weather.sky;
    if (arena?.fractureSky && boss.phaseGlow > 0) {
      sky = sky.map((channel, i) => channel + (arena.fractureSky[i] - channel) * boss.phaseGlow);
    } else if (night) sky = [sky[0] * .36, sky[1] * .42, sky[2] * .51];
    // Day/night only touches the open world: the sky tint, fog density and
    // ambient light all follow the sun, while boss arenas keep the fixed
    // look their fights were tuned for.
    const cycle = boss ? null : dayCycle(dayTime);
    if (cycle) sky = sky.map((channel, i) => channel * cycle.skyTint[i]);
    gl.clearColor(...sky, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program); gl.uniform3f(cameraLocation, ex, ey, ez); gl.uniformMatrix4fv(viewProjectionLocation, false, vp);
    if (atlasTexture) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTexture); }
    gl.uniform1i(atlasLocation, 0); gl.uniform1f(useAtlasLocation, atlasDetailed ? 1 : 0);
    gl.uniform3f(skyLocation, ...sky);
    gl.uniform1f(fogDensityLocation, boss ? fogDensityForRange(arena.fog[1]) : cycle.fogDensity * (25 / weather.fog[1]));
    gl.uniform1f(lightLocation, boss ? .94 : weather.light * cycle.light * (night ? .75 : 1));
    gl.uniform3f(sunLocation, ...(cycle ? cycle.sunDir : [0.45, 0.52, 0.38]));
    gl.uniform1f(dayLocation, cycle ? cycle.dayFactor : 1);
    const furnaceActive = boss?.profile === BOSS && boss.hp;
    const furnaceCharge = furnaceActive ? (boss.state === "windup" ? .82 : boss.state === "attack" ? 1.34 : boss.state === "recovery" ? .38 : .46) : 0;
    gl.uniform4f(furnaceLocation, boss?.x ?? 0, boss ? boss.y + 1.8 : 0, boss?.z ?? 0, furnaceCharge);
    gl.uniform1f(timeLocation, boss?.elapsed ?? weather.phase);
    const weapon = weapons[selected - palette.length];
    const selectedBlock = palette[selected] ?? AIR;
    const heldBlock = !survival.enabled || campaign.count(selectedBlock) > 0 ? selectedBlock : AIR;
    const range = isGun(weapon) ? (pulse.charge === null ? weapon.reach : pulseBurst.reach) : interactionReach;
    const blockHit = active && player.hp ? raycast(origin, d, range) : null;
    const aim = active && player.hp ? aimEnemy(origin, d, blockHit, range) : null;
    // The target block stays highlighted even while holding a weapon or
    // aiming past a zombie: it shows what you would mine if you switched.
    gl.uniform3f(targetLocation, ...(!aim && blockHit ? blockHit.hit : [-1, -1, -1]));
    drawSkyDome(viewOrigin, sky);
    drawTerrain();
    bossRender.drawForgeFloor(boss);
    bossRender.drawForgeStage(boss);
    bossRender.drawForgeAtmosphere({ boss, yaw, pitch });
    // Thrusters draw before the actor pass so the actors stay the
    // frame's last opaque upload (the glow is additive either way).
    bossRender.drawColossusThrusters({ boss, yaw, pitch });
    bossRender.drawBossBursts(bossParticles);
    drawActors(bossModel);
    drawParticles3D();
    drawPops();
    drawCrops();
    bossRender.drawGuardianFire({ boss, yaw, pitch });
    bossRender.drawDragonFire({ boss, yaw, pitch });
    drawRain3D(sheltered ? 0 : rain);
    sound.setRoar(active && !finished && Boolean(boss?.dragons.length));
    const muzzle = player.hp
      ? isGun(weapon) ? drawPulseWeapon(perspective(Math.PI / 3, aspect, .035, 6))
        : weapon ? drawMeleeWeapon(perspective(Math.PI / 3, aspect, .035, 6)) : null
      : null;
    drawEffects(weapon, heldBlock, sheltered ? 0 : rain, vp, muzzle);
    if (started) updateStatus(aim, weapon);
    if (started && pendingDurabilityWarning) {
      showMessage(pendingDurabilityWarning);
      pendingDurabilityWarning = null;
    }
  }

  // The colossus court skills (Digit1 heal / Digit4 dragons),
  // executed here: input.mjs routes the keys, this runs them.
  function colossusSkillKey(code) {
    if (code === "Digit1") {
      if (player.hp >= 100) { showMessage("生命已满"); return; }
      if (boss.elapsed < boss.healReady) {
        showMessage(`回血还需 ${Math.ceil(boss.healReady - boss.elapsed)} 秒`);
        return;
      }
      const restored = Math.min(35, 100 - player.hp);
      player.hp += restored;
      boss.healReady = boss.elapsed + 12;
      updateHealth();
      showMessage(`恢复 ${restored} 点生命`);
    } else if (boss.elapsed >= boss.dragonsReady) {
      boss.dragonHits = 0;
      const angle = Math.atan2(boss.x - player.x, boss.z - player.z);
      for (let i = 0; i < 5; i++) {
        boss.dragons.push({ x: player.x, y: player.y + 1.3, z: player.z,
          ox: player.x, oy: player.y + 1.3, oz: player.z, c: Math.cos(angle), s: Math.sin(angle),
          lane: [0,-1,1,-2,2][i] * 1.85, duration: 1.45, start: boss.elapsed + i * .62, trail: [] });
      }
      boss.dragonsReady = boss.elapsed + 20;
      sound.play("pulse-burst", STONE);
    } else showMessage(`五龙冲击还需 ${Math.ceil(boss.dragonsReady - boss.elapsed)} 秒`);
  }

  // KeyF: plants directly when the aim is plantable (the R2 action,
  // unchanged); when the aim is not plantable it arms sow mode
  // instead, so the player can aim and click — the backup entry.
  function plantKey() {
    const status = plantSeed();
    if (status === "planted") { if (sowMode) exitSowMode(); }
    else if (!sowMode && ["no-target", "not-grass", "blocked"].includes(status)) enterSowMode("wheatSeed");
  }

  // Releasing the right button with a pulse charge held: fire the
  // burst if the charge reached the windup, spend it either way.
  function releasePulseCharge() {
    if (pulse.charge === null) return;
    const charged = Math.max(pulse.charge, (performance.now() - pulse.chargeStarted) / 1000) >= pulseBurst.windup;
    pulse.charge = null;
    if (charged && mouseMode !== "paused") firePulse(true);
  }

  // Input wiring (input.mjs, split piece 5): the module owns the
  // listeners, the held-keys table and the drag state; everything
  // it can trigger is an action here, and everything it needs to
  // know arrives in the getState snapshot, taken per event.
  const input = createInput({
    document, canvas, storage, mouseLook, sensitivitySlider, sensitivityValue,
    getState: () => ({
      started, playerAlive: Boolean(player.hp), finished,
      inventoryOpen: !inventoryScreen.hidden, inventoryFromPlay,
      sowMode, sowSeed, mouseMode, lockPending: Boolean(lockAttempt),
      colossusFight: boss?.profile === COLOSSUS,
      gunSelected: isGun(weapons[selected - palette.length]),
      beaconWaiting: Boolean(defense.beacon && !survival.zombies.length),
      bossPresent: Boolean(boss),
      wheelFirst: boss ? palette.length : 0,
      wheelSlots: encounterSlots() - (boss ? palette.length : 0) - (axeAvailable() ? 0 : 1),
      selected
    }),
    actions: {
      toggleSound, closeInventory, exitSowMode, suspendGame, wakeAudio,
      colossusSkill: (code, repeat) => { if (!repeat && !finished && player.hp) colossusSkillKey(code); },
      rechargePulse, openInventory, healWithDressing, repairBeacon,
      plantKey, fertilize: fertilizeCropAtAim, plantSeed,
      skipCountdown: () => { survival.countdown = 0; },
      cycleWeather, selectSlot,
      bufferJump: () => { jumpBuffer = .18; },
      interact, releasePulse: releasePulseCharge,
      setFiring: value => { firing = value; },
      setMouseHeld: value => { mouseHeld = value; if (value) mouseHeldRepeat = 0; }
    }
  });


  function setMouseMode(mode) {
    firing = false;
    const wasPlaying = mouseMode !== "paused";
    mouseMode = mode;
    if (mode === "paused") pulse.charge = null;
    mouseLook.reset();
    input.cancelDrag();
    input.clearKeys();
    jumpBuffer = 0;
    movementTime = 0;
    lastTime = null;
    previousEye = renderedView = null;
    sceneDirty = true;
    stepDistance = 0;
    pause.hidden = !started || finished || !player.hp || mode !== "paused" || !inventoryScreen.hidden;
    lookHint.hidden = mode !== "drag";
    crosshair.hidden = mode === "paused";
    canvas.classList.toggle("playing", mode !== "paused");
    canvas.classList.toggle("drag-look", mode === "drag");
    if (wasPlaying && !pause.hidden && !document.hidden) (saveConflict ? reloadSaveButton : resumeButton).focus({ preventScroll: true });
  }

  function suspendGame() {
    // Pausing forces any batched block edits to disk now, so a tab that is
    // closed or switched away from never loses the last 300ms of digging.
    const flushResult = campaign.flush?.();
    if (flushResult && !flushResult.saved) {
      if (flushResult.conflict) checkSaveConflict(flushResult);
      else showMessage("存档写入失败，本次改动可能未保存");
    }
    window.clearTimeout(lockAttempt?.timer);
    lockAttempt = null;
    setMouseMode("paused");
    sound.setRain(0);
    sound.setRoar(false);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  function checkSaveConflict(result) {
    if (result?.conflict && !saveConflict) {
      saveConflict = true;
      reloadSaveButton.hidden = false;
      saveWarning.hidden = false;
      resumeButton.disabled = true;
      pauseInventoryButton.disabled = true;
      inventoryScreen.hidden = true;
      suspendGame();
      if (!pause.hidden && !document.hidden) reloadSaveButton.focus({ preventScroll: true });
    }
    return Boolean(result?.conflict);
  }

  // `force` rebuilds the world even when the save is not stale: the save
  // import uses it so the menu backdrop shows the imported blocks right
  // away instead of waiting for the next start.
  function loadLatestSave(force = false) {
    if (force || saveConflict || campaign.stale) {
      campaign = createProgression(storage, WORLD);
      const fresh = generateTerrain(WORLD, BLOCK);
      homeWorld.set(fresh);
      homeWorld.variants = fresh.variants;
      loadEdits();
      for (const mesh of chunkMeshes.values()) mesh.dirty = true;
      updateHotbar();
    }
    saveConflict = false;
    resumeButton.disabled = graphicsLost;
    pauseInventoryButton.disabled = false;
    reloadSaveButton.hidden = true;
    saveWarning.hidden = true;
  }

  function useDragLook(attempt) {
    if (lockAttempt !== attempt) return;
    window.clearTimeout(attempt.timer);
    lockAttempt = null;
    setMouseMode(document.hidden ? "paused" : "drag");
  }

  function wakeAudio() {
    if (!sound.playing) sound.activate();
  }

  function requestMouse(preview = false) {
    if (lockAttempt || saveConflict || graphicsLost || !started || finished || !player.hp || !inventoryScreen.hidden || document.hidden) return;
    sound.activate(preview);
    canvas.focus({ preventScroll: true });
    if (!canvas.requestPointerLock) {
      setMouseMode("drag");
      return;
    }
    const attempt = {};
    lockAttempt = attempt;
    attempt.timer = window.setTimeout(() => useDragLook(attempt), 700);
    try {
      const pending = canvas.requestPointerLock();
      attempt.usesPromise = Boolean(pending);
      pending?.catch(() => useDragLook(attempt));
    } catch {
      useDragLook(attempt);
    }
  }

  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      if (!lockAttempt || document.hidden) { document.exitPointerLock(); return; }
      window.clearTimeout(lockAttempt?.timer);
      lockAttempt = null;
      if (!started || finished || !player.hp || !inventoryScreen.hidden) { document.exitPointerLock(); return; }
      setMouseMode("locked");
    } else if (mouseMode === "locked") {
      suspendGame();
    }
  });
  document.addEventListener("pointerlockerror", () => {
    if (lockAttempt && !lockAttempt.usesPromise) useDragLook(lockAttempt);
  });
  window.addEventListener("blur", () => {
    if (mouseMode !== "paused" || lockAttempt) suspendGame();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (mouseMode !== "paused" || lockAttempt)) suspendGame();
  });
  window.addEventListener("pagehide", () => campaign.flush?.());
  window.addEventListener("storage", event => {
    if (event.storageArea !== storage) return;
    if (event.key === sensitivityKey || event.key === null) {
      mouseLook.setSensitivity(event.newValue);
      input.updateLookControl();
    }
    if ((event.key === null || [SAVE_KEY, PREVIOUS_SAVE_KEY, LEGACY_KEY].includes(event.key)) && started && !finished && !boss && campaign.stale) {
      checkSaveConflict({ conflict: true });
    }
  });

  function setGraphicsStatus(notice) {
    graphicsLost = Boolean(notice);
    startButton.disabled = defenseButton.disabled = bossButton.disabled = colossusButton.disabled = buildButton.disabled = respawnButton.disabled = graphicsLost;
    resumeButton.disabled = graphicsLost || saveConflict;
    graphicsWarning.hidden = !graphicsLost;
    setText(graphicsWarning, notice);
    if (!started || graphicsLost) {
      menuStatus.hidden = !graphicsLost;
      setText(menuStatus, notice);
    }
  }

  function rebuildRenderer() {
    try {
      initRenderer();
      setGraphicsStatus("");
    } catch (error) {
      console.error(error);
      setGraphicsStatus("无法启动图形渲染，请刷新页面后再试。");
    }
  }

  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    inventoryScreen.hidden = true;
    suspendGame();
    setGraphicsStatus("图形连接已中断，游戏已暂停，正在等待浏览器恢复。");
  });
  canvas.addEventListener("webglcontextrestored", rebuildRenderer);
  soundButton.addEventListener("click", toggleSound);
  pauseSoundButton.addEventListener("click", toggleSound);
  // The speed readout is hidden by default (it's a debug panel, not HUD);
  // the pause menu can bring it back.
  speedToggleButton?.addEventListener("click", () => {
    const hud = document.querySelector(".speed-hud");
    const show = hud.hidden;
    hud.hidden = !show;
    speedToggleButton.textContent = show ? "隐藏速度表" : "显示速度表";
    speedToggleButton.setAttribute("aria-pressed", String(show));
  });
  resumeButton.addEventListener("click", () => requestMouse());
  pauseInventoryButton.addEventListener("click", () => openInventory("backpack"));
  inventoryResume.addEventListener("click", () => closeInventory(true));
  document.querySelector("#craft-axe").addEventListener("click", () => craftItem("axe"));
  // The healing buttons (craft + use per recipe, dressing included) are
  // wired by inventory-ui.mjs's healingControls, so they are not wired
  // again here.

  function returnToMenu() {
    started = false;
    finished = false;
    boss = null;
    selectTerrain();
    Object.assign(defense, { beacon: null, routes: null, seconds: 0, elapsed: 0, victory: false });
    inventoryScreen.hidden = true;
    suspendGame();
    loadLatestSave();
    deathScreen.hidden = true;
    hud.hidden = true;
    startScreen.hidden = false;
    showMenuRecord();
    resetSurvival();
    placePlayerAtSpawn();
    ({ yaw, pitch } = spawnView);
    startButton.focus({ preventScroll: true });
  }
  pauseMenuButton.addEventListener("click", returnToMenu);
  reloadSaveButton.addEventListener("click", returnToMenu);
  deathMenuButton.addEventListener("click", () => {
    if (pendingProgressChoice) { resolveProgressChoice(false); return; }
    returnToMenu();
  });

  function startWorld(mode) {
    if (graphicsLost) return;
    const bossProfile = mode === COLOSSUS.id ? COLOSSUS : mode === BOSS.id ? BOSS : null;
    boss = bossProfile ? createBossFight(bossProfile) : null;
    bossGhostHp = boss?.hp ?? 0;
    bossGhostRate = 0;
    bossPhaseSeen = boss?.phase ?? 0;
    phaseBanner = null;
    groundDecals.length = 0;
    bossParticles.length = 0;
    bossRender.resetAfterimage();
    selectTerrain();
    if (!boss) loadLatestSave();
    const withZombies = mode === "survival" || mode === "defense";
    survival.enabled = withZombies;
    finished = false;
    Object.assign(defense, { beacon: null, routes: null, seconds: 0, elapsed: 0, victory: false });
    resetSurvival();
    // Load the progress record before the run starts: it seeds the wave
    // status display, and finishRun merges this run into it. Loading
    // here also establishes the staleness snapshot, so a save from
    // another tab during the run is caught at finishRun.
    savedProgress = campaign.loadProgress();
    runBossDefeated = null;
    mergedProgress = null;
    pendingProgressChoice = null;
    deathMenuButton.textContent = "返回主菜单";
    if (!placePlayerAtSpawn()) {
      returnToMenu();
      menuStatus.hidden = false;
      setText(menuStatus, "地图里没有可以落脚的两格高空间，无法开始游戏。");
      return;
    }
    ({ yaw, pitch } = spawnView);
    if (boss) {
      yaw = 0;
      pitch = boss.profile.arena.pitch;
      setText(bossName, boss.profile.name);
      bossHud.setAttribute("aria-label", boss.profile.name);
      prepareTerrain(9);
    } else if (mode === "defense") {
      defense.beacon = locateBeacon();
      if (!defense.beacon) {
        returnToMenu();
        menuStatus.hidden = false;
        setText(menuStatus, "出生点附近没有能架设信标的空地。请先清出两格高的区域。");
        return;
      }
      defense.routes = new Int32Array(world.length);
      survival.countdown = 22;
      const beacon = defense.beacon;
      yaw = Math.atan2(beacon.x - player.x, player.z - beacon.z);
      pitch = Math.atan2(beacon.y + 1.3 - player.y - 1.6, Math.hypot(beacon.x - player.x, beacon.z - player.z));
    }
    vitals.hidden = !withZombies && !boss;
    hud.classList.toggle("boss-mode", Boolean(boss));
    hud.classList.toggle("colossus-mode", boss?.profile === COLOSSUS);
    survivalSupplies.hidden = !withZombies;
    pauseInventoryButton.hidden = !withZombies;
    selected = withZombies || boss ? palette.length : 0;
    setText(pauseNote, boss ? "返回主菜单会结束当前挑战。" : "返回主菜单会结束当前波次，建筑和背包会保留。");
    updateHotbar();
    started = true;
    deathScreen.hidden = true;
    startScreen.hidden = true;
    hud.hidden = false;
    pause.hidden = true;
    updateStatus(null, weapons[selected - palette.length]);
    showMessage(boss ? (boss.profile === COLOSSUS ? "8 星脉枪 · R 充能" : "6 石剑 · 7 石斧") : defense.beacon ? "守住信标，清完八波敌人"
      : withZombies ? "石剑已装备 · 按 C 查看配方" : "自由建造 · 方块改动会自动保存");
    requestMouse(true);
  }
  defenseButton.addEventListener("click", () => startWorld("defense"));
  bossButton.addEventListener("click", () => startWorld("boss"));
  colossusButton.addEventListener("click", () => startWorld(COLOSSUS.id));
  startButton.addEventListener("click", () => startWorld("survival"));
  buildButton.addEventListener("click", () => startWorld("creative"));
  respawnButton.addEventListener("click", () => {
    if (pendingProgressChoice) { resolveProgressChoice(true); return; }
    if (boss) { startWorld(boss.profile.id); return; }
    if (campaign.stale) {
      startWorld(defense.beacon ? "defense" : "survival");
      return;
    }
    if (defense.beacon) { startWorld("defense"); return; }
    finished = false;
    resetSurvival();
    runBossDefeated = null;
    mergedProgress = null;
    placePlayerAtSpawn();
    ({ yaw, pitch } = spawnView);
    selected = palette.length;
    updateHotbar();
    deathScreen.hidden = true;
    updateStatus(null, weapons[selected - palette.length]);
    showMessage("已重生，建筑和背包保留");
    requestMouse();
  });

  loadEdits(); placePlayerAtSpawn(); rebuildRenderer();
  if (!graphicsLost) prepareTerrain(8);
  setText(landingSpeedLabel, `落地 → ${LANDING_SAMPLE_TIME.toFixed(2)} 秒后`);
  updateHotbar(); updateSoundButton(); input.updateLookControl(); showMenuRecord(); window.requestAnimationFrame(render);
}

if (typeof window !== "undefined") initGame(window);
