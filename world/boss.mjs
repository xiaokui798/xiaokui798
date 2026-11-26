import { contains, seeded, voxelIndex } from "./terrain.mjs";
import { weaponAssets } from "./weapon-assets.mjs";

export const ARENA = Object.freeze({ name: "熔炉遗迹", x: 16.5, z: 16.5, floor: 5, radius: 14, spawnZ: 23.8,
  pitch: -.045, sky: [.045, .018, .012], fog: [11, 24] });
export const SKY_COURT = Object.freeze({ name: "断星天井", x: 16.5, z: 16.5, floor: 6, radius: 17, spawnZ: 28.15,
  pitch: .16, sky: [.105, .135, .235], fractureSky: [.24, .105, .19], fog: [20, 35] });
// Low enough to route around, high enough to break a shot and a refracted beam.
// The two northern pillars make the entrance a readable first cover choice.
export const SKY_COURT_COVERS = Object.freeze([
  { x: 10.5, z: 22.5, radius: 1.05, height: 4 }, { x: 22.5, z: 22.5, radius: 1.05, height: 4 },
  { x: 10.5, z: 10.5, radius: 1.05, height: 4 }, { x: 22.5, z: 10.5, radius: 1.05, height: 4 }
]);
// Furnace ruins use soot-black stone and deep oxidized metal.  The old mid-grey
// palette made every arena tile read like a construction block under flat light.
export const ARENA_PALETTE = [[.075, .086, .105], [.13, .15, .18], [.29, .075, .022], [1, .20, .018], [.19, .075, .032],
  [.15, .20, .33], [.30, .39, .55], [.44, .50, .70], [.52, .37, .86], [.19, .69, .79]];
const [BASALT, TILE, BRONZE, EMBER, ASH, INK, SLATE, SILVER, VIOLET, AURORA] = ARENA_PALETTE.map((_, i) => i + 6);
// The guardian's waves ARE its health bars (batch 59, multibar
// design §1): one row per bar with that bar's full parameter set —
// cadence, windup scale, speed, recovery, damage scale — so no
// second table exists anywhere.
export const GUARDIAN_WAVES = [
  { name: "起火", hp: 260, armor: 0, windup: 1, pursuit: 1.2, speed: 3.8, recovery: 1.9, damageScale: 1, attacks: ["shock", "sweep"], minions: ["walker"] },
  { name: "烈火", hp: 320, armor: .10, windup: .86, pursuit: 1, speed: 4.4, recovery: 1.8, damageScale: 1, attacks: ["flare", "sweep"], minions: ["runner", "walker"] },
  { name: "过载", hp: 400, armor: .20, windup: .72, pursuit: .75, speed: 5.2, recovery: 1.45, damageScale: 1.15, attacks: ["ram", "nova"], minions: ["runner", "breaker"] }
];
export const BOSS = Object.freeze({ id: "boss", name: "熔炉守卫", arena: ARENA, maxHp: GUARDIAN_WAVES[0].hp, radius: .86, height: 3.45 });
export const COLOSSUS = Object.freeze({ id: "colossus", name: "断星巨像", arena: SKY_COURT, maxHp: 700, radius: 1.95, height: 8.3,
  bars: [
    { name: "裂星", hp: 700, recovery: 2.55, windupScale: 1, speedScale: 1, damageScale: 1, patterns: ["meteor", "rift"] },
    { name: "震星", hp: 750, recovery: 2.3, windupScale: .92, speedScale: 1, damageScale: 1.05, patterns: ["nova", "prism", "meteor", "rift"] },
    { name: "逐星", hp: 800, recovery: 2, windupScale: .84, speedScale: 1.15, damageScale: 1.1, patterns: ["nova", "prism", "meteor", "rift"] },
    { name: "碎星", hp: 850, recovery: 1.7, windupScale: .78, speedScale: 1.25, damageScale: 1.2, patterns: ["nova", "prism", "meteor", "rift"] }
  ] });

// The current bar of a fight, for HUD and tuning readers: fight.phase
// IS the bar index (1-based) for both bosses; hp is always the
// current bar's remaining health.
export function bossBar(fight) {
  const index = fight.phase;
  const bar = fight.profile === BOSS ? GUARDIAN_WAVES[index - 1] : fight.profile.bars[index - 1];
  const count = fight.profile === BOSS ? GUARDIAN_WAVES.length : fight.profile.bars.length;
  return { index, count, name: bar.name, hp: fight.hp, maxHp: bar.hp, damageScale: bar.damageScale };
}

// The hint is the full windup sentence the player reads (batch 48,
// boss-feedback plan problem two): no internal terms, the dodge and
// the direction are in the sentence itself.
export const BOSS_ATTACKS = Object.freeze({
  ram: { name: "熔锤冲锋", hint: "守卫要冲过来了！等红线停住再往侧边躲，它撞空就是反击机会", windup: 1.35, duration: .52, damage: 32, reach: 8, width: 1.12 },
  shock: { name: "震地波", hint: "守卫要砸地了！红圈扩到你脚下时跳起来", windup: 1.04, duration: 1.22, damage: 24, reach: 13.6 },
  sweep: { name: "扇形横扫", hint: "横扫来了！跑出地上的红扇子，从侧边出去最快", windup: .94, duration: .22, damage: 30, reach: 5.15, arc: 1.05 },
  flare: { name: "炉火坠落", hint: "火球要砸下来了！跑出地上的红圈", windup: 1.11, duration: .28, damage: 28, reach: 2.35 },
  meteor: { name: "追星坠落", hint: "陨石要砸你站的地方了，跑开！", windup: 1.29, duration: .38, damage: 24, reach: 2.85 },
  repel: { name: "星压逼退", hint: "巨像要震开你了！跑出脚下的圆圈", windup: .78, duration: .24, damage: 6, reach: 4.45 },
  rift: { name: "裂地冲线", hint: "地面要裂开了！横着跑出光带", windup: 1.26, duration: .27, damage: 27, reach: 17.4, width: 1.62 },
  nova: { name: "双环星震", hint: "两圈冲击波！红圈到脚下就跳，一共跳两次", windup: 1.35, duration: 2.62, damage: 18, reach: 19.7 },
  prism: { name: "三轨折光", hint: "三道光束要亮了！站到光束之间的空地，或打碎金色晶体", windup: 2.14, duration: .48, damage: 32, reach: 20,
    tracks: [-4.1, 0, 4.1], width: 1.05, crystalHp: 42 }
});

const orbitPoints = [[4.8, 0], [0, -4.8], [-4.8, 0], [0, 4.8]];
const novaDelay = .82, novaStart = 1.72, novaBand = .57;
const pursuitRange = 10.8, fightingDistance = 7.8;
const repelRange = 3.85, longRange = 11.2;
// The rendered guardian is much wider than its compact hit silhouette.  At
// 2.4 units it filled a first-person view, hiding the hammer and the incoming
// shock ring just when the player needs to read them.  Keep a readable combat
// standoff; the player can still step into sword range during a recovery.
const guardianStandOff = 4.6;

export function buildArena(layout) {
  const voxels = new Uint8Array(layout.width * layout.height * layout.depth);
  function set(x, y, z, block) {
    if (contains(layout, x, y, z)) voxels[voxelIndex(layout, x, y, z)] = block;
  }
  for (let x = layout.minX; x < layout.minX + layout.width; x++) {
    for (let z = layout.minZ; z < layout.minZ + layout.depth; z++) {
      const dx = x + .5 - ARENA.x, dz = z + .5 - ARENA.z;
      const r = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx);
      const rings = (r >= 6.05 && r <= 6.95) || (r >= 11.15 && r <= 12.05);
      const seam = (dx === 0 || dz === 0) && r > 3;
      const tile = r < 3 || rings || seam ? BRONZE : (Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? TILE : BASALT;
      for (let y = 0; y < ARENA.floor - 1; y++) set(x, y, z, BASALT);
      set(x, ARENA.floor - 1, z, r <= ARENA.radius ? tile : ASH);
      if (r < ARENA.radius) continue;

      const pillar = Math.abs(Math.sin(angle * 6)) < .28;
      const wallTop = r < 16.4 ? (pillar ? 12 : 9) : r < 19.5 ? 7 + Math.floor(seeded(x, z) * 3) : 5;
      for (let y = ARENA.floor; y < wallTop; y++) {
        const rind = y === wallTop - 1 || y === ARENA.floor + 1;
        const lamp = pillar && r < 15.6 && y >= 7 && y <= 9 && Math.abs(Math.sin(angle * 6)) < .13;
        set(x, y, z, lamp ? EMBER : rind ? BRONZE : (x + y + z) % 3 === 0 ? TILE : BASALT);
      }
    }
  }
  const centerX = Math.floor(ARENA.x), northWall = Math.floor(ARENA.z - ARENA.radius);
  for (let offset = -4; offset <= 4; offset++) {
    for (let y = ARENA.floor + 1; y <= ARENA.floor + 6; y++) {
      const rim = Math.abs(offset) === 4 || y === ARENA.floor + 6;
      const vent = Math.abs(offset) <= 2 && offset % 2 === 0 && y >= ARENA.floor + 2 && y <= ARENA.floor + 4;
      set(centerX + offset, y, northWall, rim ? BRONZE : vent ? EMBER : BASALT);
    }
  }
  return voxels;
}

