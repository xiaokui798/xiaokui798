import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_MINING_INTERVAL, miningInterval, validateTools, assertValidTools } from "./tools.mjs";

test("the tool table pins one mining interval per tier", () => {
  assert.deepEqual(TOOL_MINING_INTERVAL, { stone: 0.28, ember: 0.20, star: 0.14 });
  assert.equal(miningInterval("stone"), 0.28);
  assert.equal(miningInterval("ember"), 0.20);
  assert.equal(miningInterval("star"), 0.14);
  assert.equal(miningInterval("unknown"), 0.28);
  assert.equal(miningInterval(undefined), 0.28);
});

test("validateTools rejects bad tables with verbatim errors", () => {
  assert.deepEqual(validateTools(), { valid: true, errors: [] });
  assert.deepEqual(validateTools(null), { valid: false, errors: ["工具表不是对象"] });
  assert.deepEqual(validateTools({}), { valid: false, errors: ["工具表为空"] });
  assert.deepEqual(validateTools({ stone: 0.28, ember: 0.20 }),
    { valid: false, errors: ["缺少“star”品阶的挖掘耗时"] });
  assert.deepEqual(validateTools({ stone: 0.28, ember: 0, star: 0.14 }),
    { valid: false, errors: ["工具“ember”：挖掘耗时必须是正数（现在是 0）"] });
  assert.deepEqual(validateTools({ stone: 0.28, ember: -0.1, star: 0.14 }),
    { valid: false, errors: ["工具“ember”：挖掘耗时必须是正数（现在是 -0.1）"] });
  assert.deepEqual(validateTools({ stone: 0.28, ember: 0.20, star: 0.14, gold: 0.1 }),
    { valid: false, errors: ["工具“gold”：品阶必须是 stone、ember 或 star"] });
  assert.throws(() => assertValidTools({ stone: 0.28 }), /工具表校验失败：缺少“ember”品阶的挖掘耗时；缺少“star”品阶的挖掘耗时/);
});
