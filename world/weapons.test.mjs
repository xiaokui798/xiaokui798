import test from "node:test";
import assert from "node:assert/strict";
import { WEAPONS, TIER_MULTIPLIERS, TIER_UNLOCK, weaponBase, tierUnlocked, weaponUnlocked, weaponLockReason, validateWeapons, assertValidWeapons } from "./weapons.mjs";

test("the weapon table is verbatim: stone values, tier multipliers and boss guns", () => {
  assert.deepEqual(TIER_MULTIPLIERS, { stone: 1, ember: 1.5, star: 2 });
  assert.deepEqual(TIER_UNLOCK, { ember: { bossKills: { boss: 1 } }, star: { bossKills: { colossus: 1 } } });
  assert.deepEqual(WEAPONS, {
    stoneSword: { name: "石剑", style: "sword", damage: 27, reach: 2.75, cooldown: .38, tier: "stone" },
    stoneAxe: { name: "石斧", style: "axe", damage: 44, reach: 2.3, cooldown: .74, tier: "stone" },
    emberSword: { name: "熔火剑", style: "sword", damage: 41, reach: 2.75, cooldown: .38, tier: "ember", base: "stoneSword" },
    emberAxe: { name: "熔火斧", style: "axe", damage: 66, reach: 2.3, cooldown: .74, tier: "ember", base: "stoneAxe" },
    starSword: { name: "断星剑", style: "sword", damage: 54, reach: 2.75, cooldown: .38, tier: "star", base: "stoneSword" },
    starAxe: { name: "断星斧", style: "axe", damage: 88, reach: 2.3, cooldown: .74, tier: "star", base: "stoneAxe" },
    punch: { name: "拳头", style: "punch", damage: 14, reach: 2.05, cooldown: .46 },
    pulseWeapon: { name: "星脉枪", style: "pulse", damage: 24, reach: 18, cooldown: .31, capacity: 6, recharge: 1.2, bossOnly: true },
    pulseBurst: { name: "星脉爆发", style: "pulse", damage: 62, reach: 24, cooldown: .59, cost: 2, windup: .58, bossOnly: true },
    rapid: { name: "蜂鸣速射枪", style: "rapid", damage: 14, reach: 15, cooldown: .13, bossOnly: true },
    cannon: { name: "裂晶重炮", style: "cannon", damage: 52, reach: 24, cooldown: .78, cost: 2, bossOnly: true }
  });
});

test("tiered damage is the base damage times the tier multiplier, rounded", () => {
  assert.equal(WEAPONS.emberSword.damage, Math.round(WEAPONS.stoneSword.damage * TIER_MULTIPLIERS.ember));
  assert.equal(WEAPONS.emberAxe.damage, Math.round(WEAPONS.stoneAxe.damage * TIER_MULTIPLIERS.ember));
  assert.equal(WEAPONS.starSword.damage, Math.round(WEAPONS.stoneSword.damage * TIER_MULTIPLIERS.star));
  assert.equal(WEAPONS.starAxe.damage, Math.round(WEAPONS.stoneAxe.damage * TIER_MULTIPLIERS.star));
  // The 27 x 1.5 case is the only non-integer: 40.5 rounds up to 41.
  assert.equal(WEAPONS.emberSword.damage, 41);
  // Reach and cooldown carry over from the base weapon, unchanged.
  for (const key of ["emberSword", "emberAxe", "starSword", "starAxe"]) {
    assert.equal(WEAPONS[key].reach, WEAPONS[WEAPONS[key].base].reach);
    assert.equal(WEAPONS[key].cooldown, WEAPONS[WEAPONS[key].base].cooldown);
  }
});

test("tier unlocks read boss kills from the progress record", () => {
  assert.equal(tierUnlocked("stone", null), true);
  assert.equal(tierUnlocked("stone", {}), true);
  assert.equal(tierUnlocked("ember", null), false);
  assert.equal(tierUnlocked("ember", {}), false);
  assert.equal(tierUnlocked("ember", { bossKills: {} }), false);
  assert.equal(tierUnlocked("ember", { bossKills: { boss: 1 } }), true);
  assert.equal(tierUnlocked("ember", { bossKills: { colossus: 1 } }), false);
  assert.equal(tierUnlocked("star", { bossKills: { boss: 1 } }), false);
  assert.equal(tierUnlocked("star", { bossKills: { colossus: 1 } }), true);
  assert.equal(tierUnlocked("star", { bossKills: { boss: 1, colossus: 1 } }), true);
  assert.equal(tierUnlocked("mythic", { bossKills: { boss: 9 } }), false);
  assert.equal(weaponUnlocked("emberSword", { bossKills: { boss: 1 } }), true);
  assert.equal(weaponUnlocked("starAxe", { bossKills: { boss: 1 } }), false);
  assert.equal(weaponUnlocked("stoneSword", null), true);
  assert.equal(weaponUnlocked("punch", null), true);
  // An unknown key has no tier, so there is nothing to gate.
  assert.equal(weaponUnlocked("nope", null), true);
  assert.equal(weaponBase("emberSword"), "stoneSword");
  assert.equal(weaponBase("starAxe"), "stoneAxe");
  assert.equal(weaponBase("stoneSword"), "stoneSword");
  assert.equal(weaponBase("punch"), "punch");
});