function buildSkyCourt(layout) {
  const voxels = new Uint8Array(layout.width * layout.height * layout.depth);
  const { x: cx, z: cz, floor, radius } = SKY_COURT;
  function set(x, y, z, block) {
    if (contains(layout, x, y, z)) voxels[voxelIndex(layout, x, y, z)] = block;
  }
  for (let x = layout.minX; x < layout.minX + layout.width; x++) for (let z = layout.minZ; z < layout.minZ + layout.depth; z++) {
    const dx = x + .5 - cx, dz = z + .5 - cz;
    const r = Math.hypot(dx, dz), angle = Math.atan2(dz, dx);
    const aisle = Math.abs(dx) <= 1 && dz > 0;
    const star = r < 5.4 && (dx === dz || dx === -dz || r < 2.5);
    const trim = r >= 11.8 && r <= 12.55;
    const tile = star ? SILVER : aisle || trim ? VIOLET : (Math.floor(x / 3) + Math.floor(z / 3)) % 2 ? SLATE : INK;
    for (let y = 0; y < floor - 1; y++) set(x, y, z, INK);
    set(x, floor - 1, z, tile);
    if (r < radius) continue;
    const pillar = Math.abs(Math.sin(angle * 4)) < .19;
    const height = r < 19.5 ? (pillar ? 13 : 9) : r < 22 ? 8 + Math.floor(seeded(x, z) * 4) : 6;
    for (let y = floor; y < height; y++) {
      const cap = y === height - 1 || y === floor + 1;
      set(x, y, z, pillar && r < 18.5 && y >= 9 && y <= 11 ? AURORA : cap ? SILVER : (x + z + y) % 3 ? INK : SLATE);
    }
  }
  for (const [x, y, z] of [[1, 17, 3], [11, 20, -3], [23, 18, -4], [33, 15, 5], [34, 20, 16], [0, 16, 20]]) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) + Math.abs(dz) <= 1) set(x + dx, y, z + dz, SLATE);
    }
    set(x, y - 1, z, VIOLET);
    set(x, y + 1, z, AURORA);
  }
  for (const cover of SKY_COURT_COVERS) {
    const minX = Math.floor(cover.x - cover.radius), maxX = Math.floor(cover.x + cover.radius);
    const minZ = Math.floor(cover.z - cover.radius), maxZ = Math.floor(cover.z + cover.radius);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      if (Math.hypot(x + .5 - cover.x, z + .5 - cover.z) > cover.radius + .16) continue;
      for (let y = floor; y < floor + cover.height; y++) {
        const cap = y === floor + cover.height - 1;
        set(x, y, z, cap ? AURORA : (x + z + y) % 2 ? SLATE : VIOLET);
      }
    }
  }
  return voxels;
}

export function buildBossTerrain(profile, layout) {
  return profile === COLOSSUS ? buildSkyCourt(layout) : buildArena(layout);
}

export function createBossFight(profile = BOSS) {
  const { x, floor, z } = profile.arena;
  return { profile, x, y: floor, z, angle: 0, hp: profile.maxHp, hurt: 0, elapsed: 0, lowered: 0,
    healReady: 0, dragonsReady: 0, dragons: [], dragonHits: 0, pushX: 0, pushZ: 0, stride: 0, gait: 0,
    state: "ready", time: 1.2, phase: 1, phaseGlow: 0, phaseShift: 0, collapse: 0, attacks: 0, attack: null, hits: 0, orbit: -1, travel: null };
}

export function guardianBackOpen(fight, attacker) {
  return fight.profile === BOSS && fight.phase === 1 && fight.state === "windup" && attacker &&
    (attacker.x - fight.x) * Math.sin(fight.angle) + (attacker.z - fight.z) * Math.cos(fight.angle) < 0;
}

export function interruptFurnace(fight) {
  if (fight.profile !== BOSS || fight.phase !== 2 || !fight.hp) return false;
  fight.state = "recovery";
  fight.time = 3.2;
  return true;
}

export function strikeBoss(fight, damage, exposedCore = false, attacker = null) {
  if ((fight.state !== "recovery" && !guardianBackOpen(fight, attacker)) || fight.hp <= 0 || (fight.profile === COLOSSUS && !exposedCore)) return 0;
  const guardian = fight.profile === BOSS;
  const landed = Math.min(fight.hp, guardian ? Math.round(damage * (1 - GUARDIAN_WAVES[fight.phase - 1].armor)) : damage);
  fight.hp -= landed;
  fight.hurt = .20;
  fight.hits++;
  if (!fight.hp && fight.phase < bossBar(fight).count) {
    fight.phase++;
    const next = bossBar(fight);
    Object.assign(fight, { hp: next.maxHp, state: "ready", attack: null, attacks: 0, time: 2, phaseShift: 2, travel: null });
  } else if (!fight.hp) fight.state = "defeated";
  return landed;
}

export function damagePrism(fight, damage) {
  if (fight.state !== "windup" || fight.attack?.kind !== "prism") return null;
  const action = fight.attack;
  action.crystalHp = Math.max(0, action.crystalHp - damage);
  if (action.crystalHp === 0) {
    fight.state = "recovery";
    fight.time = 3.1;
  }
  return action.crystalHp;
}

function chooseColossusAttack(fight, player, phase, fallback) {
  const distance = Math.hypot(player.x - fight.x, player.z - fight.z);
  // Point-blank players must make space; a player who keeps the whole court
  // between them and the giant is chased with a marked meteor. Cover defeats
  // refracted beams, so the giant answers a concealed player with a ground rift.
  // The phase-two nova is deliberately fixed: it teaches its two-jump route
  // before the reactive choices resume.
  if (fallback === "nova") return fallback;
  if (distance < repelRange) return "repel";
  if (distance > longRange) return "meteor";
  if (player.covered && phase >= 2 && fallback === "prism") return "rift";
  return fallback;
}

function windUp(fight, player) {
  const guardian = fight.profile === BOSS ? GUARDIAN_WAVES[fight.phase - 1] : null;
  const phase = fight.phase;
  const patterns = guardian?.attacks ?? fight.profile.bars[phase - 1].patterns;
  const fallback = patterns[fight.attacks % patterns.length];
  const beyondSweep = Math.hypot(player.x - fight.x, player.z - fight.z) > BOSS_ATTACKS.sweep.reach;
  const kind = fight.profile === COLOSSUS ? chooseColossusAttack(fight, player, phase, fallback)
    : phase === 2 && beyondSweep ? "flare" : fallback;
  fight.attacks++;
  const attack = BOSS_ATTACKS[kind];
  fight.angle = Math.atan2(player.x - fight.x, player.z - fight.z);
  const targeted = kind === "flare" || kind === "meteor";
  const width = attack.width && attack.width * (phase >= 2 ? 1.3 : 1);
  // The 0.65s floor is the readability line from the design (§3):
  // frenzy scales may shorten a windup, never below this.
  fight.time = Math.max(.65, attack.windup * (guardian?.windup ?? fight.profile.bars[phase - 1].windupScale));
  fight.attack = { kind, x: targeted ? player.x : fight.x, z: targeted ? player.z : fight.z,
    angle: fight.angle, radius: 1.35, width, windup: fight.time, hit: false };
  if (guardian && kind === "flare") {
    // Mark the current position and lead a running player by half a second.
    const vx = (player.vx || 0) * .55, vz = (player.vz || 0) * .55;
    fight.attack.marks = [{ x: player.x, z: player.z }];
    if (Math.hypot(vx, vz) > 1) fight.attack.marks.push({ x: player.x + vx, z: player.z + vz });
  }
  if (kind === "ram") {
    const dx = Math.sin(fight.angle), dz = Math.cos(fight.angle);
    const ox = fight.x - ARENA.x, oz = fight.z - ARENA.z, along = ox * dx + oz * dz;
    const wall = -along + Math.sqrt(Math.max(0, along * along + (ARENA.radius - 2) ** 2 - ox * ox - oz * oz));
    fight.attack.length = Math.min(attack.reach, wall, Math.hypot(player.x - fight.x, player.z - fight.z) + 3);
    fight.attack.travelled = 0;
  }
  if (kind === "nova") {
    fight.attack.elapsed = 0;
    fight.attack.waves = [0, novaDelay].map(delay => ({ delay, radius: null, previous: novaStart, hit: false }));
  }
  if (kind === "prism") fight.attack.crystalHp = attack.crystalHp;
  fight.state = "windup";
}

