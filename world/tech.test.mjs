import test from "node:test";
import assert from "node:assert/strict";
import { RECIPES } from "./recipes.mjs";
import { TECH, TRUNK, TECH_EFFECTS, canUnlockTech, techConditions, techDisplayOrder,
  techForRecipe, techLockReason, validateTech, assertValidTech } from "./tech.mjs";

// The state canUnlockTech reads: the unlocked list, the progress save
// (boss kills, best waves, lifetime kills) and the lifetime mining count.
const empty = { techUnlocked: [], progress: {}, blocksMined: 0 };
const withTech = (...ids) => ({ ...empty, techUnlocked: ids });
const withProgress = (progress, blocksMined = 0) => ({ techUnlocked: [], progress, blocksMined });

test("the tech table is pinned verbatim: trunk, branches and effects", () => {
  assert.deepEqual(TRUNK, ["workbench", "stoneGear", "emberTech", "emberGear", "starTech", "starGear"]);
  assert.deepEqual(TECH_EFFECTS, { toughnessReduction: 0.05, swiftHandsSeconds: 0.02, firstAidHealing: 10, bountifulHarvestBonus: 1 });
  assert.deepEqual(TECH, {
    workbench: { id: "workbench", name: "工作台", desc: "主干起点：解锁石阶装备",
      requires: {}, unlocks: [] },
    stoneGear: { id: "stoneGear", name: "石阶装备", desc: "解锁石阶装备配方（石甲、石镐）",
      requires: { tech: "workbench" }, unlocks: ["stoneArmor", "stonePickaxe"] },
    emberTech: { id: "emberTech", name: "熔火科技", desc: "主干关口：解锁熔火阶装备",
      requires: { tech: "stoneGear", bossKills: { boss: 1 } }, unlocks: [] },
    emberGear: { id: "emberGear", name: "熔火阶装备", desc: "解锁熔火阶装备配方（熔火剑、熔火斧、熔火甲、熔火镐）",
      requires: { tech: "emberTech" }, unlocks: ["emberSword", "emberAxe", "emberArmor", "emberPickaxe"] },
    starTech: { id: "starTech", name: "断星科技", desc: "主干关口：解锁断星阶装备",
      requires: { tech: "emberGear", bossKills: { colossus: 1 } }, unlocks: [] },
    starGear: { id: "starGear", name: "断星阶装备", desc: "解锁断星阶装备配方（断星剑、断星斧、断星甲、断星镐）",
      requires: { tech: "starTech" }, unlocks: ["starSword", "starAxe", "starArmor", "starPickaxe"] },
    toughness: { id: "toughness", name: "坚韧", desc: "防具减伤 +5%",
      requires: { defenseWave: 4 }, unlocks: [], mount: "emberTech" },
    swiftHands: { id: "swiftHands", name: "快手", desc: "挖掘再 -0.02 秒",
      requires: { blocksMined: 500 }, unlocks: [], mount: "stoneGear" },
    firstAid: { id: "firstAid", name: "急救", desc: "敷料回血 +10",
      requires: { kills: 100 }, unlocks: [], mount: "emberGear" },
    bountifulHarvest: { id: "bountifulHarvest", name: "丰收", desc: "收获产量 +1",
      requires: { cropsHarvested: 20 }, unlocks: [], mount: "stoneGear" },
  });
  // Branches hang under their trunk node in display order; the mount is
  // visual grouping only, never a prerequisite.
  assert.deepEqual(techDisplayOrder(),
    ["workbench", "stoneGear", "swiftHands", "bountifulHarvest", "emberTech", "toughness", "emberGear", "firstAid", "starTech", "starGear"]);
});

test("the harvest branch reads the lifetime harvest count", () => {
  assert.deepEqual(techConditions({ techUnlocked: [], progress: {}, cropsHarvested: 7 }, "bountifulHarvest"),
    [{ text: "累计收获 7/20 株", met: false }]);
  assert.equal(canUnlockTech({ techUnlocked: [], progress: {}, cropsHarvested: 19 }, "bountifulHarvest"), false);
  assert.equal(canUnlockTech({ techUnlocked: [], progress: {}, cropsHarvested: 20 }, "bountifulHarvest"), true);
  assert.equal(techLockReason({ techUnlocked: [], progress: {}, cropsHarvested: 0 }, "bountifulHarvest"), "累计收获 0/20 株");
  // A state without the field (an older caller) reads as zero.
  assert.equal(canUnlockTech({ techUnlocked: [], progress: {} }, "bountifulHarvest"), false);
});

