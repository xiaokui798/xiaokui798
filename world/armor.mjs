// Armor reduction registry: the fraction of incoming damage each tier
// negates. Ember 25% and star 40% are from 打造-设计.md §④; stone has
// no design number — 10% is this round's proposal, R9 re-tunes it with
// the bot. game.js takeDamage reads the equipped piece's tier from
// here, and the equipment tab's armor card shows the same number, so
// display and combat never drift apart.
//
// A new module instead of reusing a registry: the rate is a combat
// number, not a crafting cost (recipes.mjs), a weapon stat
// (weapons.mjs) or save state (progression.mjs). One registry per
// system, each with validate/assert and a load-time self-check, is the
// established pattern (enemies / waves / difficulty / weapons).
export const ARMOR_REDUCTION = Object.freeze({ stone: 0.10, ember: 0.25, star: 0.40 });

// The reduction a tier grants, as a fraction (0.25 = 25%). Unknown
// tiers — and no armor — reduce nothing.
export function armorReduction(tier) {
  return ARMOR_REDUCTION[tier] ?? 0;
}

// Incoming damage after armor: amount * (1 - rate), rounded down, at
// least 1. A 22-damage breaker hit is 19 in stone armor, 16 in ember,
// 13 in star; a 1-damage hit still deals 1.
export function reducedDamage(amount, tier) {
  return Math.max(1, Math.floor(amount * (1 - armorReduction(tier))));
}

// Validate a reduction table (defaults to this module's own): all three
// tiers must be present, each rate a number in [0, 1). Returns
// { valid, errors } so callers can report every problem at once instead
// of failing on the first one.
export function validateArmor(reduction = ARMOR_REDUCTION) {
  const errors = [];
  if (!reduction || typeof reduction !== "object") return { valid: false, errors: ["防具表不是对象"] };
  const keys = Object.keys(reduction);
  if (keys.length === 0) return { valid: false, errors: ["防具表为空"] };
  for (const tier of ["stone", "ember", "star"]) {
    if (!Object.hasOwn(reduction, tier)) errors.push(`缺少“${tier}”品阶的减伤率`);
  }
  for (const [tier, rate] of Object.entries(reduction)) {
    if (!["stone", "ember", "star"].includes(tier)) {
      errors.push(`防具“${tier}”：品阶必须是 stone、ember 或 star`);
      continue;
    }
    if (typeof rate !== "number" || !(rate >= 0) || !(rate < 1)) {
      errors.push(`防具“${tier}”：减伤率必须在 0 到 1 之间（现在是 ${rate}）`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidArmor(reduction = ARMOR_REDUCTION) {
  const { valid, errors } = validateArmor(reduction);
  if (!valid) throw new Error(`防具表校验失败：${errors.join("；")}`);
  return true;
}
assertValidArmor();
