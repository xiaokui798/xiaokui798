// Survival difficulty curve: the numbers spawnWave() and addEnemies() in
// game.js used to carry inline. Moving them here changes nothing about the
// game — the values, the wave each kind first appears in, and the wave-size
// cap are verbatim. Defense waves do not use this table: their rosters
// come from defenseWaveRoster in defense.mjs.
import { ENEMIES } from "./enemies.mjs";

export const SURVIVAL_DIFFICULTY = Object.freeze({
  // Each wave past the first adds this much of a zombie's base HP.
  hpPerWave: 0.05,
  // A survival wave never fields more than this many zombies.
  maxZombies: 7,
  // Mix-in rules, first match wins: a kind joins the roster from its first
  // wave, on every period-th slot starting at its offset. (walker fills
  // every slot no rule claims.)
  mixIns: Object.freeze([
    Object.freeze({ kind: "breaker", fromWave: 7, period: 5, offset: 4 }),
    Object.freeze({ kind: "runner", fromWave: 5, period: 3, offset: 2 }),
    Object.freeze({ kind: "spitter", fromWave: 6, period: 4, offset: 3 })
  ])
});

// The survival roster for a wave: wave + 1 zombies, capped, with the
// mix-in kinds slotted in.
export function survivalRoster(wave) {
  return Array.from({ length: Math.min(wave + 1, SURVIVAL_DIFFICULTY.maxZombies) }, (_, i) => {
    for (const rule of SURVIVAL_DIFFICULTY.mixIns) {
      if (wave >= rule.fromWave && i % rule.period === rule.offset) return rule.kind;
    }
    return "walker";
  });
}

// HP multiplier for a wave: 1 at wave 1, then +5% per wave past it.
export function hpMultiplier(wave) {
  return 1 + SURVIVAL_DIFFICULTY.hpPerWave * Math.max(0, wave - 1);
}

// A zombie's HP at a wave: its base HP scaled by the curve, rounded the
// way addEnemies() always has.
export function scaledHp(baseHp, wave = 1) {
  return Math.round(baseHp * hpMultiplier(wave));
}

// Validate a survival difficulty table (defaults to this module's own):
// the per-wave HP growth stays in 0–1, the wave-size cap is a positive
// whole number, and every mix-in rule names a wave that exists, a slot
// that exists inside its period, and a registered enemy kind. Survival
// waves are unbounded, so a "wave that exists" is a wave number >= 1.
// Returns { valid, errors } so callers can report every problem at once
// instead of failing on the first one — the same shape as validateRecipes.
export function validateDifficulty(config = SURVIVAL_DIFFICULTY) {
  const errors = [];
  if (!config || typeof config !== "object") return { valid: false, errors: ["难度配置不是对象"] };
  if (typeof config.hpPerWave !== "number" || !Number.isFinite(config.hpPerWave)
    || config.hpPerWave < 0 || config.hpPerWave > 1) {
    errors.push(`hpPerWave 必须在 0 到 1 之间（现在是 ${config.hpPerWave}）`);
  }
  if (!Number.isInteger(config.maxZombies) || config.maxZombies <= 0) {
    errors.push(`maxZombies 必须是正整数（现在是 ${config.maxZombies}）`);
  }
  if (!Array.isArray(config.mixIns)) errors.push("mixIns 不是数组");
  else {
    config.mixIns.forEach((rule, index) => {
      const label = `mixIns[${index}]`;
      if (!rule || typeof rule !== "object") { errors.push(`${label}不是对象`); return; }
      if (!Number.isInteger(rule.fromWave) || rule.fromWave < 1) {
        errors.push(`${label}：fromWave 必须是正整数（现在是 ${rule.fromWave}）`);
      }
      if (!Number.isInteger(rule.period) || rule.period <= 0) {
        errors.push(`${label}：period 必须是正整数（现在是 ${rule.period}）`);
      } else if (!Number.isInteger(rule.offset) || rule.offset < 0 || rule.offset >= rule.period) {
        errors.push(`${label}：offset 必须在 0 到 period 之间（现在是 ${rule.offset}，period 是 ${rule.period}）`);
      }
      if (!Object.hasOwn(ENEMIES, rule.kind)) errors.push(`${label}：敌人“${rule.kind}”未注册`);
    });
  }
  return { valid: errors.length === 0, errors };
}

// The recipe table's assertValidRecipes, for difficulty: a bad shipped
// table fails the import instead of fielding an unregistered kind or a
// rule that can never fire. Exported so tests can check the failure
// without a bad table.
export function assertValidDifficulty(config = SURVIVAL_DIFFICULTY) {
  const { valid, errors } = validateDifficulty(config);
  if (!valid) throw new Error(`难度配置校验失败：${errors.join("；")}`);
  return true;
}
assertValidDifficulty();
