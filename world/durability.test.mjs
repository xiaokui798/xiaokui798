import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK } from "./recipes.mjs";
import { RARE_MATERIALS } from "./enemies.mjs";
import { DURABILITY_MAX, REPAIR_COSTS, durabilityMax, repairCost, validateDurability, assertValidDurability } from "./durability.mjs";

test("the durability maxima and repair costs are pinned per tier", () => {
  assert.deepEqual(DURABILITY_MAX, { stone: 100, ember: 200, star: 300 });
  assert.deepEqual(REPAIR_COSTS, {
    stone: [[BLOCK.STONE, 5]],
    ember: [[BLOCK.STONE, 5], ["emberCore", 1]],
    star: [[BLOCK.STONE, 5], ["starShard", 1]]
  });
  assert.equal(durabilityMax("stone"), 100);
  assert.equal(durabilityMax("ember"), 200);
  assert.equal(durabilityMax("star"), 300);
  assert.equal(durabilityMax("dragon"), 100);
  assert.equal(durabilityMax(), 100);
  assert.deepEqual(repairCost("stone"), [[BLOCK.STONE, 5]]);
  assert.deepEqual(repairCost("ember"), [[BLOCK.STONE, 5], ["emberCore", 1]]);
  assert.deepEqual(repairCost("star"), [[BLOCK.STONE, 5], ["starShard", 1]]);
  assert.deepEqual(repairCost("dragon"), [[BLOCK.STONE, 5]]);
});

test("validateDurability reports every problem at once, with exact strings", () => {
  assert.deepEqual(validateDurability(null), { valid: false, errors: ["耐久表不是对象"] });
  assert.deepEqual(validateDurability({}), { valid: false, errors: ["耐久表为空"] });
  assert.deepEqual(validateDurability({ stone: 100, ember: 200 }),
    { valid: false, errors: ["缺少“star”品阶的耐久上限"] });
  assert.deepEqual(validateDurability({ ...DURABILITY_MAX, dragon: 50 }),
    { valid: false, errors: ["耐久“dragon”：品阶必须是 stone、ember 或 star"] });
  assert.deepEqual(validateDurability({ ...DURABILITY_MAX, ember: 0 }),
    { valid: false, errors: ["耐久“ember”：上限必须是正整数（现在是 0）"] });
  assert.deepEqual(validateDurability({ ...DURABILITY_MAX, star: 150.5 }),
    { valid: false, errors: ["耐久“star”：上限必须是正整数（现在是 150.5）"] });
  assert.deepEqual(validateDurability(DURABILITY_MAX, { ...REPAIR_COSTS, ember: "cheap" }),
    { valid: false, errors: ["修理“ember”：cost 不是数组"] });
  assert.deepEqual(validateDurability(DURABILITY_MAX, { ...REPAIR_COSTS, stone: [["stone"]] }),
    { valid: false, errors: ["修理“stone”：cost[0] 不是 [材料, 数量]"] });
  assert.deepEqual(validateDurability(DURABILITY_MAX, { ...REPAIR_COSTS, stone: [[99, 5]] }),
    { valid: false, errors: ["修理“stone”：cost[0]：材料“99”未注册"] });
  assert.deepEqual(validateDurability(DURABILITY_MAX, { ...REPAIR_COSTS, ember: [[BLOCK.STONE, 5], ["nope", 1]] }, RARE_MATERIALS),
    { valid: false, errors: ["修理“ember”：cost[1]：材料“nope”未注册"] });
  // Without a registry a string id is only checked for being non-empty.
  assert.deepEqual(validateDurability(DURABILITY_MAX, { ...REPAIR_COSTS, ember: [[BLOCK.STONE, 5], ["nope", 1]] }),
    { valid: true, errors: [] });
  assert.deepEqual(validateDurability(DURABILITY_MAX, { ...REPAIR_COSTS, star: [[BLOCK.STONE, 5], ["starShard", 0]] }),
    { valid: false, errors: ["修理“star”：cost[1] 数量不是正整数"] });
  assert.deepEqual(validateDurability(DURABILITY_MAX, { ...REPAIR_COSTS, dragon: [[BLOCK.STONE, 5]] }),
    { valid: false, errors: ["修理“dragon”：品阶必须是 stone、ember 或 star"] });
  assert.deepEqual(validateDurability(DURABILITY_MAX, REPAIR_COSTS, RARE_MATERIALS),
    { valid: true, errors: [] });
});

test("assertValidDurability accepts the real table and rejects a bad one", () => {
  assert.equal(assertValidDurability(), true);
  assert.equal(assertValidDurability(DURABILITY_MAX, REPAIR_COSTS, RARE_MATERIALS), true);
  assert.throws(() => assertValidDurability({ ...DURABILITY_MAX, stone: -1 }), /耐久表校验失败：耐久“stone”：上限必须是正整数（现在是 -1）/);
});
