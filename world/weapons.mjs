// Weapon registry: every weapon the game can swing, from the stone
// sword and axe (values verbatim from the old game.js constants) to the
// boss-only guns. game.js reads damage, reach and cooldown from here —
// no weapon number lives in game.js anymore. Ember and star weapons are
// derived entries: they name their stone-tier base and their tier, and
// the validator pins damage to round(base damage x tier multiplier), so
// the multiplier is the single source of truth for the numbers.
// Follows the enemies.mjs / waves.mjs pattern: validateWeapons /
// assertValidWeapons, checked once at import.
export const TIER_MULTIPLIERS = Object.freeze({ stone: 1, ember: 1.5, star: 2 });

// What each tier needs before its recipes unlock. Stone needs nothing;
// ember needs one guardian kill, star needs one colossus kill (progress
// save `bossKills`). Thresholds are from 打造-设计.md §④; a new tier
// only adds one entry here.
export const TIER_UNLOCK = Object.freeze({
  ember: Object.freeze({ bossKills: Object.freeze({ boss: 1 }) }),
  star: Object.freeze({ bossKills: Object.freeze({ colossus: 1 }) })
});

// Boss display names for the lock copy ("需击败熔炉守卫 1 次" — the
// wording is from 打造-UI设计.md §⑦, so the strings live here next to
// the thresholds they describe).
const TIER_BOSS_NAME = Object.freeze({ ember: "熔炉守卫", star: "断星巨像" });

export const WEAPONS = Object.freeze({
  stoneSword: Object.freeze({ name: "石剑", style: "sword", damage: 27, reach: 2.75, cooldown: .38, tier: "stone" }),
  stoneAxe: Object.freeze({ name: "石斧", style: "axe", damage: 44, reach: 2.3, cooldown: .74, tier: "stone" }),
  emberSword: Object.freeze({ name: "熔火剑", style: "sword", damage: 41, reach: 2.75, cooldown: .38, tier: "ember", base: "stoneSword" }),
  emberAxe: Object.freeze({ name: "熔火斧", style: "axe", damage: 66, reach: 2.3, cooldown: .74, tier: "ember", base: "stoneAxe" }),
  starSword: Object.freeze({ name: "断星剑", style: "sword", damage: 54, reach: 2.75, cooldown: .38, tier: "star", base: "stoneSword" }),
  starAxe: Object.freeze({ name: "断星斧", style: "axe", damage: 88, reach: 2.3, cooldown: .74, tier: "star", base: "stoneAxe" }),
  punch: Object.freeze({ name: "拳头", style: "punch", damage: 14, reach: 2.05, cooldown: .46 }),
  // Boss-only guns: not craftable, not in the equipment slot. Their
  // numbers are verbatim from the old game.js constants.
  pulseWeapon: Object.freeze({ name: "星脉枪", style: "pulse", damage: 24, reach: 18, cooldown: .31, capacity: 6, recharge: 1.2, bossOnly: true }),
  pulseBurst: Object.freeze({ name: "星脉爆发", style: "pulse", damage: 62, reach: 24, cooldown: .59, cost: 2, windup: .58, bossOnly: true }),
  rapid: Object.freeze({ name: "蜂鸣速射枪", style: "rapid", damage: 14, reach: 15, cooldown: .13, bossOnly: true }),
  cannon: Object.freeze({ name: "裂晶重炮", style: "cannon", damage: 52, reach: 24, cooldown: .78, cost: 2, bossOnly: true })
});

// The stone-tier weapon a tiered weapon derives from ("熔火剑" -> "石剑").
// A weapon without a base is its own base.
export function weaponBase(key) {
  return WEAPONS[key]?.base ?? key;
}

// A tier's unlock state against a progress record ({ bossKills }):
// stone (or no tier) is always open, ember needs a guardian kill, star
// needs a colossus kill. Missing progress counts as no kills.
export function tierUnlocked(tier, progress) {
  if (!tier || tier === "stone") return true;
  const unlock = TIER_UNLOCK[tier];
  if (!unlock) return false;
  return Object.entries(unlock.bossKills ?? {}).every(([boss, needed]) => (progress?.bossKills?.[boss] ?? 0) >= needed);
}

