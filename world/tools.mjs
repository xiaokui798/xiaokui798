// Tool mining-interval registry: seconds per block for each tier.
// Stone 0.28 is the pre-existing fixed tick (game.js held it as a
// literal); ember 0.20 and star 0.14 are from 打造-设计.md §④. The
// tick is per block, not per block kind — stone and leaves mine at the
// same speed, only the equipped tool changes it. game.js reads the
// interval for the hold-to-mine repeat and for the crosshair ring, so
// the ring and the break stay in sync.
//
// A new module instead of reusing a registry: the interval is a tool
// stat, not a weapon stat (weapons.mjs), an armor stat (armor.mjs) or
// a recipe cost (recipes.mjs). One registry per system, each with
// validate/assert and a load-time self-check, is the established
// pattern (enemies / waves / difficulty / weapons / armor).
export const TOOL_MINING_INTERVAL = Object.freeze({ stone: 0.28, ember: 0.20, star: 0.14 });

// Seconds to mine one block with a tool of this tier. Unknown tiers —
// and no tool — mine at the stone rate.
export function miningInterval(tier) {
  return TOOL_MINING_INTERVAL[tier] ?? 0.28;
}

// Validate an interval table (defaults to this module's own): all
// three tiers must be present, each a positive number. Returns
// { valid, errors } so callers can report every problem at once instead
// of failing on the first one.
export function validateTools(interval = TOOL_MINING_INTERVAL) {
  const errors = [];
  if (!interval || typeof interval !== "object") return { valid: false, errors: ["工具表不是对象"] };
  const keys = Object.keys(interval);
  if (keys.length === 0) return { valid: false, errors: ["工具表为空"] };
  for (const tier of ["stone", "ember", "star"]) {
    if (!Object.hasOwn(interval, tier)) errors.push(`缺少“${tier}”品阶的挖掘耗时`);
  }
  for (const [tier, seconds] of Object.entries(interval)) {
    if (!["stone", "ember", "star"].includes(tier)) {
      errors.push(`工具“${tier}”：品阶必须是 stone、ember 或 star`);
      continue;
    }
    if (typeof seconds !== "number" || !(seconds > 0)) {
      errors.push(`工具“${tier}”：挖掘耗时必须是正数（现在是 ${seconds}）`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidTools(interval = TOOL_MINING_INTERVAL) {
  const { valid, errors } = validateTools(interval);
  if (!valid) throw new Error(`工具表校验失败：${errors.join("；")}`);
  return true;
}
assertValidTools();