// A pillar occupies a cross of five cells. Expand each cell by the giant's
// collision box and clip the whole travel segment, including long frames.
function clearTravel(x, z, endX, endZ, clearance = 0) {
  // Leave a walkable gap even when the giant stops alongside a pillar.
  const half = .5 + COLOSSUS.radius + clearance;
  for (const pillar of SKY_COURT_COVERS) {
    for (const [ox, oz] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let enter = 0, leave = 1;
      for (const [start, delta, center] of [[x, endX - x, pillar.x + ox], [z, endZ - z, pillar.z + oz]]) {
        if (!delta) {
          if (Math.abs(start - center) >= half) { leave = -1; break; }
        } else {
          const a = (center - half - start) / delta, b = (center + half - start) / delta;
          enter = Math.max(enter, Math.min(a, b));
          leave = Math.min(leave, Math.max(a, b));
        }
      }
      if (enter <= leave) return false;
    }
  }
  return true;
}

export function dragonImpact(fight, player) {
  if (fight.profile !== COLOSSUS || !fight.hp) return;
  const dx = fight.x - player.x, dz = fight.z - player.z;
  const distance = Math.hypot(dx, dz) || 1;
  fight.pushX += .65 * dx / distance;
  fight.pushZ += .65 * dz / distance;
  fight.dragonHits++;
  const exposure = fight.state === "recovery" ? fight.time : 0;
  fight.state = "recovery";
  fight.time = Math.max(.95, exposure);
  strikeBoss(fight, 16, true);
}

function reposition(fight, player) {
  const { x, z } = fight.profile.arena;
  const distance = Math.hypot(player.x - fight.x, player.z - fight.z);
  const pursuit = distance > pursuitRange;
  let chosen, best = -Infinity;
  for (let offset = 1; offset <= orbitPoints.length; offset++) {
    const i = (fight.orbit + offset) % orbitPoints.length;
    const [dx, dz] = orbitPoints[i];
    const toX = x + dx, toZ = z + dz;
    if (Math.hypot(fight.x - toX, fight.z - toZ) < .9) continue;
    const escape = Math.hypot(player.x - toX, player.z - toZ);
    const score = Math.min(escape, 5) - offset * .38;
    if (score > best) { chosen = { i, toX, toZ }; best = score; }
  }
  let { i, toX, toZ } = chosen;
  if (pursuit) {
    const fraction = 1 - fightingDistance / distance;
    const nextX = fight.x + (player.x - fight.x) * fraction - x;
    const nextZ = fight.z + (player.z - fight.z) * fraction - z;
    const limit = Math.min(1, (SKY_COURT.radius - 3.7) / Math.hypot(nextX, nextZ));
    toX = x + nextX * limit;
    toZ = z + nextZ * limit;
  }
  const clearance = pursuit ? .70 : 0;
  if (!clearTravel(fight.x, fight.z, toX, toZ, clearance)) {
    // Approach from an open aisle when the direct pursuit crosses a pillar.
    const aisles = orbitPoints.flatMap(([dx, dz]) => [[x + dx, z + dz], [x + 2 * dx, z + 2 * dz]])
      .filter(([ax, az]) => clearTravel(fight.x, fight.z, ax, az, clearance))
      .sort(([ax, az], [bx, bz]) => Math.hypot(ax - player.x, az - player.z) - Math.hypot(bx - player.x, bz - player.z));
    [toX, toZ] = aisles[0] ?? [fight.x, fight.z];
  }
  const speedScale = fight.profile.bars[fight.phase - 1].speedScale;
  const duration = pursuit ? Math.max(1.04, Math.hypot(fight.x - toX, fight.z - toZ) / (7 * speedScale))
    : (fight.phase >= 2 ? .86 : 1.04) / speedScale;
  fight.orbit = i;
  fight.travel = { fromX: fight.x, fromZ: fight.z, toX, toZ, duration, pursuit };
  fight.state = "reposition";
  fight.time = duration;
}

function advanceIntro(fight, player, dt) {
  const dx = player.x - fight.x, dz = player.z - fight.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= fightingDistance) return;
  const fraction = Math.min(4.8 * dt, distance - fightingDistance) / distance;
  if (!clearTravel(fight.x, fight.z, fight.x + dx * fraction, fight.z + dz * fraction)) return;
  fight.x += dx * fraction;
  fight.z += dz * fraction;
}

function moveColossus(fight, player, dt) {
  const { fromX, fromZ, toX, toZ, duration } = fight.travel;
  const t = 1 - Math.max(0, fight.time - dt) / duration;
  const ease = t * t * (3 - 2 * t);
  const dx = fromX + (toX - fromX) * ease - fight.x;
  const dz = fromZ + (toZ - fromZ) * ease - fight.z;
  const distance = Math.hypot(dx, dz);
  const scale = distance > 0 ? Math.min(1, dt * 12 / distance) : 0;
  const x = fight.x + dx * scale, z = fight.z + dz * scale;
  const gap = fight.profile.radius + .33;
  if (Math.abs(player.x - x) >= gap || Math.abs(player.z - z) >= gap) {
    fight.x = x;
    fight.z = z;
  }
  const target = Math.atan2(player.x - fight.x, player.z - fight.z) - fight.angle;
  const turn = Math.atan2(Math.sin(target), Math.cos(target));
  fight.angle += Math.max(-dt * 5, Math.min(dt * 5, turn));
}

function insideColossusMark(action, dx, dz, height) {
  const plan = BOSS_ATTACKS[action.kind];
  if (action.kind === "meteor") return Math.hypot(dx, dz) <= plan.reach && height < 2;
  if (action.kind === "repel") return Math.hypot(dx, dz) <= plan.reach && height < 1.4;
  if (action.kind === "nova") {
    const distance = Math.hypot(dx, dz);
    return height < .54 && action.waves.some(wave => wave.radius !== null && !wave.hit
      && distance >= wave.radius - novaBand && distance <= wave.radius + 2.3);
  }
  const s = Math.sin(action.angle), c = Math.cos(action.angle);
  const along = dx * s + dz * c;
  const side = dx * c - dz * s;
  if (along < 0 || along > plan.reach) return false;
  if (action.kind === "prism") return height < 2.6 && plan.tracks.some(track => Math.abs(side - track) <= plan.width);
  return Math.abs(side) <= action.width && height < 1.65;
}

export function insideColossusHazard(fight, player) {
  if (fight.profile !== COLOSSUS || (fight.state !== "windup" && fight.state !== "attack")) return false;
  const { attack } = fight;
  return insideColossusMark(attack, player.x - attack.x, player.z - attack.z, player.y - fight.y);
}

// "You are standing in it" for either boss (batch 48): the colossus
// keeps its mark geometry; the guardian gets the same shapes its
// damage uses — inside the sweep sector, inside a flare mark, inside
// the ram strip, or within 1.2 of a travelling shock/nova wavefront.
// Windup counts for the shapes that already exist then (sector,
// marks, strip); a shockwave only threatens once it is travelling.
export function insideHazard(fight, player) {
  if (fight.state !== "windup" && fight.state !== "attack") return false;
  if (fight.profile === COLOSSUS) return insideColossusHazard(fight, player);
  if (fight.profile !== BOSS || !fight.attack) return false;
  const action = fight.attack, plan = BOSS_ATTACKS[action.kind];
  const dx = player.x - action.x, dz = player.z - action.z;
  const distance = Math.hypot(dx, dz), height = player.y - fight.y;
  switch (action.kind) {
    case "sweep": {
      const forward = dx * Math.sin(action.angle) + dz * Math.cos(action.angle);
      return distance <= plan.reach && forward >= distance * Math.cos(plan.arc) && height < 1.22;
    }
    case "flare":
      return height < 2 && action.marks.some(mark => Math.hypot(player.x - mark.x, player.z - mark.z) <= plan.reach);
    case "shock":
      return fight.state === "attack" && height < .54 && Math.abs(distance - action.radius) < 1.2;
    case "nova":
      return fight.state === "attack" && height < .54
        && action.waves.some(wave => wave.radius !== null && Math.abs(distance - wave.radius) < 1.2);
    case "ram": {
      const s = Math.sin(action.angle), c = Math.cos(action.angle);
      const along = dx * s + dz * c, side = dx * c - dz * s;
      return height < 1.65 && along >= 0 && along <= (action.length ?? plan.reach) && Math.abs(side) <= action.width;
    }
    default:
      return false;
  }
}

