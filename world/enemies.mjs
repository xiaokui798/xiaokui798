// Single registry for every enemy kind. defense.mjs re-exports ENEMIES so
// existing imports (game.js included) keep working unchanged; new enemy
// kinds are added here, not in defense.mjs.
import { BLOCK } from "./recipes.mjs";
import { FARM_MATERIALS } from "./crops.mjs";

// Rare crafting materials, by id: they are not blocks (no BLOCK id, no
// terrain), they only live in the campaign's rare-material counts. Boss
// drops reference them by id; progression.mjs owns the counts.
export const RARE_MATERIALS = Object.freeze({ emberCore: "熔火核心", starShard: "断星碎片" });

export const ENEMIES = Object.freeze({
  breaker: { name: "破城者", hp: 155, speed: 1.13, reach: 1.44, damage: 14, strikeDelay: .70, cooldown: 1.55,
    width: 1.20, height: 1.13, armor: true, coat: [.28, .27, .26], skin: [.55, .55, .50], eyes: [.89, .40, .14],
    drops: [[BLOCK.STONE, 2], [BLOCK.LEAF, 1]] },
  // Ranged thrower: keeps its distance and lobs projectiles instead of
  // closing in. Since the batch-88 deletion it is the base kind of
  // every wave roster (the survival fill and the defense tables' core).
  // Melee kinds carry no `attack` field and stay melee by default;
  // ranged kinds carry `attack: "ranged"`, a `range`, and a
  // `projectileSpeed`.
  spitter: { name: "投掷者", hp: 55, speed: 1.25, reach: 1.0, damage: 13, strikeDelay: .55, cooldown: 2.1,
    width: .85, height: .95, armor: false, attack: "ranged", range: 7.5, projectileSpeed: 6,
    coat: [.32, .42, .22], skin: [.62, .58, .34], eyes: [.45, .85, .30],
    drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 2], ["wheatSeed", 1]] },
  // Dasher: fast and fragile, built to punish positioning — the
  // fastest kind in the registry on a thin health pool.
  dasher: { name: "疾行者", hp: 35, speed: 2.74, reach: 1.1, damage: 6, strikeDelay: .15, cooldown: .9,
    width: .82, height: .82, armor: false, coat: [.30, .48, .22], skin: [.55, .62, .38], eyes: [.95, .85, .25],
    drops: [[BLOCK.LEAF, 2], ["wheatSeed", 1]] },
  // Juggernaut: the tank — the slowest kind in the registry, by far
  // the thickest health pool outside the bosses, and the hardest
  // melee hit of any regular kind. Its ember core
  // is a chance bonus in progression.grantLoot, not a table drop, so
  // the table below stays deterministic.
  juggernaut: { name: "重甲者", hp: 180, speed: .91, reach: 1.5, damage: 15, strikeDelay: .8, cooldown: 2.5,
    width: 1.45, height: 1.3, armor: true, coat: [.38, .20, .14], skin: [.52, .42, .36], eyes: [1, .45, .15],
    drops: [[BLOCK.STONE, 3]] },
  // Exploder: closes to blastTrigger of its goal, lights a 1s fuse
  // (flashing core + windup sound), then bursts for blastDamage to
  // the player / blastBeaconDamage to the beacon inside blastRadius.
  // Killing it before the fuse ends pays its drops and no blast.
  exploder: { name: "爆裂者", hp: 30, speed: 1.82, reach: 1.1, damage: 4, strikeDelay: .3, cooldown: 1.2,
    width: .9, height: .95, armor: false, fuseSeconds: 1, blastTrigger: 2.0, blastRadius: 2.5,
    blastDamage: 18, blastBeaconDamage: 10,
    coat: [.55, .30, .12], skin: [.66, .50, .30], eyes: [1, .75, .2],
    drops: [["emberCore", 1]] },
  // Splitter (batch 94): a mid-line brawler whose death is the threat —
  // it splits into two splitlings on ANY death, so killing it first
  // hands you two fast small problems. Its wave cost is the parent
  // plus the pair (80 + 2x15); the splitlings count toward the wave
  // (parent -1, split +2, net +1) and never split again — the
  // registry refuses a split target that itself splits, so the chain
  // is one generation deep by construction.
  splitter: { name: "分裂者", hp: 80, speed: 1.5, reach: 1.15, damage: 9, strikeDelay: .45, cooldown: 1.2,
    width: 1.0, height: 1.0, armor: false, splitKind: "splitling", splitCount: 2,
    coat: [.16, .50, .28], skin: [.55, .30, .45], eyes: [.95, .90, .40],
    drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 1]] },
  // Splitling: the splitter's offspring — fast, fragile, no drops,
  // no further split. An affiliated kind: it never appears in a wave
  // roster, only as a split product.
  splitling: { name: "小分裂体", hp: 15, speed: 2.4, reach: .9, damage: 4, strikeDelay: .2, cooldown: .8,
    width: .55, height: .5, armor: false,
    coat: [.16, .50, .28], skin: [.55, .30, .45], eyes: [.95, .90, .40],
    drops: [] },
  // Summoner (batch 94): a backline caster that never closes in — it
  // holds 8-10 units off the player, retreats when pressed, and calls
  // a whelp every summonInterval seconds, at most summonCap alive at
  // once. Validation requires a positive damage on every kind, so it
  // carries a token melee it can only use when cornered with no
  // retreat left; its real weapon is the summons. Whelps do NOT count
  // toward a wave's remaining count and dissolve when the wave's
  // counting zombies are gone — otherwise a hidden summoner could
  // hold a wave open forever.
  summoner: { name: "召唤者", hp: 90, speed: 1.0, reach: 1.1, damage: 4, strikeDelay: .5, cooldown: 1.2,
    width: .9, height: 1.05, armor: false, summonKind: "whelp", summonInterval: 6, summonCap: 4,
    coat: [.34, .18, .44], skin: [.62, .50, .34], eyes: [.85, .60, 1],
    drops: [[BLOCK.LEAF, 2]] },
  // Whelp: the summoner's minion — small, quick, weak, no drops, and
  // flagged not to count toward the wave. Affiliated kind: only ever
  // spawned by a summoner, never by a roster.
  whelp: { name: "幼体", hp: 15, speed: 2.2, reach: .9, damage: 3, strikeDelay: .25, cooldown: .9,
    width: .55, height: .55, armor: false,
    coat: [.40, .30, .48], skin: [.64, .52, .35], eyes: [.85, .60, 1],
    drops: [] },
  // Lurker (batch 94): spawns burrowed and travels underground at
  // burrowSpeed, visible only as a moving soil mound — untargetable
  // and harmless while under. Within surfaceTrigger of its goal it
  // stops and surfaces over surfaceWarning seconds (mound shaking,
  // body rising, burrow sound), then fights as a fast melee kind at
  // its full speed and never burrows again. The fairness trade is
  // written into the numbers: the trail is always visible, the
  // warning is a real 0.8s, and it cannot be interrupted underground.
  lurker: { name: "潜伏者", hp: 45, speed: 2.6, reach: 1.1, damage: 11, strikeDelay: .5, cooldown: 1.0,
    width: .8, height: .85, armor: false, burrowSpeed: 2.0, surfaceTrigger: 2.5, surfaceWarning: .8,
    coat: [.45, .36, .22], skin: [.58, .48, .33], eyes: [1, .5, .2],
    drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 1]] }
});

