// Durability registry: how much use a tier of gear takes, and what it
// costs to repair at the workbench. Design 打造-设计.md §④ (R8):
// stone 100 / ember 200 / star 300; a weapon loses 1 per hit, armor 1
// per hit taken, a tool 1 per block mined; at 0 the piece is
// ineffective (it never disappears). Repair restores it to full:
// stone 5 stone; ember 5 stone + 1 ember core; star 5 stone + 1 star
// shard.
//
// One table instead of three per-registry tables: the maxima and the
// repair costs are per tier, identical across all three slots — they
// are a property of the tier, not of any one item. Splitting them into
// weapons.mjs / armor.mjs / tools.mjs would triplicate the same three
// numbers (and the repair costs would have to live in one of them
// arbitrarily), and the copies could drift. One table is the single
// source for "what a tier's gear can take and what it costs to fix",
// the same way one registry serves each system elsewhere.
import { BLOCK } from "./recipes.mjs";

export const DURABILITY_MAX = Object.freeze({ stone: 100, ember: 200, star: 300 });

// Repair cost per tier, as [material, amount] pairs (same shape as a
// recipe cost: a numeric id is a block material, a string id a rare
// material from RARE_MATERIALS).
export const REPAIR_COSTS = Object.freeze({
  stone: Object.freeze([[BLOCK.STONE, 5]]),
  ember: Object.freeze([[BLOCK.STONE, 5], ["emberCore", 1]]),
  star: Object.freeze([[BLOCK.STONE, 5], ["starShard", 1]])
});

// The most use a tier's gear takes. Unknown tiers fall back to the
// stone maximum, the same way an unknown tier mines at stone speed.
export function durabilityMax(tier) {
  return DURABILITY_MAX[tier] ?? 100;
}

// What repairing one piece of this tier costs. Unknown tiers repair
// like stone.
export function repairCost(tier) {
  return REPAIR_COSTS[tier] ?? REPAIR_COSTS.stone;
}

// Validate a durability table and its repair costs (defaults to this
// module's own): all three tiers must be present, each maximum a
// positive integer, each repair cost a list of [material, positive
// amount] pairs. A rare-material registry may be passed (progression
// passes RARE_MATERIALS); with none, string ids are only checked for
// being non-empty, the same rule validateRecipes uses. Returns
// { valid, errors } so callers can report every problem at once.
export function validateDurability(table = DURABILITY_MAX, costs = REPAIR_COSTS, rareMaterials = null) {
  const errors = [];
  if (!table || typeof table !== "object") return { valid: false, errors: ["耐久表不是对象"] };
  const keys = Object.keys(table);
  if (keys.length === 0) return { valid: false, errors: ["耐久表为空"] };
  for (const tier of ["stone", "ember", "star"]) {
    if (!Object.hasOwn(table, tier)) errors.push(`缺少“${tier}”品阶的耐久上限`);
  }
  for (const [tier, max] of Object.entries(table)) {
    if (!["stone", "ember", "star"].includes(tier)) {
      errors.push(`耐久“${tier}”：品阶必须是 stone、ember 或 star`);
      continue;
    }
    if (!Number.isInteger(max) || max <= 0) {
      errors.push(`耐久“${tier}”：上限必须是正整数（现在是 ${max}）`);
    }
  }
  if (!costs || typeof costs !== "object") return { valid: false, errors: [...errors, "修理表不是对象"] };
  const validBlocks = Object.values(BLOCK).filter(id => id !== BLOCK.AIR);
  for (const [tier, cost] of Object.entries(costs)) {
    const label = `修理“${tier}”`;
    if (!["stone", "ember", "star"].includes(tier)) {
      errors.push(`${label}：品阶必须是 stone、ember 或 star`);
      continue;
    }
    if (!Array.isArray(cost)) {
      errors.push(`${label}：cost 不是数组`);
      continue;
    }
    cost.forEach((entry, index) => {
      const entryLabel = `${label}：cost[${index}]`;
      if (!Array.isArray(entry) || entry.length !== 2) {
        errors.push(`${entryLabel} 不是 [材料, 数量]`);
        return;
      }
      const [id, amount] = entry;
      if (typeof id === "number") {
        if (!validBlocks.includes(id)) errors.push(`${entryLabel}：材料“${id}”未注册`);
      } else if (typeof id === "string") {
        if (!id || (rareMaterials && !Object.hasOwn(rareMaterials, id))) errors.push(`${entryLabel}：材料“${id}”未注册`);
      } else {
        errors.push(`${entryLabel} 不是 [材料, 数量]`);
      }
      if (!Number.isInteger(amount) || amount <= 0) errors.push(`${entryLabel} 数量不是正整数`);
    });
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidDurability(table = DURABILITY_MAX, costs = REPAIR_COSTS, rareMaterials = null) {
  const { valid, errors } = validateDurability(table, costs, rareMaterials);
  if (!valid) throw new Error(`耐久表校验失败：${errors.join("；")}`);
  return true;
}
assertValidDurability();