function advanceNova(action, player, height, dt) {
  const plan = BOSS_ATTACKS.nova;
  const distance = Math.hypot(player.x - action.x, player.z - action.z);
  const travel = plan.duration - novaDelay;
  action.elapsed += dt;
  let damage = 0;
  for (const wave of action.waves) {
    const age = action.elapsed - wave.delay;
    if (age < 0 || age > travel + dt) { wave.radius = null; continue; }
    wave.previous = wave.radius ?? novaStart;
    wave.radius = novaStart + (plan.reach - novaStart) * Math.min(1, age / travel);
    if (!wave.hit && height < .54 && distance >= wave.previous - novaBand && distance <= wave.radius + novaBand) {
      wave.hit = true;
      damage += plan.damage;
    }
  }
  return damage;
}

function strikePlayer(fight, player, dt) {
  const action = fight.attack;
  const attack = BOSS_ATTACKS[action.kind];
  const dx = player.x - action.x, dz = player.z - action.z;
  const distance = Math.hypot(dx, dz);
  const height = player.y - fight.y;
  if (action.kind === "ram") {
    if (action.hit) return 0;
    const from = action.travelled;
    let to = Math.min(action.length, from + dt * action.length / attack.duration);
    const s = Math.sin(action.angle), c = Math.cos(action.angle);
    const along = dx * s + dz * c, nearest = Math.min(to, Math.max(from, along));
    if (height <= 2 && Math.hypot(dx - nearest*s, dz - nearest*c) <= attack.width) {
      action.hit = true;
      const side = dx * c - dz * s;
      to = Math.max(from, along - Math.sqrt(Math.max(0, attack.width ** 2 - side ** 2)));
    }
    action.travelled = to;
    fight.x = action.x + s * to;
    fight.z = action.z + c * to;
    return action.hit ? attack.damage : 0;
  }
  if (action.kind === "nova") return advanceNova(action, player, height, dt);
  // A prism is a straight refracted beam: unlike the shockwaves, it terminates
  // on an obelisk. The render loop provides this from the terrain raycast.
  if (action.kind === "prism" && player.covered) return 0;
  const oldRadius = action.radius;
  const shock = action.kind === "shock";
  if (shock) action.radius = Math.min(attack.reach, oldRadius + (attack.reach - 1.35) * dt / attack.duration);
  if (action.hit) return 0;
  const forward = dx * Math.sin(action.angle) + dz * Math.cos(action.angle);
  const inRange = shock ? distance >= oldRadius - .60 && distance <= action.radius + .60 && height < .52
    : fight.profile === COLOSSUS ? insideColossusMark(action, dx, dz, height)
      : action.kind === "flare" ? action.marks.some(mark => Math.hypot(player.x - mark.x, player.z - mark.z) <= attack.reach) && height < 2
      : distance <= attack.reach && forward >= distance * Math.cos(attack.arc) && height < 1.22;
  if (!inRange) return 0;
  action.hit = true;
  return attack.damage;
}

function stepGuardian(fight, player, dt) {
  const dx = player.x - fight.x, dz = player.z - fight.z;
  const distance = Math.hypot(dx, dz);
  if (distance < .001) return;
  const pace = dt * GUARDIAN_WAVES[fight.phase - 1].speed;
  const forward = fight.phase === 2 ? Math.max(-pace * .6, Math.min(pace, distance - 4.6))
    : Math.min(Math.max(0, distance - guardianStandOff), pace);
  const side = fight.attacks && distance < 5 ? dt * 1.7 * (fight.attacks % 2 ? 1 : -1) : 0;
  let x = fight.x + (dx * forward + dz * side) / distance;
  let z = fight.z + (dz * forward - dx * side) / distance;
  const radius = Math.hypot(x - ARENA.x, z - ARENA.z), limit = ARENA.radius - 2;
  if (radius > limit) {
    x = ARENA.x + (x - ARENA.x) * limit / radius;
    z = ARENA.z + (z - ARENA.z) * limit / radius;
  }
  const step = Math.hypot(x - fight.x, z - fight.z);
  fight.stride += step * 3.4;
  fight.gait = Math.min(1, step / Math.max(.001, dt * 1.5));
  fight.x = x;
  fight.z = z;
  fight.angle = Math.atan2(player.x - x, player.z - z);
}

export function advanceBoss(fight, player, dt) {
  const result = { damage: 0, cue: null };
  if (fight.state === "defeated") return result;
  if (fight.state === "recovery" || fight.state === "ready") {
    fight.angle = Math.atan2(player.x - fight.x, player.z - fight.z);
  }
  fight.elapsed += dt;
  if (Math.hypot(fight.pushX, fight.pushZ) > .001) {
    const fraction = 1 - Math.exp(-14 * dt);
    const x = fight.x + fight.pushX * fraction, z = fight.z + fight.pushZ * fraction;
    if (Math.hypot(x - SKY_COURT.x, z - SKY_COURT.z) < SKY_COURT.radius - 3 &&
        clearTravel(fight.x, fight.z, x, z) &&
        (Math.abs(player.x - x) >= fight.profile.radius + .33 || Math.abs(player.z - z) >= fight.profile.radius + .33)) {
      fight.x = x;
      fight.z = z;
      fight.pushX *= 1 - fraction;
      fight.pushZ *= 1 - fraction;
    } else {
      fight.pushX = fight.pushZ = 0;
    }
  }
  fight.hurt = Math.max(0, fight.hurt - dt);
  fight.phaseShift = Math.max(0, (fight.phaseShift ?? 0) - dt);
  let remaining = dt;
  while (remaining > 1e-8) {
    const interval = Math.min(fight.time, remaining);
    if (fight.profile === BOSS) {
      if (fight.state === "ready") stepGuardian(fight, player, interval);
      else fight.gait *= Math.exp(-12 * interval);
    }
    const lowered = fight.state === "recovery" ? 1 : 0;
    fight.lowered += (lowered - fight.lowered) * (1 - Math.exp(-12 * interval));
    if (fight.phase === 2) fight.phaseGlow = Math.min(1, fight.phaseGlow + interval * 1.5);
    if (fight.state === "attack") {
      const secondWave = fight.attack.waves?.[1];
      const echoPending = secondWave?.radius === null && fight.attack.elapsed < secondWave.delay;
      const damage = strikePlayer(fight, player, interval);
      result.damage += damage ? Math.round(damage * bossBar(fight).damageScale) : 0;
      if (damage && fight.attack.kind === "repel") {
        const dx = player.x - fight.x, dz = player.z - fight.z;
        const length = Math.hypot(dx, dz) || 1;
        result.push = { x: dx / length * 8.2, z: dz / length * 8.2 };
      }
      if (echoPending && secondWave.radius !== null) result.cue = "boss-strike";
    }
    if (fight.state === "reposition") moveColossus(fight, player, interval);
    if (fight.state === "ready" && fight.profile === COLOSSUS) advanceIntro(fight, player, interval);
    remaining -= interval;
    fight.time -= interval;
    if (fight.time > 1e-8) break;
    if (fight.state === "windup") {
      fight.state = "attack";
      fight.time = BOSS_ATTACKS[fight.attack.kind].duration;
      result.cue = "boss-strike";
    } else if (fight.state === "attack") {
      fight.state = "recovery";
      fight.time = fight.profile === BOSS ? GUARDIAN_WAVES[fight.phase - 1].recovery : fight.profile.bars[fight.phase - 1].recovery;
      if (fight.attack.kind === "ram") fight.time = fight.attack.hit ? .85 : 3;
      result.cue = "boss-exposed";
    } else if (fight.state === "recovery" && fight.profile === COLOSSUS) {
      reposition(fight, player);
      result.cue = "boss-move";
    } else if (fight.state === "recovery") {
      fight.state = "ready";
      fight.time = GUARDIAN_WAVES[fight.phase - 1].pursuit;
      result.cue = "boss-move";
    } else {
      windUp(fight, player);
      result.cue = "boss-charge";
    }
  }
  return result;
}