// Validate an enemy registry (defaults to this module's own): every kind
// needs positive hp, speed, damage and cooldown; attack is either absent
// (melee by default) or "melee" / "ranged"; a ranged kind needs a
// positive range and projectileSpeed; every kind needs a drop table whose
// entries are [material, count] pairs — the material is a registered
// block (never AIR), a registered rare material or a registered farm
// material (a seed, so the spitter can drop wheatSeed), the count a
// positive whole number. Returns { valid, errors } so callers can report every
// problem at once instead of failing on the first one — the same shape
// as validateRecipes.
export function validateEnemies(enemies = ENEMIES) {
  const errors = [];
  if (!enemies || typeof enemies !== "object") return { valid: false, errors: ["敌人配置不是对象"] };
  const kinds = Object.keys(enemies);
  if (kinds.length === 0) errors.push("敌人配置为空");
  for (const [kind, profile] of Object.entries(enemies)) {
    const label = `敌人“${kind}”`;
    if (!profile || typeof profile !== "object") { errors.push(`${label}不是对象`); continue; }
    for (const field of ["hp", "speed", "damage", "cooldown"]) {
      if (typeof profile[field] !== "number" || !Number.isFinite(profile[field]) || profile[field] <= 0) {
        errors.push(`${label}：${field} 不是正数`);
      }
    }
    if (profile.attack !== undefined && profile.attack !== "melee" && profile.attack !== "ranged") {
      errors.push(`${label}：attack 必须是 melee 或 ranged（现在是 ${profile.attack}）`);
    }
    // A kind carrying any blast field must carry them all, positive.
    const blastFields = ["fuseSeconds", "blastTrigger", "blastRadius", "blastDamage", "blastBeaconDamage"];
    if (blastFields.some(field => profile[field] !== undefined)) {
      for (const field of blastFields) {
        if (typeof profile[field] !== "number" || !Number.isFinite(profile[field]) || profile[field] <= 0) {
          errors.push(`${label}：${field} 不是正数`);
        }
      }
    }
    // A kind carrying any summon field must carry them all: the
    // offspring kind must be registered, the interval positive, the
    // cap a positive whole number.
    const summonFields = ["summonKind", "summonInterval", "summonCap"];
    if (summonFields.some(field => profile[field] !== undefined)) {
      if (typeof profile.summonKind !== "string" || !Object.hasOwn(enemies, profile.summonKind)) {
        errors.push(`${label}：summonKind 不是已注册的敌人`);
      }
      if (typeof profile.summonInterval !== "number" || !Number.isFinite(profile.summonInterval) || profile.summonInterval <= 0) {
        errors.push(`${label}：summonInterval 不是正数`);
      }
      if (!Number.isInteger(profile.summonCap) || profile.summonCap <= 0) {
        errors.push(`${label}：summonCap 不是正整数`);
      }
    }
    // Split fields likewise — and the split target must not itself
    // split, so a split chain is exactly one generation deep.
    const splitFields = ["splitKind", "splitCount"];
    if (splitFields.some(field => profile[field] !== undefined)) {
      if (typeof profile.splitKind !== "string" || !Object.hasOwn(enemies, profile.splitKind)) {
        errors.push(`${label}：splitKind 不是已注册的敌人`);
      } else if (enemies[profile.splitKind].splitKind !== undefined) {
        errors.push(`${label}：分裂目标不能再分裂（防无限分裂）`);
      }
      if (!Number.isInteger(profile.splitCount) || profile.splitCount <= 0) {
        errors.push(`${label}：splitCount 不是正整数`);
      }
    }
    // Burrow fields likewise, all positive.
    const burrowFields = ["burrowSpeed", "surfaceTrigger", "surfaceWarning"];
    if (burrowFields.some(field => profile[field] !== undefined)) {
      for (const field of burrowFields) {
        if (typeof profile[field] !== "number" || !Number.isFinite(profile[field]) || profile[field] <= 0) {
          errors.push(`${label}：${field} 不是正数`);
        }
      }
    }
    if (profile.attack === "ranged") {
      for (const field of ["range", "projectileSpeed"]) {
        if (typeof profile[field] !== "number" || !Number.isFinite(profile[field]) || profile[field] <= 0) {
          errors.push(`${label}：${field} 不是正数`);
        }
      }
    }
    if (profile.drops === undefined) errors.push(`${label}：没有掉落表`);
    else if (!Array.isArray(profile.drops)) errors.push(`${label}：掉落表不是数组`);
    else for (const [index, entry] of profile.drops.entries()) {
      const dropLabel = `${label}：掉落[${index}]`;
      if (!Array.isArray(entry) || entry.length !== 2) { errors.push(`${dropLabel}不是 [材料, 数量]`); continue; }
      const [id, amount] = entry;
      const knownBlock = typeof id === "number" && Number.isInteger(id) && id !== BLOCK.AIR && id >= BLOCK.AIR && id <= BLOCK.LEAF;
      if (!knownBlock && !(typeof id === "string"
        && (Object.hasOwn(RARE_MATERIALS, id) || Object.hasOwn(FARM_MATERIALS, id)))) {
        errors.push(`${dropLabel}：材料“${id}”未注册`);
      }
      if (!Number.isInteger(amount) || amount <= 0) errors.push(`${dropLabel}：数量不是正整数`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// The recipe table's assertValidRecipes, for enemies: a bad shipped
// registry fails the import instead of spawning a kind with no health or
// a thrower with nowhere to throw from. Exported so tests can check the
// failure without a bad table.
export function assertValidEnemies(enemies = ENEMIES) {
  const { valid, errors } = validateEnemies(enemies);
  if (!valid) throw new Error(`敌人配置校验失败：${errors.join("；")}`);
  return true;
}
assertValidEnemies();
