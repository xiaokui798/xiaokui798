import { BLOCK, RECIPES, SAVE_KEY, PREVIOUS_SAVE_KEY, LEGACY_KEY, createProgression } from "./progression.mjs";
import { WORLD, CHUNK_SIZE, FACES as faces, contains, voxelIndex, voxelPosition,
  seeded, generateTerrain, createChunkGrid, distanceSquared, buildChunkMesh } from "./terrain.mjs";
import { ENEMIES, DEFENSE_WAVES, BEACON, choosesBeacon, selectWaveSpawns, repairPlan, defenseResult,
  actorRay, findMeleeTarget, zombieParts, beaconParts } from "./defense.mjs";
import { createMouseLook } from "./controls.mjs";
import { PHYSICS_STEP, LANDING_SAMPLE_TIME, createSpeedReadout, overlapsPlayerBlock, stepPlayer } from "./movement.mjs";
import { ARENA_PALETTE, BOSS, GUARDIAN_WAVES, COLOSSUS, BOSS_ATTACKS, buildBossTerrain, createBossFight, advanceBoss, strikeBoss, guardianBackOpen, interruptFurnace, damagePrism,
  bossParts, posedGuardian, forgeStageParts, posedColossus, insideColossusHazard, modelFaces, modelHit, pulseViewModel, dragonImpact } from "./boss.mjs";

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
  const bossHealth = document.querySelector("#boss-health");
  const bossHealthValue = document.querySelector("#boss-health-value");
  const bossCallout = document.querySelector("#boss-callout");
  const menuStatus = document.querySelector("#menu-status");
  const buildButton = document.querySelector("#build-button");
  const soundButton = document.querySelector("#sound-button");
  const pauseSoundButton = document.querySelector("#pause-sound-button");
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
  const craftAxeButton = document.querySelector("#craft-axe");
  const craftDressingButton = document.querySelector("#craft-dressing");
  const useDressingButton = document.querySelector("#use-dressing");
  const axeCost = document.querySelector("#axe-cost");
  const dressingCost = document.querySelector("#dressing-cost");
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
  const maxZombies = 7;
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
  const pulseWeapon = { name: "星脉枪", style: "pulse", damage: 24, reach: 18, cooldown: .31, capacity: 6, recharge: 1.2 };
  const pulseBurst = { damage: 62, reach: 24, cooldown: .59, cost: 2, windup: .58 };
  const weapons = [
    { name: "石剑", style: "sword", damage: 27, reach: 2.75, cooldown: .38 },
    { name: "石斧", style: "axe", damage: 44, reach: 2.3, cooldown: .74 },
    pulseWeapon,
    { name: "蜂鸣速射枪", style: "rapid", damage: 14, reach: 15, cooldown: .13 },
    { name: "裂晶重炮", style: "cannon", damage: 52, reach: 24, cooldown: .78, cost: 2 }
  ];
  const punch = { damage: 14, reach: 2.05, cooldown: .46 };
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
  const homeWorld = generateTerrain(WORLD, BLOCK);
  const arenaWorlds = new Map();
  let world = homeWorld, boss = null;
  let storage;
  try { storage = window.localStorage; } catch { /* A blocked store does not prevent play. */ }
  const sensitivityKey = "block-world:look-sensitivity:v1";
  let savedSensitivity;
  try { savedSensitivity = storage?.getItem(sensitivityKey); } catch { /* Use the default. */ }
  const mouseLook = createMouseLook(savedSensitivity);
  let campaign = createProgression(storage, WORLD);
  const sound = createWorldAudio();
  const keys = new Set();
  let selected = 0;
  const pulse = { rounds: pulseWeapon.capacity, recharge: 0, charge: null, chargeStarted: 0, shot: null };
  let actorMesh, viewModelMesh, flameMesh, guardianFlameMesh, forgeAtmosphereMesh, forgeFloorMesh, forgeStageMesh;
  let started = false, lastTime = null;
  let finished = false;
  let mouseMode = "paused";
  let lockAttempt = null;
  let saveConflict = false;
  let inventoryFromPlay = false;
  let graphicsLost = false;
  let drag = null;
  let { yaw, pitch } = spawnView;
  let noticeTimer;
  let jumpBuffer = 0;
  let movementTime = 0;
  let previousEye = null, renderedView = null;
  let sceneDirty = true;
  const speedReadout = createSpeedReadout();
  let stepDistance = 0;
  let effectsVisible = false;
  // These are presentation-only impulses.  Keeping them out of the fight
  // state means the timing and hit rules stay deterministic while the boss
  // can still have a proper sense of weight on every beat.
  const guardianFx = { charge: 0, strike: 0, exposed: 0, hit: 0, kind: null };
  const blockSprites = new Map();
  const blockActionTime = .18;
  const player = { x: 16.5, y: 10, z: 16.5, vx: 0, vy: 0, vz: 0, grounded: false, hp: 100, hurt: 0,
    cooldown: 0, recoveryTime: 1, hitConfirm: 0, swing: 0, handAction: 0 };
  const survival = { enabled: false, wave: 0, kills: 0, countdown: firstWaveDelay, zombies: [], routes: new Int32Array(world.length), recalc: 0, goal: -1, routesDirty: true };
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
    uniform mat4 uViewProjection;
    uniform vec3 uCamera;
    out vec3 vColor;
    out float vDistance;
    out vec3 vPosition;
    out vec2 flameUV;
    out vec3 metalNormal;
    flat out vec4 vFace;
    void main() {
      vColor = aColor;
      vDistance = distance(aPosition, uCamera);
      vPosition = aPosition;
      vFace = aFace;
      flameUV = aFace.xy;
      metalNormal = aFace.xyz;
      gl_Position = uViewProjection * vec4(aPosition, 1.0);
    }`;
  const fragmentSource = `#version 300 es
    precision highp float;
    in vec3 vColor;
    in float vDistance;
    in vec3 vPosition;
    in vec2 flameUV;
    in vec3 metalNormal;
    flat in vec4 vFace;
    uniform vec3 uTarget;
    uniform vec3 uSky;
    uniform vec2 uFog;
    uniform float uLight;
    uniform vec4 uFurnace;
    uniform float uTime;
    out vec4 outColor;
    void main() {
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
      if (vFace.w > 0.0 && fract(vPosition.y) < 0.75 + 0.10 * grain) {
        color = vec3(0.49, 0.30, 0.16) * vFace.w;
      }
      if (vFace.w >= 0.0) color *= 0.89 + 0.21 * grain;
      float amount = smoothstep(uFog.x, uFog.y, vDistance);
      vec3 uv = fract(vPosition);
      vec3 edges = min(uv, 1.0 - uv) + abs(vFace.xyz);
      if (all(equal(floor(interior), uTarget)) && min(edges.x, min(edges.y, edges.z)) < 0.025) {
        color *= 0.37;
      }
      outColor = vec4(mix(color * uLight, uSky, amount), 1.0);
    }`;

  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  }
  let program, positionLocation, colorLocation, faceLocation, viewProjectionLocation, cameraLocation,
    targetLocation, skyLocation, fogLocation, lightLocation, furnaceLocation, timeLocation;

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
    viewProjectionLocation = gl.getUniformLocation(program, "uViewProjection");
    cameraLocation = gl.getUniformLocation(program, "uCamera");
    targetLocation = gl.getUniformLocation(program, "uTarget");
    skyLocation = gl.getUniformLocation(program, "uSky");
    fogLocation = gl.getUniformLocation(program, "uFog");
    lightLocation = gl.getUniformLocation(program, "uLight");
    furnaceLocation = gl.getUniformLocation(program, "uFurnace");
    timeLocation = gl.getUniformLocation(program, "uTime");
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.viewport(0, 0, canvas.width, canvas.height);
    chunkMeshes.clear();
    actorMesh = viewModelMesh = flameMesh = guardianFlameMesh = forgeAtmosphereMesh = forgeFloorMesh = forgeStageMesh = undefined;
    sceneDirty = true;
  }

  function index(x, y, z) { return voxelIndex(WORLD, x, y, z); }
  function inside(x, y, z) { return contains(WORLD, x, y, z); }
  function get(x, y, z) { return inside(x, y, z) ? world[index(x, y, z)] : STONE; }
  function set(x, y, z, type) { if (inside(x, y, z)) world[index(x, y, z)] = type; }

  function loadEdits() {
    for (const [cell, type] of campaign.blockEdits()) homeWorld[cell] = type;
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
    const { vertices, indices } = buildChunkMesh(WORLD, chunk, get, blockColors, { grass: GRASS, leaf: LEAF });
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
    if (keys.has("ArrowLeft")) yaw -= 1.9 * dt;
    if (keys.has("ArrowRight")) yaw += 1.9 * dt;
    if (keys.has("ArrowUp")) adjustPitch(1.6 * dt);
    if (keys.has("ArrowDown")) adjustPitch(-1.6 * dt);
    const sprinting = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const oldX = player.x, oldZ = player.z;
    const wasGrounded = player.grounded;
    const takeoffSpeed = wasGrounded && jumpBuffer > 0 ? Math.hypot(player.vx, player.vz) : null;
    const forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    const side = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
    const solidActor = boss ?? defense.beacon;
    const { radius, height } = boss ? boss.profile : BEACON;
    const obstacle = solidActor && [solidActor.x - radius, solidActor.y, solidActor.z - radius,
      solidActor.x + radius, solidActor.y + height, solidActor.z + radius];
    const { jumped, landingSpeed } = stepPlayer(player, {
      forward, side, yaw, sprint: sprinting, jump: jumpBuffer > 0
    }, get, obstacle, dt);
    speedReadout.record(Math.hypot(player.vx, player.vz), player.grounded, jumped ? takeoffSpeed : null, dt);
    if (jumped) {
      sound.play("jump", materialUnderfoot());
      jumpBuffer = 0;
    }
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if (player.grounded && !wasGrounded && landingSpeed > 2.6) sound.play("land", materialUnderfoot());
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
    while (distance <= reach && inside(...cell)) {
      if (get(...cell)) return { hit: cell, place: previous, distance };
      previous = [...cell];
      const axis = crossing.indexOf(Math.min(...crossing));
      distance = crossing[axis];
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
    const roster = wave?.enemies ?? Array(Math.min(nextWave + 1, maxZombies)).fill("walker");
    const alternate = Boolean(wave && nextWave >= 4);
    let spawns = selectWaveSpawns(roster, waveCandidates(center, 12), alternate);
    if (!spawns.length) spawns = selectWaveSpawns(roster, waveCandidates(center, 24), alternate);
    if (!spawns.length) {
      survival.countdown = 5;
      showMessage(defense.beacon ? "没有足够的刷怪空间，试着打通信标周围的通路" : "没有足够的刷怪空间，请移到开阔处");
      return;
    }
    addEnemies(spawns);
    survival.wave = nextWave;
    survival.countdown = wave ? 17 : 8;
    defense.seconds = wave?.seconds ?? 0;
    showMessage(wave ? wave.name : `第 ${nextWave} 波来了`);
  }

  function addEnemies(spawns) {
    for (const { kind, cell, x, z } of spawns) {
      survival.zombies.push({ kind, cell, next: -1, travel: 0, x: x + .5, y: cellPosition(cell)[1], z: z + .5,
        hp: ENEMIES[kind].hp, angle: 0, cooldown: .65, windup: 0, hurt: 0, walk: 0 });
    }
  }

  function resetSurvival() {
    Object.assign(survival, { wave: 0, kills: 0, countdown: firstWaveDelay, recalc: 0, goal: -1, routesDirty: true });
    survival.zombies.length = 0;
    survival.routes.fill(-1);
    Object.assign(pulse, { rounds: pulseWeapon.capacity, recharge: 0, charge: null, shot: null });
    Object.assign(player, { hp: 100, hurt: 0, cooldown: 0, recoveryTime: 1, hitConfirm: 0, swing: 0, handAction: 0 });
    updateHealth();
  }

  function updateHealth() {
    health.value = player.hp;
    healthValue.textContent = String(player.hp);
  }

  function takeDamage(amount) {
    if (!player.hp) return;
    player.hp = Math.max(0, player.hp - amount);
    player.hurt = .42;
    sound.play("hurt", DIRT);
    updateHealth();
    if (player.hp > 0) return;
    if (boss) return finishBoss(false);
    if (defense.beacon) return finishDefense("player-down");
    finishRun("你倒下了", `撑到第 ${survival.wave} 波，击退 ${survival.kills} 只僵尸。建筑和背包会保留。`, "重生");
  }

  function finishRun(title, summary, action) {
    finished = true;
    deathTitle.textContent = title;
    deathSummary.textContent = summary;
    respawnButton.textContent = action;
    deathScreen.hidden = false;
    suspendGame();
    respawnButton.focus({ preventScroll: true });
  }

  function finishBoss(won) {
    if (won) sound.play(boss.profile === BOSS ? "forge-collapse" : "defeat", STONE);
    finishRun(won ? `${boss.profile.name}已击败` : "挑战失败",
      `${Math.floor(boss.elapsed)} 秒 · 命中 ${boss.hits} 次 · ${won ? `剩余生命 ${player.hp}` : `${boss.profile.name}剩余 ${boss.hp} 点生命`}`,
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
    const progress = result === "cleared" ? `撑过全部 ${DEFENSE_WAVES.length} 波` : `进行到第 ${survival.wave || 1} 波`;
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
    zombie.x = from[0] + .5 + (to[0] - from[0]) * t;
    zombie.z = from[2] + .5 + (to[2] - from[2]) * t;
    const rise = to[1] - from[1];
    const heightBlend = rise > 0 ? Math.min(t * 3, 1) : Math.max(0, t * 3 - 2);
    zombie.y = from[1] + rise * heightBlend;
    zombie.walk += dt * 7 * pace;
    if (t === 1) { zombie.cell = zombie.next; zombie.next = -1; }
  }

  function updateCombat(dt) {
    guardianFx.charge = Math.max(0, guardianFx.charge - dt / .52);
    guardianFx.strike = Math.max(0, guardianFx.strike - dt / .34);
    guardianFx.exposed = Math.max(0, guardianFx.exposed - dt / .74);
    guardianFx.hit = Math.max(0, guardianFx.hit - dt / .22);
    player.cooldown = Math.max(0, player.cooldown - dt);
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
    if (drag && isGun(weapons[selected - palette.length]) && !drag.moved && !drag.fired) {
      drag.holdTime += dt;
      if (drag.holdTime >= .22) firing = drag.fired = true;
    }
    if (firing && !finished && player.hp && isGun(weapons[selected - palette.length])) {
      firePulse(false);
      if (finished) return;
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
      const { cue, damage, push } = advanceBoss(boss, { ...player, covered }, dt);
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
      }
      if (damage) {
        takeDamage(damage);
        if (boss.profile === BOSS) guardianFx.strike = Math.max(guardianFx.strike, .92);
        if (push) { player.vx = push.x; player.vz = push.z; }
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
      const profile = ENEMIES[zombie.kind] ?? ENEMIES.walker;
      const playerDistance = Math.hypot(player.x - zombie.x, player.z - zombie.z);
      const atBeacon = choosesBeacon(zombie.kind, Boolean(defense.beacon), playerDistance,
        survival.routes[zombie.cell] >= 0, defense.routes?.[zombie.cell] >= 0);
      const goal = atBeacon ? defense.beacon : player;
      if (zombie.windup && zombie.attackingBeacon !== atBeacon) zombie.windup = 0;
      const dx = goal.x - zombie.x, dz = goal.z - zombie.z;
      const distance = Math.hypot(dx, dz);
      zombie.angle = Math.atan2(dx, dz);
      const origin = [zombie.x, zombie.y + 1.26 * profile.height, zombie.z];
      const delta = [dx, goal.y + 1.2 - origin[1], dz];
      const reach = Math.hypot(...delta);
      if (distance <= profile.reach && Math.abs(goal.y - zombie.y) <= 1.06 && reach > .01
        && !raycast(origin, delta.map(value => value / reach), reach)) {
        if (zombie.windup > 0) {
          zombie.windup = Math.max(0, zombie.windup - dt);
          if (zombie.windup > 0) continue;
          zombie.cooldown = profile.cooldown;
          if (atBeacon) damageBeacon(profile.damage);
          else takeDamage(profile.damage);
          if (finished) break;
        } else if (zombie.cooldown <= 0) {
          zombie.windup = profile.strikeDelay;
          zombie.attackingBeacon = atBeacon;
        }
      } else {
        zombie.windup = 0;
        walkZombie(zombie, dt, atBeacon ? defense.routes : survival.routes, profile);
      }
    }
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
      impact: aim?.crystal ? "crystal" : aim ? (aim.weak && boss.state === "recovery" ? "core" : "armor") : block ? "stone" : null };
    sound.play(heavy ? "cannon-fire" : gun.style === "rapid" ? "rapid-fire" : "pulse-fire", STONE);
    attack(gun, aim, profile);
  }

  function attack(weapon, aim, profile = weapon ?? punch) {
    if (player.cooldown > 0) return;
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
    if (boss && !aim.zombie) {
      if (aim.crystal) {
        const remaining = damagePrism(boss, profile.damage);
        if (remaining !== null) {
          player.hitConfirm = .25;
          sound.play(remaining ? "hit" : "pulse-crystal", STONE);
          showMessage(remaining ? `命中晶体 · 剩余 ${remaining}` : "晶体破碎 · 三轨折光中断");
          return;
        }
      }
      const oldPhase = boss.phase;
      const damage = strikeBoss(boss, profile.damage, aim.weak, player);
      const hitSound = boss.profile === BOSS ? "core-hit" : "hit";
      const blockedSound = boss.profile === BOSS ? "forge-armor" : "place";
      sound.play(damage ? hitSound : blockedSound, STONE);
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
    const damage = Math.min(zombie.hp, profile.damage);
    zombie.hp -= damage;
    player.hitConfirm = .25;
    zombie.hurt = .23;
    if (!ENEMIES[zombie.kind]?.armor) {
      zombie.cooldown = Math.max(zombie.cooldown, .38);
      zombie.windup = 0;
    }
    sound.play("hit", STONE);
    if (zombie.hp > 0) {
      showMessage(`命中${(ENEMIES[zombie.kind] ?? ENEMIES.walker).name} · 伤害 ${damage}`);
      return;
    }
    survival.zombies.splice(survival.zombies.indexOf(zombie), 1);
    survival.kills++;
    if (boss) {
      sound.play("defeat", DIRT);
      if (interruptFurnace(boss)) {
        sound.play("forge-vent", STONE);
        guardianFx.exposed = 1;
        showMessage("供火中断 · 守卫熄火，趁现在近身");
        return;
      }
      showMessage(`击退${ENEMIES[zombie.kind].name} · 剩余随从 ${survival.zombies.length}`);
      return;
    }
    const lootResult = campaign.grantLoot();
    if (checkSaveConflict(lootResult)) return;
    updateHotbar();
    sound.play("defeat", DIRT);
    const loot = `石头 +1 · 树叶 +1${lootResult.saved ? "" : " · 未保存"}`;
    if (!survival.zombies.length) {
      if (defense.beacon && survival.wave === DEFENSE_WAVES.length) { finishDefense("cleared"); return; }
      const healed = Math.min(24, 100 - player.hp);
      player.hp += healed;
      updateHealth();
      showMessage(`${healed ? `本波清空 · 生命 +${healed}` : "本波清空"} · ${loot}`);
    } else {
      showMessage(loot);
    }
  }

  function createActorMesh(quadCount) {
    const vertices = new Float32Array(quadCount * 4 * 10);
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
      }
    });
    return used;
  }

  function uploadActorMesh(mesh, used) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.vertices.subarray(0, used));
    bindVertexLayout();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
    gl.drawElements(gl.TRIANGLES, used / 40 * 6, gl.UNSIGNED_SHORT, 0);
  }

  function drawDragonFire() {
    if (!boss?.dragons.length) return;
    flameMesh ??= createActorMesh(1024);
    let used = 0;
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const upX = -rightZ * Math.sin(pitch), upZ = rightX * Math.sin(pitch), upY = Math.cos(pitch);
    function glow(x, y, z, size, r, g, b) {
      for (const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        flameMesh.vertices.set([x + size*(rightX*u + upX*v), y + size*upY*v,
          z + size*(rightZ*u + upZ*v), r,g,b,u,v,0,-8], used);
        used += 10;
      }
    }
    for (const d of boss.dragons) {
      if (!d.trail.length) continue;
      const s = d.headingS ?? d.s, c = d.headingC ?? d.c;
      for (let i = 0; i < d.trail.length; i++) {
        const p = d.trail[i], taper = 1 - i/32;
        const flicker = Math.sin(22*boss.elapsed + i*.75 + d.lane);
        const radius = (.18 + .32*taper) * (1 + .12*flicker);
        glow(p.x,p.y,p.z,radius*1.85,.44*taper,.042*taper,.005);
        glow(p.x,p.y,p.z,radius,.8*taper,.32*taper,.032*taper);
        const loft = (1-taper) * (1.1 + .45*flicker);
        glow(p.x + c*.22*flicker,p.y + loft,p.z - s*.22*flicker,
          radius*.46,.9*taper,.18*taper,.01);
      }
      for (const side of [-1,1]) for (let j=0; j<9; j++) {
        const f=j/8, lateral=side*(.16+.41*f);
        glow(d.x + c*lateral - s*f*.48,d.y+.14+.52*f,d.z-s*lateral-c*f*.48,
          .17-.09*f,1,.54,.12);
        if (j>3) glow(d.x+c*lateral-s*f*.72,d.y+.12+.37*f,d.z-s*lateral-c*f*.72,.08,1,.34,.06);
      }
      glow(d.x,d.y,d.z,.53,1,.65,.18);
      glow(d.x+s*.36,d.y-.06,d.z+c*.36,.31,1,.82,.38);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    uploadActorMesh(flameMesh, used);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  // A fixed field of broken molten seams replaces the chessboard feeling of
  // the old arena floor.  The shader animates flow inside each seam, while the
  // uneven segments keep them from reading as a set of decorative circles.
  function drawForgeFloor() {
    if (boss?.profile !== BOSS || !boss.hp) return;
    forgeFloorMesh ??= createActorMesh(260);
    const { vertices } = forgeFloorMesh;
    const { x: cx, z: cz, floor } = boss.profile.arena;
    let used = 0;
    const quad = (a, b, c, d) => {
      if (used + 40 > vertices.length) return;
      for (const [x, z] of [a, b, c, d]) {
        vertices.set([x, floor + .036, z, 1, .07, .006, 0, 1, 0, -11], used);
        used += 10;
      }
    };
    const seam = (x1, z1, x2, z2, width) => {
      const dx = x2 - x1, dz = z2 - z1, length = Math.hypot(dx, dz) || 1;
      const nx = -dz / length * width, nz = dx / length * width;
      quad([x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x2 - nx, z2 - nz], [x2 + nx, z2 + nz]);
    };
    // Twelve jagged branches spread out from the furnace plate.  Each branch
    // is deliberately broken into mismatched lengths and offsets.
    for (let branch = 0; branch < 12; branch++) {
      const angle = branch / 12 * Math.PI * 2 + .19 * Math.sin(branch * 4.2);
      let x = cx + Math.sin(angle) * (1.8 + (branch % 3) * .12);
      let z = cz + Math.cos(angle) * (1.8 + (branch % 3) * .12);
      for (let segment = 0; segment < 4; segment++) {
        const step = 1.03 + ((branch * 7 + segment * 5) % 4) * .22;
        const wobble = Math.sin(branch * 3.1 + segment * 2.4) * .21;
        const nx = x + Math.sin(angle + wobble) * step;
        const nz = z + Math.cos(angle + wobble) * step;
        seam(x, z, nx, nz, .045 + ((branch + segment) % 3) * .023);
        x = nx + Math.cos(angle) * .12;
        z = nz - Math.sin(angle) * .12;
      }
    }
    // The central grate has irregular cuts rather than a clean target-like
    // ring.  It anchors the boss visually without obscuring dodge space.
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * Math.PI * 2, b = a + (.15 + (i % 3) * .012);
      const r = 3.32 + Math.sin(i * 4.3) * .14;
      const r2 = r + .20 + (i % 4) * .026;
      quad([cx + Math.sin(a) * r, cz + Math.cos(a) * r], [cx + Math.sin(a) * r2, cz + Math.cos(a) * r2],
        [cx + Math.sin(b) * r2, cz + Math.cos(b) * r2], [cx + Math.sin(b) * r, cz + Math.cos(b) * r]);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    uploadActorMesh(forgeFloorMesh, used);
  }

  function drawForgeStage() {
    if (boss?.profile !== BOSS || !boss.hp) return;
    forgeStageMesh ??= createActorMesh(860);
    const used = appendModel(forgeStageMesh.vertices, 0, forgeStageParts(boss));
    uploadActorMesh(forgeStageMesh, used);
  }

  // This is the arena's always-on stage layer: drifting slag, breathing vent
  // plumes, and hot air around the perimeter.  It makes the room feel like a
  // functioning furnace even during the beats between attacks.
  function drawForgeAtmosphere() {
    if (boss?.profile !== BOSS || !boss.hp) return;
    forgeAtmosphereMesh ??= createActorMesh(720);
    let used = 0;
    const { x: cx, z: cz, floor, radius } = boss.profile.arena;
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const upX = -rightZ * Math.sin(pitch), upZ = rightX * Math.sin(pitch), upY = Math.cos(pitch);
    const hot = boss.phase === 1 ? [1, .13, .012] : boss.phase === 2 ? [1, .28, .018] : [1, .49, .05];
    const glow = (x, y, z, size, r, g, b) => {
      if (used + 40 > forgeAtmosphereMesh.vertices.length) return;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        forgeAtmosphereMesh.vertices.set([x + size * (rightX * u + upX * v), y + size * upY * v,
          z + size * (rightZ * u + upZ * v), r, g, b, u, v, 0, -8], used);
        used += 10;
      }
    };
    // Sparse rising embers are anchored in 3D; their speed and height vary so
    // they read as depth rather than a 2D particle overlay.
    for (let i = 0; i < 76; i++) {
      const seed = seeded(i + 71, boss.phase * 19 + 3);
      const angle = i * 2.39996 + seed * 5.7;
      const ring = 2.4 + (i % 11) * .83;
      const cycle = (boss.elapsed * (.22 + (i % 5) * .045) + seed) % 1;
      const sway = Math.sin(boss.elapsed * (1.5 + seed) + i * 1.9) * .23;
      glow(cx + Math.cos(angle) * ring + sway, floor + .18 + cycle * (1.9 + (i % 4) * .34),
        cz + Math.sin(angle) * ring + Math.cos(boss.elapsed + i) * .14,
        .018 + (i % 4) * .010, hot[0] * (.12 + cycle * .18), hot[1] * (.16 + cycle * .23), hot[2] * (.2 + cycle * .3));
    }
    // Six vents around the wall leave broad, slow columns of heat that frame
    // the fight without masking the player or the dodge telegraphs.
    for (let vent = 0; vent < 6; vent++) {
      const angle = vent / 6 * Math.PI * 2 + .25;
      const vx = cx + Math.sin(angle) * (radius - 1.35), vz = cz + Math.cos(angle) * (radius - 1.35);
      for (let layer = 0; layer < 7; layer++) {
        const t = layer / 6;
        const flutter = Math.sin(boss.elapsed * 3.7 + vent * 2.2 + layer) * (.11 + t * .19);
        const intensity = (.18 + (1 - t) * .18) * (boss.state === "attack" ? 1.35 : 1);
        glow(vx + flutter, floor + .25 + t * 2.9, vz - flutter * .5, .17 + t * .24,
          hot[0] * intensity, hot[1] * intensity, hot[2] * intensity);
      }
    }
    if (boss.state === "attack" && boss.attack?.kind === "shock") {
      const action = boss.attack;
      for (let i = 0; i < 48; i++) {
        const a = i / 48 * Math.PI * 2;
        const r = action.radius + Math.sin(i * 2.7 + boss.elapsed * 14) * .17;
        glow(action.x + Math.sin(a) * r, floor + .11 + (i % 3) * .055, action.z + Math.cos(a) * r,
          .052 + (i % 4) * .016, .95, .10 + (i % 3) * .04, .01);
      }
    }
    if ((boss.state === "windup" || boss.state === "attack") && boss.attack?.kind === "sweep") {
      const action = boss.attack, plan = BOSS_ATTACKS.sweep;
      const windup = boss.state === "windup" ? 1 - boss.time / action.windup : 1;
      const reach = plan.reach * (.28 + windup * .72);
      for (let i = 0; i < 36; i++) {
        const angle = action.angle - plan.arc + 2 * plan.arc * i / 35;
        const r = reach * (.72 + (i % 4) * .08);
        glow(action.x + Math.sin(angle) * r, floor + .18 + (i % 3) * .075, action.z + Math.cos(angle) * r,
          .052 + (i % 3) * .019, 1, .16 + windup * .18, .01);
      }
    }
    if (boss.state === "windup" && boss.attack?.marks) {
      for (const mark of boss.attack.marks) for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 + boss.elapsed * 2.4;
        const r = .45 + (i % 3) * .26;
        glow(mark.x + Math.sin(a) * r, floor + .16 + (i % 4) * .16, mark.z + Math.cos(a) * r,
          .045 + (i % 2) * .02, 1, .16, .01);
      }
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    uploadActorMesh(forgeAtmosphereMesh, used);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  // The guardian deliberately uses soft, additive billboards instead of more
  // voxel geometry.  Its silhouette can remain readable against the arena,
  // while heat, cinders, and pressure now move continuously through a move.
  function drawGuardianFire() {
    if (boss?.profile !== BOSS || !boss.hp) return;
    const active = boss.state === "windup" || boss.state === "attack";
    const vulnerable = boss.state === "recovery";
    const shifting = boss.phaseShift > 0;
    const energized = active || vulnerable || shifting || boss.hurt > 0;
    if (!energized) return;
    guardianFlameMesh ??= createActorMesh(420);
    let used = 0;
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const upX = -rightZ * Math.sin(pitch), upZ = rightX * Math.sin(pitch), upY = Math.cos(pitch);
    const phase = boss.phase;
    const action = boss.attack;
    const windup = boss.state === "windup" && action ? 1 - boss.time / action.windup : 0;
    const release = boss.state === "attack" && action
      ? 1 - boss.time / BOSS_ATTACKS[action.kind].duration : 0;
    const charge = shifting ? .82 + .18 * Math.sin(boss.elapsed * 22) ** 2
      : boss.state === "attack" ? 1 - release * .86 : Math.min(1, windup * 1.12);
    const cool = vulnerable ? [0.22, 1, .84] : phase === 1 ? [1, .24, .035]
      : phase === 2 ? [1, .39, .045] : [1, .58, .10];
    const glow = (x, y, z, size, alpha = 1, lift = 0) => {
      if (used + 40 > guardianFlameMesh.vertices.length) return;
      const r = cool[0] * alpha, g = cool[1] * alpha, b = cool[2] * alpha;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        guardianFlameMesh.vertices.set([x + size * (rightX * u + upX * v), y + lift + size * upY * v,
          z + size * (rightZ * u + upZ * v), r, g, b, u, v, 0, -9], used);
        used += 10;
      }
    };
    const emberCount = vulnerable ? 17 : 10 + phase * 4;
    for (let i = 0; i < emberCount; i++) {
      const seed = i * 2.39996 + phase * .83;
      const drift = boss.elapsed * (1.8 + (i % 3) * .23) + seed;
      const radius = .27 + (i % 5) * .095 + charge * .48;
      const rise = (i / emberCount) * (1.35 + charge * .82);
      const orbit = drift + Math.sin(drift * .71) * .32;
      const pulse = .66 + .34 * Math.sin(drift * 3.7 + i);
      glow(boss.x + Math.cos(orbit) * radius, boss.y + .84 + rise,
        boss.z + Math.sin(orbit) * radius, (.045 + (i % 4) * .011) * pulse * (1 + charge), .44 + .56 * charge, rise * .06);
    }
    // A two-part plume sells a furnace instead of a flat emissive rectangle.
    const plume = .22 + charge * .18 + (vulnerable ? .10 : 0);
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const wobble = Math.sin(boss.elapsed * 9 + i * 1.7) * (.08 + t * .07);
      glow(boss.x + wobble, boss.y + 1.55 + t * (1.15 + charge), boss.z + Math.cos(boss.elapsed * 7 + i) * .08,
        plume * (1 - t * .56), (1 - t * .48) * (.48 + charge * .52), t * .12);
    }
    if (shifting) {
      // A quick ignition halo makes the new furnace configuration legible
      // before it starts using that wave's attacks.
      for (let i = 0; i < 24; i++) {
        const angle = i / 24 * Math.PI * 2 + boss.elapsed * 4;
        const radius = .7 + (1 - boss.phaseShift / .85) * 1.45;
        glow(boss.x + Math.sin(angle) * radius, boss.y + 1.55 + (i % 3) * .16,
          boss.z + Math.cos(angle) * radius, .065 + (i % 4) * .018, .86, .08);
      }
    }
    if (action?.kind === "flare" && active) {
      // Each marked landing gets its own shell. The trail samples earlier
      // positions on the same arc and converges on the actual damage point.
      for (const [index, mark] of action.marks.entries()) {
        const side = index === 0 ? -1 : 1;
        const ox = boss.x + side * 1.16 * Math.cos(boss.angle);
        const oz = boss.z - side * 1.16 * Math.sin(boss.angle);
        if (boss.state === "windup") {
          for (let i = 0; i < 16; i++) {
            const t = windup - i * .012;
            if (t < 0) break;
            const y = (1 - t) * 3.24 + 15 * t * (1 - t);
            const size = 1 - i / 16;
            glow(ox + (mark.x - ox) * t, boss.y + .12 + y, oz + (mark.z - oz) * t,
              .08 + .31 * size, size);
          }
        } else {
          for (let i = 0; i < 18; i++) {
            const angle = i * 2.39996;
            const radius = release * (1 + i % 4 * .35);
            glow(mark.x + Math.sin(angle) * radius, boss.y + .12 + release * (1 - release) * (3 + i % 3),
              mark.z + Math.cos(angle) * radius, .07 + .14 * (1 - release), 1 - release);
          }
        }
      }
    }
    if (action?.kind === "nova" && boss.state === "attack") {
      for (const [index, wave] of action.waves.entries()) {
        if (wave.radius === null) continue;
        for (let i = 0; i < 40; i++) {
          const angle = (i + index * .5) * Math.PI / 20;
          const height = .13 + .21 * Math.sin(i * 4.1 + action.elapsed * 9) ** 2;
          glow(action.x + Math.sin(angle) * wave.radius, boss.y + height,
            action.z + Math.cos(angle) * wave.radius, index ? .17 : .11, .86);
        }
      }
    }
    if (boss.state === "attack" && action?.kind === "shock") {
      // Slag leaves the striking face in a low ballistic fan. Sample the
      // contact point in the locked attack frame so sparks stay on the floor.
      const age = release * BOSS_ATTACKS.shock.duration;
      const sin = Math.sin(action.angle), cos = Math.cos(action.angle);
      const contactX = action.x - 1.91 * cos + 2.36 * sin;
      const contactZ = action.z + 1.91 * sin + 2.36 * cos;
      for (let shard = 0; shard < 30; shard++) {
        const bearing = shard * 2.39996;
        const speed = 1.4 + (shard % 7) * .48;
        const lift = age * (2.8 + (shard % 5) * .58 - 7.6 * age);
        if (lift < 0) continue;
        const travel = speed * age;
        glow(contactX + travel * Math.sin(bearing), boss.y + .12 + lift,
          contactZ + travel * Math.cos(bearing), .045 + (shard % 3) * .017, 1 - release);
      }
      // Tiny vertical tongues on the advancing shock front make it feel like
      // it is tearing through the floor instead of being a painted ring.
      const start = action.radius - .36, end = action.radius + .28;
      for (let i = 0; i < 24; i++) {
        const angle = i / 24 * Math.PI * 2 + boss.elapsed * .35;
        const radius = start + (end - start) * ((i % 3) / 2);
        glow(action.x + Math.sin(angle) * radius, boss.y + .16, action.z + Math.cos(angle) * radius,
          .07 + (i % 2) * .024, .68, .08 + (i % 4) * .035);
      }
    }
    if (boss.state === "attack" && action?.kind === "ram") {
      const s = Math.sin(action.angle), c = Math.cos(action.angle);
      for (let i = 0; i < 18; i++) {
        const distance = Math.max(0, action.travelled - i * .22);
        const side = Math.sin(i * 2.4 + boss.elapsed * 18) * (.22 + i * .012);
        glow(action.x + s * distance + c * side, boss.y + .35 + (i % 4) * .12,
          action.z + c * distance - s * side, .10 + (18 - i) * .004, .58, i * .025);
      }
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    uploadActorMesh(guardianFlameMesh, used);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  function drawActors(bossModel) {
    if (!survival.zombies.length && !defense.beacon && !boss) return;
    actorMesh ??= createActorMesh(1700);
    const { vertices } = actorMesh;
    let used = 0;
    function box(actor, s, c, x, y, z, width, height, depth, red, green, blue) {
      const body = ENEMIES[actor.kind];
      const horizontal = body?.width ?? 1, vertical = body?.height ?? 1;
      for (const { d, v, light } of faces) {
        const shadeR = Math.min(1, red * light + actor.hurt * 2);
        const shadeG = Math.min(1, green * light);
        const shadeB = Math.min(1, blue * light);
        const nx = d[0] * c + d[2] * s;
        const nz = -d[0] * s + d[2] * c;
        for (const [vx, vy, vz] of v) {
          const px = (x + vx * width) * horizontal, pz = (z + vz * depth) * horizontal;
          vertices[used++] = actor.x + px * c + pz * s;
          vertices[used++] = actor.y + (y + vy * height) * vertical;
          vertices[used++] = actor.z - px * s + pz * c;
          vertices[used++] = shadeR;
          vertices[used++] = shadeG;
          vertices[used++] = shadeB;
          vertices[used++] = nx;
          vertices[used++] = d[1];
          vertices[used++] = nz;
          vertices[used++] = 0;
        }
      }
    }
    function groundArc(action, inner, outer, span, y, color) {
      const start = action.angle - span / 2;
      const pieces = Math.ceil(64 * span / (2 * Math.PI));
      function vertex(angle, radius) {
        vertices.set([action.x + Math.sin(angle) * radius, y, action.z + Math.cos(angle) * radius,
          ...color, 0, 1, 0, 0], used);
        used += 10;
      }
      for (let i = 0; i < pieces; i++) {
        const a = start + span * i / pieces, b = start + span * (i + 1) / pieces;
        vertex(a, inner);
        vertex(b, inner);
        vertex(b, outer);
        vertex(a, outer);
      }
    }
    function groundStrip(action, left, right, length, y, color) {
      const s = Math.sin(action.angle), c = Math.cos(action.angle);
      for (const [side, forward] of [[left, 0], [right, 0], [right, length], [left, length]]) {
        vertices.set([action.x + c * side + s * forward, y, action.z - s * side + c * forward,
          ...color, 0, 1, 0, 0], used);
        used += 10;
      }
    }
    if (boss) {
      const s = Math.sin(boss.angle), c = Math.cos(boss.angle);
      if (bossModel) used = appendModel(vertices, used, bossModel, boss.hurt);
      else bossParts(boss, (...part) => box(boss, s, c, ...part));
      if (boss.attack && (boss.state === "windup" || boss.state === "attack")) {
        const action = boss.attack, plan = BOSS_ATTACKS[action.kind];
        const striking = boss.state === "attack";
        const cold = boss.profile === COLOSSUS;
        const edge = cold ? (striking ? [1, .75, .87] : [1, .45, .64])
          : striking ? [1, .61, .20] : [.99, .29, .12];
        const heat = cold ? (striking ? [.75, .28, .57] : [.42, .19, .39])
          : striking ? [.93, .33, .10] : [.49, .17, .12];
        const full = 2 * Math.PI;
        const y = boss.y + .025;
        if (action.kind === "prism") {
          const rim = striking ? [1, .88, .57] : [1, .65, .32];
          const fill = striking ? [1, .53, .23] : [.30, .17, .19];
          for (const track of plan.tracks) {
            const left = track - plan.width, right = track + plan.width;
            groundStrip(action, left, right, plan.reach, y, fill);
            groundStrip(action, left, left + .11, plan.reach, y + .017, rim);
            groundStrip(action, right - .11, right, plan.reach, y + .017, rim);
            if (striking) {
              groundStrip(action, track - .25, track + .25, plan.reach, y + .17, rim);
            } else {
              const offset = plan.reach * (1 - boss.time / action.windup);
              groundStrip({ ...action, x: action.x + s * offset, z: action.z + c * offset },
                track - .82, track + .82, Math.min(1.5, plan.reach - offset), y + .03, rim);
            }
          }
        } else if (action.kind === "nova") {
          if (!striking) {
            groundArc(action, 1.48, 1.93, full, y, heat);
            groundArc(action, 2.34, 2.52, full, y, edge);
          } else {
            for (const wave of action.waves) {
              if (wave.radius === null) continue;
              groundArc(action, wave.radius - .52, wave.radius + .52, full, y, heat);
              groundArc(action, wave.radius + .34, wave.radius + .52, full, y + .017, edge);
            }
          }
        } else if (action.kind === "ram") {
          groundStrip(action, -plan.width, plan.width, action.length, y, heat);
          groundStrip(action, -plan.width, -.92, action.length, y + .02, edge);
          groundStrip(action, .92, plan.width, action.length, y + .02, edge);
        } else if (action.marks) {
          for (const mark of action.marks) {
            const circle = { ...mark, angle: 0 };
            groundArc(circle, 0, plan.reach, full, y, heat);
            groundArc(circle, plan.reach - .16, plan.reach, full, y + .02, edge);
          }
        } else if (action.kind === "rift") {
          groundStrip(action, -action.width, action.width, plan.reach, y, heat);
          groundStrip(action, -action.width, -action.width + .13, plan.reach, y + .017, edge);
          groundStrip(action, action.width - .13, action.width, plan.reach, y + .017, edge);
          if (striking) groundStrip(action, -.26, .26, plan.reach, y + .017, edge);
        } else if (action.kind === "shock") {
          const radius = action.radius;
          groundArc(action, Math.max(0, radius - .45), radius + .45, full, y, heat);
          groundArc(action, radius + .26, radius + .44, full, y + .017, edge);
          if (!striking) groundArc(action, 2.05, 2.20, full, y, edge);
        } else {
          const span = action.kind === "sweep" ? plan.arc * 2 : full;
          groundArc(action, 0, plan.reach, span, y, heat);
          groundArc(action, plan.reach - .17, plan.reach, span, y + .017, edge);
          if (action.kind === "flare" || action.kind === "meteor") groundArc(action, plan.reach * .52, plan.reach * .58, span, y + .017, edge);
          if (action.kind === "meteor") {
            const altitude = striking ? .08 : .16 + 8.5 * (boss.time / action.windup) ** 1.6;
            const crystal = { x: action.x, y: y + altitude, z: action.z, hurt: 0 };
            const angle = boss.elapsed * 3;
            const sin = Math.sin(angle), cos = Math.cos(angle);
            box(crystal, sin, cos, -.60, .20, -.60, 1.20, .84, 1.20, ...edge);
            box(crystal, sin, cos, -.32, 0, -.32, .64, 1.38, .64, ...heat);
          }
        }
      }
    }
    for (const zombie of survival.zombies) {
      const style = ENEMIES[zombie.kind] ?? ENEMIES.walker;
      const s = Math.sin(zombie.angle), c = Math.cos(zombie.angle);
      zombieParts(zombie, style, (...part) => box(zombie, s, c, ...part));
    }
    const beacon = defense.beacon;
    if (beacon) {
      const s = Math.sin(defense.elapsed * .82), c = Math.cos(defense.elapsed * .82);
      beaconParts(beacon, defense.elapsed, (...part) => box(beacon, 0, 1, ...part), (...part) => box(beacon, s, c, ...part));
    }
    gl.uniform3f(targetLocation, -1, -1, -1);
    uploadActorMesh(actorMesh, used);
  }

  function cycleWeather() {
    weather.index = (weather.index + 1) % weatherTypes.length;
    weather.elapsed = 0;
  }

  function updateWeather(dt) {
    const target = weatherTypes[weather.index];
    weather.elapsed += dt;
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

  const rainPattern = Array.from({ length: 110 }, (_, i) => ({
    phase: seeded(i, 21), speed: .63 + seeded(i, 7) * .55,
    x: seeded(i, 15), length: .022 + .022 * seeded(i, 43)
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
    gl.uniform2f(fogLocation, 100, 120);
    const used = appendModel(viewModelMesh.vertices, 0, gun.parts, 0, true);
    uploadActorMesh(viewModelMesh, used);
    return projectEffect(projection, gun.muzzle, width, height);
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
    if (rain > .02) {
      fx.beginPath();
      fx.lineWidth = Math.max(1, width / 880);
      fx.strokeStyle = `rgba(196, 222, 233, ${.45 * rain})`;
      const drops = Math.floor(rainPattern.length * rain);
      for (let i = 0; i < drops; i++) {
        const drop = rainPattern[i];
        const phase = (drop.phase + weather.phase * drop.speed) % 1;
        const x = ((drop.x + phase * .12 + 1 - yaw * .023 % 1) % 1) * width;
        const y = (phase * 1.13 - .07) * height;
        const length = drop.length * height;
        fx.moveTo(x, y);
        fx.lineTo(x + length * .32, y + length);
      }
      fx.stroke();
    }
    if (player.hurt > 0) {
      const vignette = fx.createRadialGradient(width * .5, height * .5, height * .24, width * .5, height * .5, Math.hypot(width, height) * .52);
      vignette.addColorStop(0, "rgba(151,34,26,0)");
      vignette.addColorStop(1, `rgba(151,34,26,${player.hurt * 1.75})`);
      fx.fillStyle = vignette;
      fx.fillRect(0, 0, width, height);
    }
    if (!player.hp) return;
    if (!weapon) { drawHeldBlock(block, width, height); return; }
    if (isGun(weapon)) { drawPulseMuzzle(muzzle, vp, width, height); return; }
    const unit = Math.max(3, Math.min(height, width) / 123);
    const swing = Math.sin(Math.PI * (1 - player.swing / .27));
    fx.save();
    fx.translate(width * .82 - swing * width * .19, height * .96 + swing * height * .05);
    fx.rotate(.45 - swing * 1.18);
    fx.scale(unit, unit);
    const rect = (color, x, y, w, h) => { fx.fillStyle = color; fx.fillRect(x, y, w, h); };
    rect("#382b22", -2, -9, 5, 19);
    rect("#795942", -1, -9, 2, 15);
    if (weapon.style === "sword") {
      rect("#414c4b", -4, -33, 9, 26);
      rect("#a6b3ae", -3, -37, 7, 27);
      rect("#d2d9d4", -3, -35, 2, 24);
      rect("#56635c", -7, -11, 15, 4);
    } else {
      rect("#624732", -2, -33, 5, 25);
      rect("#465352", -12, -36, 18, 16);
      rect("#b5c2bb", -15, -34, 10, 13);
      rect("#d6ddd7", -15, -34, 3, 13);
    }
    fx.restore();
  }

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
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
    bossHud.hidden = !boss;
    if (boss) {
      const wave = boss.profile === BOSS ? GUARDIAN_WAVES[boss.phase - 1] : null;
      const maxHp = wave?.hp ?? boss.profile.maxHp;
      if (bossHealth.max !== maxHp) bossHealth.max = maxHp;
      if (bossHealth.value !== boss.hp) bossHealth.value = boss.hp;
      setText(bossHealthValue, `${boss.hp} / ${maxHp}`);
      let phaseLabel = wave ? `第 ${boss.phase} / ${GUARDIAN_WAVES.length} 波 · ${wave.name} · 随从 ${enemiesLeft}`
        : boss.phase === 1 ? "第一阶段" : `第二阶段 · ${boss.profile.phaseName}`;
      if (wave) {
        phaseLabel += [" · 蓄力时可绕背破甲", " · 击倒随从可中断供火", " · 诱使冲锋扑空可延长反击"][boss.phase - 1];
        setText(bossName, `熔炉守卫 · 第 ${boss.phase} / ${GUARDIAN_WAVES.length} 波`);
      }
      if (boss.profile === COLOSSUS) {
        const timer = ready => ready > boss.elapsed ? ` ${Math.ceil(ready - boss.elapsed)}秒` : "";
        phaseLabel += `　1 回血${timer(boss.healReady)}　4 五龙冲击${timer(boss.dragonsReady)}`;
      }
      setText(waveStatus, phaseLabel);
      const attack = boss.attack && BOSS_ATTACKS[boss.attack.kind];
      const covered = bossHasCover();
      const danger = !finished && insideColossusHazard(boss, { ...player, covered });
      const phaseShiftHint = boss.profile === BOSS && boss.phaseShift > 0
        ? { 2: "炉芯升压 · 烈火：击倒随从可中断供火", 3: "撞锤展开 · 过载：诱使冲锋扑空" }[boss.phase]
        : null;
      const callout = finished ? "挑战结束"
        : phaseShiftHint ? phaseShiftHint
        : boss.state === "ready" ? (boss.profile === COLOSSUS ? "巨像正在逼近，准备闪避" : "守卫正在逼近，留意起手")
          : boss.state === "reposition" ? (boss.travel.pursuit ? "巨像正在追击，拉开侧向距离" : "巨像正在换位，留意下一次预警")
          : boss.state === "recovery" ? (boss.profile === COLOSSUS ? "巨像降下 · 攻击青色核心" : "核心暴露 · 现在反击")
            : boss.attack.kind === "prism" && covered ? `${attack.name} · ${attack.hint} · 掩体遮住折光，换侧瞄准晶体`
            : boss.attack.kind === "prism" && boss.state === "windup" ? `${attack.name} · ${attack.hint}`
              : danger ? `${attack.name} · ${boss.attack.kind === "repel" ? "退到圆圈外" : boss.attack.kind === "nova" ? "震圈逼近，准备起跳" : boss.attack.kind === "meteor" ? "脚下已锁定，立刻跑开" : "你在光带中，向侧面闪避"}`
              : boss.state === "windup" ? `${attack.name} · ${attack.hint}` : attack.name;
      setText(bossCallout, callout);
      bossHud.classList.toggle("vulnerable", boss.state === "recovery");
      bossHud.classList.toggle("in-danger", danger);
    } else if (beacon) {
      const wave = Math.min(DEFENSE_WAVES.length, enemiesLeft || finished ? survival.wave : survival.wave + 1);
      const plan = DEFENSE_WAVES[Math.max(0, wave - 1)];
      setText(waveStatus, `第 ${wave || 1} / ${DEFENSE_WAVES.length} 波 · ${plan.name}`);
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
      setText(waveStatus, !survival.enabled ? "自由建造" : enemiesLeft
        ? `第 ${survival.wave} 波 · 剩余 ${enemiesLeft} 只`
        : `第 ${survival.wave + 1} 波 · ${Math.max(1, Math.ceil(survival.countdown))} 秒后`);
    }
    setText(coordinates, `X ${player.x.toFixed(1)} · Y ${player.y.toFixed(1)} · Z ${player.z.toFixed(1)}`);
    const charging = weapon === pulseWeapon && pulse.charge !== null;
    const inReach = aim && aim.distance <= (charging ? pulseBurst : weapon ?? punch).reach;
    const target = aim?.zombie;
    targetStatus.hidden = !aim;
    const backOpen = boss && guardianBackOpen(boss, player);
    const exposed = backOpen || boss?.state === "recovery" && (boss.profile !== COLOSSUS || aim?.weak);
    crosshair.classList.toggle("on-target", Boolean(inReach && (!boss || target || exposed || aim.crystal)));
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
        : hasPulseEquipped && !pulse.rounds ? "能量耗尽" : player.cooldown > 0 ? "收招中" : "可攻击";
      setText(weaponLabel, `${weapon?.name ?? "徒手"} · ${availability}`);
      const remaining = recharging ? pulse.recharge / pulseWeapon.recharge
        : charging ? 1 - pulse.charge / pulseBurst.windup : player.cooldown / player.recoveryTime;
      const recovery = Math.round(100 * (1 - remaining));
      if (weaponRecovery.value !== recovery) weaponRecovery.value = recovery;
    }
    if (boss && aim && !aim.zombie) {
      setText(targetStatus, !inReach ? "超出攻击距离" : aim.crystal ? `聚星晶体 ${boss.attack.crystalHp} / ${BOSS_ATTACKS.prism.crystalHp}`
        : backOpen ? "背部炉门暴露" : exposed ? "核心暴露" : boss.state === "recovery" ? "瞄准青色核心" : "护甲关闭");
    } else if (target) {
      const style = ENEMIES[target.kind] ?? ENEMIES.walker;
      const hint = !inReach ? " · 超出攻击距离" : target.windup > 0 ? " · 蓄力" : "";
      setText(targetStatus, `${style.name} ${target.hp} / ${style.hp}${hint}`);
    }
  }
  function showMessage(text) {
    window.clearTimeout(noticeTimer);
    message.textContent = text;
    noticeTimer = window.setTimeout(() => message.textContent = "", 1700);
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
  function axeAvailable() { return !survival.enabled || campaign.axeUnlocked; }
  function encounterSlots() { return boss?.profile === COLOSSUS ? slotCount : palette.length + 2; }

  function selectSlot(slot) {
    if (slot >= encounterSlots() || (boss && slot < palette.length)) return;
    if (weapons[slot - palette.length]?.style === "axe" && !axeAvailable()) {
      showMessage("石斧需要制作，按 C 打开背包");
      return;
    }
    if (selected === slot) return;
    firing = false;
    cancelDrag();
    pulse.charge = null;
    selected = slot;
    updateHotbar();
  }

  function updateHotbar() {
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
        slot.innerHTML = `<b>${(i + 1) % 10}</b><span class="weapon-swatch ${isGun(weapon) ? "pulse" : weapon.style}-swatch" aria-hidden="true"></span>${weapon.name}`;
        return slot;
      }
      const type = palette[i];
      const color = blockColors[type].map(channel => Math.round(channel * 255));
      slot.style.setProperty("--block-color", `rgb(${color.join(" ")})`);
      const quantity = survival.enabled ? `<span class="slot-count">${campaign.count(type)}</span>` : "";
      slot.innerHTML = `<b>${i + 1}</b>${quantity}<span class="swatch" aria-hidden="true"></span>${blockNames[type]}`;
      return slot;
    }));
    setText(hudDressings, String(campaign.dressings));
  }

  function recipeCost(key) {
    return RECIPES[key].cost.map(([block, count]) => `${blockNames[block]} ${campaign.count(block)}/${count}`).join(" · ");
  }

  function updateInventory() {
    inventoryMaterials.replaceChildren(...palette.map(block => {
      const entry = document.createElement("div");
      const label = document.createElement("dt"), value = document.createElement("dd");
      label.textContent = blockNames[block];
      value.textContent = String(campaign.count(block));
      entry.append(label, value);
      return entry;
    }));
    setText(axeCost, campaign.axeUnlocked ? "已解锁，按 7 装备" : recipeCost("axe"));
    setText(dressingCost, `${recipeCost("dressing")} · 恢复 ${RECIPES.dressing.healing} 点生命`);
    setText(inventoryDressings, `敷料 ${campaign.dressings} 件 · 当前生命 ${player.hp}/100`);
    craftAxeButton.disabled = !campaign.canCraft("axe");
    craftDressingButton.disabled = !campaign.canCraft("dressing");
    useDressingButton.disabled = !campaign.dressings || player.hp >= 100;
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

  function healWithDressing() {
    if (!survival.enabled || !player.hp) return;
    let notice;
    if (player.hp >= 100) notice = "生命已满";
    else {
      const result = campaign.useDressing();
      if (checkSaveConflict(result)) return;
      if (!result) notice = "背包里没有敷料，按 C 制作";
      else {
        const healed = Math.min(100 - player.hp, RECIPES.dressing.healing);
        player.hp += healed;
        updateHealth();
        updateHotbar();
        notice = `生命 +${healed}${result.saved ? "" : " · 未保存"}`;
      }
    }
    if (inventoryScreen.hidden) showMessage(notice);
    else {
      updateInventory();
      setText(inventoryNotice, notice);
    }
  }

  function openInventory() {
    if (!started || finished || !player.hp) return;
    if (!survival.enabled) {
      showMessage(boss ? (boss.profile === COLOSSUS ? "6 石剑 · 7 石斧 · 8 星脉枪" : "挑战武器可用 6、7 或滚轮切换") : "自由建造的方块不限量");
      return;
    }
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
    const result = campaign.editBlock(index(x, y, z), before, type, survival.enabled);
    if (!result || checkSaveConflict(result)) return;
    set(...cell, type);
    player.handAction = blockActionTime;
    survival.recalc = 0;
    survival.routesDirty = true;
    sound.play(place ? "place" : "break", effectMaterial);
    if (survival.enabled) updateHotbar();
    const action = place ? `已放置${blockNames[type]}` : survival.enabled ? `${blockNames[before]} +1` : "已破坏方块";
    showMessage(result.saved ? action : `${action}，本次改动无法保存`);
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
    gl.enableVertexAttribArray(positionLocation); gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(colorLocation); gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(faceLocation); gl.vertexAttribPointer(faceLocation, 4, gl.FLOAT, false, 40, 24);
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
    const [ex, ey, ez] = viewOrigin;
    const bossModel = !boss ? null : boss.profile === COLOSSUS ? posedColossus(boss) : posedGuardian(boss);
    renderedView = { origin, direction: d, bossModel };
    const aspect = canvas.width / canvas.height;
    // Boss attacks ask the player to read silhouettes and ground space at the
    // same time.  A slightly wider arena lens keeps the raised weapon and its
    // incoming hazard in frame without changing aiming or collision rules.
    const fov = boss ? Math.PI * .4 : Math.PI / 3;
    const vp = multiply(perspective(fov, aspect, .06, 90), lookAt(ex, ey, ez, ex + d[0], ey + d[1], ez + d[2]));
    const night = Boolean(defense.beacon) && !defense.victory;
    const arena = boss?.profile.arena;
    let sky = arena?.sky ?? weather.sky;
    if (arena?.fractureSky && boss.phaseGlow > 0) {
      sky = sky.map((channel, i) => channel + (arena.fractureSky[i] - channel) * boss.phaseGlow);
    } else if (night) sky = [sky[0] * .36, sky[1] * .42, sky[2] * .51];
    gl.clearColor(...sky, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program); gl.uniform3f(cameraLocation, ex, ey, ez); gl.uniformMatrix4fv(viewProjectionLocation, false, vp);
    gl.uniform3f(skyLocation, ...sky); gl.uniform2f(fogLocation, ...(boss ? boss.profile.arena.fog : weather.fog));
    gl.uniform1f(lightLocation, boss ? .94 : weather.light * (night ? .75 : 1));
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
    gl.uniform3f(targetLocation, ...(!weapon && !aim && blockHit ? blockHit.hit : [-1, -1, -1]));
    drawTerrain();
    drawForgeFloor();
    drawForgeStage();
    drawForgeAtmosphere();
    drawActors(bossModel);
    drawGuardianFire();
    drawDragonFire();
    sound.setRoar(active && !finished && Boolean(boss?.dragons.length));
    const muzzle = isGun(weapon) && player.hp ? drawPulseWeapon(perspective(Math.PI / 3, aspect, .035, 6)) : null;
    drawEffects(weapon, heldBlock, sheltered ? 0 : rain, vp, muzzle);
    if (started) updateStatus(aim, weapon);
  }

  document.addEventListener("keydown", event => {
    if (started && event.code === "KeyM" && !event.repeat) {
      toggleSound();
      return;
    }
    if (!inventoryScreen.hidden && (event.code === "Escape" || (event.code === "KeyC" && !event.repeat))) {
      event.preventDefault();
      closeInventory(event.code === "KeyC" && inventoryFromPlay);
      return;
    }
    if (event.code === "Escape" && (mouseMode !== "paused" || lockAttempt)) {
      suspendGame();
      return;
    }
    if (mouseMode === "paused") return;
    if (!event.repeat) wakeAudio();
    if (boss?.profile === COLOSSUS && ["Digit1", "Digit4"].includes(event.code)) {
      if (event.repeat || finished || !player.hp) return;
      if (event.code === "Digit1") {
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
      return;
    }
    if (event.code === "KeyR" && !event.repeat && isGun(weapons[selected - palette.length])) { rechargePulse(); return; }
    if (event.code === "KeyC" && !event.repeat) { openInventory(); return; }
    if (event.code === "KeyH" && !event.repeat) { healWithDressing(); return; }
    if (event.code === "KeyE" && !event.repeat) { repairBeacon(); return; }
    if (event.code === "KeyB" && !event.repeat && defense.beacon && !survival.zombies.length) {
      survival.countdown = 0;
      return;
    }
    if (event.code === "KeyT" && !event.repeat && !boss) cycleWeather();
    keys.add(event.code);
    if (event.code.startsWith("Arrow")) event.preventDefault();
    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) jumpBuffer = .12;
    }
    if (event.code.startsWith("Digit")) selectSlot((Number(event.code.slice(5)) || 10) - 1);
  });
  document.addEventListener("keyup", event => keys.delete(event.code));

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
    try { storage?.setItem(sensitivityKey, String(mouseLook.sensitivity)); } catch { /* Session-local settings still work. */ }
  });

  function cancelDrag() {
    if (!drag) return;
    const { pointerId } = drag;
    drag = null;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  function setMouseMode(mode) {
    firing = false;
    const wasPlaying = mouseMode !== "paused";
    mouseMode = mode;
    if (mode === "paused") pulse.charge = null;
    mouseLook.reset();
    cancelDrag();
    keys.clear();
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

  function loadLatestSave() {
    if (saveConflict || campaign.stale) {
      campaign = createProgression(storage, WORLD);
      homeWorld.set(generateTerrain(WORLD, BLOCK));
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

  document.addEventListener("mousemove", event => {
    if (mouseMode === "locked" && document.pointerLockElement === canvas) mouseLook.push(event.movementX, event.movementY, "locked");
  });

  canvas.addEventListener("mousedown", event => {
    if (!started || !player.hp || (event.button !== 0 && event.button !== 2)) return;
    if (mouseMode === "paused") return;
    wakeAudio();
    if (mouseMode === "locked" && event.button === 0 && isGun(weapons[selected - palette.length])) firing = true;
    if (mouseMode === "locked" || event.button === 2) interact(event.button === 2);
  });
  document.addEventListener("mouseup", event => {
    if (event.button === 0) firing = false;
    if (event.button !== 2 || pulse.charge === null) return;
    const charged = Math.max(pulse.charge, (performance.now() - pulse.chargeStarted) / 1000) >= pulseBurst.windup;
    pulse.charge = null;
    if (charged && mouseMode !== "paused") firePulse(true);
  });

  canvas.addEventListener("pointerdown", event => {
    if (mouseMode !== "drag" || event.button !== 0 || drag) return;
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
    firing = false;
    cancelDrag();
    if (clicked && mouseMode === "drag") {
      wakeAudio();
      interact(false);
    }
  });
  for (const type of ["pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, event => {
      if (drag?.pointerId === event.pointerId) { firing = false; cancelDrag(); }
    });
  }

  canvas.addEventListener("wheel", event => {
    if (mouseMode === "paused" || event.deltaY === 0) return;
    event.preventDefault();
    const first = boss ? palette.length : 0;
    const slots = encounterSlots() - first - (axeAvailable() ? 0 : 1);
    selectSlot(first + (selected - first + Math.sign(event.deltaY) + slots) % slots);
  }, { passive: false });
  canvas.addEventListener("contextmenu", event => event.preventDefault());
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
  window.addEventListener("storage", event => {
    if (event.storageArea !== storage) return;
    if (event.key === sensitivityKey || event.key === null) {
      mouseLook.setSensitivity(event.newValue);
      updateLookControl();
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
  resumeButton.addEventListener("click", () => requestMouse());
  pauseInventoryButton.addEventListener("click", openInventory);
  inventoryResume.addEventListener("click", () => closeInventory(true));
  craftAxeButton.addEventListener("click", () => craftItem("axe"));
  craftDressingButton.addEventListener("click", () => craftItem("dressing"));
  useDressingButton.addEventListener("click", healWithDressing);

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
    menuStatus.hidden = !graphicsLost;
    resetSurvival();
    placePlayerAtSpawn();
    ({ yaw, pitch } = spawnView);
    startButton.focus({ preventScroll: true });
  }
  pauseMenuButton.addEventListener("click", returnToMenu);
  reloadSaveButton.addEventListener("click", returnToMenu);
  deathMenuButton.addEventListener("click", returnToMenu);

  function startWorld(mode) {
    if (graphicsLost) return;
    const bossProfile = mode === COLOSSUS.id ? COLOSSUS : mode === BOSS.id ? BOSS : null;
    boss = bossProfile ? createBossFight(bossProfile) : null;
    selectTerrain();
    if (!boss) loadLatestSave();
    const withZombies = mode === "survival" || mode === "defense";
    survival.enabled = withZombies;
    finished = false;
    Object.assign(defense, { beacon: null, routes: null, seconds: 0, elapsed: 0, victory: false });
    resetSurvival();
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
      bossHealth.max = boss.profile.maxHp;
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
    showMessage(boss ? (boss.profile === COLOSSUS ? "8 星脉枪 · R 充能" : "6 石剑 · 7 石斧") : defense.beacon ? "守住信标，清完五波敌人"
      : withZombies ? "石剑已装备 · 按 C 查看配方" : "自由建造 · 方块改动会自动保存");
    requestMouse(true);
  }
  defenseButton.addEventListener("click", () => startWorld("defense"));
  bossButton.addEventListener("click", () => startWorld("boss"));
  colossusButton.addEventListener("click", () => startWorld(COLOSSUS.id));
  startButton.addEventListener("click", () => startWorld("survival"));
  buildButton.addEventListener("click", () => startWorld("creative"));
  respawnButton.addEventListener("click", () => {
    if (boss) { startWorld(boss.profile.id); return; }
    if (campaign.stale) {
      startWorld(defense.beacon ? "defense" : "survival");
      return;
    }
    if (defense.beacon) { startWorld("defense"); return; }
    finished = false;
    resetSurvival();
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
  updateHotbar(); updateSoundButton(); updateLookControl(); window.requestAnimationFrame(render);
}

if (typeof window !== "undefined") initGame(window);