export function posedColossus(fight) {
  const open = fight.state === "recovery", won = fight.state === "defeated";
  const travel = fight.state === "reposition" ? 1 - fight.time / fight.travel.duration : 0;
  const approach = fight.state === "ready" ? 1 - fight.time / 1.2 : 0;
  const drive = Math.sin(Math.PI * Math.max(travel, approach));
  const dip = fight.lowered;
  const fall = won ? fight.collapse : 0;
  const winding = fight.state === "windup", releasing = fight.state === "attack";
  const action = fight.attack;
  const move = winding || releasing ? action.kind : null;
  const t = winding ? 1 - fight.time / action.windup : 0;
  const release = releasing ? 1 - fight.time / BOSS_ATTACKS[move].duration : 0;
  const charge = winding ? ease(t) : releasing ? 1 - ease(Math.min(1, release * 4)) : 0;
  const hit = releasing ? Math.sin(Math.PI * release ** .65) : 0;
  const wave = move === "nova" && releasing
    ? Math.max(0, 1 - (action.elapsed - (action.elapsed >= novaDelay ? novaDelay : 0)) / .27) : 0;
  const hover = Math.sin(fight.elapsed * (2 * Math.PI / 3)) * .15 * (1 - dip) * (1 - fall);
  const liftBase = 2.26 - 2.71 * dip + hover + drive * (approach ? -.68 : .46) - fall * 1.15;
  // Charge squash, release rebound and the phase-shift dip (batch
  // 49): the giant mirrors the guardian's beats, dipping first and
  // rising back through a phase change.
  const attackAge = releasing ? release * BOSS_ATTACKS[move].duration : Infinity;
  const rebound = attackAge < .12 ? .04 * (1 - attackAge / .12) : 0;
  const shiftNorm = Math.min(1, (fight.phaseShift ?? 0) / 1.2);
  const phaseDip = shiftNorm > 0 ? -.45 * Math.sin(Math.PI * (1 - shiftNorm)) : 0;
  const lift = Math.max(.42, liftBase - .12 * charge + rebound + phaseDip);
  const cool = [.21, .74, .95], teal = [.26, 1, .83], enraged = [1, .35, .22];
  const energyBoost = Math.min(2.5, (1 + .8 * charge) * (1 + 1.5 * shiftNorm));
  const energy = cool.map((value, i) => (open || won ? teal[i] : value + (enraged[i] - value) * fight.phaseGlow) * (1 - fall * .92) * energyBoost);
  const gesture = [-1, 1].map(side => {
    let raise = .14 * Math.sin(fight.elapsed * 3.1 + side) + drive * .30 + fall * .50;
    let reach = drive * -.48 + fall * .44 - fight.hurt * 1.15;
    let spread = dip * .15 + fall * .39;
    if (move === "meteor" && side === 1) {
      raise += 1.76 * charge - .58 * hit;
      reach += -.12 * charge + 1.1 * hit;
    }
    if (move === "rift") {
      raise += .67 * charge + .26 * hit;
      reach += -.46 * charge + 1.57 * hit;
    }
    if (move === "nova") {
      raise += 1.45 * charge - .52 * wave;
      spread += .72 * charge + .43 * wave;
    }
    if (move === "prism") {
      raise += .58 + .67 * charge;
      spread += .73 + .45 * charge;
      reach += .71 + .56 * hit;
    }
    return { raise, reach, spread };
  });
  // The three orbiting crystals light one by one across the prism
  // windup, one every half second; the third is the beams' cue.
  const prismLit = winding && move === "prism" ? Math.min(3, Math.floor(t * action.windup / .5) + 1) : 0;
  return colossusModel(fight, { lift, exposed: dip, energy, gesture, drive, fall, prismLit,
    stagger: Math.sin(fight.hurt * 21) * fight.hurt * .75, prism: move === "prism" && winding ? .08 + charge * .92 : 0 });
}

export function bossParts(fight, emit) {
  const slate = [.28, .29, .34], iron = [.43, .45, .51], bronze = [.62, .34, .16];
  const flash = fight.state === "windup" ? .76 + Math.sin(fight.elapsed * 21) * .21 : .76;
  const core = fight.state === "defeated" ? [.20, .17, .18]
    : fight.state === "recovery" ? [.34, 1, .89] : [flash, .35 * flash, .08];
  const stride = Math.sin(fight.stride) * fight.gait;
  const wind = fight.state === "windup" ? 1 - fight.time / fight.attack.windup : 0;
  const swing = fight.state === "attack" ? fight.time / BOSS_ATTACKS[fight.attack.kind].duration : 0;
  const sweep = fight.attack?.kind === "sweep";
  const plates = fight.lowered * .26;
  const bob = Math.abs(stride) * .11 - fight.lowered * .20 + Math.sin(fight.elapsed * 3) * .032 - wind * .12;
  const part = (x,y,z,...rest) => emit(x,y+bob,z+fight.lowered*.12,...rest);
  for (const side of [-1,1]) {
    const step = stride * side, lift = Math.max(0, step) * .31;
    emit(side < 0 ? -.78 : .16, lift, -.50 + step * .48, .62, .33, .98, ...slate);
    emit(side < 0 ? -.62 : .19, .28 + lift * .62, -.42 + step * .30, .43, .86, .70, ...iron);
  }
  part(-.67, .94, -.54, 1.34, 1.43, .94, ...slate);
  part(-.90 - plates, 1.38, -.44, .54, .93, .97, ...bronze);
  part(.36 + plates, 1.38, -.44, .54, .93, .97, ...bronze);
  part(-.28, 1.50, .405, .56, .57, .14, ...core);
  if (fight.phase === 1) {
    part(-.54, 1.18, -.61, 1.08, .91, .13, ...slate);
    part(-.23, 1.36, -.69, .46, .54, .09, ...(wind ? [.28, .99, .82] : bronze));
  } else if (fight.phase === 2) {
    for (const side of [-1, 1]) {
      part(side * .67 - .18, 2.05, -.51, .36, .96, .43, ...iron);
      part(side * .67 - .14, 2.97, -.47, .28, .12 + wind * .33, .35, 1, .48, .08);
    }
  } else {
    for (const side of [-1, 1]) {
      part(side * .78 - .31, 1.65, .32, .62, .62, .68, ...iron);
      part(side * .78 - .19, 1.72, .95, .38, .37, .22 + wind * .32, ...bronze);
    }
  }
  part(-.39, 2.31, -.34, .78, .61, .76, ...iron);
  part(-.30, 2.55, .423, .60, .10, .08, ...core);
  part(-.52, 2.78, -.29, .21, .49, .52, ...bronze);
  part(.31, 2.78, -.29, .21, .49, .52, ...bronze);
  for (const side of [-1,1]) {
    const power = sweep && side < 0 ? .2 : 1;
    const raised = power * (wind * .94 - swing * .38);
    const reach = -stride * side * .38 + power * (wind * .18 + swing * .75);
    const across = sweep && side > 0 ? .52 * wind - swing * .62 : 0;
    part((side < 0 ? -1.12 : .72) + across * .4, 1.04 + raised * .55, -.42 + reach * .46, .40, 1.08, .76, ...slate);
    part((side < 0 ? -1.22 : .72) + across, .86 + raised, -.19 + reach, .50, .48, .77, ...iron);
  }
}

// Colossus armor and pulse weapon geometry.
const TAU = 2 * Math.PI;
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const add = (a, b) => a.map((v, i) => v + b[i]);
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, n) => a.map(v => v * n);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = ([x, y, z], [a, b, c]) => [y * c - z * b, z * a - x * c, x * b - y * a];
const unit = v => scale(v, 1 / Math.hypot(...v));
const ease = x => x * x * (3 - 2 * x);

function axes(yaw = 0, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  return identity.map(([x, y, z]) => {
    const right = cr * x - sr * y, up = sr * x + cr * y;
    const forward = sp * up + cp * z;
    return [cy * right + sy * forward, cp * up - sp * z, -sy * right + cy * forward];
  });
}

function orient(v, [x, y, z]) {
  return add(add(scale(x, v[0]), scale(y, v[1])), scale(z, v[2]));
}

// Convex cross sections share the same polygon at each height. The same
// outward planes are used for shading and for clipping a shot against the mesh.
function form(sides, profile, angle = Math.PI / sides) {
  const vertices = profile.flatMap(([y, radius]) => Array.from({ length: sides }, (_, i) => {
    const turn = angle + i * TAU / sides;
    return [Math.cos(turn) * radius, y, Math.sin(turn) * radius];
  }));
  const faces = [];
  function face(indices) {
    let [a, b, c] = indices.map(i => vertices[i]);
    let normal = unit(cross(subtract(b, a), subtract(c, a)));
    if (dot(normal, a) < 0) {
      indices.reverse();
      normal = scale(normal, -1);
      a = vertices[indices[0]];
    }
    faces.push({ indices, normal, offset: dot(normal, a) });
  }
  for (let ring = 0; ring < profile.length - 1; ring++) for (let j = 0; j < sides; j++) {
    const a = ring * sides + j, b = ring * sides + (j + 1) % sides;
    face([a, b, b + sides, a + sides]);
  }
  const top = (profile.length - 1) * sides;
  for (let i = 1; i < sides - 1; i++) {
    face([0, i, i + 1]);
    face([top, top + i, top + i + 1]);
  }
  return { vertices, faces };
}

