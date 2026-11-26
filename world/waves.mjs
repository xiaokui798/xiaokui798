// Single registry for the defense mode configuration: the wave roster
// and the beacon's tuning. Both are plain literals; the only import is
// the enemy registry, so a wave can be checked against the kinds that
// actually exist. defense.mjs re-exports them, so existing
// `import { DEFENSE_WAVES, BEACON } from "./defense.mjs"` code (game.js
// included) keeps working unchanged. Add a new wave by appending one
// entry; the wave count, timers and spawn logic all follow the table.
import { ENEMIES } from "./enemies.mjs";

export const DEFENSE_WAVES = Object.freeze([
  { name: "前哨接触", enemies: ["spitter", "spitter"], seconds: 45 },
  { name: "交叉火力", enemies: ["spitter", "spitter", "spitter"], seconds: 49 },
  { name: "重型来袭", enemies: ["breaker", "spitter", "spitter"], seconds: 54 },
  { name: "两面夹击", enemies: ["breaker", "spitter", "spitter", "spitter", "spitter"], seconds: 58 },
  { name: "黎明前的攻势", enemies: ["breaker", "breaker", "spitter", "spitter", "spitter", "spitter"], seconds: 64 }
]);

export const BEACON = Object.freeze({ hp: 120, radius: .43, height: 1.93, repairRange: 3.1, repairCost: 3, repairedHp: 30 });

// Validate a defense configuration (defaults to this module's own):
// every roster entry must be a registered enemy kind, every wave needs
// a positive timer, and the beacon needs positive health. Returns
// { valid, errors } so callers can report every problem at once instead
// of failing on the first one — the same shape as validateRecipes.
export function validateWaves(waves = DEFENSE_WAVES, beacon = BEACON) {
  const errors = [];
  if (!Array.isArray(waves)) return { valid: false, errors: ["波次配置不是数组"] };
  if (waves.length === 0) errors.push("波次配置为空");
  waves.forEach((wave, index) => {
    const label = `第 ${index + 1} 波`;
    if (!wave || typeof wave !== "object") { errors.push(`${label}不是对象`); return; }
    if (!Array.isArray(wave.enemies)) errors.push(`${label}没有敌人名单`);
    else {
      if (wave.enemies.length === 0) errors.push(`${label}没有敌人`);
      for (const kind of wave.enemies) {
        if (!Object.hasOwn(ENEMIES, kind)) errors.push(`${label}：敌人“${kind}”未注册`);
      }
    }
    if (typeof wave.seconds !== "number" || !Number.isFinite(wave.seconds) || wave.seconds <= 0) {
      errors.push(`${label}：秒数不是正数`);
    }
  });
  if (!beacon || typeof beacon !== "object") errors.push("信标配置不是对象");
  else if (typeof beacon.hp !== "number" || !Number.isFinite(beacon.hp) || beacon.hp <= 0) {
    errors.push("信标血量不是正数");
  }
  return { valid: errors.length === 0, errors };
}

// The recipe table's assertValidRecipes, for waves: a bad shipped table
// fails the import instead of spawning an unregistered kind or a wave
// that times out the moment it starts. Exported so tests can check the
// failure without a bad table.
export function assertValidWaves(waves = DEFENSE_WAVES, beacon = BEACON) {
  const { valid, errors } = validateWaves(waves, beacon);
  if (!valid) throw new Error(`波次配置校验失败：${errors.join("；")}`);
  return true;
}
assertValidWaves();
