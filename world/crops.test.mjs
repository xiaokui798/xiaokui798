import test from "node:test";
import assert from "node:assert/strict";
import { CROPS, FARM_MATERIALS, STARTER_SEEDS, RAIN_GROWTH_MULTIPLIER, FERTILIZER_GROWTH_MULTIPLIER,
  growthStage, isMature, validateCrops, assertValidCrops } from "./crops.mjs";
import { DAY_LENGTH } from "./terrain.mjs";
import { BLOCK } from "./recipes.mjs";

test("the crop registry is pinned verbatim", () => {
  assert.equal(DAY_LENGTH, 240);
  assert.equal(RAIN_GROWTH_MULTIPLIER, 2);
  assert.equal(FERTILIZER_GROWTH_MULTIPLIER, 2);
  assert.deepEqual(FARM_MATERIALS, { wheatSeed: "小麦种子", wheat: "小麦", fertilizer: "腐叶" });
  assert.deepEqual(STARTER_SEEDS, { wheatSeed: 2 });
  assert.deepEqual(Object.keys(CROPS), ["wheat"]);
  assert.deepEqual(CROPS, {
    wheat: { name: "小麦", seed: "wheatSeed", stages: 3, growthSeconds: DAY_LENGTH,
      yield: [["wheat", 2], ["wheatSeed", 1]] }
  });
  assert.ok(Object.isFrozen(CROPS));
  assert.ok(Object.isFrozen(FARM_MATERIALS));
  assert.ok(Object.isFrozen(STARTER_SEEDS));
});

test("growthStage steps through the stages and stays mature", () => {
  const wheat = CROPS.wheat;
  // 3 stages over 240s: a stage lasts 120s, the mature stage starts at 240s.
  assert.equal(growthStage(wheat, 0), 0);
  assert.equal(growthStage(wheat, 119), 0);
  assert.equal(growthStage(wheat, 120), 1);
  assert.equal(growthStage(wheat, 239), 1);
  assert.equal(growthStage(wheat, 240), 2);
  assert.equal(growthStage(wheat, 9999), 2);
  assert.equal(growthStage(wheat, -5), 0);
  assert.equal(growthStage(null, 240), 0);
  assert.equal(growthStage({ stages: 1, growthSeconds: 240 }, 240), 0);
});

test("isMature is true only at a full growthSeconds", () => {
  const wheat = CROPS.wheat;
  assert.equal(isMature(wheat, 239), false);
  assert.equal(isMature(wheat, 240), true);
  assert.equal(isMature(wheat, 9999), true);
  assert.equal(isMature(null, 240), false);
  assert.equal(isMature(wheat, "240"), false);
});

test("validateCrops reports every bad field with the pinned wording", () => {
  assert.deepEqual(validateCrops(null), { valid: false, errors: ["作物表不是对象"] });
  assert.deepEqual(validateCrops({}), { valid: false, errors: ["作物表为空"] });
  assert.deepEqual(validateCrops({ wheat: null }), { valid: false, errors: ["作物“wheat”不是对象"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, name: "" } }),
    { valid: false, errors: ["作物“wheat”：名字必须是非空字符串"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, seed: "" } }),
    { valid: false, errors: ["作物“wheat”：种子必须是非空字符串"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, seed: "dragonScale" } }),
    { valid: false, errors: ["作物“wheat”：种子“dragonScale”未注册"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, stages: 1 } }),
    { valid: false, errors: ["作物“wheat”：阶段数必须是大于 1 的整数（现在是 1）"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, stages: 2.5 } }),
    { valid: false, errors: ["作物“wheat”：阶段数必须是大于 1 的整数（现在是 2.5）"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, growthSeconds: 0 } }),
    { valid: false, errors: ["作物“wheat”：生长耗时必须是正数（现在是 0）"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, yield: "wheat" } }),
    { valid: false, errors: ["作物“wheat”：产量不是数组"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, yield: [["wheat"]] } }),
    { valid: false, errors: ["作物“wheat”：产量[0]不是 [材料, 数量]"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, yield: [["dragonScale", 1]] } }),
    { valid: false, errors: ["作物“wheat”：产量[0]：材料“dragonScale”未注册"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, yield: [[BLOCK.AIR, 1]] } }),
    { valid: false, errors: ["作物“wheat”：产量[0]：材料“0”未注册"] });
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, yield: [["wheat", 0]] } }),
    { valid: false, errors: ["作物“wheat”：产量[0]：数量不是正整数"] });
  // A block id in the yield is a registered material too.
  assert.deepEqual(validateCrops({ wheat: { ...CROPS.wheat, yield: [[BLOCK.STONE, 1]] } }),
    { valid: true, errors: [] });
  assert.deepEqual(validateCrops(), { valid: true, errors: [] });
});

test("assertValidCrops throws with the pinned prefix", () => {
  assert.throws(() => assertValidCrops({ wheat: { ...CROPS.wheat, stages: 1 } }),
    /作物表校验失败：作物“wheat”：阶段数必须是大于 1 的整数（现在是 1）/);
  assert.equal(assertValidCrops(), true);
});