const hull = form(6, [[-.5, .44], [-.28, .78], [.24, 1], [.5, .64]]);
const plate = form(6, [[-.5, .72], [-.33, 1], [.33, 1], [.5, .72]]);
const cuff = form(8, [[-.5, .84], [.5, .84]]);
const cylinder = form(10, [[-.5, 1], [.5, 1]]);
// Profiles run from breech to muzzle. The tapered shoulders catch light as
// the weapon recoils, even when viewed almost straight down its length.
const weaponShells = Object.fromEntries(Object.entries(weaponAssets).map(([style, asset]) => {
  const parts = asset.groups.map(({color, faces}) => {
    const indices = [...new Set(faces.flatMap(face => face.indices))];
    const remap = new Map(indices.map((index, i) => [index, i]));
    const mesh = { vertices: indices.map(index => asset.vertices[index]), faces: faces.map(face => ({
      normal: face.normal, cornerNormals: face.cornerNormals, indices: face.indices.map(index => remap.get(index))
    })) };
    const size = style === "cannon" ? 1.35 : 1;
    return piece(mesh, [0,.045,-.21], [size,size,size], color);
  });
  return [style, parts];
}));
const crystal = form(5, [[-.5, .035], [-.17, 1], [.17, 1], [.5, .035]], 0);

function piece(mesh, center, dimensions, color, basis = identity, target = 0, glow = false) {
  return { mesh, center, dimensions, color, basis, target, glow };
}

function link(mesh, from, to, width, depth, color, glow = false) {
  const delta = subtract(to, from);
  const y = unit(delta);
  const x = unit(cross(y, Math.abs(y[2]) > .9 ? [1, 0, 0] : [0, 0, 1]));
  return piece(mesh, scale(add(from, to), .5), [width, Math.hypot(...delta), depth], color, [x, y, cross(x, y)], 0, glow);
}

function transformParts(parts, center, basis) {
  return parts.map(part => ({ ...part, center: add(center, orient(part.center, basis)),
    basis: part.basis.map(vector => orient(vector, basis)) }));
}

export function modelFaces(parts, emit) {
  for (const { mesh, center, dimensions, color, basis, target, glow } of parts) {
    const [u, v, w] = basis;
    const [width, height, depth] = dimensions;
    const [px, py, pz] = center;
    const points = mesh.vertices.map(([x, y, z]) => {
      const a = x * width, b = y * height, c = z * depth;
      return [px + u[0] * a + v[0] * b + w[0] * c, py + u[1] * a + v[1] * b + w[1] * c, pz + u[2] * a + v[2] * b + w[2] * c];
    });
    for (const { indices, normal, cornerNormals } of mesh.faces) {
      const facing = unit(orient(normal.map((v, i) => v / dimensions[i]), basis));
      const light = glow ? 1 : .60 + .44 * Math.max(0, dot(facing, [-.38, .79, .48]));
      emit(indices.map(i => points[i]), facing, cornerNormals ? color : scale(color, light), target, glow,
        cornerNormals?.map(n => orient(n, basis)));
    }
  }
}

export function modelHit(parts, origin, direction, reach) {
  let hit = null;
  for (const { mesh, center, dimensions, basis, target } of parts) {
    if (target < 0) continue;
    const local = subtract(origin, center);
    const from = basis.map((axis, i) => dot(local, axis) / dimensions[i]);
    const ray = basis.map((axis, i) => dot(direction, axis) / dimensions[i]);
    let near = 0, far = hit?.distance ?? reach;
    for (const { normal, offset } of mesh.faces) {
      const allowance = offset - dot(from, normal), projected = dot(ray, normal);
      if (Math.abs(projected) < 1e-8) {
        if (allowance < 0) { near = Infinity; break; }
      } else if (projected > 0) {
        far = Math.min(far, allowance / projected);
      } else {
        near = Math.max(near, allowance / projected);
      }
      if (near > far) break;
    }
    if (near <= far && near < (hit?.distance ?? reach)) hit = { distance: near, weak: target === 1, crystal: target === 2 };
  }
  return hit;
}

