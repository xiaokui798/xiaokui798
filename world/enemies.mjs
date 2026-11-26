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
  walker: { name: "游荡者", hp: 70, speed: 1.52, reach: 1.18, damage: 10, strikeDelay: .32, cooldown: 1.28,
    width: 1, height: 1, armor: false, coat: [.24, .31, .36], skin: [.54, .57, .40], eyes: [.96, .59, .21],
    drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 1]] },
  runner: { name: "突袭者", hp: 43, speed: 2.52, reach: 1.14, damage: 6, strikeDelay: .18, cooldown: .94,
    width: .8, height: .86, armor: false, coat: [.36, .26, .27], skin: [.58, .46, .40], eyes: [.91, .34, .20],
    drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 1], [BLOCK.WOOD, 1]] },
  breaker: { name: "破城者", hp: 155, speed: 1.13, reach: 1.44, damage: 14, strikeDelay: .70, cooldown: 1.55,
    width: 1.20, height: 1.13, armor: true, coat: [.28, .27, .26], skin: [.55, .55, .50], eyes: [.89, .40, .14],
    drops: [[BLOCK.STONE, 2], [BLOCK.LEAF, 1]] },
  // Ranged thrower: keeps its distance and lobs projectiles instead of
  // closing in. Registry-only for now — no wave roster lists it, and
  // game.js has no ranged attack or spawn path for it yet (see the
  // wiring notes in the S8 report). Melee kinds carry no `attack` field
  // and stay melee by default; ranged kinds carry `attack: "ranged"`,
  // a `range`, and a `projectileSpeed`.
  spitter: { name: "投掷者", hp: 55, speed: 1.25, reach: 1.0, damage: 13, strikeDelay: .55, cooldown: 2.1,
    width: .85, height: .95, armor: false, attack: "ranged", range: 7.5, projectileSpeed: 6,
    coat: [.32, .42, .22], skin: [.62, .58, .34], eyes: [.45, .85, .30],
    drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 2], ["wheatSeed", 1]] }
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
