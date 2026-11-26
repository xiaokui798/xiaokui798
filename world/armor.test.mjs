import test from "node:test";
import assert from "node:assert/strict";
import { ARMOR_REDUCTION, armorReduction, reducedDamage, validateArmor, assertValidArmor } from "./armor.mjs";

test("the armor table pins one reduction per tier", () => {
  assert.deepEqual(ARMOR_REDUCTION, { stone: 0.10, ember: 0.25, star: 0.40 });
  assert.equal(armorReduction("stone"), 0.10);
  assert.equal(armorReduction("ember"), 0.25);
  assert.equal(armorReduction("star"), 0.40);
  assert.equal(armorReduction("unknown"), 0);
  assert.equal(armorReduction(undefined), 0);
});

test("reducedDamage rounds each tier's cut down, never below 1", () => {
  // A 14-damage breaker hit: 12 / 10 / 8. A 24-damage colossus
  // meteor: 21 / 18 / 14. A full 100: 90 / 75 / 60.
  assert.deepEqual([14, 24, 100].map(amount => reducedDamage(amount, "stone")), [12, 21, 90]);
  assert.deepEqual([14, 24, 100].map(amount => reducedDamage(amount, "ember")), [10, 18, 75]);
  assert.deepEqual([14, 24, 100].map(amount => reducedDamage(amount, "star")), [8, 14, 60]);
  assert.equal(reducedDamage(14, undefined), 14);
  // The floor is 1, not 0: a 1-damage hit still deals 1 in every tier,
  // and so do 2 in stone (1.8) and 3 in star (1.8).
  assert.equal(reducedDamage(1, "stone"), 1);
  assert.equal(reducedDamage(1, "ember"), 1);
  assert.equal(reducedDamage(1, "star"), 1);
  assert.equal(reducedDamage(2, "stone"), 1);
  assert.equal(reducedDamage(2, "ember"), 1);
  assert.equal(reducedDamage(3, "star"), 1);
});

test("validateArmor rejects bad tables with verbatim errors", () => {
  assert.deepEqual(validateArmor(), { valid: true, errors: [] });
  assert.deepEqual(validateArmor(null), { valid: false, errors: ["防具表不是对象"] });
  assert.deepEqual(validateArmor({}), { valid: false, errors: ["防具表为空"] });
  assert.deepEqual(validateArmor({ stone: 0.1, ember: 0.25 }),
    { valid: false, errors: ["缺少“star”品阶的减伤率"] });
  assert.deepEqual(validateArmor({ stone: 0.1, ember: 0.25, star: 1 }),
    { valid: false, errors: ["防具“star”：减伤率必须在 0 到 1 之间（现在是 1）"] });
  assert.deepEqual(validateArmor({ stone: 0.1, ember: -0.1, star: 0.4 }),
    { valid: false, errors: ["防具“ember”：减伤率必须在 0 到 1 之间（现在是 -0.1）"] });
  assert.deepEqual(validateArmor({ stone: 0.1, ember: 0.25, star: 0.4, gold: 0.5 }),
    { valid: false, errors: ["防具“gold”：品阶必须是 stone、ember 或 star"] });
  assert.throws(() => assertValidArmor({ stone: 0.1 }), /防具表校验失败：缺少“ember”品阶的减伤率；缺少“star”品阶的减伤率/);
});