test("canUnlockTech walks the trunk in order and checks each threshold", () => {
  // The trunk root is free; each next node needs the previous one.
  assert.equal(canUnlockTech(empty, "workbench"), true);
  assert.equal(canUnlockTech(empty, "stoneGear"), false);
  assert.equal(canUnlockTech(withTech("workbench"), "stoneGear"), true);
  assert.equal(canUnlockTech(withTech("workbench"), "emberTech"), false);
  // A boss kill alone does not open 熔火科技 without the trunk.
  assert.equal(canUnlockTech(withProgress({ bossKills: { boss: 1 } }), "emberTech"), false);
  assert.equal(canUnlockTech({ techUnlocked: ["workbench", "stoneGear"], progress: { bossKills: { boss: 1 } }, blocksMined: 0 }, "emberTech"), true);
  assert.equal(canUnlockTech(withTech("workbench", "stoneGear", "emberTech"), "emberGear"), true);
  assert.equal(canUnlockTech(withTech("workbench", "stoneGear", "emberTech", "emberGear"), "starTech"), false);
  assert.equal(canUnlockTech({ techUnlocked: ["workbench", "stoneGear", "emberTech", "emberGear"], progress: { bossKills: { colossus: 1 } }, blocksMined: 0 }, "starTech"), true);
  // Each branch threshold, just below and at the line.
  assert.equal(canUnlockTech(withProgress({ defense: { bestWave: 3 } }), "toughness"), false);
  assert.equal(canUnlockTech(withProgress({ defense: { bestWave: 4 } }), "toughness"), true);
  assert.equal(canUnlockTech(withProgress({}, 499), "swiftHands"), false);
  assert.equal(canUnlockTech(withProgress({}, 500), "swiftHands"), true);
  assert.equal(canUnlockTech(withProgress({ kills: 99 }), "firstAid"), false);
  assert.equal(canUnlockTech(withProgress({ kills: 100 }), "firstAid"), true);
  // Already unlocked, and unknown ids, are never unlockable.
  assert.equal(canUnlockTech(withTech("workbench"), "workbench"), false);
  assert.equal(canUnlockTech(empty, "nope"), false);
});

test("techConditions lists every requirement as have/need, prerequisite first", () => {
  assert.deepEqual(techConditions(empty, "emberTech"),
    [{ text: "需先解锁：石阶装备", met: false }, { text: "击败熔炉守卫 0/1 次", met: false }]);
  assert.deepEqual(techConditions(withTech("workbench", "stoneGear"), "emberTech"),
    [{ text: "已解锁石阶装备", met: true }, { text: "击败熔炉守卫 0/1 次", met: false }]);
  assert.deepEqual(techConditions(withProgress({ defense: { bestWave: 2 } }), "toughness"),
    [{ text: "防守最佳波次 2/4", met: false }]);
  assert.deepEqual(techConditions(withProgress({}, 123), "swiftHands"),
    [{ text: "累计挖掘 123/500 块", met: false }]);
  assert.deepEqual(techConditions(withProgress({ kills: 87 }), "firstAid"),
    [{ text: "累计击杀 87/100 只", met: false }]);
  assert.deepEqual(techConditions(empty, "workbench"), []);
  assert.deepEqual(techConditions(empty, "nope"), []);
});

test("techLockReason names the first unmet requirement, or null when open", () => {
  assert.equal(techLockReason(empty, "workbench"), null);
  assert.equal(techLockReason(withTech("workbench"), "stoneGear"), null);
  assert.equal(techLockReason(empty, "stoneGear"), "需先解锁：工作台");
  assert.equal(techLockReason(empty, "emberTech"), "需先解锁：石阶装备");
  assert.equal(techLockReason(withTech("workbench", "stoneGear"), "emberTech"), "击败熔炉守卫 0/1 次");
  assert.equal(techLockReason(withTech("workbench", "stoneGear", "emberTech"), "emberGear"), null);
  assert.equal(techLockReason(withProgress({ defense: { bestWave: 2 } }), "toughness"), "防守最佳波次 2/4");
  assert.equal(techLockReason(withTech("toughness"), "toughness"), null);
  assert.equal(techLockReason(empty, "nope"), null);
});

