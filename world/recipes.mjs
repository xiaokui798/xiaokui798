// Single registry for block ids and crafting recipes. RECIPES references
// BLOCK, so the ids live here with it: that keeps this registry
// self-contained with no import cycle back to progression.mjs, and lets
// the recipes stay verbatim. progression.mjs re-exports both, so existing
// `import { BLOCK, RECIPES } from "./progression.mjs"` code (game.js
// included) keeps working unchanged. A future blocks.mjs registry would
// take BLOCK from here.
export const BLOCK = Object.freeze({ AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAF: 5 });

export const RECIPES = Object.freeze({
  axe: { name: "石斧", cost: [[BLOCK.STONE, 3], [BLOCK.WOOD, 2]] },
  dressing: { name: "树叶敷料", cost: [[BLOCK.LEAF, 2]], healing: 30 },
  bandage: { name: "树皮绷带", cost: [[BLOCK.WOOD, 2], [BLOCK.LEAF, 1]], healing: 20 },
  bigDressing: { name: "树叶大敷料", cost: [[BLOCK.LEAF, 4]], healing: 50 },
  // Compost (R3, farming): leaves + dirt, mixed by hand like a
  // dressing — no workbench, no equipment slot. Its key is a farm
  // material id, so crafting one credits the campaign's seed counts
  // (see progression.mjs craft()); it is spent on crops, one per plant.
  fertilizer: { name: "腐叶", cost: [[BLOCK.LEAF, 2], [BLOCK.DIRT, 1]] },
  // The watering can (R6, farming): a one-time tool grant like the
  // axe — crafting it sets a save flag (progression.mjs craft()), it
  // occupies no slot and is never consumed; using it is the KeyJ
  // watering action on an aimed crop. Wood and leaf, mixed by hand
  // like the compost — no workbench, no tech gate (farming has none).
  wateringCan: { name: "洒水壶", cost: [[BLOCK.WOOD, 3], [BLOCK.LEAF, 2]] },
  // The workbench is the gate to all equipment: it is built without one
  // (it is the first build), and every equipment recipe below needs it.
  workbench: { name: "工作台", cost: [[BLOCK.STONE, 5], [BLOCK.WOOD, 5]] },
  // Stone-tier equipment. `equipment` names the slot the piece fills and
  // `tier` its rank; the effect of each slot lands in its own round
  // (armor reduction in R5, tool speed in R6), but the piece is craftable
  // and wearable from here.
  stoneArmor: { name: "石甲", cost: [[BLOCK.STONE, 6], [BLOCK.WOOD, 2]], equipment: "armor", tier: "stone" },
  stonePickaxe: { name: "石镐", cost: [[BLOCK.STONE, 3], [BLOCK.WOOD, 2]], equipment: "tool", tier: "stone" },
  // Ember- and star-tier weapons. Cost ids are block ids or rare
  // material ids ("emberCore" / "starShard" from the boss drops); the
  // tier gate itself lives in progression.mjs (boss kills), not here —
  // the recipe table only names the slot and tier.
  emberSword: { name: "熔火剑", cost: [[BLOCK.STONE, 8], [BLOCK.WOOD, 4], ["emberCore", 2]], equipment: "weapon", tier: "ember" },
  emberAxe: { name: "熔火斧", cost: [[BLOCK.STONE, 8], [BLOCK.WOOD, 4], ["emberCore", 2]], equipment: "weapon", tier: "ember" },
  starSword: { name: "断星剑", cost: [[BLOCK.STONE, 10], [BLOCK.WOOD, 4], ["starShard", 2], ["emberCore", 1]], equipment: "weapon", tier: "star" },
  starAxe: { name: "断星斧", cost: [[BLOCK.STONE, 10], [BLOCK.WOOD, 4], ["starShard", 2], ["emberCore", 1]], equipment: "weapon", tier: "star" },
  // Ember- and star-tier armor, mirroring the weapon costs (stone armor
  // is stone 6 + wood 2; each tier adds its boss material).
  emberArmor: { name: "熔火甲", cost: [[BLOCK.STONE, 8], [BLOCK.WOOD, 2], ["emberCore", 2]], equipment: "armor", tier: "ember" },
  starArmor: { name: "断星甲", cost: [[BLOCK.STONE, 10], [BLOCK.WOOD, 2], ["starShard", 2], ["emberCore", 1]], equipment: "armor", tier: "star" },
  // Ember- and star-tier pickaxes, mirroring the armor costs.
  emberPickaxe: { name: "熔火镐", cost: [[BLOCK.STONE, 8], [BLOCK.WOOD, 2], ["emberCore", 2]], equipment: "tool", tier: "ember" },
  starPickaxe: { name: "断星镐", cost: [[BLOCK.STONE, 10], [BLOCK.WOOD, 2], ["starShard", 2], ["emberCore", 1]], equipment: "tool", tier: "star" },
  // Cooking (R4): dishes are healing recipes, so they ride the existing
  // HEALING_KEYS road — per-recipe counts, the backpack rows and the HUD
  // consumables line all pick them up with no second food system. The
  // `cooking` flag is what separates them from dressings: crafting is
  // gated on the workbench (progression.mjs canCraft, the same gate the
  // equipment recipes use) and the backpack row offers eating, not
  // crafting. Costs spend the farm material "wheat" (a string id, routed
  // by progression.mjs to the farm counts) alongside block materials.
  // Values are pinned by the R4 dispatch: no hunger, no buffs (the
  // salad's speed buff is R5, not here).
  bakedWheat: { name: "烤麦饼", cost: [["wheat", 2]], healing: 40, cooking: true },
  veggieSalad: { name: "果蔬沙拉", cost: [[BLOCK.LEAF, 2], ["wheat", 1]], healing: 25, cooking: true,
    buff: { kind: "speed", pct: 10, seconds: 30 } },
  stew: { name: "炖菜", cost: [["wheat", 2], [BLOCK.WOOD, 1]], healing: 60, cooking: true,
    buff: { kind: "attack", pct: 10, seconds: 30 } }
});

