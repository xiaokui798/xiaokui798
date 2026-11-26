// Save-shape helpers split out of game.js (batch 51, split piece 1).
//
// progression.mjs owns the storage layer itself — the world save's
// serialize/migrate, the progress record's load/save, the save keys.
// What lives here is the shape logic game.js used to carry inline:
// how a finished run merges into the progress record, how saved
// block edits land on a freshly generated world, the import
// failure wording, and the one storage key game.js defines itself.
// Everything here is pure or works on injected values only; nothing
// imports game.js, so there is no cycle.

import { recordBossKill } from "./progression.mjs";

// The look-sensitivity setting's storage key. Not a save key — the
// game save's keys all live in progression.mjs — but it shares the
// storage area and the cross-tab storage event with them.
export const LOOK_SENSITIVITY_KEY = "block-world:look-sensitivity:v1";

// Saved player edits overwrite generated blocks, and their variants
// with them: a block placed where a flower stood renders plain.
// `world` is the block array (its `variants` ride along as a
// property, as generateTerrain returns it); `edits` is any iterable
// of [cell, type] pairs, as campaign.blockEdits() returns.
export function applyBlockEdits(world, edits) {
  for (const [cell, type] of edits) {
    world[cell] = type;
    if (world.variants) world.variants[cell] = 0;
  }
}

// Merge one finished run into the progress record: best wave is a
// max, kills accumulate, a boss win adds its id, and a defense run
// updates the defense record. Pure: the caller (game.js) owns the
// per-run cache and the savedProgress slot this feeds.
//
// run = { wave, kills, bossDefeated: <boss id | null>,
//         defense: { wave, victory } | null }
export function mergeRunProgressRecord(base, run) {
  let merged = {
    version: 2,
    wave: Math.max(base.wave, run.wave),
    kills: base.kills + run.kills,
    bossesDefeated: { ...base.bossesDefeated, ...(run.bossDefeated ? { [run.bossDefeated]: true } : {}) },
    // Carry the base's kill counts forward: without this spread a run
    // that kills no boss would wipe the counts on save, and a boss win
    // would count from zero instead of from the stored total.
    bossKills: { ...base.bossKills },
    bestWave: Math.max(base.bestWave ?? base.wave, run.wave),
    defense: run.defense ? {
      wave: Math.max(base.defense.wave, run.defense.wave),
      cleared: base.defense.cleared || run.defense.victory,
      bestWave: Math.max(base.defense.bestWave, run.defense.wave)
    } : base.defense
  };
  // A boss win counts as a kill, not just a defeat: the kill count for
  // that boss goes up by one (recordBossKill also marks it defeated).
  if (run.bossDefeated) merged = recordBossKill(merged, run.bossDefeated);
  return merged;
}

// The pause menu's import-failure wording: campaign.importSave
// reports a machine reason; this is its human sentence, or undefined
// for a reason nobody has worded yet (the caller falls back).
export function saveImportFailureReason(reason) {
  return { "invalid-json": "文件不是有效的 JSON", "unknown-version": "无法识别的存档版本",
    "invalid-save": "存档内容损坏", quota: "存储空间不足", conflict: "另一标签页更新了存档",
    error: "保存失败" }[reason];
}