test("techForRecipe maps each equipment recipe to its trunk node", () => {
  assert.equal(techForRecipe("stoneArmor"), "stoneGear");
  assert.equal(techForRecipe("stonePickaxe"), "stoneGear");
  assert.equal(techForRecipe("emberSword"), "emberGear");
  assert.equal(techForRecipe("emberAxe"), "emberGear");
  assert.equal(techForRecipe("emberArmor"), "emberGear");
  assert.equal(techForRecipe("emberPickaxe"), "emberGear");
  assert.equal(techForRecipe("starSword"), "starGear");
  assert.equal(techForRecipe("starAxe"), "starGear");
  assert.equal(techForRecipe("starArmor"), "starGear");
  assert.equal(techForRecipe("starPickaxe"), "starGear");
  assert.equal(techForRecipe("dressing"), null);
  assert.equal(techForRecipe("workbench"), null);
  assert.equal(techForRecipe("axe"), null);
  assert.equal(techForRecipe("nope"), null);
});

test("validateTech reports every problem at once, with exact strings", () => {
  assert.deepEqual(validateTech(null), { valid: false, errors: ["科技表不是对象"] });
  assert.deepEqual(validateTech({}), { valid: false, errors: ["科技表为空"] });
  assert.deepEqual(validateTech({ ...TECH, bad: { name: "坏科技" } }),
    { valid: false, errors: ["科技“bad”：效果文案必须是非空字符串", "科技“bad”：门槛不是对象"] });
  assert.deepEqual(validateTech({ ...TECH, workbench: { ...TECH.workbench, name: "" } }),
    { valid: false, errors: ["科技“workbench”：名字必须是非空字符串"] });
  assert.deepEqual(validateTech({ ...TECH, workbench: { ...TECH.workbench, desc: "" } }),
    { valid: false, errors: ["科技“workbench”：效果文案必须是非空字符串"] });
  assert.deepEqual(validateTech({ ...TECH, workbench: { ...TECH.workbench, requires: null } }),
    { valid: false, errors: ["科技“workbench”：门槛不是对象"] });
  assert.deepEqual(validateTech({ ...TECH, stoneGear: { ...TECH.stoneGear, requires: { tech: "nope" } } }),
    { valid: false, errors: ["科技“stoneGear”：前置科技“nope”未注册", "主干“stoneGear”的前置不是“workbench”"] });
  assert.deepEqual(validateTech({ ...TECH, emberTech: { ...TECH.emberTech, requires: { tech: "stoneGear", bossKills: { nope: 1 } } } }),
    { valid: false, errors: ["科技“emberTech”：Boss“nope”未注册"] });
  assert.deepEqual(validateTech({ ...TECH, emberTech: { ...TECH.emberTech, requires: { tech: "stoneGear", bossKills: { boss: 0 } } } }),
    { valid: false, errors: ["科技“emberTech”：Boss“boss”的击杀数不是正整数"] });
  assert.deepEqual(validateTech({ ...TECH, toughness: { ...TECH.toughness, requires: { defenseWave: 0 } } }),
    { valid: false, errors: ["科技“toughness”：defenseWave必须是正整数（现在是 0）"] });
  assert.deepEqual(validateTech({ ...TECH, toughness: { ...TECH.toughness, mount: "nope" } }),
    { valid: false, errors: ["科技“toughness”：挂点科技“nope”未注册"] });
  assert.deepEqual(validateTech({ ...TECH, stoneGear: { ...TECH.stoneGear, unlocks: "stoneArmor" } }),
    { valid: false, errors: ["科技“stoneGear”：解锁列表不是数组"] });
  assert.deepEqual(validateTech({ ...TECH, stoneGear: { ...TECH.stoneGear, unlocks: ["nope"] } }, RECIPES),
    { valid: false, errors: ["科技“stoneGear”：解锁“nope”不是配方"] });
  assert.deepEqual(validateTech({ ...TECH, emberGear: { ...TECH.emberGear, unlocks: [...TECH.emberGear.unlocks, "stoneArmor"] } }, RECIPES),
    { valid: false, errors: ["科技“emberGear”：配方“stoneArmor”已被科技“stoneGear”解锁"] });
  const { starGear, ...noStar } = TECH;
  assert.deepEqual(validateTech(noStar), { valid: false, errors: ["主干科技“starGear”未注册"] });
  assert.deepEqual(validateTech({ ...TECH, stoneGear: { ...TECH.stoneGear, requires: { tech: "emberTech" } } }),
    { valid: false, errors: ["主干“stoneGear”的前置不是“workbench”"] });
  assert.deepEqual(validateTech({ ...TECH, workbench: { ...TECH.workbench, requires: { tech: "stoneGear" } } }),
    { valid: false, errors: ["主干起点“workbench”不应有前置科技"] });
});

test("assertValidTech throws on a bad table at startup", () => {
  assert.equal(assertValidTech(), true);
  assert.equal(assertValidTech(TECH, RECIPES), true);
  assert.throws(() => assertValidTech({ bad: { name: "坏科技" } }), /科技表校验失败/);
});