// The furnace guardian keeps the compact collision silhouette used by the
// encounter rules, but renders as a segmented forge machine.  Rounded plates,
// joint links, and a moving core give its moves a readable body line instead
// of making every beat depend on a box changing colour.
export function posedGuardian(fight) {
  const winding = fight.state === "windup", striking = fight.state === "attack";
  const action = fight.attack;
  const wind = winding && action ? 1 - fight.time / action.windup : 0;
  const release = striking && action ? 1 - fight.time / BOSS_ATTACKS[action.kind].duration : 0;
  // Store torque early. The last part of the warning is the actual downswing,
  // so the hammer reaches the floor when the expanding damage band starts.
  const drawBack = winding ? ease(Math.min(1, wind / .74)) : 0;
  const downswing = winding ? ease(Math.max(0, (wind - .74) / .26)) : 0;
  const drive = drawBack * (1 - downswing);
  const follow = striking ? 1 - ease(release) : downswing;
  const stride = Math.sin(fight.stride) * fight.gait;
  const phaseShift = Math.min(1, (fight.phaseShift ?? 0) / 1.2);
  const vulnerable = fight.state === "recovery";
  const dead = fight.state === "defeated";
  const dark = [.12, .15, .18], steel = [.28, .32, .38], iron = [.43, .47, .53];
  const copper = [.61, .27, .11], hot = fight.phase === 1 ? [1, .19, .025]
    : fight.phase === 2 ? [1, .36, .035] : [1, .59, .09];
  // Charge and phase theatre (batch 49): the core brightens toward
  // 1.8x across a windup and bursts toward 2.5x as a phase opens.
  const coreBoost = dead ? 1 : Math.min(2.5, (1 + .8 * ease(wind)) * (1 + 1.5 * phaseShift));
  const core = (dead ? [.15, .09, .06] : vulnerable ? [.22, 1, .82]
    : hot.map(channel => channel + (1 - channel) * phaseShift * .42)).map(channel => channel * coreBoost);
  const lean = (action?.kind === "ram" ? (drive + follow) * .44 : follow * .28 - drive * .09) - fight.hurt * .16;
  const torso = [0, 1.87 + Math.abs(stride) * .08 - (vulnerable ? .20 : 0) + phaseShift * .14, -.03 + lean];
  const parts = [
    piece(hull, [-.48 - phaseShift * .15, .52 + Math.max(0, stride) * .13, -.02], [.48, 1.06, .47], steel, axes(0, stride * -.22)),
    piece(hull, [.48 + phaseShift * .15, .52 + Math.max(0, -stride) * .13, -.02], [.48, 1.06, .47], steel, axes(0, stride * .22)),
    piece(plate, [-.48, .15 + Math.max(0, stride) * .22, .12 + stride * .34], [.61, .30, .76], dark, axes(0, stride * .2)),
    piece(plate, [.48, .15 + Math.max(0, -stride) * .22, .12 - stride * .34], [.61, .30, .76], dark, axes(0, -stride * .2)),
    piece(hull, [0, 1.04, -.02], [1.12, .72, .72], dark, axes(0, lean * -.16)),
    piece(hull, torso, [1.55, 1.72, 1.03], steel, axes(0, lean * -.27)),
    piece(plate, [0, 2.05 - (vulnerable ? .18 : 0), .55 + lean * .25], [1.22, .88, .20], copper, axes(0, -.20 - lean * .11)),
    piece(crystal, [0, 1.95 - (vulnerable ? .20 : 0), .73 + lean * .27], [.46, .71, .22], core, axes(fight.elapsed * (1.3 + drive * 2)), 0, true),
    piece(cylinder, [0, 2.83, -.02 + lean * .34], [.38, .48, .38], copper, axes(0, lean * -.15)),
    piece(hull, [0, 3.22, .02 + lean * .43], [.92, .76, .71], dark, axes(0, lean * -.22)),
    piece(plate, [0, 3.21, .43 + lean * .47], [.63, .24, .10], core, axes(0, -.08), 0, true)
  ];
  let hammerBase;
  for (const side of [-1, 1]) {
    // Split shutters slide into the collar as pressure drops. The back vent
    // uses the same cyan cue as the front counterattack window.
    const aperture = fight.lowered;
    const shutterY = 1.95 - aperture * .17;
    parts.push(piece(plate, [side * (.22 + .39 * aperture), shutterY, .87],
      [.23, .74, .09], dark, axes(side * aperture * .55, 0, side * .12)));
    if (fight.phase === 1) {
      const vent = winding ? [.24, 1, .82] : copper;
      parts.push(piece(plate, [side * .23, 1.88, -.94],
        [.18, .65, .09], vent, axes(0, 0, side * .18), 0, winding));
    }
    const sweep = action?.kind === "sweep" ? side * (drive - follow) : 0;
    const raised = drive * (action?.kind === "shock" ? .72 : action?.kind === "ram" ? -.16 : .25) + phaseShift * .46;
    const shoulder = [side * 1.03, 2.38 + raised * .24, .05 + lean * .45];
    const elbow = [side * (1.49 + Math.abs(sweep) * .26), 1.57 + raised * .72, .26 + drive * .28 + lean * .56];
    const wrist = [side * (1.68 - sweep * .22), .83 + raised * .98, .48 + drive * .67 + lean * .68];
    wrist[2] += side * stride * .36;
    if (action?.kind === "flare") {
      // Open the elbows to frame the launch, then draw both hands inward.
      elbow[0] += side * drive * .32;
      wrist[0] += side * (.46 * drive - .54 * follow);
      wrist[1] += 1.5 * drive + .72 * follow;
      wrist[2] += .47 * follow;
    } else if (action?.kind === "ram") {
      const brace = drive + follow;
      elbow[2] -= .32 * brace;
      wrist[0] -= side * .58 * brace;
      wrist[2] += .91 * brace;
      wrist[1] += .38 * brace;
    } else if (action?.kind === "nova") {
      // The second arm stays cocked while the first wave is travelling.
      const delay = side < 0 ? 0 : novaDelay;
      const age = (winding ? -fight.time : striking ? action.elapsed : 10) - delay;
      const lift = winding ? ease(wind) : striking ? 1 : 0;
      const plunge = ease(Math.max(0, Math.min(1, (age + .16) / .16)));
      const settle = Math.max(0, 1 - Math.max(0, age) / .46);
      const stroke = 1.65 * lift * (1 - plunge) - .54 * plunge * settle;
      elbow[1] += stroke * .55;
      wrist[1] += stroke;
      wrist[2] += plunge * settle * .64;
    }
    if (side < 0) {
      hammerBase = wrist;
      if (action?.kind === "shock") {
        wrist[1] += .97 * drive - .25 * follow;
        wrist[2] += .75 * follow - .92 * drive;
      } else if (action?.kind === "sweep") {
        wrist[0] += 1.32 * follow - .32 * drive;
        wrist[2] += .9 * follow;
      }
    }
    parts.push(
      piece(plate, [side * 1.08, 2.42 + raised * .22, .04 + lean * .42], [.64, .70, .72], iron, axes(0, .08, -side * .42)),
      link(cylinder, shoulder, elbow, .27, .27, dark),
      piece(cylinder, elbow, [.37, .33, .37], copper, axes(0, .82, side * .17)),
      link(plate, elbow, wrist, .39, .36, steel),
      piece(hull, wrist, [.54, .60, .51], iron, axes(side * .15, drive * .18, -side * .20)),
      piece(plate, [wrist[0], wrist[1] - .14, wrist[2] + .28], [.34, .17, .22], core, axes(0, .26), 0, true)
    );
  }
  // Each wave alters the silhouette as well as the particle palette.
  if (fight.phase === 1) {
    const hammerLift = action?.kind === "shock" ? drive : drive * .18;
    const tilt = .82 + hammerLift * 1.35 - follow * 1.17;
    const hammerHead = add(hammerBase, [-.23, Math.sin(tilt), Math.cos(tilt)]);
    parts.push(
      piece(plate, [0, 3.63, -.02], [.68, .18, .54], copper, axes(0, .05)),
      link(cylinder, hammerBase, hammerHead, .15, .14, dark),
      piece(hull, hammerHead, [.73, .46, .54], steel, axes(.36, hammerLift * .28, -.23)),
      piece(plate, add(hammerHead, [-.10, .03, .27]), [.55, .18, .13], hot, axes(.36, 0), 0, true)
    );
  } else if (fight.phase === 2) {
    for (const side of [-1, 1]) {
      const ventKick = action?.kind === "flare" ? drive : wind * .24;
      parts.push(
        piece(hull, [side * .68, 3.42, -.04], [.22, .86 + wind * .25, .25], copper, axes(side * .18, .16, -side * .22)),
        piece(crystal, [side * .81, 3.75 + wind * .14, .04], [.10, .33, .12], hot, axes(fight.elapsed * 2 + side), -1, true),
        piece(cylinder, [side * 1.16, 2.82, -.13 + ventKick * .12], [.26, .84, .26], dark, axes(side * .12, -.25 + ventKick * .22, 0)),
        piece(plate, [side * 1.20, 3.22 + ventKick * .20, .10 + ventKick * .28], [.18, .19, .16], hot, axes(side * .12, 0), 0, true)
      );
    }
  } else {
    for (const side of [-1, 1]) {
      const hornDrive = action?.kind === "ram" ? drive + follow : wind * .32;
      parts.push(
        link(plate, [side * .72, 2.74, .06], [side * (1.02 + hornDrive * .35), 2.73, .72 + hornDrive * .56], .32, .25, copper, true),
        piece(hull, [side * 1.38, 2.08, .19 + hornDrive * .55], [.49, .50, .72], dark, axes(side * .28, hornDrive * .42, 0)),
        piece(plate, [side * 1.47, 2.10, .58 + hornDrive * .82], [.34, .30, .22], hot, axes(side * .28, hornDrive * .42, 0), 0, true)
      );
    }
  }
  // The whole machine squashes as it charges (0.12 by windup end),
  // rebounds 0.04 into the strike, rides 0.5 up through a phase
  // shift, and shudders for 0.3s after a missed charge (a miss sets
  // the recovery clock to 3, a hit to .85 — advanceBoss owns both).
  const attackAge = striking && action ? release * BOSS_ATTACKS[action.kind].duration : Infinity;
  const rebound = attackAge < .12 ? .04 * (1 - attackAge / .12) : 0;
  const phaseRise = phaseShift > 0 ? .5 * Math.sin(Math.PI * (1 - phaseShift)) : 0;
  let shakeX = 0;
  if (fight.state === "recovery" && action?.kind === "ram" && !action.hit) {
    const age = 3 - fight.time;
    if (age >= 0 && age < .3) shakeX = Math.sin(fight.elapsed * 95) * .05 * (1 - age / .3);
  }
  return transformParts(parts, [fight.x + shakeX, fight.y - .12 * ease(wind) + rebound + phaseRise, fight.z], axes(fight.angle, 0, 0));
}

// Six dormant forge pylons turn the surrounding wall into a machine room.
// They are visual scenery only: no collision or arena rule depends on them.
export function forgeStageParts(fight) {
  if (fight.profile !== BOSS) return [];
  const { x: cx, z: cz, floor, radius } = fight.profile.arena;
  const dark = [.075, .09, .11], steel = [.20, .24, .29], copper = [.46, .11, .026];
  const hot = fight.phase === 1 ? [1, .18, .02] : fight.phase === 2 ? [1, .38, .035] : [1, .62, .08];
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const angle = i * TAU / 6 + Math.PI / 6;
    const basis = axes(angle + Math.PI);
    const center = [cx + Math.sin(angle) * (radius - 1.0), floor, cz + Math.cos(angle) * (radius - 1.0)];
    const point = local => add(center, orient(local, basis));
    const flicker = .82 + .18 * Math.sin(fight.elapsed * 5.2 + i * 2.7);
    parts.push(
      piece(hull, point([0, 1.34, 0]), [1.15, 2.68, .96], dark, basis),
      piece(plate, point([0, 1.64, .48]), [.72, 1.35, .16], steel, basis),
      piece(plate, point([0, 1.64, .60]), [.30, .71, .08], hot.map(v => v * flicker), basis, -1, true),
      piece(cylinder, point([0, 3.02, -.03]), [.40, .62, .40], copper, basis),
      piece(crystal, point([0, 3.64, .04]), [.21, .62, .21], hot, axes(fight.elapsed * 1.7 + i), -1, true)
    );
  }
  return parts;
}