// Validate a recipe table (defaults to this module's own): every cost
// entry must reference a registered block id or a registered string
// material id, and carry a positive integer count; every recipe with
// healing must have a cost, and no two recipes may share a name. An
// equipment recipe names one of the three slots and a non-empty tier,
// and must have a cost like any other craftable. A cooking recipe must
// heal and have a cost (a dish that heals nothing is a dressing-table
// bug, not a dish). A buff, when present, names one of the two buff
// kinds (speed / attack) with a positive percent and duration. A string cost id is checked against the passed
// string-material registries when any are given — rare materials and
// farm materials are separate registries, so callers pass both (the
// startup check in progression.mjs passes RARE_MATERIALS and
// FARM_MATERIALS); without a registry only non-emptiness is checked.
// Returns { valid, errors } so callers can report every problem at
// once instead of failing on the first one.
export function validateRecipes(recipes = RECIPES, ...registries) {
  const stringMaterials = registries.length
    ? Object.assign({}, ...registries.filter(registry => registry && typeof registry === "object"))
    : null;
  const errors = [];
  if (!recipes || typeof recipes !== "object") return { valid: false, errors: ["配方表不是对象"] };
  const names = new Map();
  for (const [key, recipe] of Object.entries(recipes)) {
    if (!recipe || typeof recipe !== "object") {
      errors.push(`${key}：配方不是对象`);
      continue;
    }
    const cost = recipe.cost ?? [];
    if (!Array.isArray(cost)) {
      errors.push(`${key}：cost 不是数组`);
      continue;
    }
    cost.forEach((entry, index) => {
      if (!Array.isArray(entry) || entry.length !== 2) {
        errors.push(`${key}：cost[${index}] 不是 [材料, 数量]`);
        return;
      }
      const [id, amount] = entry;
      if (typeof id === "number") {
        if (!Object.values(BLOCK).includes(id)) errors.push(`${key}：cost 引用未注册方块 ${id}`);
      } else if (typeof id === "string") {
        if (!id || (stringMaterials && !Object.hasOwn(stringMaterials, id))) errors.push(`${key}：cost 引用未注册材料 ${id}`);
      } else {
        errors.push(`${key}：cost[${index}] 不是 [材料, 数量]`);
      }
      if (!Number.isInteger(amount) || amount <= 0) errors.push(`${key}：cost[${index}] 数量不是正整数`);
    });
    if (recipe.healing > 0 && cost.length === 0) errors.push(`${key}：回血配方没有 cost`);
    if (recipe.cooking !== undefined) {
      if (recipe.cooking !== true) errors.push(`${key}：cooking 必须是 true`);
      else {
        if (!(recipe.healing > 0)) errors.push(`${key}：烹饪配方必须有回血`);
        if (cost.length === 0) errors.push(`${key}：烹饪配方没有 cost`);
      }
    }
    if (recipe.buff !== undefined) {
      const buff = recipe.buff;
      if (!buff || typeof buff !== "object") errors.push(`${key}：buff 必须是对象`);
      else {
        if (!["speed", "attack"].includes(buff.kind)) errors.push(`${key}：buff.kind 只许 speed 或 attack（现在是 ${buff.kind}）`);
        if (!(typeof buff.pct === "number" && buff.pct > 0)) errors.push(`${key}：buff.pct 必须是正数`);
        if (!(typeof buff.seconds === "number" && buff.seconds > 0)) errors.push(`${key}：buff.seconds 必须是正数`);
      }
    }
    if (recipe.equipment !== undefined) {
      if (!["weapon", "armor", "tool"].includes(recipe.equipment)) {
        errors.push(`${key}：装备槽必须是 weapon、armor 或 tool（现在是 ${recipe.equipment}）`);
      }
      if (typeof recipe.tier !== "string" || !recipe.tier) errors.push(`${key}：装备配方必须有品阶`);
      if (cost.length === 0) errors.push(`${key}：装备配方没有 cost`);
    }
    if (recipe.tier !== undefined && (typeof recipe.tier !== "string" || !recipe.tier)) {
      errors.push(`${key}：品阶必须是非空字符串`);
    }
    if (typeof recipe.name === "string") {
      if (names.has(recipe.name)) errors.push(`${key}：配方名“${recipe.name}”与 ${names.get(recipe.name)} 重复`);
      else names.set(recipe.name, key);
    }
  }
  return { valid: errors.length === 0, errors };
}
