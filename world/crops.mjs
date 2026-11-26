// The crop registry (R2, farming & cooking): one module owns every crop
// kind, its growth timing and its harvest yield, so the save layer
// (progression.mjs) and the game (game.js) read one source instead of
// hardcoding wheat numbers in two places. A crop is not a block — it
// lives in the campaign's `crops` field (a cell -> crop record) and is
// drawn as its own mesh, so adding a crop never touches BLOCK, the
// materials array, the atlas or the terrain generator.
import { DAY_LENGTH } from "./terrain.mjs";
import { BLOCK } from "./recipes.mjs";

// Farm materials, by id: seeds, harvested products, and fertilizer.
// They are not blocks (no BLOCK id, no terrain) and not boss materials
// — they only live in the campaign's seed counts, the same shape as
// rareMaterials. The count object is called `seeds` in the save because
// seeds are its primary content, but it holds harvested products too
// (wheat), since R4's cooking recipes spend them through the same
// string-id path — and fertilizer (composted leaves), which is crafted
// in R3 and spent on crops through the same path.
export const FARM_MATERIALS = Object.freeze({ wheatSeed: "小麦种子", wheat: "小麦", fertilizer: "腐叶" });

// Rain doubles growth: a crop in the rain grows a day's worth in half a
// day. The rate is a named constant so R3's fertilizer reuses the same
// multiplier instead of hardcoding another 2.
export const RAIN_GROWTH_MULTIPLIER = 2;

// Fertilizer doubles growth too, and multiplies with rain: a fertilized
// crop in the rain grows at x4. One application lasts the crop's whole
// cycle (the fertilized flag is per crop, set once, never re-applied).
export const FERTILIZER_GROWTH_MULTIPLIER = 2;

// The seeds a new game starts with: 2 wheat seeds, so the player can
// try planting before the first spitter drops one. An old save (no seeds
// field) loads the same 2 on upgrade — the starter is the fallback, the
// way starterMaterials is for blocks.
export const STARTER_SEEDS = Object.freeze({ wheatSeed: 2 });

// Crops, by id. `growthSeconds` is the game-time from planting to
// harvestable (one day: DAY_LENGTH); `stages` is how many visual stages
// the crop passes through, so each stage lasts growthSeconds /
// (stages - 1) seconds and the last stage is the mature one. `yield` is
// [material, count] pairs paid on harvest — a block id or a farm
// material id, the count a positive whole number. Wheat pays its seed
// back, so one harvest re-plants itself.
export const CROPS = Object.freeze({
  wheat: { name: "小麦", seed: "wheatSeed", stages: 3, growthSeconds: DAY_LENGTH,
    yield: [["wheat", 2], ["wheatSeed", 1]] }
});

// The stage a crop of this kind is in after `growth` seconds of
// effective growth (rain already folded in by the caller): the last stage
// is the mature one, so growth past the mature point stays there.
export function growthStage(def, growth) {
  if (!def || typeof def.stages !== "number" || def.stages < 2
    || typeof def.growthSeconds !== "number" || def.growthSeconds <= 0) return 0;
  const stageSeconds = def.growthSeconds / (def.stages - 1);
  return Math.min(def.stages - 1, Math.floor(Math.max(0, growth) / stageSeconds));
}

// True once the crop has had a full growthSeconds of effective growth —
// the same point growthStage returns the last stage.
export function isMature(def, growth) {
  return typeof def?.growthSeconds === "number"
    && typeof growth === "number" && growth >= def.growthSeconds;
}

// Validate a crop registry (defaults to this module's own): every kind
// needs a name, a registered seed id, at least 2 stages (a seedling and
// a mature stage), a positive growth time, and a yield table whose
// entries are [material, count] pairs — the material a registered block
// (never AIR) or a registered farm material, the count a positive whole
// number. Returns { valid, errors } so callers can report every problem
// at once instead of failing on the first one — the same shape as
// validateEnemies.
export function validateCrops(crops = CROPS, farmMaterials = FARM_MATERIALS) {
  const errors = [];
  if (!crops || typeof crops !== "object") return { valid: false, errors: ["作物表不是对象"] };
  const kinds = Object.keys(crops);
  if (kinds.length === 0) errors.push("作物表为空");
  for (const [id, def] of Object.entries(crops)) {
    const label = `作物“${id}”`;
    if (!def || typeof def !== "object") { errors.push(`${label}不是对象`); continue; }
    if (typeof def.name !== "string" || !def.name) errors.push(`${label}：名字必须是非空字符串`);
    if (typeof def.seed !== "string" || !def.seed) errors.push(`${label}：种子必须是非空字符串`);
    else if (!Object.hasOwn(farmMaterials ?? {}, def.seed)) errors.push(`${label}：种子“${def.seed}”未注册`);
    if (!Number.isInteger(def.stages) || def.stages < 2) {
      errors.push(`${label}：阶段数必须是大于 1 的整数（现在是 ${def.stages}）`);
    }
    if (typeof def.growthSeconds !== "number" || !Number.isFinite(def.growthSeconds) || def.growthSeconds <= 0) {
      errors.push(`${label}：生长耗时必须是正数（现在是 ${def.growthSeconds}）`);
    }
    if (!Array.isArray(def.yield)) errors.push(`${label}：产量不是数组`);
    else for (const [index, entry] of def.yield.entries()) {
      const yieldLabel = `${label}：产量[${index}]`;
      if (!Array.isArray(entry) || entry.length !== 2) { errors.push(`${yieldLabel}不是 [材料, 数量]`); continue; }
      const [material, amount] = entry;
      const knownBlock = typeof material === "number" && Number.isInteger(material)
        && material !== BLOCK.AIR && material >= BLOCK.AIR && material <= BLOCK.LEAF;
      if (!knownBlock && !(typeof material === "string" && Object.hasOwn(farmMaterials ?? {}, material))) {
        errors.push(`${yieldLabel}：材料“${material}”未注册`);
      }
      if (!Number.isInteger(amount) || amount <= 0) errors.push(`${yieldLabel}：数量不是正整数`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// The recipe table's assertValidRecipes, for crops: a bad shipped
// registry fails the import instead of growing a crop with no seed or
// no yield. Exported so tests can check the failure without a bad table.
export function assertValidCrops(crops = CROPS, farmMaterials = FARM_MATERIALS) {
  const { valid, errors } = validateCrops(crops, farmMaterials);
  if (!valid) throw new Error(`作物表校验失败：${errors.join("；")}`);
  return true;
}
assertValidCrops();