function colossusModel(fight, pose) {
  const { lift, exposed, energy, gesture, drive, fall } = pose;
  const metal = [.22, .29, .38], shadow = [.095, .135, .20], ceramic = [.60, .68, .72], brass = [.63, .43, .26];
  const parts = [
    piece(hull, [0, 1.30, -.14], [1.89, 2.47, 1.08], metal),
    piece(plate, [0, .39, -.18], [1.10, .64, .91], shadow),
    piece(hull, [0, -.02, -.31], [.74, .88, .65], brass),
    piece(crystal, [0, -.40, -.35], [.29, .60, .27], energy, identity, -1, true),
    piece(plate, [0, 2.78, .04], [.58, .44, .56], brass, axes(0, .14)),
    piece(hull, [0, 3.26, .01], [1.13, 1.14, .73], shadow, axes(0, .21)),
    piece(plate, [0, 3.47, .35], [.99, .48, .56], ceramic, axes(0, -.20)),
    piece(plate, [0, 3.27, .64], [.66, .17, .19], energy, identity, 0, true),
    piece(crystal, [0, 1.39, 1.08], [.70, 1.23, .48], energy, axes(fight.elapsed * .72), 1, true)
  ];
  for (const side of [-1, 1]) {
    const { reach, raise, spread } = gesture[side < 0 ? 0 : 1];
    const shoulder = [side * 1.51, 2.26, -.13];
    const elbow = [side * (2.33 + spread * .45), 1.41 + raise * .48, .10 + reach * .35];
    const wrist = [side * (2.77 + spread), .65 + raise, .52 + reach];
    parts.push(
      piece(plate, [side * (1.18 + exposed * .45), 1.48, .69 + exposed * .02], [.51, 1.74, .42],
        ceramic, axes(side * (.28 + exposed * .62), 0, -side * .30)),
      piece(plate, [side * (.27 + exposed * .94), 1.45 + exposed * .15, 1.55 - exposed * .26],
        [.36, 1.19, .17], shadow, axes(side * exposed * .69, 0, -side * .09)),
      piece(plate, [side * .46, 3.83, -.04], [.19, .82, .25], brass, axes(0, -.34, -side * .48)),
      link(cylinder, shoulder, elbow, .41, .40, shadow),
      piece(plate, shoulder, [.79, .94, .76], ceramic, axes(0, reach * .22, -side * (.54 + spread * .13))),
      link(cuff, elbow, wrist, .58, .57, metal),
      piece(cylinder, elbow, [.39, .37, .39], brass, axes(0, .85, side * .10)),
      piece(hull, wrist, [.61, .73, .60], shadow, axes(side * .23, reach * .33, -side * raise * .22)),
      piece(plate, add(wrist, [0, 0, .48]), [.31, .42, .16], energy, identity, 0, true)
    );
  }
  for (let i = 0; i < 3; i++) {
    const angle = i * TAU / 3 + fight.elapsed * .7;
    const lit = i < (pose.prismLit ?? 0);
    const cx = Math.cos(angle) * 1.49, cy = 3.31 + Math.sin(angle) * 1.28;
    parts.push(piece(crystal, [cx, cy, -.94],
      [.15, .58, .16], lit ? [1, .68, .22] : brass, axes(0, 0, angle - Math.PI / 2), -1, lit));
    // A lit crystal stands on a slim pillar of light reaching the
    // court floor (local ground sits at -lift).
    if (lit) parts.push(piece(cylinder, [cx, (cy - lift) / 2, -.94], [.15, cy + lift, .15],
      [.55, .36, .10], identity, -1, true));
  }
  if (pose.prism) {
    parts.push(piece(crystal, [0, 1.91 + pose.prism * .4, 2.08], [.69, 1.16, .67],
      [1, .68, .22], axes(fight.elapsed * 2.4, .18), 2, true));
  }
  return transformParts(parts, [fight.x + pose.stagger, fight.y + lift, fight.z], axes(fight.angle, drive * -.19 + fall * .41, fall * -.52));
}

export function pulseViewModel({ charge, recharge, recoiling, bob, ammo, charged, style = "pulse" }) {
  const dark = [.085, .14, .18], shell = [.29, .43, .47], ceramic = [.65, .72, .70], copper = [.65, .41, .23], glove = [.18, .21, .21];
  const glow = charged || style === "cannon" ? [1, .67, .31] : style === "rapid" ? [.68, .47, 1] : [.25, .92, .87];
  const release = recharge ? Math.sin(Math.PI * recharge) : 0;
  const extracting = ease(Math.min(1, release * 1.28));
  const travel = recoiling * .063;
  const barrelLength = style === "cannon" ? .647 : style === "rapid" ? .641 : .58;
  const muzzle = [-.012, .067, -barrelLength - charge * .04 + (style === "pulse" ? travel : 0)];
  const parts = style === "pulse" ? [
    link(hull, [0, .044, .16], [0, .044, -.27 + travel], .106, .104, dark),
    link(plate, [0, .045, .11], [0, .045, -.22 + travel], .103, .105, shell),
    link(plate, [0, .138, .13], [0, .111, -.28 + travel], .073, .032, ceramic),
    link(cylinder, [0, .064, -.13], muzzle, .049, .049, dark),
    link(cylinder, [0, .066, -.16 + travel], [0, .066, -.36 + travel], .065, .061, copper),
    link(cylinder, [0, .065, muzzle[2] + .087], muzzle, .066, .061, shell),
    link(cylinder, [muzzle[0], muzzle[1], muzzle[2] + .012], [muzzle[0], muzzle[1], muzzle[2] + .003], .043, .043,
      charge > 0 ? glow : dark, charge > 0)
  ] : [...weaponShells[style]];
  parts.push(
    link(plate, [0, -.005, .086], [.024, -.234, .156], .060, .064, dark),
    link(cuff, [.046, -.145, .144], [.071, -.42, .318], .092, .093, glove),
    piece(plate, [.048, -.118, .145], [.086, .129, .077], glove, axes(-.24, .40)),
    piece(plate, [.010, -.10, .107], [.051, .096, .094], glove, axes(.4, .32)),
    piece(plate, [0, -.059 - extracting * .185, -.14 + extracting * .053], [.096, .096, .158], copper)
  );
  if (style === "pulse") for (const side of [-1, 1]) {
    const x = side * (.062 + charge * .037);
    parts.push(link(plate, [x, .077, -.205 + travel], [x, .075, muzzle[2] + .045], .021, .029, ceramic));
    parts.push(link(cuff, [x, .087, -.23 + travel], [x, .087, muzzle[2] + .062], .011, .012, glow, true));
  }
  for (let i = 0; i < 6; i++) {
    const z = -.217 + i * .026 + extracting * .05;
    parts.push(piece(plate, [-.086, -.023 - extracting * .185, z], [.016, .026, .011], i < ammo ? glow : shadowCell, identity, 0, i < ammo));
  }
  const support = [-.077 - extracting * .034, -.115 - extracting * .156, -.29 + extracting * .13];
  parts.push(link(cuff, [-.143, -.43, .09], support, .081, .082, glove));
  parts.push(piece(plate, support, [.080, .105, .105], glove, axes(.32, .42)));
  for (let i = 0; i < 3; i++) {
    parts.push(piece(cuff, add(support, [.006, .044, -.052 + i * .052]), [.059, .07, .021], glove, axes(0, 0, .9)));
  }
  const anchor = [.50 + bob[0] - charge * .070, -.33 + bob[1] - release * .067, -1.01 + recoiling * .09];
  const aim = axes(.30 + release * .25, -.19 - recoiling * .12, -.15 - release * .45);
  return { parts: transformParts(parts, anchor, aim), muzzle: add(anchor, orient(muzzle, aim)) };
}

// Melee view model: a low-poly sword or axe held in the same view space as
// the guns, so melee is a 3D object instead of a flat 2D drawing. `swing`
// is the seconds left of the .27s swing (0 = at rest); the swing is split
// into anticipation -> strike -> recover and reads through the aim basis.
export function meleeViewModel({ style = "sword", swing = 0, bob = [0, 0] }) {
  const phase = swing > 0 ? 1 - swing / .27 : 1;
  const windup = phase < .25 ? phase / .25 : 0;
  const strike = phase < .25 ? 0 : phase < .6 ? (phase - .25) / .35 : 1;
  const recover = phase < .6 ? 0 : (phase - .6) / .4;
  const sweep = strike * (1 - recover);
  const steel = [.62, .68, .65], edge = [.86, .91, .88], dark = [.085, .14, .18];
  const wood = [.48, .29, .12], leather = [.38, .27, .18];
  const parts = style === "sword" ? [
    piece(plate, [0, -.30, -.10], [.10, .16, .10], leather),
    piece(plate, [0, -.22, -.10], [.20, .04, .12], dark),
    piece(plate, [0, .02, -.10], [.09, .42, .03], steel),
    piece(plate, [0, .26, -.10], [.07, .10, .03], edge)
  ] : [
    piece(plate, [0, -.28, -.10], [.08, .34, .08], wood),
    piece(plate, [0, .02, -.10], [.30, .22, .04], steel),
    piece(plate, [0, .02, -.10], [.10, .22, .05], edge)
  ];
  const anchor = [.42 + bob[0] - sweep * .30, -.34 + bob[1] - windup * .06 + sweep * .10, -1.01];
  const aim = axes(.22 + windup * .18 - sweep * .30, -.16 + sweep * .22, -.35 + windup * .5 - sweep * .85);
  return { parts: transformParts(parts, anchor, aim) };
}

const shadowCell = [.14, .22, .23];