export function weaponUnlocked(key, progress) {
  return tierUnlocked(WEAPONS[key]?.tier, progress);
}

// The lock line the workbench tab shows for a weapon whose tier is not
// unlocked yet, or null when it is open. The copy is from
// 打造-UI设计.md §⑦.
export function weaponLockReason(key, progress) {
  const tier = WEAPONS[key]?.tier;
  if (!tier || tierUnlocked(tier, progress)) return null;
  const needed = Object.values(TIER_UNLOCK[tier].bossKills)[0];
  return `需击败${TIER_BOSS_NAME[tier]} ${needed} 次`;
}

// Validate a weapon table (defaults to this module's own): every entry
// needs a name, a known style and positive damage/reach/cooldown; a
// tiered entry must name a registered base and its damage must be the
// base damage times the tier multiplier, rounded, with the base's
// reach/cooldown carried over. Returns { valid, errors } so callers can
// report every problem at once instead of failing on the first one.
export function validateWeapons(weapons = WEAPONS) {
  const errors = [];
  if (!weapons || typeof weapons !== "object") return { valid: false, errors: ["武器表不是对象"] };
  const keys = Object.keys(weapons);
  if (keys.length === 0) return { valid: false, errors: ["武器表为空"] };
  for (const [key, weapon] of Object.entries(weapons)) {
    const label = `武器“${key}”`;
    if (!weapon || typeof weapon !== "object") {
      errors.push(`${label}不是对象`);
      continue;
    }
    if (typeof weapon.name !== "string" || !weapon.name) errors.push(`${label}：名字必须是非空字符串`);
    if (!["sword", "axe", "punch", "pulse", "rapid", "cannon"].includes(weapon.style)) {
      errors.push(`${label}：style 必须是 sword、axe、punch、pulse、rapid 或 cannon（现在是 ${weapon.style}）`);
    }
    for (const field of ["damage", "reach", "cooldown"]) {
      if (typeof weapon[field] !== "number" || !(weapon[field] > 0)) errors.push(`${label}：${field} 不是正数`);
    }
    for (const field of ["capacity", "recharge", "cost", "windup"]) {
      if (weapon[field] !== undefined && (typeof weapon[field] !== "number" || !(weapon[field] > 0))) {
        errors.push(`${label}：${field} 不是正数`);
      }
    }
    if (weapon.tier !== undefined && !Object.hasOwn(TIER_MULTIPLIERS, weapon.tier)) {
      errors.push(`${label}：品阶必须是 stone、ember 或 star（现在是 ${weapon.tier}）`);
    }
    if (weapon.base !== undefined) {
      const base = weapons[weapon.base];
      if (!base) {
        errors.push(`${label}：基础武器“${weapon.base}”未注册`);
      } else {
        if (!weapon.tier || !Object.hasOwn(TIER_MULTIPLIERS, weapon.tier)) {
          errors.push(`${label}：品阶武器必须有品阶`);
        } else {
          const expected = Math.round(base.damage * TIER_MULTIPLIERS[weapon.tier]);
          if (weapon.damage !== expected) errors.push(`${label}：伤害应为 ${expected}（基础 ${base.damage} × ${TIER_MULTIPLIERS[weapon.tier]}）`);
        }
        if (weapon.reach !== base.reach) errors.push(`${label}：射程应与基础武器一致（${base.reach}）`);
        if (weapon.cooldown !== base.cooldown) errors.push(`${label}：冷却应与基础武器一致（${base.cooldown}）`);
      }
    } else if (weapon.tier === "ember" || weapon.tier === "star") {
      errors.push(`${label}：品阶武器必须有基础武器`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidWeapons(weapons = WEAPONS) {
  const { valid, errors } = validateWeapons(weapons);
  if (!valid) throw new Error(`武器表校验失败：${errors.join("；")}`);
  return true;
}
assertValidWeapons();