test("the lock reason names the boss the tier needs", () => {
  assert.equal(weaponLockReason("stoneSword", null), null);
  assert.equal(weaponLockReason("emberSword", null), "需击败熔炉守卫 1 次");
  assert.equal(weaponLockReason("emberAxe", { bossKills: { colossus: 1 } }), "需击败熔炉守卫 1 次");
  assert.equal(weaponLockReason("emberSword", { bossKills: { boss: 1 } }), null);
  assert.equal(weaponLockReason("starSword", null), "需击败断星巨像 1 次");
  assert.equal(weaponLockReason("starAxe", { bossKills: { boss: 1 } }), "需击败断星巨像 1 次");
  assert.equal(weaponLockReason("starSword", { bossKills: { colossus: 1 } }), null);
  assert.equal(weaponLockReason("punch", null), null);
});

test("validateWeapons rejects a bad table with exact errors", () => {
  assert.deepEqual(validateWeapons(null), { valid: false, errors: ["武器表不是对象"] });
  assert.deepEqual(validateWeapons({}), { valid: false, errors: ["武器表为空"] });
  assert.deepEqual(validateWeapons({ nope: null }).errors, ["武器“nope”不是对象"]);
  assert.deepEqual(validateWeapons({ ...WEAPONS, punch: { ...WEAPONS.punch, style: "kick" } }).errors,
    ["武器“punch”：style 必须是 sword、axe、punch、pulse、rapid 或 cannon（现在是 kick）"]);
  // A bad base cascades: the tiered entries pin their damage to it.
  assert.deepEqual(validateWeapons({ ...WEAPONS, stoneSword: { ...WEAPONS.stoneSword, damage: 0 } }).errors,
    ["武器“stoneSword”：damage 不是正数", "武器“emberSword”：伤害应为 0（基础 0 × 1.5）", "武器“starSword”：伤害应为 0（基础 0 × 2）"]);
  assert.deepEqual(validateWeapons({ ...WEAPONS, rapid: { ...WEAPONS.rapid, name: "" } }).errors,
    ["武器“rapid”：名字必须是非空字符串"]);
  assert.deepEqual(validateWeapons({ ...WEAPONS, emberSword: { ...WEAPONS.emberSword, damage: 40 } }).errors,
    ["武器“emberSword”：伤害应为 41（基础 27 × 1.5）"]);
  assert.deepEqual(validateWeapons({ ...WEAPONS, starAxe: { ...WEAPONS.starAxe, reach: 2.5 } }).errors,
    ["武器“starAxe”：射程应与基础武器一致（2.3）"]);
  assert.deepEqual(validateWeapons({ ...WEAPONS, starSword: { ...WEAPONS.starSword, cooldown: .5 } }).errors,
    ["武器“starSword”：冷却应与基础武器一致（0.38）"]);
  assert.deepEqual(validateWeapons({ ...WEAPONS, emberAxe: { ...WEAPONS.emberAxe, base: "nope" } }).errors,
    ["武器“emberAxe”：基础武器“nope”未注册"]);
  assert.deepEqual(validateWeapons({ ...WEAPONS, starSword: { ...WEAPONS.starSword, tier: "mythic" } }).errors,
    ["武器“starSword”：品阶必须是 stone、ember 或 star（现在是 mythic）", "武器“starSword”：品阶武器必须有品阶"]);
  assert.deepEqual(validateWeapons({ ...WEAPONS,
    emberSword: { name: "熔火剑", style: "sword", damage: 41, reach: 2.75, cooldown: .38, tier: "ember" } }).errors,
    ["武器“emberSword”：品阶武器必须有基础武器"]);
  assert.deepEqual(validateWeapons({ ...WEAPONS, cannon: { ...WEAPONS.cannon, cost: 0 } }).errors,
    ["武器“cannon”：cost 不是正数"]);
});

test("assertValidWeapons passes the real table and throws on a bad one", () => {
  // Importing this module already ran the self-check; the return value
  // pins it as a callable assertion too.
  assert.equal(assertValidWeapons(), true);
  assert.equal(validateWeapons().valid, true);
  assert.throws(() => assertValidWeapons({ ...WEAPONS, cannon: { ...WEAPONS.cannon, damage: -1 } }),
    /武器表校验失败：武器“cannon”：damage 不是正数/);
});
