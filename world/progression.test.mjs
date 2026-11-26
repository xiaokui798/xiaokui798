import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK, LEGACY_KEY, PREVIOUS_SAVE_KEY, SAVE_KEY, V4_SAVE_KEY, V3_SAVE_KEY, SAVE_SLOT_1_KEY, SAVE_SLOT_2_KEY, V4_SLOT_1_KEY, V4_SLOT_2_KEY, PROGRESS_KEY, V1_PROGRESS_KEY, SAVE_VERSION, PROGRESS_VERSION, SAVE_MIGRATIONS, RECIPES, HEALING_KEYS, COOKING_KEYS, createProgression, emptyProgress, loadProgress, saveProgress, isProgressStale, recordBossKill, assertValidRecipes } from "./progression.mjs";
import { BLOCK as BLOCK_FROM_REGISTRY, RECIPES as RECIPES_FROM_REGISTRY, validateRecipes } from "./recipes.mjs";

function makeSharedStorage(data = new Map()) {
  // Two tabs: distinct storage objects over the same underlying store,
  // like two tabs' localStorage objects over one origin.
  const view = () => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    keys: () => [...data.keys()] });
  return [view(), view()];
}
import { LEGACY_WORLD, WORLD, voxelIndex } from "./terrain.mjs";
import { CROPS, growthStage } from "./crops.mjs";

const line = width => ({ minX: 0, minZ: 0, width, height: 1, depth: 1 });

function makeStorage(entries = []) {
  const data = new Map(entries);
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    keys: () => [...data.keys()] };
}

test("imports legacy blocks and keeps the old save available", () => {
  const legacy = JSON.stringify([[2, BLOCK.WOOD], [9, BLOCK.AIR], [20, BLOCK.STONE]]);
  const storage = makeStorage([[LEGACY_KEY, legacy]]);
  const game = createProgression(storage, line(20));
  assert.deepEqual([...game.blockEdits()], [[2, BLOCK.WOOD], [9, BLOCK.AIR]]);
  game.editBlock(8, BLOCK.AIR, BLOCK.DIRT, true);
  assert.equal(storage.getItem(LEGACY_KEY), legacy);
  const reloaded = createProgression(storage, line(20));
  assert.deepEqual([...reloaded.blockEdits()], [[2, BLOCK.WOOD], [9, BLOCK.AIR], [8, BLOCK.DIRT]]);
  assert.equal(reloaded.count(BLOCK.DIRT), 9);
});

test("limited placement and mining store material changes with the block", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(20));
  assert.equal(game.editBlock(3, BLOCK.AIR, BLOCK.STONE, true), null);
  assert.equal(storage.getItem(SAVE_KEY), null);
  assert.ok(game.editBlock(3, BLOCK.STONE, BLOCK.AIR, true).saved);
  assert.equal(game.count(BLOCK.STONE), 1);
  assert.ok(game.editBlock(3, BLOCK.AIR, BLOCK.STONE, true).saved);
  assert.equal(game.count(BLOCK.STONE), 0);
  assert.ok(game.editBlock(4, BLOCK.AIR, BLOCK.LEAF, false).saved);
  assert.ok(game.editBlock(4, BLOCK.LEAF, BLOCK.AIR, false).saved);
  assert.equal(game.count(BLOCK.LEAF), 0);
});

test("loot unlocks a recipe, crafting pays once, and supplies reload correctly", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  assert.equal(game.craft("axe"), null);
  assert.equal(game.craft("constructor"), null);
  for (let i = 0; i < 3; i++) game.grantLoot();
  assert.ok(game.craft("axe").saved);
  assert.equal(game.craft("axe"), null);
  assert.equal(game.count(BLOCK.STONE), 0);
  assert.equal(game.count(BLOCK.WOOD), 0);
  assert.ok(game.craft("dressing").saved);
  const reloaded = createProgression(storage, line(10));
  assert.equal(reloaded.axeUnlocked, true);
  assert.equal(reloaded.dressings, 1);
  assert.ok(reloaded.useDressing().saved);
  assert.equal(reloaded.useDressing(), null);
  assert.equal(createProgression(storage, line(10)).dressings, 0);
});

test("unavailable storage keeps changes playable for the current session", () => {
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  const game = createProgression(blocked, line(10));
  assert.deepEqual(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true), { saved: false, reason: "error" });
  assert.equal(game.count(BLOCK.WOOD), 3);
  assert.deepEqual([...game.blockEdits()], [[1, BLOCK.AIR]]);
});

test("a corrupt v5 save is quarantined before falling back to v2", () => {
  const corrupt = "{not json";
  const oldSave = JSON.stringify({ version: 2, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: true, dressings: 2 });
  const storage = makeStorage([[SAVE_KEY, corrupt], [PREVIOUS_SAVE_KEY, oldSave]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.axeUnlocked, true);
  assert.equal(game.dressings, 2);
  const quarantined = storage.keys().filter(key => key.startsWith(`${SAVE_KEY}.corrupt:`));
  assert.equal(quarantined.length, 1);
  assert.match(quarantined[0], /^block-world:save:v5\.corrupt:\d+$/);
  assert.equal(storage.getItem(quarantined[0]), corrupt);
  assert.equal(storage.getItem(SAVE_KEY), corrupt);
});

test("a corrupt v3 save is quarantined under its own key before falling back to v2", () => {
  const corrupt = "{not json";
  const oldSave = JSON.stringify({ version: 2, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: true, dressings: 2 });
  const storage = makeStorage([[V3_SAVE_KEY, corrupt], [PREVIOUS_SAVE_KEY, oldSave]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.axeUnlocked, true);
  assert.equal(game.dressings, 2);
  const quarantined = storage.keys().filter(key => key.startsWith(`${V3_SAVE_KEY}.corrupt:`));
  assert.equal(quarantined.length, 1);
  assert.match(quarantined[0], /^block-world:save:v3\.corrupt:\d+$/);
  assert.equal(storage.getItem(quarantined[0]), corrupt);
  assert.equal(storage.getItem(V3_SAVE_KEY), corrupt);
});

test("a corrupt v4 save with no fallback still quarantines the original", () => {
  const corrupt = "{broken";
  const storage = makeStorage([[SAVE_KEY, corrupt]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.dressings, 0);
  const quarantined = storage.keys().filter(key => key.startsWith(`${SAVE_KEY}.corrupt:`));
  assert.equal(quarantined.length, 1);
  assert.equal(storage.getItem(quarantined[0]), corrupt);
});

test("progress survives a reload and is stored apart from the building save", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  const progress = { wave: 7, kills: 42, bossesDefeated: { boss: true, colossus: true },
    defense: { wave: 5, cleared: true, bestWave: 5 } };
  const expected = { version: 2, wave: 7, kills: 42, bossesDefeated: { boss: true, colossus: true },
    bossKills: {}, bestWave: 7, defense: { wave: 5, cleared: true, bestWave: 5 } };
  assert.deepEqual(game.saveProgress(progress), { saved: true });
  assert.deepEqual(loadProgress(storage), expected);
  assert.deepEqual(game.loadProgress(), expected);
  // The building save is a separate key: progress writes leave it alone,
  // and a block edit leaves the progress alone.
  assert.equal(storage.getItem(SAVE_KEY), null);
  assert.ok(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.deepEqual(loadProgress(storage), expected);
  assert.deepEqual([...createProgression(storage, line(10)).blockEdits()], [[1, BLOCK.AIR]]);
});

test("a corrupt progress save is quarantined before falling back to empty progress", () => {
  const corrupt = "{not json";
  const storage = makeStorage([[PROGRESS_KEY, corrupt]]);
  assert.deepEqual(loadProgress(storage), emptyProgress());
  const quarantined = storage.keys().filter(key => key.startsWith(`${PROGRESS_KEY}.corrupt:`));
  assert.equal(quarantined.length, 1);
  assert.match(quarantined[0], /^block-world:progress:v2\.corrupt:\d+$/);
  assert.equal(storage.getItem(quarantined[0]), corrupt);
  assert.equal(storage.getItem(PROGRESS_KEY), corrupt);
});

test("a progress save with the wrong version falls back empty without quarantining", () => {
  const storage = makeStorage([[PROGRESS_KEY, JSON.stringify({ version: 3, wave: 9, kills: 99 })]]);
  assert.deepEqual(loadProgress(storage), emptyProgress());
  assert.equal(storage.keys().filter(key => key.includes(".corrupt:")).length, 0);
  assert.deepEqual(loadProgress(makeStorage()), emptyProgress());
});

test("progress values are sanitized on save and load", () => {
  const storage = makeStorage();
  assert.deepEqual(saveProgress(storage, { wave: -3, kills: 4.7, bossesDefeated: { boss: "yes", colossus: true, "": true },
    defense: { wave: 2.9, cleared: "yes", bestWave: -1 } }), { saved: true });
  assert.deepEqual(loadProgress(storage), { version: 2, wave: 0, kills: 4, bossesDefeated: { colossus: true },
    bossKills: {}, bestWave: 0, defense: { wave: 2, cleared: false, bestWave: 0 } });
});

test("a progress save that exceeds storage quota reports quota", () => {
  const storage = makeStorage();
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  assert.deepEqual(saveProgress(storage, { wave: 1, kills: 1 }), { saved: false, reason: "quota" });
  assert.deepEqual(saveProgress(null, { wave: 1 }), { saved: false, reason: "error" });
});

test("a stale progress save is refused until the other tab's save is forced over", () => {
  const [tabA, tabB] = makeSharedStorage();
  assert.deepEqual(saveProgress(tabA, { wave: 1, kills: 5 }), { saved: true });
  assert.deepEqual(loadProgress(tabB), { version: 2, wave: 1, kills: 5, bossesDefeated: {}, bossKills: {},
    bestWave: 1, defense: { wave: 0, cleared: false, bestWave: 0 } });
  assert.equal(isProgressStale(tabA), false);
  assert.equal(isProgressStale(tabB), false);
  // Tab A saves again; tab B's snapshot is now behind.
  assert.deepEqual(saveProgress(tabA, { wave: 2, kills: 10 }), { saved: true });
  assert.equal(isProgressStale(tabB), true);
  assert.equal(isProgressStale(tabA), false);
  assert.deepEqual(saveProgress(tabB, { wave: 9, kills: 99 }), { saved: false, reason: "stale" });
  assert.deepEqual(loadProgress(tabA), { version: 2, wave: 2, kills: 10, bossesDefeated: {}, bossKills: {},
    bestWave: 2, defense: { wave: 0, cleared: false, bestWave: 0 } });
  // An explicit force overwrites, and the roles reverse.
  assert.deepEqual(saveProgress(tabB, { wave: 9, kills: 99 }, { force: true }), { saved: true });
  assert.equal(isProgressStale(tabB), false);
  assert.equal(isProgressStale(tabA), true);
  assert.equal(loadProgress(tabA).wave, 9);
  assert.equal(loadProgress(tabA).kills, 99);
});

test("a progress save with no prior load claims the key", () => {
  const [tabA, tabB] = makeSharedStorage();
  assert.deepEqual(saveProgress(tabA, { wave: 3 }), { saved: true });
  // Tab B never loaded, so it has no baseline to be stale against: its
  // first save claims the key. Callers that need protection must load
  // first (startWorld does).
  assert.equal(isProgressStale(tabB), false);
  assert.deepEqual(saveProgress(tabB, { wave: 1 }), { saved: true });
  assert.equal(loadProgress(tabA).wave, 1);
});

test("a stale progress save never reaches the quota path, and force still can", () => {
  const [tabA, tabB] = makeSharedStorage();
  assert.deepEqual(saveProgress(tabA, { wave: 1 }), { saved: true });
  assert.deepEqual(loadProgress(tabB).wave, 1);
  assert.deepEqual(saveProgress(tabA, { wave: 2 }), { saved: true });
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  tabB.setItem = () => { throw quota; };
  assert.deepEqual(saveProgress(tabB, { wave: 9 }), { saved: false, reason: "stale" });
  assert.deepEqual(saveProgress(tabB, { wave: 9 }, { force: true }), { saved: false, reason: "quota" });
  assert.equal(isProgressStale(tabB), true);
  assert.equal(isProgressStale(null), false);
});

test("a corrupt progress save still quarantines and the recovery save is not blocked", () => {
  const [tabA, tabB] = makeSharedStorage();
  tabA.setItem(PROGRESS_KEY, "{broken");
  assert.deepEqual(loadProgress(tabB), emptyProgress());
  const quarantined = tabB.keys().filter(key => key.startsWith(`${PROGRESS_KEY}.corrupt:`));
  assert.equal(quarantined.length, 1);
  // The corrupt text is the snapshot now, so saving the recovery is not stale.
  assert.equal(isProgressStale(tabB), false);
  assert.deepEqual(saveProgress(tabB, { wave: 1 }), { saved: true });
  assert.equal(loadProgress(tabA).wave, 1);
});

test("the campaign instance exposes progress staleness and force saves", () => {
  const [tabA, tabB] = makeSharedStorage();
  const first = createProgression(tabA, line(10)), second = createProgression(tabB, line(10));
  assert.deepEqual(first.saveProgress({ wave: 1, kills: 2 }), { saved: true });
  assert.equal(second.loadProgress().wave, 1);
  assert.equal(second.progressStale, false);
  assert.deepEqual(first.saveProgress({ wave: 2, kills: 4 }), { saved: true });
  assert.equal(second.progressStale, true);
  assert.deepEqual(second.saveProgress({ wave: 5 }), { saved: false, reason: "stale" });
  assert.deepEqual(second.saveProgress({ wave: 5 }, { force: true }), { saved: true });
  assert.equal(second.progressStale, false);
  assert.equal(first.progressStale, true);
  assert.equal(first.loadProgress().wave, 5);
});

test("a save that exceeds storage quota reports quota instead of a generic failure", () => {
  const storage = makeStorage();
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  const game = createProgression(storage, line(10));
  assert.deepEqual(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true), { saved: false, reason: "quota" });
});

test("a quota failure rolls back crafting, loot, spending and dressings", () => {
  const seed = JSON.stringify({ version: 4, edits: [], materials: [0, 0, 10, 3, 2, 2], axeUnlocked: false,
    dressings: { dressing: 1, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[V4_SAVE_KEY, seed]]);
  const game = createProgression(storage, line(10));
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  const realSetItem = storage.setItem;
  storage.setItem = () => { throw quota; };
  assert.deepEqual(game.craft("axe"), { saved: false, reason: "quota" });
  assert.equal(game.axeUnlocked, false);
  assert.equal(game.count(BLOCK.STONE), 3);
  assert.equal(game.count(BLOCK.WOOD), 2);
  assert.deepEqual(game.grantLoot(), { saved: false, reason: "quota" });
  assert.equal(game.count(BLOCK.STONE), 3);
  assert.equal(game.count(BLOCK.LEAF), 2);
  assert.deepEqual(game.spendMaterial(BLOCK.STONE, 1), { saved: false, reason: "quota" });
  assert.equal(game.count(BLOCK.STONE), 3);
  assert.deepEqual(game.useDressing(), { saved: false, reason: "quota" });
  assert.equal(game.dressings, 1);
  // Nothing reached the disk, and the rolled-back craft can be retried
  // once storage works again.
  const reloaded = createProgression(storage, line(10));
  assert.equal(reloaded.axeUnlocked, false);
  assert.equal(reloaded.dressings, 1);
  assert.equal(reloaded.count(BLOCK.STONE), 3);
  storage.setItem = realSetItem;
  assert.ok(game.craft("axe").saved);
  assert.equal(game.axeUnlocked, true);
});

test("a quota failure rolls back a block edit and its materials", () => {
  const storage = makeStorage();
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  const game = createProgression(storage, line(10));
  assert.deepEqual(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true), { saved: false, reason: "quota" });
  assert.equal(game.count(BLOCK.WOOD), 2);
  assert.deepEqual([...game.blockEdits()], []);
  assert.deepEqual(game.editBlock(2, BLOCK.AIR, BLOCK.DIRT, true), { saved: false, reason: "quota" });
  assert.equal(game.count(BLOCK.DIRT), 10);
  assert.deepEqual([...game.blockEdits()], []);
});

test("a generic save error also rolls back crafting and keeps its reason", () => {
  const seed = JSON.stringify({ version: 4, edits: [], materials: [0, 0, 10, 3, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[V4_SAVE_KEY, seed]]);
  storage.setItem = () => { throw new Error("disk gone"); };
  const game = createProgression(storage, line(10));
  assert.deepEqual(game.craft("axe"), { saved: false, reason: "error" });
  assert.equal(game.axeUnlocked, false);
  assert.equal(game.count(BLOCK.STONE), 3);
  assert.equal(game.count(BLOCK.WOOD), 2);
});

test("rapid block edits batch into one write and flush on demand", () => {
  let writes = 0;
  const storage = makeStorage();
  const counting = { ...storage, setItem(key, value) { if (key === SAVE_KEY) writes++; storage.setItem(key, value); } };
  const game = createProgression(counting, line(20));
  assert.ok(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.equal(writes, 1);
  assert.ok(game.editBlock(2, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.ok(game.editBlock(3, BLOCK.WOOD, BLOCK.AIR, true).saved);
  // The two follow-ups are still batched: no second write yet.
  assert.equal(writes, 1);
  assert.equal(game.pendingSave, true);
  assert.deepEqual(game.flush(), { saved: true });
  assert.equal(writes, 2);
  assert.equal(game.pendingSave, false);
  const reloaded = createProgression(storage, line(20));
  assert.deepEqual([...reloaded.blockEdits()], [[1, BLOCK.AIR], [2, BLOCK.AIR], [3, BLOCK.AIR]]);
});

test("an outdated tab cannot overwrite a newer save", () => {
  const storage = makeStorage();
  const first = createProgression(storage, line(10)), outdated = createProgression(storage, line(10));
  assert.ok(first.editBlock(2, BLOCK.AIR, BLOCK.WOOD, true).saved);
  assert.deepEqual(outdated.editBlock(5, BLOCK.AIR, BLOCK.DIRT, true), { saved: false, conflict: true });
  assert.equal(outdated.count(BLOCK.DIRT), 10);
  assert.deepEqual([...outdated.blockEdits()], []);
  assert.deepEqual([...createProgression(storage, line(10)).blockEdits()], [[2, BLOCK.WOOD]]);
});

test("a stale inventory restores ingredients, crafted items, and loot", () => {
  const storage = makeStorage();
  const first = createProgression(storage, line(10));
  for (let i = 0; i < 3; i++) first.grantLoot();
  first.craft("dressing");
  const second = createProgression(storage, line(10));
  first.spendMaterial(BLOCK.STONE, 1);
  assert.equal(second.stale, true);
  assert.equal(second.craft("axe").conflict, true);
  assert.equal(second.axeUnlocked, false);
  assert.equal(second.useDressing().conflict, true);
  assert.equal(second.dressings, 1);
  assert.equal(second.grantLoot().conflict, true);
  assert.equal(second.count(BLOCK.STONE), 3);
  assert.equal(second.count(BLOCK.LEAF), 1);
});

test("checkConflict latches a pending decision that refused edits keep pending", () => {
  const storage = makeStorage();
  const first = createProgression(storage, line(10)), second = createProgression(storage, line(10));
  assert.equal(second.checkConflict(), false);
  assert.equal(second.pendingConflict, null);
  assert.ok(first.editBlock(2, BLOCK.AIR, BLOCK.WOOD, true).saved);
  assert.equal(second.checkConflict(), true);
  const pending = second.pendingConflict;
  assert.equal(typeof pending?.detectedAt, "number");
  // Polling again does not re-stamp the decision.
  assert.equal(second.checkConflict(), true);
  assert.deepEqual(second.pendingConflict, pending);
  // While the decision is pending, edits are refused and nothing lands.
  assert.deepEqual(second.editBlock(5, BLOCK.AIR, BLOCK.DIRT, true), { saved: false, conflict: true });
  assert.equal(second.count(BLOCK.DIRT), 10);
  assert.deepEqual([...second.blockEdits()], []);
  assert.deepEqual(second.pendingConflict, pending);
  // The pending state is a copy: mutating it does not clear the real one.
  pending.detectedAt = 0;
  assert.notEqual(second.pendingConflict.detectedAt, 0);
});

test("keepLocal overwrites the remote save with the local session", () => {
  // Both tabs load the same seeded save; the first tab then saves a newer
  // one, so the second tab's memory (the seeded save) is what keepLocal
  // must write back over it.
  const seed = JSON.stringify({ version: 4, edits: [[1, 0, 0, BLOCK.AIR]], materials: [0, 0, 10, 1, 3, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[V4_SAVE_KEY, seed]]);
  const first = createProgression(storage, line(10)), second = createProgression(storage, line(10));
  assert.ok(first.editBlock(2, BLOCK.AIR, BLOCK.DIRT, true).saved);
  assert.equal(second.checkConflict(), true);
  assert.ok(second.pendingConflict);
  assert.deepEqual(second.keepLocal(), { saved: true });
  assert.equal(second.pendingConflict, null);
  // The disk now holds the second tab's loaded session, not the first's.
  const saved = JSON.parse(storage.getItem(SAVE_KEY));
  assert.deepEqual(saved.edits, [[1, 0, 0, BLOCK.AIR]]);
  assert.equal(saved.materials[BLOCK.WOOD], 3);
  assert.equal(saved.materials[BLOCK.STONE], 1);
  assert.equal(saved.materials[BLOCK.DIRT], 10);
  const reloaded = createProgression(storage, line(10));
  assert.deepEqual([...reloaded.blockEdits()], [[1, BLOCK.AIR]]);
  assert.equal(reloaded.count(BLOCK.WOOD), 3);
  // The first tab now faces the decision, and the second can save again.
  assert.equal(first.stale, true);
  assert.equal(first.checkConflict(), true);
  assert.ok(first.pendingConflict);
  assert.ok(second.editBlock(3, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.deepEqual(second.flush(), { saved: true });
  assert.deepEqual([...createProgression(storage, line(10)).blockEdits()], [[1, BLOCK.AIR], [3, BLOCK.AIR]]);
});

test("keepLocal reports quota and leaves the decision pending", () => {
  const seed = JSON.stringify({ version: 4, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, seed]]);
  const first = createProgression(storage, line(10)), second = createProgression(storage, line(10));
  assert.ok(first.editBlock(2, BLOCK.AIR, BLOCK.DIRT, true).saved);
  assert.equal(second.checkConflict(), true);
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  assert.deepEqual(second.keepLocal(), { saved: false, reason: "quota" });
  assert.ok(second.pendingConflict);
  // Memory and disk are untouched: the decision can still be taken later.
  assert.deepEqual([...second.blockEdits()], []);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)).edits, [[2, 0, 0, BLOCK.DIRT]]);
});

test("loadRemote discards local edits and rebuilds from the remote save", () => {
  const seed = JSON.stringify({ version: 4, edits: [[1, 0, 0, BLOCK.AIR]], materials: [0, 0, 10, 0, 3, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[V4_SAVE_KEY, seed]]);
  const first = createProgression(storage, line(10)), second = createProgression(storage, line(10));
  assert.ok(first.editBlock(2, BLOCK.AIR, BLOCK.DIRT, true).saved);
  assert.equal(second.checkConflict(), true);
  assert.deepEqual(second.loadRemote(), { loaded: true });
  assert.equal(second.pendingConflict, null);
  // The local session (seeded save) is gone; the remote save is in force.
  assert.deepEqual([...second.blockEdits()], [[1, BLOCK.AIR], [2, BLOCK.DIRT]]);
  assert.equal(second.count(BLOCK.WOOD), 3);
  assert.equal(second.count(BLOCK.STONE), 0);
  assert.equal(second.count(BLOCK.DIRT), 9);
  const reloaded = createProgression(storage, line(10));
  assert.deepEqual([...reloaded.blockEdits()], [[1, BLOCK.AIR], [2, BLOCK.DIRT]]);
  // The tab can save again, and its next edit claims the save.
  assert.ok(second.editBlock(3, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.deepEqual(second.flush(), { saved: true });
  assert.deepEqual([...createProgression(storage, line(10)).blockEdits()],
    [[1, BLOCK.AIR], [2, BLOCK.DIRT], [3, BLOCK.AIR]]);
});

test("loadRemote drops unflushed batched edits instead of resurrecting them", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  assert.ok(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true).saved);
  // A rapid follow-up edit is batched: in memory and dirty, not on disk.
  assert.ok(game.editBlock(2, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.equal(game.pendingSave, true);
  assert.deepEqual([...game.blockEdits()], [[1, BLOCK.AIR], [2, BLOCK.AIR]]);
  // Another tab's save lands (simulated by writing storage directly).
  const remote = JSON.stringify({ version: 5, edits: [[5, 0, 0, BLOCK.DIRT]], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  storage.setItem(SAVE_KEY, remote);
  assert.equal(game.checkConflict(), true);
  assert.deepEqual(game.loadRemote(), { loaded: true });
  assert.equal(game.pendingSave, false);
  assert.deepEqual([...game.blockEdits()], [[5, BLOCK.DIRT]]);
  assert.equal(game.count(BLOCK.WOOD), 2);
  // A later flush must not bring the discarded edits back.
  assert.ok(game.editBlock(6, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.deepEqual(game.flush(), { saved: true });
  assert.deepEqual([...createProgression(storage, line(10)).blockEdits()], [[5, BLOCK.DIRT], [6, BLOCK.AIR]]);
});

test("loadRemote quarantines a corrupt remote v4 and falls back to v2", () => {
  const oldSave = JSON.stringify({ version: 2, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: true, dressings: 2 });
  const storage = makeStorage([[PREVIOUS_SAVE_KEY, oldSave]]);
  const first = createProgression(storage, line(10));
  assert.ok(first.editBlock(2, BLOCK.AIR, BLOCK.DIRT, true).saved);
  const second = createProgression(storage, line(10));
  storage.setItem(SAVE_KEY, "{broken");
  assert.equal(second.checkConflict(), true);
  assert.deepEqual(second.loadRemote(), { loaded: true });
  assert.equal(second.pendingConflict, null);
  assert.equal(second.axeUnlocked, true);
  assert.equal(second.dressings, 2);
  assert.deepEqual([...second.blockEdits()], []);
  const quarantined = storage.keys().filter(key => key.startsWith(`${SAVE_KEY}.corrupt:`));
  assert.equal(quarantined.length, 1);
  assert.equal(storage.getItem(quarantined[0]), "{broken");
});

test("loadRemote with broken storage reports the failure and keeps the session", () => {
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  const game = createProgression(blocked, line(10));
  assert.deepEqual(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true), { saved: false, reason: "error" });
  assert.equal(game.count(BLOCK.WOOD), 3);
  assert.deepEqual(game.loadRemote(), { loaded: false, reason: "error" });
  assert.equal(game.count(BLOCK.WOOD), 3);
  assert.deepEqual([...game.blockEdits()], [[1, BLOCK.AIR]]);
  assert.equal(game.pendingConflict, null);
});

test("conflict decisions without storage report an error", () => {
  const game = createProgression(null, line(10));
  assert.deepEqual(game.keepLocal(), { saved: false, reason: "error" });
  assert.deepEqual(game.loadRemote(), { loaded: false, reason: "error" });
  assert.equal(game.checkConflict(), false);
  assert.equal(game.pendingConflict, null);
});

test("spending stone on a repair debits exactly once and persists", () => {
  const storage = makeStorage(), game = createProgression(storage, line(10));
  for (let i = 0; i < 3; i++) game.grantLoot();
  assert.equal(game.spendMaterial(BLOCK.STONE, 4), null);
  assert.equal(game.spendMaterial(BLOCK.STONE, -1), null);
  assert.equal(game.count(BLOCK.STONE), 3);
  assert.ok(game.spendMaterial(BLOCK.STONE, 3).saved);
  assert.equal(game.spendMaterial(BLOCK.STONE, 3), null);
  assert.equal(createProgression(storage, line(10)).count(BLOCK.STONE), 0);
});

test("v2 buildings, equipped recipes and supplies migrate to stable coordinates", () => {
  const oldCell = voxelIndex(LEGACY_WORLD, 25, 9, 27);
  const oldSave = JSON.stringify({ version: 2, edits: [[oldCell, BLOCK.WOOD]], materials: [0, 7, 12, 8, 3, 2], axeUnlocked: true, dressings: 4 });
  const storage = makeStorage([[PREVIOUS_SAVE_KEY, oldSave]]);
  const current = createProgression(storage, WORLD);
  assert.deepEqual([...current.blockEdits()], [[voxelIndex(WORLD, 25, 9, 27), BLOCK.WOOD]]);
  assert.equal(current.count(BLOCK.STONE), 8);
  assert.equal(current.axeUnlocked, true);
  assert.equal(current.dressings, 4);
  assert.ok(current.editBlock(voxelIndex(WORLD, -11, 5, -7), BLOCK.AIR, BLOCK.DIRT, true).saved);
  assert.equal(storage.getItem(PREVIOUS_SAVE_KEY), oldSave);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)).edits, [[25, 9, 27, BLOCK.WOOD], [-11, 5, -7, BLOCK.DIRT]]);

  const bigger = { ...WORLD, minX: -32, minZ: -32, width: 96, depth: 96 };
  const restored = createProgression(storage, bigger);
  assert.deepEqual([...restored.blockEdits()], [
    [voxelIndex(bigger, 25, 9, 27), BLOCK.WOOD], [voxelIndex(bigger, -11, 5, -7), BLOCK.DIRT]
  ]);
  assert.equal(restored.count(BLOCK.DIRT), 11);
});

test("the migration table lists v5, v4, v3, v2 and v1 newest first, with one version each", () => {
  assert.deepEqual(SAVE_MIGRATIONS.map(entry => entry.version), [5, 4, 3, 2, 1]);
  assert.deepEqual(SAVE_MIGRATIONS.map(entry => entry.key), [SAVE_KEY, V4_SAVE_KEY, V3_SAVE_KEY, PREVIOUS_SAVE_KEY, LEGACY_KEY]);
  assert.equal(SAVE_VERSION, 5);
  assert.equal(SAVE_VERSION, SAVE_MIGRATIONS[0].version);
  assert.equal(PROGRESS_VERSION, 2);
  assert.ok(Object.isFrozen(SAVE_MIGRATIONS));
  assert.equal(new Set(SAVE_MIGRATIONS.map(entry => entry.version)).size, 5);
  // A fresh save is written with the table's newest version.
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  assert.ok(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version, SAVE_VERSION);
});

test("progression re-exports the recipes registry from recipes.mjs unchanged", () => {
  assert.equal(RECIPES, RECIPES_FROM_REGISTRY);
  assert.equal(BLOCK, BLOCK_FROM_REGISTRY);
  assert.deepEqual(Object.keys(RECIPES), ["axe", "dressing", "bandage", "bigDressing", "fertilizer", "wateringCan", "workbench", "stoneArmor", "stonePickaxe",
    "emberSword", "emberAxe", "starSword", "starAxe", "emberArmor", "starArmor", "emberPickaxe", "starPickaxe",
    "bakedWheat", "veggieSalad", "stew"]);
  assert.deepEqual(RECIPES, {
    axe: { name: "石斧", cost: [[BLOCK.STONE, 3], [BLOCK.WOOD, 2]] },
    dressing: { name: "树叶敷料", cost: [[BLOCK.LEAF, 2]], healing: 30 },
    bandage: { name: "树皮绷带", cost: [[BLOCK.WOOD, 2], [BLOCK.LEAF, 1]], healing: 20 },
    bigDressing: { name: "树叶大敷料", cost: [[BLOCK.LEAF, 4]], healing: 50 },
    fertilizer: { name: "腐叶", cost: [[BLOCK.LEAF, 2], [BLOCK.DIRT, 1]] },
    wateringCan: { name: "洒水壶", cost: [[BLOCK.WOOD, 3], [BLOCK.LEAF, 2]] },
    workbench: { name: "工作台", cost: [[BLOCK.STONE, 5], [BLOCK.WOOD, 5]] },
    stoneArmor: { name: "石甲", cost: [[BLOCK.STONE, 6], [BLOCK.WOOD, 2]], equipment: "armor", tier: "stone" },
    stonePickaxe: { name: "石镐", cost: [[BLOCK.STONE, 3], [BLOCK.WOOD, 2]], equipment: "tool", tier: "stone" },
    emberSword: { name: "熔火剑", cost: [[BLOCK.STONE, 8], [BLOCK.WOOD, 4], ["emberCore", 2]], equipment: "weapon", tier: "ember" },
    emberAxe: { name: "熔火斧", cost: [[BLOCK.STONE, 8], [BLOCK.WOOD, 4], ["emberCore", 2]], equipment: "weapon", tier: "ember" },
    starSword: { name: "断星剑", cost: [[BLOCK.STONE, 10], [BLOCK.WOOD, 4], ["starShard", 2], ["emberCore", 1]], equipment: "weapon", tier: "star" },
    starAxe: { name: "断星斧", cost: [[BLOCK.STONE, 10], [BLOCK.WOOD, 4], ["starShard", 2], ["emberCore", 1]], equipment: "weapon", tier: "star" },
    emberArmor: { name: "熔火甲", cost: [[BLOCK.STONE, 8], [BLOCK.WOOD, 2], ["emberCore", 2]], equipment: "armor", tier: "ember" },
    starArmor: { name: "断星甲", cost: [[BLOCK.STONE, 10], [BLOCK.WOOD, 2], ["starShard", 2], ["emberCore", 1]], equipment: "armor", tier: "star" },
    emberPickaxe: { name: "熔火镐", cost: [[BLOCK.STONE, 8], [BLOCK.WOOD, 2], ["emberCore", 2]], equipment: "tool", tier: "ember" },
    starPickaxe: { name: "断星镐", cost: [[BLOCK.STONE, 10], [BLOCK.WOOD, 2], ["starShard", 2], ["emberCore", 1]], equipment: "tool", tier: "star" },
    bakedWheat: { name: "烤麦饼", cost: [["wheat", 2]], healing: 40, cooking: true },
    veggieSalad: { name: "果蔬沙拉", cost: [[BLOCK.LEAF, 2], ["wheat", 1]], healing: 25, cooking: true,
      buff: { kind: "speed", pct: 10, seconds: 30 } },
    stew: { name: "炖菜", cost: [["wheat", 2], [BLOCK.WOOD, 1]], healing: 60, cooking: true,
      buff: { kind: "attack", pct: 10, seconds: 30 } }
  });
  assert.ok(Object.isFrozen(RECIPES));
  assert.deepEqual(BLOCK, { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAF: 5 });
  assert.ok(Object.isFrozen(BLOCK));
});

test("validateRecipes accepts the shipped recipe table", () => {
  assert.deepEqual(validateRecipes(), { valid: true, errors: [] });
  assert.deepEqual(validateRecipes(RECIPES), { valid: true, errors: [] });
  // A recipe with no healing needs no cost, and zero healing is not healing.
  assert.deepEqual(validateRecipes({ plain: { name: "普通", cost: [[BLOCK.STONE, 1]] } }), { valid: true, errors: [] });
  assert.deepEqual(validateRecipes({ freebie: { name: "赠品" } }), { valid: true, errors: [] });
  assert.deepEqual(validateRecipes({ zero: { name: "零回血", healing: 0 } }), { valid: true, errors: [] });
});

test("validateRecipes rejects unregistered blocks, costless healing and duplicate names", () => {
  assert.deepEqual(validateRecipes({ bad: { name: "坏配方", cost: [[9, 1]] } }),
    { valid: false, errors: ["bad：cost 引用未注册方块 9"] });
  assert.deepEqual(validateRecipes({ free: { name: "白嫖药", cost: [], healing: 10 } }),
    { valid: false, errors: ["free：回血配方没有 cost"] });
  assert.deepEqual(validateRecipes({ free: { name: "白嫖药", healing: 10 } }),
    { valid: false, errors: ["free：回血配方没有 cost"] });
  const duplicated = validateRecipes({
    a: { name: "同名", cost: [[BLOCK.LEAF, 1]] },
    b: { name: "同名", cost: [[BLOCK.WOOD, 1]] }
  });
  assert.equal(duplicated.valid, false);
  assert.deepEqual(duplicated.errors, ["b：配方名“同名”与 a 重复"]);
  // Every problem is reported at once, not just the first.
  const broken = validateRecipes({
    bad: { name: "坏配方", cost: [[9, 1]], healing: 5 },
    twin: { name: "坏配方", cost: [], healing: 5 }
  });
  assert.equal(broken.valid, false);
  assert.deepEqual(broken.errors, ["bad：cost 引用未注册方块 9", "twin：回血配方没有 cost", "twin：配方名“坏配方”与 bad 重复"]);
  assert.deepEqual(validateRecipes(null), { valid: false, errors: ["配方表不是对象"] });
});

test("a v4 save with the wrong version falls back to v2", () => {
  const wrongVersion = JSON.stringify({ version: 2, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: false, dressings: 0 });
  const oldSave = JSON.stringify({ version: 2, edits: [], materials: [0, 0, 10, 5, 2, 1], axeUnlocked: true, dressings: 3 });
  const storage = makeStorage([[SAVE_KEY, wrongVersion], [PREVIOUS_SAVE_KEY, oldSave]]);
  const game = createProgression(storage, WORLD);
  assert.equal(game.axeUnlocked, true);
  assert.equal(game.dressings, 3);
  assert.equal(game.count(BLOCK.STONE), 5);
  assert.equal(game.count(BLOCK.LEAF), 1);
});

test("a v3 save with malformed edits keeps its supplies and takes edits from v2", () => {
  const oldCell = voxelIndex(LEGACY_WORLD, 25, 9, 27);
  const broken = JSON.stringify({ version: 3, edits: "nope", materials: [0, 0, 10, 5, 2, 0], axeUnlocked: false, dressings: 1 });
  const oldSave = JSON.stringify({ version: 2, edits: [[oldCell, BLOCK.WOOD]], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: true, dressings: 0 });
  const storage = makeStorage([[V3_SAVE_KEY, broken], [PREVIOUS_SAVE_KEY, oldSave]]);
  const game = createProgression(storage, WORLD);
  assert.deepEqual([...game.blockEdits()], [[voxelIndex(WORLD, 25, 9, 27), BLOCK.WOOD]]);
  assert.equal(game.count(BLOCK.STONE), 5);
  assert.equal(game.dressings, 1);
  assert.equal(game.axeUnlocked, false);
});

test("a v2 save with the wrong version falls back to legacy edits", () => {
  const wrongVersion = JSON.stringify({ version: 3, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: true, dressings: 9 });
  const legacy = JSON.stringify([[2, BLOCK.WOOD], [9, BLOCK.AIR]]);
  const storage = makeStorage([[PREVIOUS_SAVE_KEY, wrongVersion], [LEGACY_KEY, legacy]]);
  const game = createProgression(storage, line(20));
  assert.deepEqual([...game.blockEdits()], [[2, BLOCK.WOOD], [9, BLOCK.AIR]]);
  assert.equal(game.axeUnlocked, false);
  assert.equal(game.dressings, 0);
  assert.equal(game.count(BLOCK.DIRT), 10);
});

test("a v2 save with malformed edits takes its edits from legacy", () => {
  const oldSave = JSON.stringify({ version: 2, edits: "nope", materials: [0, 0, 10, 4, 2, 0], axeUnlocked: true, dressings: 2 });
  const legacy = JSON.stringify([[2, BLOCK.WOOD], [9, BLOCK.AIR]]);
  const storage = makeStorage([[PREVIOUS_SAVE_KEY, oldSave], [LEGACY_KEY, legacy]]);
  const game = createProgression(storage, line(20));
  assert.deepEqual([...game.blockEdits()], [[2, BLOCK.WOOD], [9, BLOCK.AIR]]);
  assert.equal(game.count(BLOCK.STONE), 4);
  assert.equal(game.axeUnlocked, true);
  assert.equal(game.dressings, 2);
});

test("a corrupt legacy save loads with starter supplies", () => {
  const storage = makeStorage([[LEGACY_KEY, "{broken"]]);
  const game = createProgression(storage, line(10));
  assert.deepEqual([...game.blockEdits()], []);
  assert.equal(game.count(BLOCK.DIRT), 10);
  assert.equal(game.count(BLOCK.WOOD), 2);
  assert.equal(game.axeUnlocked, false);
  assert.equal(game.dressings, 0);
});

test("a migrating save watches the older keys, a current save does not", () => {
  const oldSave = JSON.stringify({ version: 2, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false, dressings: 0 });
  const storage = makeStorage([[PREVIOUS_SAVE_KEY, oldSave]]);
  const migrating = createProgression(storage, line(10));
  assert.equal(migrating.stale, false);
  storage.setItem(PREVIOUS_SAVE_KEY, JSON.stringify({ version: 2, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: true, dressings: 0 }));
  assert.equal(migrating.stale, true);

  const v5 = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage2 = makeStorage([[SAVE_KEY, v5], [PREVIOUS_SAVE_KEY, oldSave]]);
  const settled = createProgression(storage2, line(10));
  assert.equal(settled.stale, false);
  storage2.setItem(PREVIOUS_SAVE_KEY, JSON.stringify({ version: 2, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: true, dressings: 0 }));
  storage2.setItem(LEGACY_KEY, "[]");
  assert.equal(settled.stale, false);
});

test("loadRemote rebuilds from a legacy-only save", () => {
  const v5 = JSON.stringify({ version: 5, edits: [[1, 0, 0, BLOCK.DIRT]], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const legacy = JSON.stringify([[2, BLOCK.WOOD], [9, BLOCK.AIR]]);
  const storage = makeStorage([[SAVE_KEY, v5], [LEGACY_KEY, legacy]]);
  const game = createProgression(storage, line(20));
  assert.deepEqual([...game.blockEdits()], [[1, BLOCK.DIRT]]);
  // The remote save is replaced by a legacy-only save: v4 gone, v3/v2 absent.
  storage.setItem(SAVE_KEY, null);
  assert.equal(game.checkConflict(), true);
  assert.deepEqual(game.loadRemote(), { loaded: true });
  assert.deepEqual([...game.blockEdits()], [[2, BLOCK.WOOD], [9, BLOCK.AIR]]);
  assert.equal(game.count(BLOCK.DIRT), 10);
  assert.equal(game.pendingConflict, null);
});

test("a v3 save migrates its dressing number into the per-recipe object", () => {
  const v3 = JSON.stringify({ version: 3, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false, dressings: 3 });
  const storage = makeStorage([[V3_SAVE_KEY, v3]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.dressings, 3);
  assert.deepEqual(game.dressingsByRecipe, { dressing: 3, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  // The next write upgrades the save to v5 with the object shape.
  assert.ok(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true).saved);
  const written = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(written.version, 5);
  assert.deepEqual(written.dressings, { dressing: 3, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  const reloaded = createProgression(storage, line(10));
  assert.deepEqual(reloaded.dressingsByRecipe, { dressing: 3, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  assert.equal(storage.getItem(V3_SAVE_KEY), v3);
});

test("a v2 save migrates its dressing number the same way", () => {
  const oldSave = JSON.stringify({ version: 2, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false, dressings: 2 });
  const storage = makeStorage([[PREVIOUS_SAVE_KEY, oldSave]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.dressings, 2);
  assert.deepEqual(game.dressingsByRecipe, { dressing: 2, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
});

test("a v4 save round-trips per-recipe counts and sanitizes bad values", () => {
  const v4 = JSON.stringify({ version: 4, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 1, bandage: 2, bigDressing: 0, unknown: 9 } });
  const storage = makeStorage([[V4_SAVE_KEY, v4]]);
  const game = createProgression(storage, line(10));
  // Unknown keys are dropped.
  assert.deepEqual(game.dressingsByRecipe, { dressing: 1, bandage: 2, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  const dirty = JSON.stringify({ version: 4, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: -3, bandage: 2000, bigDressing: 1 } });
  const storage2 = makeStorage([[V4_SAVE_KEY, dirty]]);
  const loaded = createProgression(storage2, line(10));
  assert.deepEqual(loaded.dressingsByRecipe, { dressing: 0, bandage: 999, bigDressing: 1, bakedWheat: 0, veggieSalad: 0, stew: 0 });
});

test("crafting counts healing items per recipe and useDressing heals per key", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  for (let i = 0; i < 4; i++) game.grantLoot();
  assert.ok(game.craft("dressing").saved);
  assert.ok(game.craft("bandage").saved);
  for (let i = 0; i < 3; i++) game.grantLoot();
  assert.ok(game.craft("bigDressing").saved);
  assert.deepEqual(game.dressingsByRecipe, { dressing: 1, bandage: 1, bigDressing: 1, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  // campaign.dressings stays the dressing count only, for the existing HUD.
  assert.equal(game.dressings, 1);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)).dressings, { dressing: 1, bandage: 1, bigDressing: 1, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  const reloaded = createProgression(storage, line(10));
  assert.deepEqual(reloaded.dressingsByRecipe, { dressing: 1, bandage: 1, bigDressing: 1, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  assert.deepEqual(reloaded.useDressing("bandage"), { saved: true, healed: 20 });
  assert.deepEqual(reloaded.useDressing("bigDressing"), { saved: true, healed: 50 });
  assert.deepEqual(reloaded.useDressing(), { saved: true, healed: 30 });
  assert.deepEqual(reloaded.dressingsByRecipe, { dressing: 0, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  assert.equal(reloaded.useDressing("bandage"), null);
  assert.equal(reloaded.useDressing("axe"), null);
  assert.equal(reloaded.useDressing("nope"), null);
});

test("the 急救 tech adds 10 healing to every dressing use", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  for (let i = 0; i < 4; i++) game.grantLoot();
  assert.ok(game.craft("dressing").saved);
  assert.ok(game.craft("bandage").saved);
  for (let i = 0; i < 3; i++) game.grantLoot();
  assert.ok(game.craft("bigDressing").saved);
  // A second dressing, so one use can be spent before the unlock.
  for (let i = 0; i < 2; i++) game.grantLoot();
  assert.ok(game.craft("dressing").saved);
  // Without the tech, the recipe amounts are unchanged.
  assert.deepEqual(game.useDressing(), { saved: true, healed: 30 });
  // 100 lifetime kills open 急救; the bonus applies to all three.
  const progress = JSON.stringify({ version: 2, wave: 0, kills: 100, bossesDefeated: {}, bossKills: {},
    bestWave: 0, defense: { wave: 0, cleared: false, bestWave: 0 } });
  storage.setItem(PROGRESS_KEY, progress);
  assert.ok(game.unlockTech("firstAid").saved);
  assert.deepEqual(game.useDressing("bandage"), { saved: true, healed: 30 });
  assert.deepEqual(game.useDressing(), { saved: true, healed: 40 });
  assert.deepEqual(game.useDressing("bigDressing"), { saved: true, healed: 60 });
});

test("HEALING_KEYS lists the healing recipes in table order", () => {
  // The UI enumerates the backpack from this, so a new healing recipe
  // shows up without touching game.js.
  assert.deepEqual(HEALING_KEYS, ["dressing", "bandage", "bigDressing", "bakedWheat", "veggieSalad", "stew"]);
});

test("a quota failure rolls back per-recipe dressing counts", () => {
  const seed = JSON.stringify({ version: 4, edits: [], materials: [0, 0, 10, 0, 2, 1], axeUnlocked: false,
    dressings: { dressing: 1, bandage: 1, bigDressing: 0 } });
  const storage = makeStorage([[V4_SAVE_KEY, seed]]);
  const game = createProgression(storage, line(10));
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  assert.deepEqual(game.craft("bandage"), { saved: false, reason: "quota" });
  assert.deepEqual(game.dressingsByRecipe, { dressing: 1, bandage: 1, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  assert.equal(game.count(BLOCK.WOOD), 2);
  assert.equal(game.count(BLOCK.LEAF), 1);
  assert.deepEqual(game.useDressing("bandage"), { saved: false, reason: "quota" });
  assert.equal(game.dressingsByRecipe.bandage, 1);
});

test("assertValidRecipes throws on a bad table at startup", () => {
  assert.equal(assertValidRecipes(), true);
  assert.equal(assertValidRecipes(RECIPES), true);
  assert.throws(() => assertValidRecipes({ bad: { name: "坏配方", cost: [[9, 1]] } }), /配方表校验失败/);
  assert.throws(() => assertValidRecipes({ free: { name: "白嫖药", healing: 10 } }), /配方表校验失败/);
});

test("COOKING_KEYS lists the three dishes in table order", () => {
  assert.deepEqual(COOKING_KEYS, ["bakedWheat", "veggieSalad", "stew"]);
});

test("cooking needs the workbench, spends its costs and heals per dish", () => {
  // A v5 save with wheat in the farm counts and the blocks the dishes
  // and the workbench spend — but no workbench yet.
  const save = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 10, 10, 10], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 },
    seeds: { wheatSeed: 0, wheat: 6, fertilizer: 0 }, workbenchBuilt: false });
  const storage = makeStorage([[SAVE_KEY, save]]);
  const game = createProgression(storage, line(10));
  // No workbench: every dish is locked, crafting spends nothing.
  for (const key of COOKING_KEYS) {
    assert.equal(game.canCraft(key), false, `${key} must need the workbench`);
    assert.equal(game.craft(key), null);
  }
  assert.equal(game.count("wheat"), 6);
  assert.equal(game.count(BLOCK.LEAF), 10);
  // Build the workbench (stone 5 + wood 5), then each dish crafts.
  assert.ok(game.craft("workbench").saved);
  assert.equal(game.canCraft("bakedWheat"), true);
  assert.ok(game.craft("bakedWheat").saved);
  assert.equal(game.count("wheat"), 4, "烤麦饼 spends wheat 2");
  assert.ok(game.craft("veggieSalad").saved);
  assert.equal(game.count(BLOCK.LEAF), 8, "果蔬沙拉 spends leaves 2");
  assert.equal(game.count("wheat"), 3, "果蔬沙拉 spends wheat 1");
  assert.ok(game.craft("stew").saved);
  assert.equal(game.count("wheat"), 1, "炖菜 spends wheat 2");
  assert.equal(game.count(BLOCK.WOOD), 4, "炖菜 spends wood 1 (after the workbench's 5)");
  assert.deepEqual(game.dressingsByRecipe, { dressing: 0, bandage: 0, bigDressing: 0, bakedWheat: 1, veggieSalad: 1, stew: 1 });
  // Eating heals the dish's own amount; an eaten dish is gone.
  assert.deepEqual(game.useDressing("bakedWheat"), { saved: true, healed: 40 });
  assert.deepEqual(game.useDressing("veggieSalad"), { saved: true, healed: 25 });
  assert.deepEqual(game.useDressing("stew"), { saved: true, healed: 60 });
  assert.equal(game.useDressing("stew"), null);
  // The counts survive a reload.
  const reloaded = createProgression(storage, line(10));
  assert.deepEqual(reloaded.dressingsByRecipe, { dressing: 0, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
});

test("the 急救 tech adds 10 healing to food too", () => {
  const save = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 10, 10, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0, stew: 1 },
    seeds: { wheatSeed: 0, wheat: 0, fertilizer: 0 }, workbenchBuilt: true });
  const storage = makeStorage([[SAVE_KEY, save]]);
  const game = createProgression(storage, line(10));
  const progress = JSON.stringify({ version: 2, wave: 0, kills: 100, bossesDefeated: {}, bossKills: {},
    bestWave: 0, defense: { wave: 0, cleared: false, bestWave: 0 } });
  storage.setItem(PROGRESS_KEY, progress);
  assert.ok(game.unlockTech("firstAid").saved);
  assert.deepEqual(game.useDressing("stew"), { saved: true, healed: 70 });
});

test("validateRecipes rejects a bad cooking recipe verbatim", () => {
  assert.deepEqual(validateRecipes({ bad: { name: "坏菜", cost: [["wheat", 1]], cooking: true } }, { wheat: "小麦" }),
    { valid: false, errors: ["bad：烹饪配方必须有回血"] });
  assert.deepEqual(validateRecipes({ bad: { name: "坏菜", cost: [], healing: 10, cooking: true } }),
    { valid: false, errors: ["bad：回血配方没有 cost", "bad：烹饪配方没有 cost"] });
  assert.deepEqual(validateRecipes({ bad: { name: "坏菜", cost: [["wheat", 1]], healing: 10, cooking: "yes" } }),
    { valid: false, errors: ["bad：cooking 必须是 true"] });
  assert.throws(() => assertValidRecipes({ bad: { name: "坏菜", cost: [["wheat", 1]], cooking: true } }), /配方表校验失败/);
});

test("validateRecipes rejects a bad buff verbatim", () => {
  const dish = buff => ({ name: "试菜", cost: [["wheat", 1]], healing: 10, cooking: true, buff });
  assert.deepEqual(validateRecipes({ bad: dish({ kind: "jump", pct: 10, seconds: 30 }) }, { wheat: "小麦" }),
    { valid: false, errors: ["bad：buff.kind 只许 speed 或 attack（现在是 jump）"] });
  assert.deepEqual(validateRecipes({ bad: dish({ kind: "speed", pct: 0, seconds: 30 }) }),
    { valid: false, errors: ["bad：buff.pct 必须是正数"] });
  assert.deepEqual(validateRecipes({ bad: dish({ kind: "attack", pct: 10, seconds: -5 }) }),
    { valid: false, errors: ["bad：buff.seconds 必须是正数"] });
  assert.deepEqual(validateRecipes({ bad: dish("speed") }),
    { valid: false, errors: ["bad：buff 必须是对象"] });
  assert.throws(() => assertValidRecipes({ bad: dish({ kind: "jump", pct: 10, seconds: 30 }) }), /配方表校验失败/);
  // The shipped dishes pass: salad is speed, stew is attack.
  assert.deepEqual(RECIPES.veggieSalad.buff, { kind: "speed", pct: 10, seconds: 30 });
  assert.deepEqual(RECIPES.stew.buff, { kind: "attack", pct: 10, seconds: 30 });
  assert.equal(RECIPES.bakedWheat.buff, undefined);
});

test("export matches the current save, and import restores a save", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(20));
  assert.ok(game.editBlock(3, BLOCK.STONE, BLOCK.AIR, true).saved);
  assert.ok(game.editBlock(4, BLOCK.LEAF, BLOCK.AIR, false).saved);
  assert.ok(game.editBlock(5, BLOCK.LEAF, BLOCK.AIR, false).saved);
  for (let i = 0; i < 3; i++) game.grantLoot();
  assert.ok(game.craft("axe").saved);
  assert.ok(game.craft("dressing").saved);
  // Export is the save on disk, byte for byte.
  assert.equal(game.exportSave(), storage.getItem(SAVE_KEY));
  assert.equal(JSON.parse(game.exportSave()).version, 5);
  assert.equal(JSON.parse(game.exportSave()).dressings.dressing, 1);
  // Import a different save: state, disk and a fresh reload all agree.
  const imported = JSON.stringify({ version: 4, edits: [[3, 0, 0, BLOCK.WOOD]], materials: [0, 0, 5, 2, 9, 3],
    axeUnlocked: true, dressings: { dressing: 2, bandage: 1, bigDressing: 0 } });
  assert.deepEqual(game.importSave(imported), { imported: true });
  assert.equal(game.count(BLOCK.DIRT), 5);
  assert.equal(game.count(BLOCK.STONE), 2);
  assert.equal(game.count(BLOCK.WOOD), 9);
  assert.equal(game.count(BLOCK.LEAF), 3);
  assert.equal(game.axeUnlocked, true);
  assert.deepEqual(game.dressingsByRecipe, { dressing: 2, bandage: 1, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  assert.deepEqual([...game.blockEdits()], [[voxelIndex(line(20), 3, 0, 0), BLOCK.WOOD]]);
  assert.equal(storage.getItem(SAVE_KEY), game.exportSave());
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version, 5);
  const reloaded = createProgression(storage, line(20));
  assert.equal(reloaded.count(BLOCK.WOOD), 9);
  assert.deepEqual(reloaded.dressingsByRecipe, { dressing: 2, bandage: 1, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  assert.deepEqual([...reloaded.blockEdits()], [[voxelIndex(line(20), 3, 0, 0), BLOCK.WOOD]]);
  // An older-version save imports too, and is re-saved as the current
  // version: v3's numeric dressings migrate to the dressing count.
  const v3 = JSON.stringify({ version: 3, edits: [[5, 0, 0, BLOCK.STONE]], materials: [0, 0, 1, 1, 1, 1],
    axeUnlocked: false, dressings: 2 });
  assert.deepEqual(game.importSave(v3), { imported: true });
  assert.equal(game.dressings, 2);
  assert.deepEqual(game.dressingsByRecipe, { dressing: 2, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version, 5);
});

test("a bad import file never touches the existing save", () => {
  const seed = JSON.stringify({ version: 5, edits: [[2, 0, 0, BLOCK.STONE]], materials: [0, 0, 10, 3, 2, 2],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, seed]]);
  const game = createProgression(storage, line(10));
  const beforeState = game.exportSave();
  assert.deepEqual(game.importSave("not json at all"), { imported: false, reason: "invalid-json" });
  assert.deepEqual(game.importSave(JSON.stringify({ version: 99, edits: [], materials: [], axeUnlocked: false,
    dressings: {} })), { imported: false, reason: "unknown-version" });
  assert.deepEqual(game.importSave(JSON.stringify([[1, BLOCK.WOOD]])), { imported: false, reason: "unknown-version" });
  assert.deepEqual(game.importSave(JSON.stringify({ version: 4, edits: "not-an-array", materials: [0, 0, 0, 0, 0, 0],
    axeUnlocked: false, dressings: {} })), { imported: false, reason: "invalid-save" });
  assert.deepEqual(game.importSave(JSON.stringify({ version: 4, edits: [], materials: "not-an-array",
    axeUnlocked: false, dressings: {} })), { imported: false, reason: "invalid-save" });
  assert.equal(game.exportSave(), beforeState);
  assert.equal(storage.getItem(SAVE_KEY), seed);
  assert.equal(game.count(BLOCK.DIRT), 10);
  assert.equal(game.dressings, 1);
  assert.deepEqual([...game.blockEdits()], [[voxelIndex(line(10), 2, 0, 0), BLOCK.STONE]]);
});

test("an import that cannot write rolls back and keeps the old save", () => {
  const seed = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 3, 2, 2], axeUnlocked: false,
    dressings: { dressing: 1, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, seed]]);
  const game = createProgression(storage, line(10));
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  const imported = JSON.stringify({ version: 4, edits: [[1, 0, 0, BLOCK.WOOD]], materials: [0, 0, 1, 1, 1, 1],
    axeUnlocked: true, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  assert.deepEqual(game.importSave(imported), { imported: false, reason: "quota" });
  assert.equal(game.count(BLOCK.DIRT), 10);
  assert.equal(game.count(BLOCK.STONE), 3);
  assert.equal(game.axeUnlocked, false);
  assert.equal(game.dressings, 1);
  assert.deepEqual([...game.blockEdits()], []);
  assert.equal(storage.getItem(SAVE_KEY), seed);
});

test("saves rotate through three slots, newest first, and the oldest is dropped", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(20));
  const saves = [];
  const mine = cell => {
    assert.ok(game.editBlock(cell, BLOCK.WOOD, BLOCK.AIR, true).saved);
    game.flush();
    saves.push(storage.getItem(SAVE_KEY));
  };
  mine(1); mine(2); mine(3); mine(4);
  // Four saves: the primary holds the fourth, slot 1 the third, slot 2
  // the second — and the first save is gone from storage entirely.
  assert.equal(storage.getItem(SAVE_KEY), saves[3]);
  assert.equal(storage.getItem(SAVE_SLOT_1_KEY), saves[2]);
  assert.equal(storage.getItem(SAVE_SLOT_2_KEY), saves[1]);
  assert.ok(!storage.keys().some(key => storage.getItem(key) === saves[0]));
  const reloaded = createProgression(storage, line(20));
  assert.deepEqual([...reloaded.blockEdits()], [[1, BLOCK.AIR], [2, BLOCK.AIR], [3, BLOCK.AIR], [4, BLOCK.AIR]]);
});

test("a corrupt primary falls back to the previous slot", () => {
  const first = JSON.stringify({ version: 5, edits: [[1, 0, 0, BLOCK.STONE]], materials: [0, 0, 1, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const second = JSON.stringify({ version: 5, edits: [[2, 0, 0, BLOCK.WOOD]], materials: [0, 0, 2, 0, 0, 0],
    axeUnlocked: true, dressings: { dressing: 1, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, "{not json"], [SAVE_SLOT_1_KEY, second], [SAVE_SLOT_2_KEY, first]]);
  const game = createProgression(storage, line(10));
  // The corrupt primary is quarantined; the state is the second save's
  // (slot 1 wins over slot 2).
  assert.equal(game.count(BLOCK.DIRT), 2);
  assert.equal(game.axeUnlocked, true);
  assert.equal(game.dressings, 1);
  assert.deepEqual([...game.blockEdits()], [[voxelIndex(line(10), 2, 0, 0), BLOCK.WOOD]]);
  const quarantined = storage.keys().filter(key => key.startsWith(`${SAVE_KEY}.corrupt:`));
  assert.equal(quarantined.length, 1);
  assert.equal(storage.getItem(quarantined[0]), "{not json");
});

test("a corrupt slot is skipped for the older slot", () => {
  const first = JSON.stringify({ version: 5, edits: [[1, 0, 0, BLOCK.STONE]], materials: [0, 0, 1, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, "{not json"], [SAVE_SLOT_1_KEY, "{also broken"], [SAVE_SLOT_2_KEY, first]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.count(BLOCK.DIRT), 1);
  assert.deepEqual([...game.blockEdits()], [[voxelIndex(line(10), 1, 0, 0), BLOCK.STONE]]);
  // The corrupt slot is skipped silently — no quarantine copy of it.
  assert.equal(storage.keys().filter(key => key.startsWith(`${SAVE_SLOT_1_KEY}.corrupt:`)).length, 0);
});

test("a valid primary loads even when both slots carry larger counts", () => {
  // Batch 78 (visual batch 74's rollback observation): the fallback
  // order is positional, newest first — a slot stands in only when
  // every newer entry is unusable, and can never outvote a valid
  // primary, whatever its contents claim.
  const save = count => JSON.stringify({ version: 5, edits: [], materials: [0, 0, count, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, save(3)], [SAVE_SLOT_1_KEY, save(99)], [SAVE_SLOT_2_KEY, save(50)]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.count(BLOCK.DIRT), 3);
});

test("an unflushed session keeps its synchronous saves and loses only the batched edit tail", () => {
  // The hard-kill boundary, measured (batch 78): crafting and loot
  // save synchronously, so they survive a kill with no flush; block
  // edits batch for 300ms, so a kill loses exactly the edits since
  // the last write — and a normal close (flush, as pagehide and
  // pause both do) loses nothing.
  const storage = makeStorage();
  const game = createProgression(storage, line(20));
  game.grantLoot("walker");
  assert.ok(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.ok(game.editBlock(2, BLOCK.WOOD, BLOCK.AIR, true).saved);
  // Both edits batch: the 300ms window runs from the loot's write,
  // not from the previous edit, so neither is on disk yet.
  assert.equal(game.pendingSave, true, "both edits are batched, not yet on disk");
  const afterKill = createProgression(storage, line(20));
  assert.equal(afterKill.count(BLOCK.STONE), 1, "the synchronous loot save survived the kill");
  assert.deepEqual([...afterKill.blockEdits()], [], "the whole batched tail is gone, nothing older");
  assert.deepEqual(game.flush(), { saved: true });
  const afterClose = createProgression(storage, line(20));
  assert.deepEqual([...afterClose.blockEdits()], [[1, BLOCK.AIR], [2, BLOCK.AIR]], "a flush leaves nothing behind");
});

test("a corrupt primary falls back to a v3 save with its edits intact", () => {
  const oldSave = JSON.stringify({ version: 3, edits: [[2, 0, 0, BLOCK.STONE], [5, 0, 0, BLOCK.WOOD]],
    materials: [0, 0, 7, 0, 0, 0], axeUnlocked: true, dressings: 2 });
  const storage = makeStorage([[SAVE_KEY, "{not json"], [V3_SAVE_KEY, oldSave]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.count(BLOCK.DIRT), 7);
  assert.equal(game.axeUnlocked, true);
  assert.equal(game.dressings, 2);
  assert.deepEqual([...game.blockEdits()],
    [[voxelIndex(line(10), 2, 0, 0), BLOCK.STONE], [voxelIndex(line(10), 5, 0, 0), BLOCK.WOOD]]);
});

test("a save still writes after falling back to a slot", () => {
  const good = JSON.stringify({ version: 5, edits: [[2, 0, 0, BLOCK.WOOD]], materials: [0, 0, 2, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 0, bigDressing: 0 } });
  const older = JSON.stringify({ version: 5, edits: [[1, 0, 0, BLOCK.STONE]], materials: [0, 0, 1, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, "{not json"], [SAVE_SLOT_1_KEY, good], [SAVE_SLOT_2_KEY, older]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.count(BLOCK.DIRT), 2);
  // Save a new edit: the new primary is the fallback state plus the
  // edit, and the corrupt primary text must not have been rotated into
  // slot 1 — the good backups stay put.
  assert.ok(game.editBlock(3, BLOCK.LEAF, BLOCK.AIR, true).saved);
  game.flush();
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version, 5);
  assert.equal(game.count(BLOCK.DIRT), 2);
  assert.equal(game.count(BLOCK.LEAF), 1);
  assert.equal(storage.getItem(SAVE_SLOT_1_KEY), good);
  assert.equal(storage.getItem(SAVE_SLOT_2_KEY), older);
  const reloaded = createProgression(storage, line(10));
  assert.equal(reloaded.count(BLOCK.DIRT), 2);
  assert.equal(reloaded.count(BLOCK.LEAF), 1);
  assert.deepEqual([...reloaded.blockEdits()],
    [[voxelIndex(line(10), 2, 0, 0), BLOCK.WOOD], [voxelIndex(line(10), 3, 0, 0), BLOCK.AIR]]);
});

test("progress v2 starts with empty boss kills and a zero best wave", () => {
  assert.deepEqual(emptyProgress(), { version: 2, wave: 0, kills: 0, bossesDefeated: {}, bossKills: {},
    bestWave: 0, defense: { wave: 0, cleared: false, bestWave: 0 } });
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  assert.deepEqual(game.saveProgress({ wave: 4, kills: 9 }), { saved: true });
  assert.deepEqual(loadProgress(storage), { version: 2, wave: 4, kills: 9, bossesDefeated: {}, bossKills: {},
    bestWave: 4, defense: { wave: 0, cleared: false, bestWave: 0 } });
});

test("a v1 progress save migrates with defaults filled in", () => {
  const old = { version: 1, wave: 5, kills: 30, bossesDefeated: { boss: true },
    defense: { wave: 2, cleared: false, bestWave: 2 } };
  // The old key: a save written before the v2 bump.
  const storage = makeStorage([[V1_PROGRESS_KEY, JSON.stringify(old)]]);
  assert.deepEqual(loadProgress(storage), { version: 2, wave: 5, kills: 30, bossesDefeated: { boss: true },
    bossKills: {}, bestWave: 5, defense: { wave: 2, cleared: false, bestWave: 2 } });
  // Saving the migrated record writes it under the new key as v2, and
  // leaves the old key untouched.
  const game = createProgression(storage, line(10));
  assert.deepEqual(game.saveProgress(loadProgress(storage)), { saved: true });
  assert.equal(JSON.parse(storage.getItem(PROGRESS_KEY)).version, 2);
  assert.equal(storage.getItem(V1_PROGRESS_KEY), JSON.stringify(old));
  // A v1 record found under the current key (the shape game tests seed)
  // migrates the same way.
  const seeded = makeStorage([[PROGRESS_KEY, JSON.stringify(old)]]);
  assert.equal(loadProgress(seeded).bestWave, 5);
  assert.deepEqual(loadProgress(seeded).bossKills, {});
});

test("a corrupt v2 progress save falls back to the v1 save", () => {
  const old = JSON.stringify({ version: 1, wave: 4, kills: 12, bossesDefeated: {},
    defense: { wave: 0, cleared: false, bestWave: 0 } });
  const storage = makeStorage([[PROGRESS_KEY, "{not json"], [V1_PROGRESS_KEY, old]]);
  const loaded = loadProgress(storage);
  assert.equal(loaded.wave, 4);
  assert.equal(loaded.kills, 12);
  assert.equal(loaded.bestWave, 4);
  // The corrupt v2 text is quarantined; the v1 text is left alone.
  assert.equal(storage.keys().filter(key => key.startsWith(`${PROGRESS_KEY}.corrupt:`)).length, 1);
  assert.equal(storage.getItem(V1_PROGRESS_KEY), old);
});

test("boss kills count up per boss", () => {
  const first = recordBossKill(emptyProgress(), "boss");
  assert.deepEqual(first.bossKills, { boss: 1 });
  assert.equal(first.bossesDefeated.boss, true);
  const second = recordBossKill(first, "boss");
  assert.deepEqual(second.bossKills, { boss: 2 });
  // A different boss counts separately.
  const third = recordBossKill(second, "colossus");
  assert.deepEqual(third.bossKills, { boss: 2, colossus: 1 });
  assert.equal(third.bossesDefeated.colossus, true);
  // Earlier records are untouched: counting does not mutate its input.
  assert.deepEqual(first.bossKills, { boss: 1 });
  assert.deepEqual(second.bossKills, { boss: 2 });
  // No boss id, no kill — the record is just sanitized.
  assert.deepEqual(recordBossKill(emptyProgress(), "").bossKills, {});
  // A v1 defeat with no count cannot invent one: the first counted kill
  // is 1, not 2.
  const migrated = loadProgress(makeStorage([[V1_PROGRESS_KEY, JSON.stringify({ version: 1, wave: 2,
    kills: 0, bossesDefeated: { boss: true }, defense: { wave: 0, cleared: false, bestWave: 0 } })]]));
  assert.deepEqual(migrated.bossKills, {});
  assert.deepEqual(recordBossKill(migrated, "boss").bossKills, { boss: 1 });
});

test("sanitizing progress syncs the best wave and cleans boss kill counts", () => {
  const storage = makeStorage();
  assert.deepEqual(saveProgress(storage, { wave: 3, bestWave: 5, kills: 1,
    bossKills: { boss: 2, colossus: 0, "": 3, bad: -1, weird: 1.5 } }), { saved: true });
  // bestWave wins over the legacy wave on both fields; zero, negative
  // and empty-id counts are dropped, a fractional count is floored, and
  // a counted boss is marked defeated.
  assert.deepEqual(loadProgress(storage), { version: 2, wave: 5, kills: 1,
    bossesDefeated: { boss: true, weird: true }, bossKills: { boss: 2, weird: 1 }, bestWave: 5,
    defense: { wave: 0, cleared: false, bestWave: 0 } });
});

test("a block edit made while storage reads fail stays dirty and flushes once storage recovers", () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    keys: () => [...data.keys()] };
  const game = createProgression(storage, line(10));
  const realGetItem = storage.getItem;
  storage.getItem = () => { throw new Error("read gone"); };
  assert.deepEqual(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true), { saved: false, reason: "error" });
  assert.deepEqual([...game.blockEdits()], [[1, BLOCK.AIR]]);
  // Before the audit fix the edit sat in memory with pendingSave false,
  // and flush() reported { saved: true } while writing nothing — the
  // edit vanished on reload.
  assert.equal(game.pendingSave, true);
  storage.getItem = realGetItem;
  assert.deepEqual(game.flush(), { saved: true });
  assert.equal(game.pendingSave, false);
  assert.deepEqual([...createProgression(storage, line(10)).blockEdits()], [[1, BLOCK.AIR]]);
});

test("a batched flush that hits quota stays dirty and retries once storage recovers", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(20));
  assert.ok(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.ok(game.editBlock(2, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.equal(game.pendingSave, true);
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  const realSetItem = storage.setItem;
  storage.setItem = () => { throw quota; };
  assert.deepEqual(game.flush(), { saved: false, reason: "quota" });
  assert.equal(game.pendingSave, true);
  assert.deepEqual(game.lastFlushError, { saved: false, reason: "quota" });
  assert.deepEqual([...game.blockEdits()], [[1, BLOCK.AIR], [2, BLOCK.AIR]]);
  storage.setItem = realSetItem;
  assert.deepEqual(game.flush(), { saved: true });
  assert.equal(game.pendingSave, false);
  assert.deepEqual([...createProgression(storage, line(20)).blockEdits()], [[1, BLOCK.AIR], [2, BLOCK.AIR]]);
});

test("a batched flush refused by a conflict keeps the edits for keepLocal", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(20));
  assert.ok(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.ok(game.editBlock(2, BLOCK.WOOD, BLOCK.AIR, true).saved);
  const remote = JSON.stringify({ version: 5, edits: [[5, 0, 0, BLOCK.DIRT]], materials: [0, 0, 10, 0, 2, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  storage.setItem(SAVE_KEY, remote);
  assert.deepEqual(game.flush(), { saved: false, conflict: true });
  assert.equal(game.pendingSave, true);
  assert.deepEqual(game.lastFlushError, { saved: false, conflict: true });
  assert.ok(game.pendingConflict);
  assert.deepEqual([...game.blockEdits()], [[1, BLOCK.AIR], [2, BLOCK.AIR]]);
  assert.deepEqual(game.keepLocal(), { saved: true });
  assert.equal(game.pendingSave, false);
  assert.equal(game.pendingConflict, null);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)).edits, [[1, 0, 0, BLOCK.AIR], [2, 0, 0, BLOCK.AIR]]);
  // The remote save survives as the slot-1 backup, not lost.
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_SLOT_1_KEY)).edits, [[5, 0, 0, BLOCK.DIRT]]);
});

test("a v1 legacy building save and a v1 progress save upgrade together", () => {
  const oldCell = voxelIndex(LEGACY_WORLD, 25, 9, 27);
  const legacyBuilding = JSON.stringify([[oldCell, BLOCK.WOOD]]);
  const oldProgress = JSON.stringify({ version: 1, wave: 5, kills: 30, bossesDefeated: { boss: true },
    defense: { wave: 2, cleared: false, bestWave: 2 } });
  const storage = makeStorage([[LEGACY_KEY, legacyBuilding], [V1_PROGRESS_KEY, oldProgress]]);
  const game = createProgression(storage, WORLD);
  assert.deepEqual([...game.blockEdits()], [[voxelIndex(WORLD, 25, 9, 27), BLOCK.WOOD]]);
  assert.deepEqual(loadProgress(storage), { version: 2, wave: 5, kills: 30, bossesDefeated: { boss: true },
    bossKills: {}, bestWave: 5, defense: { wave: 2, cleared: false, bestWave: 2 } });
  assert.ok(game.editBlock(voxelIndex(WORLD, -11, 5, -7), BLOCK.AIR, BLOCK.DIRT, true).saved);
  assert.deepEqual(game.saveProgress(loadProgress(storage)), { saved: true });
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version, 5);
  assert.equal(JSON.parse(storage.getItem(PROGRESS_KEY)).version, 2);
  assert.equal(storage.getItem(LEGACY_KEY), legacyBuilding);
  assert.equal(storage.getItem(V1_PROGRESS_KEY), oldProgress);
  const reloaded = createProgression(storage, WORLD);
  assert.deepEqual([...reloaded.blockEdits()], [[voxelIndex(WORLD, 25, 9, 27), BLOCK.WOOD],
    [voxelIndex(WORLD, -11, 5, -7), BLOCK.DIRT]]);
  assert.equal(loadProgress(storage).wave, 5);
  assert.deepEqual(loadProgress(storage).bossKills, {});
});

test("a building save and a progress save never make each other stale", () => {
  const [tabA, tabB] = makeSharedStorage();
  const first = createProgression(tabA, line(10)), second = createProgression(tabB, line(10));
  assert.deepEqual(first.saveProgress({ wave: 1, kills: 1 }), { saved: true });
  assert.equal(second.loadProgress().wave, 1);
  assert.ok(first.editBlock(2, BLOCK.AIR, BLOCK.DIRT, true).saved);
  assert.equal(second.progressStale, false);
  assert.deepEqual(second.saveProgress({ wave: 2, kills: 2 }), { saved: true });
  // Each side's own staleness still works: the building save did make
  // the other tab's building save stale, and the progress save did make
  // the first tab's progress stale.
  assert.equal(second.stale, true);
  assert.equal(isProgressStale(tabA), true);
  assert.deepEqual(saveProgress(tabA, { wave: 3 }), { saved: false, reason: "stale" });
});

test("a corrupt v2 progress save that falls back to v1 still catches the other tab's save", () => {
  const [tabA, tabB] = makeSharedStorage();
  tabA.setItem(PROGRESS_KEY, "{broken");
  tabA.setItem(V1_PROGRESS_KEY, JSON.stringify({ version: 1, wave: 4, kills: 12, bossesDefeated: {},
    defense: { wave: 0, cleared: false, bestWave: 0 } }));
  assert.equal(loadProgress(tabB).wave, 4);
  assert.deepEqual(saveProgress(tabA, { wave: 9, kills: 99 }), { saved: true });
  assert.equal(isProgressStale(tabB), true);
  assert.deepEqual(saveProgress(tabB, { wave: 5, kills: 5 }), { saved: false, reason: "stale" });
  assert.equal(loadProgress(tabA).wave, 9);
});

test("keepLocal after falling back to a slot never rotates the corrupt primary into a slot", () => {
  const good = JSON.stringify({ version: 5, edits: [[2, 0, 0, BLOCK.WOOD]], materials: [0, 0, 2, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 0, bigDressing: 0 } });
  const older = JSON.stringify({ version: 5, edits: [[1, 0, 0, BLOCK.STONE]], materials: [0, 0, 1, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, "{not json"], [SAVE_SLOT_1_KEY, good], [SAVE_SLOT_2_KEY, older]]);
  const game = createProgression(storage, line(10));
  assert.deepEqual([...game.blockEdits()], [[voxelIndex(line(10), 2, 0, 0), BLOCK.WOOD]]);
  assert.ok(game.editBlock(3, BLOCK.LEAF, BLOCK.AIR, true).saved);
  const other = createProgression(storage, line(10));
  assert.ok(other.editBlock(4, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.equal(game.checkConflict(), true);
  assert.deepEqual(game.keepLocal(), { saved: true });
  for (const key of [SAVE_KEY, SAVE_SLOT_1_KEY, SAVE_SLOT_2_KEY]) {
    const text = storage.getItem(key);
    assert.notEqual(text, "{not json");
    assert.equal(JSON.parse(text).version, 5);
  }
  // The other tab's save survives as the slot-1 backup.
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_SLOT_1_KEY)).edits,
    [[2, 0, 0, BLOCK.WOOD], [3, 0, 0, BLOCK.AIR], [4, 0, 0, BLOCK.AIR]]);
});

test("an import refused by a conflict rolls back and leaves the decision pending", () => {
  const seed = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, seed]]);
  const first = createProgression(storage, line(10)), second = createProgression(storage, line(10));
  assert.ok(first.editBlock(2, BLOCK.AIR, BLOCK.DIRT, true).saved);
  const imported = JSON.stringify({ version: 4, edits: [[1, 0, 0, BLOCK.WOOD]], materials: [0, 0, 1, 1, 1, 1],
    axeUnlocked: true, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  assert.deepEqual(second.importSave(imported), { imported: false, reason: "conflict" });
  assert.ok(second.pendingConflict);
  assert.deepEqual([...second.blockEdits()], []);
  assert.equal(second.count(BLOCK.DIRT), 10);
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)).edits, [[2, 0, 0, BLOCK.DIRT]]);
  // The pending decision is still resolvable: loadRemote takes the
  // other tab's save and clears it.
  assert.deepEqual(second.loadRemote(), { loaded: true });
  assert.equal(second.pendingConflict, null);
  assert.deepEqual([...second.blockEdits()], [[2, BLOCK.DIRT]]);
});

test("loadRemote rebuilds the building save without clearing progress staleness", () => {
  const [tabA, tabB] = makeSharedStorage();
  const first = createProgression(tabA, line(10)), second = createProgression(tabB, line(10));
  assert.deepEqual(first.saveProgress({ wave: 1, kills: 1 }), { saved: true });
  assert.equal(second.loadProgress().wave, 1);
  assert.deepEqual(first.saveProgress({ wave: 2, kills: 2 }), { saved: true });
  assert.equal(second.progressStale, true);
  assert.ok(first.editBlock(2, BLOCK.AIR, BLOCK.DIRT, true).saved);
  assert.deepEqual(second.loadRemote(), { loaded: true });
  assert.equal(second.progressStale, true);
  assert.equal(second.stale, false);
  assert.deepEqual(second.saveProgress({ wave: 5 }), { saved: false, reason: "stale" });
});

test("a tab that fell back to v2 still notices the v2 key changing", () => {
  const oldSave = JSON.stringify({ version: 2, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: true, dressings: 2 });
  const storage = makeStorage([[SAVE_KEY, "{not json"], [PREVIOUS_SAVE_KEY, oldSave]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.axeUnlocked, true);
  assert.equal(game.stale, false);
  storage.setItem(PREVIOUS_SAVE_KEY, JSON.stringify({ version: 2, edits: [], materials: [0, 0, 10, 0, 2, 0],
    axeUnlocked: false, dressings: 0 }));
  assert.equal(game.stale, true);
  assert.deepEqual(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true), { saved: false, conflict: true });
});

test("each kind pays its own drops, and an unknown kind pays the old fixed drop", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  // Starter supplies are 10 dirt + 2 wood, so deltas keep the test
  // independent of them; the totals at the end pin the whole table.
  const delta = kind => {
    const before = [game.count(BLOCK.STONE), game.count(BLOCK.WOOD), game.count(BLOCK.LEAF)];
    assert.ok(game.grantLoot(kind).saved);
    return [game.count(BLOCK.STONE) - before[0], game.count(BLOCK.WOOD) - before[1],
      game.count(BLOCK.LEAF) - before[2]];
  };
  assert.deepEqual(delta("walker"), [1, 0, 1]);
  assert.deepEqual(delta("runner"), [1, 1, 1]);
  assert.deepEqual(delta("breaker"), [2, 0, 1]);
  assert.deepEqual(delta("spitter"), [1, 0, 2]);
  assert.deepEqual(delta("zombie"), [1, 0, 1]);
  assert.deepEqual(delta(undefined), [1, 0, 1]);
  assert.equal(game.count(BLOCK.STONE), 7);
  assert.equal(game.count(BLOCK.WOOD), 3);
  assert.equal(game.count(BLOCK.LEAF), 7);
  // The drops persist across a reload.
  const reloaded = createProgression(storage, line(10));
  assert.equal(reloaded.count(BLOCK.STONE), 7);
  assert.equal(reloaded.count(BLOCK.WOOD), 3);
  assert.equal(reloaded.count(BLOCK.LEAF), 7);
});

test("boss wins pay rare materials, 2 for a first kill and 1 for a repeat", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  assert.deepEqual(game.rareMaterials, { emberCore: 0, starShard: 0 });
  assert.ok(game.grantBossLoot("boss", 2).saved);
  assert.deepEqual(game.rareMaterials, { emberCore: 2, starShard: 0 });
  assert.ok(game.grantBossLoot("boss", 1).saved);
  assert.ok(game.grantBossLoot("colossus", 2).saved);
  assert.deepEqual(game.rareMaterials, { emberCore: 3, starShard: 2 });
  // Unknown bosses and non-positive counts pay nothing.
  assert.equal(game.grantBossLoot("dragon", 2), null);
  assert.equal(game.grantBossLoot("boss", 0), null);
  assert.equal(game.grantBossLoot("boss", -1), null);
  assert.equal(game.grantBossLoot("boss", 1.5), null);
  assert.deepEqual(game.rareMaterials, { emberCore: 3, starShard: 2 });
  // The counts are written to the save, not just held in memory.
  assert.deepEqual(JSON.parse(storage.getItem(SAVE_KEY)).rareMaterials, { emberCore: 3, starShard: 2 });
  assert.deepEqual(createProgression(storage, line(10)).rareMaterials, { emberCore: 3, starShard: 2 });
});

test("a save written before rare materials loads with all zeros", () => {
  // A v4 save with no rareMaterials field at all, like every save
  // written before this round.
  const old = JSON.stringify({ version: 4, edits: [], materials: [0, 0, 10, 0, 2, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[V4_SAVE_KEY, old]]);
  assert.deepEqual(createProgression(storage, line(10)).rareMaterials, { emberCore: 0, starShard: 0 });
  // Unknown rare ids are dropped and out-of-range counts clamp to zero.
  const weird = JSON.stringify({ version: 4, edits: [], materials: [0, 0, 10, 0, 2, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 },
    rareMaterials: { emberCore: 5, starShard: -2, dragonScale: 9 } });
  assert.deepEqual(createProgression(makeStorage([[V4_SAVE_KEY, weird]]), line(10)).rareMaterials,
    { emberCore: 5, starShard: 0 });
});

test("a v4 save migrates to v5, carrying its rare materials and defaulting the new fields", () => {
  const v4 = JSON.stringify({ version: 4, edits: [[1, 0, 0, BLOCK.DIRT]], materials: [0, 0, 10, 3, 2, 2],
    axeUnlocked: true, dressings: { dressing: 1, bandage: 0, bigDressing: 0 },
    rareMaterials: { emberCore: 2, starShard: 0 } });
  const storage = makeStorage([[V4_SAVE_KEY, v4]]);
  const game = createProgression(storage, line(10));
  // The v4 supplies survive, the R2 cores are carried (not reset), and
  // the v5 fields default empty.
  assert.equal(game.count(BLOCK.DIRT), 10);
  assert.equal(game.axeUnlocked, true);
  assert.deepEqual(game.rareMaterials, { emberCore: 2, starShard: 0 });
  assert.deepEqual(game.equipment, { weapon: null, armor: null, tool: null });
  assert.deepEqual(game.techUnlocked, []);
  assert.equal(game.workbenchBuilt, false);
  assert.deepEqual(game.stats, { blocksMined: 0, cropsPlanted: 0, cropsHarvested: 0 });
  // The farming fields default too: the starter seeds (a v4 save has no
  // seeds field) and no planted crops.
  assert.deepEqual(game.seeds, { wheatSeed: 2, wheat: 0, fertilizer: 0 });
  assert.deepEqual(game.crops, {});
  // The next write upgrades the save to v5 and leaves the v4 file alone.
  assert.ok(game.editBlock(2, BLOCK.WOOD, BLOCK.AIR, true).saved);
  const written = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(written.version, 5);
  assert.deepEqual(written.rareMaterials, { emberCore: 2, starShard: 0 });
  assert.deepEqual(written.equipment, { weapon: null, armor: null, tool: null });
  assert.deepEqual(written.seeds, { wheatSeed: 2, wheat: 0, fertilizer: 0 });
  assert.deepEqual(written.crops, {});
  assert.equal(storage.getItem(V4_SAVE_KEY), v4);
  // A v5 primary takes precedence over the v4 file underneath it.
  const storage2 = makeStorage([[SAVE_KEY, JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } })], [V4_SAVE_KEY, v4]]);
  assert.equal(createProgression(storage2, line(10)).count(BLOCK.DIRT), 0);
});

test("a corrupt v4 save is quarantined under its own key before falling back to v2", () => {
  const oldSave = JSON.stringify({ version: 2, edits: [], materials: [0, 0, 0, 0, 0, 0], axeUnlocked: true, dressings: 2 });
  const storage = makeStorage([[V4_SAVE_KEY, "{not json"], [PREVIOUS_SAVE_KEY, oldSave]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.axeUnlocked, true);
  assert.equal(game.dressings, 2);
  const quarantined = storage.keys().filter(key => key.startsWith(`${V4_SAVE_KEY}.corrupt:`));
  assert.equal(quarantined.length, 1);
  assert.match(quarantined[0], /^block-world:save:v4\.corrupt:\d+$/);
  assert.equal(storage.getItem(quarantined[0]), "{not json");
  assert.equal(storage.getItem(V4_SAVE_KEY), "{not json");
});

test("a corrupt v5 save with corrupt v5 slots falls back to the v4 backup", () => {
  const v4 = JSON.stringify({ version: 4, edits: [[1, 0, 0, BLOCK.STONE]], materials: [0, 0, 1, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const v4slot = JSON.stringify({ version: 4, edits: [[2, 0, 0, BLOCK.WOOD]], materials: [0, 0, 2, 0, 0, 0],
    axeUnlocked: true, dressings: { dressing: 1, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, "{not json"], [SAVE_SLOT_1_KEY, "{also broken"],
    [V4_SAVE_KEY, v4], [V4_SLOT_1_KEY, v4slot]]);
  const game = createProgression(storage, line(10));
  // The v4 primary wins over its own slot.
  assert.equal(game.count(BLOCK.DIRT), 1);
  assert.deepEqual([...game.blockEdits()], [[voxelIndex(line(10), 1, 0, 0), BLOCK.STONE]]);
  // And with the v4 primary gone too, its slot is the last resort.
  const storage2 = makeStorage([[SAVE_KEY, "{not json"], [SAVE_SLOT_1_KEY, "{also broken"],
    [V4_SLOT_1_KEY, v4slot]]);
  const fallback = createProgression(storage2, line(10));
  assert.equal(fallback.count(BLOCK.DIRT), 2);
  assert.equal(fallback.axeUnlocked, true);
});

test("the workbench gates equipment, and crafting it locks itself out", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  for (let i = 0; i < 5; i++) game.grantLoot("breaker");
  for (let i = 0; i < 5; i++) game.grantLoot("runner");
  assert.equal(game.count(BLOCK.STONE), 15);
  assert.equal(game.count(BLOCK.WOOD), 7);
  // No workbench yet: equipment cannot be made, whatever the materials.
  assert.equal(game.canCraft("stoneArmor"), false);
  assert.equal(game.canCraft("stonePickaxe"), false);
  assert.equal(game.craft("stoneArmor"), null);
  assert.equal(game.workbenchBuilt, false);
  // Build it: stone 5 + wood 5, and it cannot be built twice.
  assert.ok(game.craft("workbench").saved);
  assert.equal(game.workbenchBuilt, true);
  assert.equal(game.count(BLOCK.STONE), 10);
  assert.equal(game.count(BLOCK.WOOD), 2);
  assert.equal(game.canCraft("workbench"), false);
  assert.equal(game.craft("workbench"), null);
  // Armor now crafts (stone 6 + wood 2, exactly what is left) — once
  // the 石阶装备 trunk node is unlocked; the workbench alone no longer
  // opens the equipment recipes.
  assert.equal(game.canCraft("stoneArmor"), false);
  assert.ok(game.unlockTech("workbench").saved);
  assert.ok(game.unlockTech("stoneGear").saved);
  assert.equal(game.canCraft("stoneArmor"), true);
  assert.ok(game.craft("stoneArmor").saved);
  assert.deepEqual(game.equipment, { weapon: null, armor: { key: "stoneArmor", tier: "stone", durability: 100 }, tool: null });
  assert.equal(game.canCraft("stoneArmor"), false);
  assert.equal(game.craft("stoneArmor"), null);
  // The pickaxe (stone 3 + wood 2) still crafts.
  for (let i = 0; i < 2; i++) game.grantLoot("runner");
  assert.ok(game.craft("stonePickaxe").saved);
  assert.deepEqual(game.equipment.tool, { key: "stonePickaxe", tier: "stone", durability: 100 });
  // Both survive a reload.
  const reloaded = createProgression(storage, line(10));
  assert.equal(reloaded.workbenchBuilt, true);
  assert.deepEqual(reloaded.equipment,
    { weapon: null, armor: { key: "stoneArmor", tier: "stone", durability: 100 }, tool: { key: "stonePickaxe", tier: "stone", durability: 100 } });
});

test("a quota failure rolls back the workbench with its materials", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  for (let i = 0; i < 5; i++) game.grantLoot("breaker");
  for (let i = 0; i < 5; i++) game.grantLoot("runner");
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  assert.deepEqual(game.craft("workbench"), { saved: false, reason: "quota" });
  assert.equal(game.workbenchBuilt, false);
  assert.equal(game.count(BLOCK.STONE), 15);
  assert.equal(game.count(BLOCK.WOOD), 7);
});

test("survival mining counts toward stats, placing and creative edits do not", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  assert.deepEqual(game.stats, { blocksMined: 0, cropsPlanted: 0, cropsHarvested: 0 });
  assert.ok(game.editBlock(1, BLOCK.STONE, BLOCK.AIR, true).saved);
  assert.deepEqual(game.stats, { blocksMined: 1, cropsPlanted: 0, cropsHarvested: 0 });
  assert.ok(game.editBlock(2, BLOCK.WOOD, BLOCK.AIR, true).saved);
  assert.deepEqual(game.stats, { blocksMined: 2, cropsPlanted: 0, cropsHarvested: 0 });
  // Placing a block is not mining, and creative (unlimited) edits are free.
  assert.ok(game.editBlock(3, BLOCK.AIR, BLOCK.DIRT, true).saved);
  assert.ok(game.editBlock(4, BLOCK.STONE, BLOCK.AIR, false).saved);
  assert.deepEqual(game.stats, { blocksMined: 2, cropsPlanted: 0, cropsHarvested: 0 });
  // The count persists (after the batched edit flushes) and is not
  // capped at the stack limit.
  assert.deepEqual(game.flush(), { saved: true });
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).stats.blocksMined, 2);
  assert.deepEqual(createProgression(storage, line(10)).stats, { blocksMined: 2, cropsPlanted: 0, cropsHarvested: 0 });
});

test("a quota failure on a mining edit rolls the mining count back too", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  storage.setItem = () => { throw Object.assign(new Error("quota exceeded"), { name: "QuotaExceededError" }); };
  assert.deepEqual(game.editBlock(1, BLOCK.STONE, BLOCK.AIR, true), { saved: false, reason: "quota" });
  assert.deepEqual(game.stats, { blocksMined: 0, cropsPlanted: 0, cropsHarvested: 0 });
  assert.deepEqual([...game.blockEdits()], []);
});

test("a v5 save sanitizes bad equipment, tech and stats instead of crashing the load", () => {
  const dirty = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 },
    equipment: { weapon: { key: "stoneSword", tier: "stone" }, armor: { key: "dragonArmor", tier: "ember" }, tool: "not-an-object" },
    techUnlocked: ["toughness", 7, "toughness", null], workbenchBuilt: "yes",
    stats: { blocksMined: -5, cropsPlanted: "three", cropsHarvested: -1 } });
  const game = createProgression(makeStorage([[SAVE_KEY, dirty]]), line(10));
  assert.deepEqual(game.equipment, { weapon: null, armor: null, tool: null });
  assert.deepEqual(game.techUnlocked, ["toughness"]);
  assert.equal(game.workbenchBuilt, false);
  assert.deepEqual(game.stats, { blocksMined: 0, cropsPlanted: 0, cropsHarvested: 0 });
  // And a clean v5 file round-trips everything it carries, including a
  // mining count past the stack limit (a lifetime counter is not capped).
  const clean = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 }, rareMaterials: { emberCore: 2, starShard: 1 },
    equipment: { weapon: null, armor: { key: "stoneArmor", tier: "stone" }, tool: { key: "stonePickaxe", tier: "stone", durability: 100 } },
    techUnlocked: ["toughness"], workbenchBuilt: true, stats: { blocksMined: 1500 } });
  const loaded = createProgression(makeStorage([[SAVE_KEY, clean]]), line(10));
  // The armor is an R3–R7 save with no durability stored: it loads at
  // full. The pickaxe's stored 100 round-trips unchanged.
  assert.deepEqual(loaded.equipment.armor, { key: "stoneArmor", tier: "stone", durability: 100 });
  assert.deepEqual(loaded.equipment.tool, { key: "stonePickaxe", tier: "stone", durability: 100 });
  assert.deepEqual(loaded.techUnlocked, ["toughness"]);
  assert.equal(loaded.workbenchBuilt, true);
  assert.deepEqual(loaded.stats, { blocksMined: 1500, cropsPlanted: 0, cropsHarvested: 0 });
  assert.deepEqual(loaded.rareMaterials, { emberCore: 2, starShard: 1 });
});

test("validateRecipes rejects a bad equipment slot, a missing tier and a free equipment recipe", () => {
  assert.deepEqual(validateRecipes({ ...RECIPES, badSlot: { name: "坏槽", cost: [[BLOCK.STONE, 1]], equipment: "ring", tier: "stone" } }),
    { valid: false, errors: ["badSlot：装备槽必须是 weapon、armor 或 tool（现在是 ring）"] });
  assert.deepEqual(validateRecipes({ ...RECIPES, noTier: { name: "无阶", cost: [[BLOCK.STONE, 1]], equipment: "armor" } }),
    { valid: false, errors: ["noTier：装备配方必须有品阶"] });
  assert.deepEqual(validateRecipes({ ...RECIPES, emptyTier: { name: "空阶", cost: [[BLOCK.STONE, 1]], equipment: "armor", tier: "" } }),
    { valid: false, errors: ["emptyTier：装备配方必须有品阶", "emptyTier：品阶必须是非空字符串"] });
  assert.deepEqual(validateRecipes({ ...RECIPES, free: { name: "免费", cost: [], equipment: "tool", tier: "stone" } }),
    { valid: false, errors: ["free：装备配方没有 cost"] });
  assert.deepEqual(validateRecipes({ ...RECIPES, stoneArmor: { ...RECIPES.stoneArmor, tier: "ember" } }),
    { valid: true, errors: [] });
});

test("validateRecipes accepts rare material costs against a registry and rejects bad ones", () => {
  const RARE = { emberCore: "熔火核心", starShard: "断星碎片" };
  const FARM = { wheatSeed: "小麦种子", wheat: "小麦", fertilizer: "腐叶" };
  // The shipped table spends both registries (boss materials on the
  // equipment, wheat on the dishes), so it validates against both.
  assert.deepEqual(validateRecipes(RECIPES, RARE, FARM), { valid: true, errors: [] });
  assert.deepEqual(validateRecipes({ ok: { name: "好", cost: [["emberCore", 1]] } }, RARE), { valid: true, errors: [] });
  assert.deepEqual(validateRecipes({ bad: { name: "坏", cost: [["nope", 1]] } }, RARE),
    { valid: false, errors: ["bad：cost 引用未注册材料 nope"] });
  assert.deepEqual(validateRecipes({ bad: { name: "坏", cost: [[BLOCK.STONE, 0]] } }, RARE),
    { valid: false, errors: ["bad：cost[0] 数量不是正整数"] });
  assert.deepEqual(validateRecipes({ bad: { name: "坏", cost: [[BLOCK.STONE, 1.5]] } }, RARE),
    { valid: false, errors: ["bad：cost[0] 数量不是正整数"] });
  assert.deepEqual(validateRecipes({ bad: { name: "坏", cost: [5] } }, RARE),
    { valid: false, errors: ["bad：cost[0] 不是 [材料, 数量]"] });
  assert.deepEqual(validateRecipes({ bad: { name: "坏", cost: [[BLOCK.STONE]] } }, RARE),
    { valid: false, errors: ["bad：cost[0] 不是 [材料, 数量]"] });
});

test("ember weapons need a guardian kill and spend ember cores; star needs a colossus kill", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  for (let i = 0; i < 8; i++) game.grantLoot("breaker");
  for (let i = 0; i < 7; i++) game.grantLoot("runner");
  game.grantBossLoot("boss", 2);
  game.grantBossLoot("colossus", 2);
  assert.equal(game.count(BLOCK.STONE), 23);
  assert.equal(game.count(BLOCK.WOOD), 9);
  assert.equal(game.count("emberCore"), 2);
  assert.equal(game.count("starShard"), 2);
  assert.ok(game.craft("workbench").saved);
  // No boss kills on record: both tiers locked, whatever the materials.
  assert.equal(game.canCraft("emberSword"), false);
  assert.equal(game.canCraft("emberAxe"), false);
  assert.equal(game.canCraft("starSword"), false);
  assert.equal(game.craft("emberSword"), null);
  // One guardian kill unlocks ember (but not star) — through the
  // tech tree: the kill opens the 熔火科技 node, and the node opens the
  // recipes. The kill alone, without the trunk clicks, still locks.
  const progress = (bossKills) => JSON.stringify({ version: 2, wave: 0, kills: 0, bossesDefeated: {}, bossKills,
    bestWave: 0, defense: { wave: 0, cleared: false, bestWave: 0 } });
  storage.setItem(PROGRESS_KEY, progress({ boss: 1 }));
  assert.equal(game.canCraft("emberSword"), false);
  assert.ok(game.unlockTech("workbench").saved);
  assert.ok(game.unlockTech("stoneGear").saved);
  assert.ok(game.unlockTech("emberTech").saved);
  assert.ok(game.unlockTech("emberGear").saved);
  assert.equal(game.canCraft("emberSword"), true);
  assert.equal(game.canCraft("starSword"), false);
  assert.ok(game.craft("emberSword").saved);
  assert.deepEqual(game.equipment.weapon, { key: "emberSword", tier: "ember", durability: 200 });
  assert.equal(game.count(BLOCK.STONE), 10);
  assert.equal(game.count(BLOCK.WOOD), 0);
  assert.equal(game.count("emberCore"), 0);
  // One weapon slot: an ember axe of the same tier cannot be made too.
  assert.equal(game.canCraft("emberAxe"), false);
  assert.equal(game.craft("emberAxe"), null);
  // A colossus kill unlocks star, but the star sword still needs wood
  // and one more ember core on top of the two star shards.
  storage.setItem(PROGRESS_KEY, progress({ boss: 1, colossus: 1 }));
  assert.ok(game.unlockTech("starTech").saved);
  assert.ok(game.unlockTech("starGear").saved);
  assert.equal(game.canCraft("starSword"), false);
  for (let i = 0; i < 4; i++) game.grantLoot("runner");
  game.grantBossLoot("boss", 1);
  assert.ok(game.craft("starSword").saved);
  assert.deepEqual(game.equipment.weapon, { key: "starSword", tier: "star", durability: 300 });
  assert.equal(game.count(BLOCK.STONE), 4);
  assert.equal(game.count(BLOCK.WOOD), 0);
  assert.equal(game.count("starShard"), 0);
  assert.equal(game.count("emberCore"), 0);
  // Both survive a reload.
  const reloaded = createProgression(storage, line(10));
  assert.equal(reloaded.workbenchBuilt, true);
  assert.deepEqual(reloaded.equipment.weapon, { key: "starSword", tier: "star", durability: 300 });
});

test("a quota failure rolls back an ember craft with its cores", () => {
  const storage = makeStorage([[PROGRESS_KEY, JSON.stringify({ version: 2, wave: 0, kills: 0, bossesDefeated: { boss: true },
    bossKills: { boss: 1 }, bestWave: 0, defense: { wave: 0, cleared: false, bestWave: 0 } })]]);
  const game = createProgression(storage, line(10));
  for (let i = 0; i < 8; i++) game.grantLoot("breaker");
  for (let i = 0; i < 7; i++) game.grantLoot("runner");
  game.grantBossLoot("boss", 2);
  assert.ok(game.craft("workbench").saved);
  assert.ok(game.unlockTech("workbench").saved);
  assert.ok(game.unlockTech("stoneGear").saved);
  assert.ok(game.unlockTech("emberTech").saved);
  assert.ok(game.unlockTech("emberGear").saved);
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  assert.deepEqual(game.craft("emberSword"), { saved: false, reason: "quota" });
  assert.equal(game.count("emberCore"), 2);
  assert.equal(game.count(BLOCK.STONE), 18);
  assert.equal(game.count(BLOCK.WOOD), 4);
  assert.equal(game.equipment.weapon, null);
});

test("ember armor needs a guardian kill and spends its cores; star needs a colossus kill", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  for (let i = 0; i < 8; i++) game.grantLoot("breaker");
  for (let i = 0; i < 7; i++) game.grantLoot("runner");
  game.grantBossLoot("boss", 2);
  game.grantBossLoot("colossus", 2);
  assert.ok(game.craft("workbench").saved);
  assert.equal(game.canCraft("emberArmor"), false);
  const progress = (bossKills) => JSON.stringify({ version: 2, wave: 0, kills: 0, bossesDefeated: {}, bossKills,
    bestWave: 0, defense: { wave: 0, cleared: false, bestWave: 0 } });
  storage.setItem(PROGRESS_KEY, progress({ boss: 1 }));
  assert.equal(game.canCraft("emberArmor"), false);
  assert.ok(game.unlockTech("workbench").saved);
  assert.ok(game.unlockTech("stoneGear").saved);
  assert.ok(game.unlockTech("emberTech").saved);
  assert.ok(game.unlockTech("emberGear").saved);
  assert.equal(game.canCraft("emberArmor"), true);
  assert.equal(game.canCraft("starArmor"), false);
  assert.ok(game.craft("emberArmor").saved);
  assert.deepEqual(game.equipment.armor, { key: "emberArmor", tier: "ember", durability: 200 });
  assert.equal(game.count(BLOCK.STONE), 10);
  assert.equal(game.count(BLOCK.WOOD), 2);
  assert.equal(game.count("emberCore"), 0);
  // Same tier again is blocked; star needs the colossus kill and
  // fresh materials.
  assert.equal(game.canCraft("emberArmor"), false);
  storage.setItem(PROGRESS_KEY, progress({ boss: 1, colossus: 1 }));
  assert.ok(game.unlockTech("starTech").saved);
  assert.ok(game.unlockTech("starGear").saved);
  assert.equal(game.canCraft("starArmor"), false);
  for (let i = 0; i < 4; i++) game.grantLoot("runner");
  game.grantBossLoot("boss", 1);
  assert.ok(game.craft("starArmor").saved);
  assert.deepEqual(game.equipment.armor, { key: "starArmor", tier: "star", durability: 300 });
  assert.equal(game.count("starShard"), 0);
  assert.equal(game.count("emberCore"), 0);
});

test("ember pickaxe needs a guardian kill and spends its cores; star needs a colossus kill", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  for (let i = 0; i < 8; i++) game.grantLoot("breaker");
  for (let i = 0; i < 7; i++) game.grantLoot("runner");
  game.grantBossLoot("boss", 2);
  game.grantBossLoot("colossus", 2);
  assert.ok(game.craft("workbench").saved);
  assert.equal(game.canCraft("emberPickaxe"), false);
  const progress = (bossKills) => JSON.stringify({ version: 2, wave: 0, kills: 0, bossesDefeated: {}, bossKills,
    bestWave: 0, defense: { wave: 0, cleared: false, bestWave: 0 } });
  storage.setItem(PROGRESS_KEY, progress({ boss: 1 }));
  assert.equal(game.canCraft("emberPickaxe"), false);
  assert.ok(game.unlockTech("workbench").saved);
  assert.ok(game.unlockTech("stoneGear").saved);
  assert.ok(game.unlockTech("emberTech").saved);
  assert.ok(game.unlockTech("emberGear").saved);
  assert.equal(game.canCraft("emberPickaxe"), true);
  assert.equal(game.canCraft("starPickaxe"), false);
  assert.ok(game.craft("emberPickaxe").saved);
  assert.deepEqual(game.equipment.tool, { key: "emberPickaxe", tier: "ember", durability: 200 });
  assert.equal(game.count(BLOCK.STONE), 10);
  assert.equal(game.count(BLOCK.WOOD), 2);
  assert.equal(game.count("emberCore"), 0);
  // Same tier again is blocked; star needs the colossus kill and
  // fresh materials.
  assert.equal(game.canCraft("emberPickaxe"), false);
  storage.setItem(PROGRESS_KEY, progress({ boss: 1, colossus: 1 }));
  assert.ok(game.unlockTech("starTech").saved);
  assert.ok(game.unlockTech("starGear").saved);
  assert.equal(game.canCraft("starPickaxe"), false);
  for (let i = 0; i < 4; i++) game.grantLoot("runner");
  game.grantBossLoot("boss", 1);
  assert.ok(game.craft("starPickaxe").saved);
  assert.deepEqual(game.equipment.tool, { key: "starPickaxe", tier: "star", durability: 300 });
  assert.equal(game.count("starShard"), 0);
  assert.equal(game.count("emberCore"), 0);
});

test("tech unlocks persist across reloads and export/import", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  assert.ok(game.unlockTech("workbench").saved);
  assert.ok(game.unlockTech("stoneGear").saved);
  assert.deepEqual(game.techUnlocked, ["workbench", "stoneGear"]);
  const reloaded = createProgression(storage, line(10));
  assert.deepEqual(reloaded.techUnlocked, ["workbench", "stoneGear"]);
  // Export carries the list; importing it into a fresh campaign keeps it.
  const exported = game.exportSave();
  assert.deepEqual(JSON.parse(exported).techUnlocked, ["workbench", "stoneGear"]);
  const fresh = createProgression(makeStorage(), line(10));
  assert.deepEqual(fresh.importSave(exported), { imported: true });
  assert.deepEqual(fresh.techUnlocked, ["workbench", "stoneGear"]);
});

test("unlockTech refuses unmet requirements, repeats and unknown ids", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  // No boss kill: 熔火科技 refuses; no prerequisite: 石阶装备 refuses.
  assert.equal(game.unlockTech("emberTech"), null);
  assert.equal(game.unlockTech("stoneGear"), null);
  assert.equal(game.unlockTech("nope"), null);
  assert.deepEqual(game.techUnlocked, []);
  // Unlocking the trunk in order works; a repeat is refused.
  assert.ok(game.unlockTech("workbench").saved);
  assert.ok(game.unlockTech("stoneGear").saved);
  assert.equal(game.unlockTech("stoneGear"), null);
  assert.deepEqual(game.techUnlocked, ["workbench", "stoneGear"]);
});

test("a quota failure rolls back a tech unlock", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  assert.deepEqual(game.unlockTech("workbench"), { saved: false, reason: "quota" });
  assert.deepEqual(game.techUnlocked, []);
});

// A v5 save with one equipped piece per slot and the materials to
// repair an ember piece, for the durability tests below.
function saveWithGear(equipment, materials = [0, 0, 0, 10, 0, 0], rareMaterials = { emberCore: 1, starShard: 1 }, workbenchBuilt = true) {
  return JSON.stringify({ version: 5, edits: [], materials, axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 }, rareMaterials,
    equipment, techUnlocked: [], workbenchBuilt, stats: { blocksMined: 0 } });
}

test("wearing equipment drops durability by 1 per use, floors at 0, and persists across reloads", () => {
  const gear = { weapon: { key: "emberSword", tier: "ember", durability: 200 },
    armor: { key: "stoneArmor", tier: "stone", durability: 100 }, tool: { key: "starPickaxe", tier: "star", durability: 300 } };
  const storage = makeStorage([[SAVE_KEY, saveWithGear(gear)]]);
  const game = createProgression(storage, line(10));
  assert.ok(game.wearEquipment("weapon").saved);
  assert.equal(game.equipment.weapon.durability, 199);
  assert.ok(game.wearEquipment("armor").saved);
  assert.equal(game.equipment.armor.durability, 99);
  assert.ok(game.wearEquipment("tool").saved);
  assert.equal(game.equipment.tool.durability, 299);
  // Wear the sword to 0: the 200th wear lands, the 201st is a no-op.
  for (let i = 0; i < 199; i++) game.wearEquipment("weapon");
  assert.equal(game.equipment.weapon.durability, 0);
  assert.equal(game.wearEquipment("weapon"), null);
  assert.equal(game.equipment.weapon.durability, 0);
  // Wearing an empty slot is a no-op too.
  assert.equal(game.wearEquipment("weapon"), null);
  // And the worn values survive a reload.
  const reloaded = createProgression(storage, line(10));
  assert.deepEqual(reloaded.equipment, { weapon: { key: "emberSword", tier: "ember", durability: 0 },
    armor: { key: "stoneArmor", tier: "stone", durability: 99 },
    tool: { key: "starPickaxe", tier: "star", durability: 299 } });
});

test("repairing restores a piece to full and deducts the tier's cost; short materials block it", () => {
  const gear = { weapon: { key: "emberSword", tier: "ember", durability: 150 }, armor: null, tool: null };
  const storage = makeStorage([[SAVE_KEY, saveWithGear(gear)]]);
  const game = createProgression(storage, line(10));
  assert.ok(game.repairEquipment("weapon").saved);
  assert.deepEqual(game.equipment.weapon, { key: "emberSword", tier: "ember", durability: 200 });
  assert.equal(game.count(BLOCK.STONE), 5);
  assert.equal(game.count("emberCore"), 0);
  // Already full: nothing to repair.
  assert.equal(game.repairEquipment("weapon"), null);
  // No piece in the slot: nothing to repair.
  assert.equal(game.repairEquipment("armor"), null);
  // Short on stone: the repair is refused and the durability stays put.
  const poor = makeStorage([[SAVE_KEY, saveWithGear(gear, [0, 0, 0, 4, 0, 0])]]);
  const poorGame = createProgression(poor, line(10));
  assert.equal(poorGame.repairEquipment("weapon"), null);
  assert.equal(poorGame.equipment.weapon.durability, 150);
  assert.equal(poorGame.count(BLOCK.STONE), 4);
  // Short on the rare material: same refusal (stone alone is not enough).
  const noCore = makeStorage([[SAVE_KEY, saveWithGear(gear, [0, 0, 0, 10, 0, 0], { emberCore: 0, starShard: 1 })]]);
  const noCoreGame = createProgression(noCore, line(10));
  assert.equal(noCoreGame.repairEquipment("weapon"), null);
  assert.equal(noCoreGame.equipment.weapon.durability, 150);
  // No workbench yet: no repair at all (the repair lives at the bench).
  const noBench = makeStorage([[SAVE_KEY, saveWithGear(gear, [0, 0, 0, 10, 0, 0], { emberCore: 1, starShard: 1 }, false)]]);
  const noBenchGame = createProgression(noBench, line(10));
  assert.equal(noBenchGame.repairEquipment("weapon"), null);
  assert.equal(noBenchGame.equipment.weapon.durability, 150);
});

test("a quota failure rolls a repair back, materials and durability together", () => {
  const gear = { weapon: { key: "emberSword", tier: "ember", durability: 150 }, armor: null, tool: null };
  const storage = makeStorage([[SAVE_KEY, saveWithGear(gear)]]);
  const game = createProgression(storage, line(10));
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  assert.deepEqual(game.repairEquipment("weapon"), { saved: false, reason: "quota" });
  assert.equal(game.equipment.weapon.durability, 150);
  assert.equal(game.count(BLOCK.STONE), 10);
  assert.equal(game.count("emberCore"), 1);
});

test("a stored durability is clamped into [0, max]; a non-integer one loads full", () => {
  const gear = { weapon: { key: "emberSword", tier: "ember", durability: 999 },
    armor: { key: "stoneArmor", tier: "stone", durability: -5 },
    tool: { key: "starPickaxe", tier: "star", durability: 1.5 } };
  const storage = makeStorage([[SAVE_KEY, saveWithGear(gear)]]);
  const game = createProgression(storage, line(10));
  assert.equal(game.equipment.weapon.durability, 200);
  assert.equal(game.equipment.armor.durability, 0);
  assert.equal(game.equipment.tool.durability, 300);
});

// Farming (R2): seeds and crops in the v5 save.

test("a v5 save loads its seeds and crops, dropping bad entries and repairing the stage", () => {
  const save = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 },
    seeds: { wheatSeed: 5, wheat: 3, dragonScale: 9 },
    crops: { 3: { crop: "wheat", stage: 0, plantedAt: 10, growth: 130, fertilized: false },
      4: { crop: "wheat", stage: 2, plantedAt: 0, growth: 240, fertilized: true, watered: false },
      5: { crop: "dragonfruit", stage: 0, plantedAt: 0, growth: 0 },
      6: { crop: "wheat", stage: 0, plantedAt: 0, growth: -5 },
      99: { crop: "wheat", stage: 0, plantedAt: 0, growth: 0, fertilized: false } } });
  const game = createProgression(makeStorage([[SAVE_KEY, save]]), line(10));
  assert.deepEqual(game.seeds, { wheatSeed: 5, wheat: 3, fertilizer: 0 });
  // Cell 3's stored stage 0 disagrees with its growth (130s is stage 1):
  // the stage is recomputed from the growth on load. Cell 4's stored
  // fertilized flag survives the load. The unknown crop, the negative
  // growth and the out-of-range cell are all dropped.
  assert.deepEqual(game.crops, {
    3: { crop: "wheat", stage: 1, plantedAt: 10, growth: 130, fertilized: false, watered: false },
    4: { crop: "wheat", stage: 2, plantedAt: 0, growth: 240, fertilized: true, watered: false }
  });
  assert.equal(game.isCropMature(voxelIndex(line(10), 3, 0, 0)), false);
  assert.equal(game.isCropMature(voxelIndex(line(10), 4, 0, 0)), true);
  assert.equal(game.isCropMature(voxelIndex(line(10), 5, 0, 0)), false);
});

test("planting spends one seed, starts the clock, and counts the planting", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  const cell = voxelIndex(line(10), 3, 0, 0);
  // The fresh save starts with the 2 starter seeds.
  assert.equal(game.count("wheatSeed"), 2);
  assert.ok(game.plantCrop(cell, "wheat", 30).saved);
  assert.equal(game.count("wheatSeed"), 1);
  assert.deepEqual(game.cropAt(cell), { crop: "wheat", stage: 0, plantedAt: 30, growth: 0, fertilized: false, watered: false });
  assert.deepEqual(game.stats, { blocksMined: 0, cropsPlanted: 1, cropsHarvested: 0 });
  // The same cell twice, an unknown crop, a bad cell and a bad clock
  // are all refused — and a second seed plants a second cell.
  assert.equal(game.plantCrop(cell, "wheat", 31), null);
  assert.equal(game.plantCrop(voxelIndex(line(10), 4, 0, 0), "dragonfruit", 31), null);
  assert.equal(game.plantCrop(99, "wheat", 31), null);
  assert.equal(game.plantCrop(voxelIndex(line(10), 5, 0, 0), "wheat", -1), null);
  assert.ok(game.plantCrop(voxelIndex(line(10), 4, 0, 0), "wheat", 31).saved);
  assert.equal(game.count("wheatSeed"), 0);
  // No seeds left: a third planting is refused.
  assert.equal(game.plantCrop(voxelIndex(line(10), 5, 0, 0), "wheat", 32), null);
  // The planting persists across a reload.
  const reloaded = createProgression(storage, line(10));
  assert.deepEqual(reloaded.cropAt(cell), { crop: "wheat", stage: 0, plantedAt: 30, growth: 0, fertilized: false, watered: false });
  assert.equal(reloaded.count("wheatSeed"), 0);
  assert.equal(reloaded.stats.cropsPlanted, 2);
});

test("a quota failure rolls a planting back, seed and crop together", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  const cell = voxelIndex(line(10), 3, 0, 0);
  assert.deepEqual(game.plantCrop(cell, "wheat", 30), { saved: false, reason: "quota" });
  assert.equal(game.count("wheatSeed"), 2);
  assert.equal(game.cropAt(cell), null);
  assert.equal(game.stats.cropsPlanted, 0);
});

test("harvesting pays the yield only when mature, and counts the harvest", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  const cell = voxelIndex(line(10), 3, 0, 0);
  const empty = voxelIndex(line(10), 4, 0, 0);
  assert.ok(game.plantCrop(cell, "wheat", 0).saved);
  // Nothing planted, and an immature crop, are both refused.
  assert.equal(game.harvestCrop(empty), null);
  assert.equal(game.harvestCrop(cell), null);
  assert.equal(game.count("wheat"), 0);
  // A full day of growth matures it; the harvest pays 2 wheat and the
  // seed back, and the cell is empty again.
  assert.deepEqual(game.advanceCrops(240, false), { saved: true });
  assert.equal(game.isCropMature(cell), true);
  const result = game.harvestCrop(cell);
  assert.deepEqual(result, { saved: true, yield: [["wheat", 2], ["wheatSeed", 1]] });
  assert.equal(game.count("wheat"), 2);
  assert.equal(game.count("wheatSeed"), 2);
  assert.equal(game.cropAt(cell), null);
  assert.deepEqual(game.stats, { blocksMined: 0, cropsPlanted: 1, cropsHarvested: 1 });
  assert.deepEqual(game.flush(), { saved: true });
});

test("a quota failure rolls a harvest back, yield and crop together", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  const cell = voxelIndex(line(10), 3, 0, 0);
  assert.ok(game.plantCrop(cell, "wheat", 0).saved);
  assert.deepEqual(game.advanceCrops(240, false), { saved: true });
  assert.deepEqual(game.flush(), { saved: true });
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  assert.deepEqual(game.harvestCrop(cell), { saved: false, reason: "quota" });
  assert.equal(game.count("wheat"), 0);
  assert.equal(game.count("wheatSeed"), 1);
  assert.deepEqual(game.cropAt(cell), { crop: "wheat", stage: 2, plantedAt: 0, growth: 240, fertilized: false, watered: false });
  assert.equal(game.stats.cropsHarvested, 0);
});

// Farming (R3): fertilizer.

// A save with leaves to compost with: the starter save has 0 leaves.
function leafySave() {
  return JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 0, 2, 10], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
}

test("crafting compost spends leaves and dirt and credits the farm counts", () => {
  const game = createProgression(makeStorage([[SAVE_KEY, leafySave()]]), line(10));
  // Leaves 10, dirt 10: the recipe (leaves 2 + dirt 1) is affordable,
  // and it needs no workbench — it is mixed by hand like a dressing.
  assert.equal(game.canCraft("fertilizer"), true);
  assert.ok(game.craft("fertilizer").saved);
  assert.equal(game.count("fertilizer"), 1);
  assert.equal(game.count(BLOCK.LEAF), 8);
  assert.equal(game.count(BLOCK.DIRT), 9);
  // 10 leaves make 5 composts, then the leaves run out.
  assert.ok(game.craft("fertilizer").saved);
  assert.ok(game.craft("fertilizer").saved);
  assert.ok(game.craft("fertilizer").saved);
  assert.ok(game.craft("fertilizer").saved);
  assert.equal(game.count("fertilizer"), 5);
  assert.equal(game.count(BLOCK.LEAF), 0);
  assert.equal(game.canCraft("fertilizer"), false);
  assert.equal(game.craft("fertilizer"), null);
  // At the stack limit the recipe is refused, like a dressing.
  const full = createProgression(makeStorage([[SAVE_KEY, JSON.stringify({ version: 5, edits: [],
    materials: [0, 0, 10, 0, 2, 10], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 },
    seeds: { wheatSeed: 2, wheat: 0, fertilizer: 999 } })]]), line(10));
  assert.equal(full.canCraft("fertilizer"), false);
  assert.equal(full.craft("fertilizer"), null);
});

test("fertilizing spends one compost, sets the flag for the whole cycle, and refuses repeats", () => {
  const storage = makeStorage([[SAVE_KEY, leafySave()]]);
  const game = createProgression(storage, line(10));
  const cell = voxelIndex(line(10), 3, 0, 0);
  const other = voxelIndex(line(10), 4, 0, 0);
  // No crop here, and no compost yet: both are refused.
  assert.equal(game.fertilizeCrop(cell), null);
  assert.ok(game.plantCrop(cell, "wheat", 0).saved);
  assert.equal(game.fertilizeCrop(cell), null);
  // One compost, then the flag is set and the compost is spent.
  assert.ok(game.craft("fertilizer").saved);
  assert.ok(game.fertilizeCrop(cell).saved);
  assert.equal(game.count("fertilizer"), 0);
  assert.deepEqual(game.cropAt(cell), { crop: "wheat", stage: 0, plantedAt: 0, growth: 0, fertilized: true, watered: false });
  // A second dose on the same plant is refused — it would not stack.
  assert.equal(game.fertilizeCrop(cell), null);
  // Another plant can be fertilized with another compost.
  assert.ok(game.craft("fertilizer").saved);
  assert.ok(game.plantCrop(other, "wheat", 0).saved);
  assert.ok(game.fertilizeCrop(other).saved);
  assert.equal(game.count("fertilizer"), 0);
  // The flag persists across a reload.
  const reloaded = createProgression(storage, line(10));
  assert.equal(reloaded.cropAt(cell).fertilized, true);
  assert.equal(reloaded.cropAt(other).fertilized, true);
});

test("a quota failure rolls a fertilizing back, compost and flag together", () => {
  const storage = makeStorage([[SAVE_KEY, leafySave()]]);
  const game = createProgression(storage, line(10));
  const cell = voxelIndex(line(10), 3, 0, 0);
  assert.ok(game.plantCrop(cell, "wheat", 0).saved);
  assert.ok(game.craft("fertilizer").saved);
  assert.deepEqual(game.flush(), { saved: true });
  const quota = new Error("quota exceeded");
  quota.name = "QuotaExceededError";
  storage.setItem = () => { throw quota; };
  assert.deepEqual(game.fertilizeCrop(cell), { saved: false, reason: "quota" });
  assert.equal(game.count("fertilizer"), 1);
  assert.equal(game.cropAt(cell).fertilized, false);
});

test("a fertilized crop grows twice as fast, four times in the rain", () => {
  const game = createProgression(makeStorage([[SAVE_KEY, leafySave()]]), line(10));
  const fed = voxelIndex(line(10), 3, 0, 0);
  const plain = voxelIndex(line(10), 4, 0, 0);
  assert.ok(game.plantCrop(fed, "wheat", 0).saved);
  assert.ok(game.plantCrop(plain, "wheat", 0).saved);
  assert.ok(game.craft("fertilizer").saved);
  assert.ok(game.fertilizeCrop(fed).saved);
  // 60s dry: the fertilized crop gains 120s, the plain one 60s.
  assert.deepEqual(game.advanceCrops(60, false), { saved: true });
  assert.equal(game.cropAt(fed).growth, 120);
  assert.equal(game.cropAt(plain).growth, 60);
  assert.equal(game.cropAt(fed).stage, 1);
  assert.equal(game.cropAt(plain).stage, 0);
  // 30s of rain: the fertilized crop gains 120s more (x4), the plain
  // one 60s (x2) — the fertilized crop is mature at 240s.
  assert.deepEqual(game.advanceCrops(30, true), { saved: true });
  assert.equal(game.cropAt(fed).growth, 240);
  assert.equal(game.cropAt(plain).growth, 120);
  assert.equal(game.isCropMature(fed), true);
  assert.equal(game.isCropMature(plain), false);
});

test("crafting the watering can grants a durable tool, and watering spends nothing", () => {
  const canSave = () => JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 0, 3, 10], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  const storage = makeStorage([[SAVE_KEY, canSave()]]);
  const game = createProgression(storage, line(10));
  const cell = voxelIndex(line(10), 3, 0, 0);
  assert.ok(game.plantCrop(cell, "wheat", 0).saved);
  // No can yet: watering is refused even on a planted crop.
  assert.equal(game.wateringCanOwned, false);
  assert.equal(game.waterCrop(cell), null);
  // Crafting the can (wood 3 + leaf 2, no workbench) grants it for
  // good: it cannot be crafted twice, and it survives a reload.
  assert.equal(game.canCraft("wateringCan"), true);
  assert.ok(game.craft("wateringCan").saved);
  assert.equal(game.wateringCanOwned, true);
  assert.equal(game.count(BLOCK.WOOD), 0);
  assert.equal(game.count(BLOCK.LEAF), 8);
  assert.equal(game.canCraft("wateringCan"), false);
  assert.equal(game.craft("wateringCan"), null);
  // One watering sets the flag and spends nothing; a repeat is
  // refused (it would not stack), and the flag survives a reload.
  assert.ok(game.waterCrop(cell).saved);
  assert.deepEqual(game.cropAt(cell), { crop: "wheat", stage: 0, plantedAt: 0, growth: 0, fertilized: false, watered: true });
  assert.equal(game.waterCrop(cell), null);
  const reloaded = createProgression(storage, line(10));
  assert.equal(reloaded.wateringCanOwned, true);
  assert.equal(reloaded.cropAt(cell).watered, true);
});

test("a watered crop grows twice as fast, eight times watered and fertilized in the rain", () => {
  const storage = makeStorage([[SAVE_KEY, JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 0, 3, 10],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 }, seeds: { wheatSeed: 5, wheat: 0, fertilizer: 0 } })]]);
  const game = createProgression(storage, line(10));
  const plain = voxelIndex(line(10), 3, 0, 0), watered = voxelIndex(line(10), 4, 0, 0), both = voxelIndex(line(10), 5, 0, 0);
  assert.ok(game.craft("wateringCan").saved);
  assert.ok(game.craft("fertilizer").saved);
  for (const cell of [plain, watered, both]) assert.ok(game.plantCrop(cell, "wheat", 0).saved);
  assert.ok(game.waterCrop(watered).saved);
  assert.ok(game.waterCrop(both).saved);
  assert.ok(game.fertilizeCrop(both).saved);
  // 30 seconds of rain: the plain crop gets x2 (rain), the watered
  // x4 (rain x watering), the watered + fertilized x8.
  assert.deepEqual(game.advanceCrops(30, true), { saved: true });
  assert.equal(game.cropAt(plain).growth, 60);
  assert.equal(game.cropAt(watered).growth, 120);
  assert.equal(game.cropAt(both).growth, 240);
});

test("the harvest tech pays +1 on every yield entry once 20 harvests unlock it", () => {
  const richSave = cropsHarvested => JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 },
    stats: { blocksMined: 0, cropsPlanted: 0, cropsHarvested } });
  const cell = voxelIndex(line(10), 3, 0, 0);
  // One harvest short: the branch stays locked.
  const locked = createProgression(makeStorage([[SAVE_KEY, richSave(19)]]), line(10));
  assert.equal(locked.unlockTech("bountifulHarvest"), null);
  // At 20 the unlock lands, and a mature wheat pays 3 wheat + 2 seeds.
  const storage = makeStorage([[SAVE_KEY, richSave(20)]]);
  const game = createProgression(storage, line(10));
  assert.ok(game.unlockTech("bountifulHarvest").saved);
  assert.ok(game.plantCrop(cell, "wheat", 0).saved);
  assert.deepEqual(game.advanceCrops(240, false), { saved: true });
  const result = game.harvestCrop(cell);
  assert.deepEqual(result, { saved: true, yield: [["wheat", 3], ["wheatSeed", 2]] });
  assert.equal(game.count("wheat"), 3);
  // Seeds: 2 starter - 1 planted + 2 paid by the bonused yield.
  assert.equal(game.count("wheatSeed"), 3);
});

test("uprooting removes a crop without a yield", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  const cell = voxelIndex(line(10), 3, 0, 0);
  assert.equal(game.removeCrop(cell), null);
  assert.ok(game.plantCrop(cell, "wheat", 0).saved);
  assert.ok(game.removeCrop(cell).saved);
  assert.equal(game.cropAt(cell), null);
  assert.equal(game.count("wheat"), 0);
  assert.equal(game.count("wheatSeed"), 1);
  assert.equal(game.stats.cropsHarvested, 0);
});

test("advanceCrops grows on game time, doubles in the rain, and batches the write", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  const cell = voxelIndex(line(10), 3, 0, 0);
  // No crops: a tick is a no-op and marks nothing dirty.
  assert.deepEqual(game.advanceCrops(10, false), { saved: true });
  assert.equal(game.pendingSave, false);
  assert.ok(game.plantCrop(cell, "wheat", 0).saved);
  const before = storage.getItem(SAVE_KEY);
  // 100s at the base rate: still stage 0 (a stage lasts 120s).
  assert.deepEqual(game.advanceCrops(100, false), { saved: true });
  assert.deepEqual(game.cropAt(cell), { crop: "wheat", stage: 0, plantedAt: 0, growth: 100, fertilized: false, watered: false });
  // 20s more crosses the stage boundary — but the write is batched, so
  // the storage text is unchanged until the flush.
  assert.deepEqual(game.advanceCrops(20, false), { saved: true });
  assert.deepEqual(game.cropAt(cell), { crop: "wheat", stage: 1, plantedAt: 0, growth: 120, fertilized: false, watered: false });
  assert.equal(game.pendingSave, true);
  assert.equal(storage.getItem(SAVE_KEY), before);
  assert.deepEqual(game.flush(), { saved: true });
  assert.equal(game.pendingSave, false);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).crops[cell].growth, 120);
  // Rain doubles the rate: 60s of rain is 120s of growth, and the crop
  // is mature at 240s.
  assert.deepEqual(game.advanceCrops(60, true), { saved: true });
  assert.deepEqual(game.cropAt(cell), { crop: "wheat", stage: 2, plantedAt: 0, growth: 240, fertilized: false, watered: false });
  assert.equal(game.isCropMature(cell), true);
  // A zero or negative tick is a no-op.
  assert.deepEqual(game.advanceCrops(0, false), { saved: true });
  assert.deepEqual(game.advanceCrops(-5, false), { saved: true });
  assert.deepEqual(game.cropAt(cell), { crop: "wheat", stage: 2, plantedAt: 0, growth: 240, fertilized: false, watered: false });
  assert.deepEqual(game.flush(), { saved: true });
});

test("a spitter kill pays its seed, and string counts route to the right table", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  // The starter seeds plus one spitter kill.
  assert.equal(game.count("wheatSeed"), 2);
  assert.ok(game.grantLoot("spitter").saved);
  assert.equal(game.count("wheatSeed"), 3);
  assert.equal(game.count(BLOCK.STONE), 1);
  assert.equal(game.count(BLOCK.LEAF), 2);
  assert.equal(game.count("wheat"), 0);
  // A boss material still routes to the rare table, not the seeds.
  assert.ok(game.grantBossLoot("boss", 1).saved);
  assert.equal(game.count("emberCore"), 1);
  assert.equal(game.count("wheatSeed"), 3);
  assert.equal(game.count("nope"), 0);
});

test("an export/import round-trip carries seeds and crops", () => {
  const storage = makeStorage();
  const game = createProgression(storage, line(10));
  const cell = voxelIndex(line(10), 3, 0, 0);
  assert.ok(game.plantCrop(cell, "wheat", 5).saved);
  assert.deepEqual(game.advanceCrops(130, false), { saved: true });
  assert.deepEqual(game.flush(), { saved: true });
  const exported = game.exportSave();
  const storage2 = makeStorage();
  const game2 = createProgression(storage2, line(10));
  assert.deepEqual(game2.importSave(exported), { imported: true });
  assert.deepEqual(game2.cropAt(cell), { crop: "wheat", stage: 1, plantedAt: 5, growth: 130, fertilized: false, watered: false });
  assert.equal(game2.count("wheatSeed"), 1);
  assert.equal(game2.stats.cropsPlanted, 1);
  // Importing a save with no crops clears the planted ones.
  const bare = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 10, 0, 2, 0], axeUnlocked: false,
    dressings: { dressing: 0, bandage: 0, bigDressing: 0 } });
  assert.deepEqual(game2.importSave(bare), { imported: true });
  assert.deepEqual(game2.crops, {});
  assert.equal(game2.count("wheatSeed"), 2);
});

// ---- Batch 83: save-compatibility audit --------------------------------
// Each historical version's real stored shape, loaded whole on the
// current version: fields reconcile, fields added later land on
// their documented defaults (never undefined), and the loaded state
// saves back as v5 and reads back identical (round-trip). Migration
// fragments (corrupt fallbacks, wrong versions, edit mixing) are
// covered by the tests above; this battery is the whole-save pass.

function stateOf(game) {
  return {
    edits: [...game.blockEdits()].sort((a, b) => a[0] - b[0]),
    materials: [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.WOOD, BLOCK.LEAF].map(block => game.count(block)),
    axeUnlocked: game.axeUnlocked, wateringCanOwned: game.wateringCanOwned,
    dressings: game.dressingsByRecipe, rare: game.rareMaterials, seeds: game.seeds,
    crops: game.crops, equipment: game.equipment, tech: game.techUnlocked,
    workbenchBuilt: game.workbenchBuilt, stats: game.stats
  };
}

// The defaults every pre-field save must land on: no watering can,
// starter seeds, no crops, empty slots, no tech, no workbench,
// zeroed counters, no rare materials.
const LATER_DEFAULTS = {
  wateringCanOwned: false,
  rare: { emberCore: 0, starShard: 0 },
  seeds: { wheatSeed: 2, wheat: 0, fertilizer: 0 },
  crops: {}, equipment: { weapon: null, armor: null, tool: null },
  tech: [], workbenchBuilt: false,
  stats: { blocksMined: 0, cropsPlanted: 0, cropsHarvested: 0 }
};

function assertLaterDefaults(game) {
  const state = stateOf(game);
  for (const field of Object.keys(LATER_DEFAULTS)) assert.deepEqual(state[field], LATER_DEFAULTS[field], field);
}

// Load -> reconcile -> save back (a loot grant, a synchronous save)
// -> reload: the second load must equal the first game's state.
function roundTrip(storage, layout) {
  const first = createProgression(storage, layout);
  const loaded = stateOf(first);
  first.grantLoot("walker");
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).version, SAVE_VERSION);
  const second = createProgression(storage, layout);
  assert.deepEqual(stateOf(second), stateOf(first), "the written v5 save reads back identical");
  return loaded;
}

test("audit: a v4 save (per-recipe dressings, nothing later) loads whole and round-trips", () => {
  const fixture = JSON.stringify({ version: 4, edits: [[3, 0, 0, BLOCK.STONE], [7, 0, 0, BLOCK.WOOD]],
    materials: [0, 5, 6, 7, 8, 9], axeUnlocked: true,
    dressings: { dressing: 2, bandage: 1, bigDressing: 0 } });
  const storage = makeStorage([[V4_SAVE_KEY, fixture]]);
  const loaded = roundTrip(storage, line(20));
  assert.deepEqual(loaded.edits, [[3, BLOCK.STONE], [7, BLOCK.WOOD]]);
  assert.deepEqual(loaded.materials, [5, 6, 7, 8, 9]);
  assert.equal(loaded.axeUnlocked, true);
  assert.deepEqual(loaded.dressings, { dressing: 2, bandage: 1, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  const game = createProgression(storage, line(20));
  assertLaterDefaults(game);
  assert.equal(storage.getItem(V4_SAVE_KEY), fixture, "the old key is left untouched");
});

test("audit: a v3 save (single dressing count) loads whole and round-trips", () => {
  const fixture = JSON.stringify({ version: 3, edits: [[4, 0, 0, BLOCK.DIRT]],
    materials: [0, 1, 2, 3, 4, 5], axeUnlocked: false, dressings: 3 });
  const storage = makeStorage([[V3_SAVE_KEY, fixture]]);
  const loaded = roundTrip(storage, line(20));
  assert.deepEqual(loaded.edits, [[4, BLOCK.DIRT]]);
  assert.deepEqual(loaded.materials, [1, 2, 3, 4, 5]);
  assert.deepEqual(loaded.dressings, { dressing: 3, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  assertLaterDefaults(createProgression(storage, line(20)));
});

test("audit: a v2 save lands the later fields on their defaults and round-trips", () => {
  const oldCell = voxelIndex(LEGACY_WORLD, 25, 9, 27);
  const fixture = JSON.stringify({ version: 2, edits: [[oldCell, BLOCK.WOOD]],
    materials: [0, 7, 12, 8, 3, 2], axeUnlocked: true, dressings: 4 });
  const storage = makeStorage([[PREVIOUS_SAVE_KEY, fixture]]);
  const loaded = roundTrip(storage, WORLD);
  assert.deepEqual(loaded.edits, [[voxelIndex(WORLD, 25, 9, 27), BLOCK.WOOD]]);
  assert.deepEqual(loaded.materials, [7, 12, 8, 3, 2]);
  assert.equal(loaded.dressings.dressing, 4);
  assertLaterDefaults(createProgression(storage, WORLD));
});

test("audit: a legacy v1 edit list loads with starter supplies and round-trips", () => {
  const fixture = JSON.stringify([[2, BLOCK.WOOD], [9, BLOCK.AIR]]);
  const storage = makeStorage([[LEGACY_KEY, fixture]]);
  const loaded = roundTrip(storage, line(20));
  assert.deepEqual(loaded.edits, [[2, BLOCK.WOOD], [9, BLOCK.AIR]]);
  // No supplies in v1 at all: the starter kit stands in (dirt 10,
  // wood 2), everything else at its default.
  assert.deepEqual(loaded.materials, [0, 10, 0, 2, 0]);
  assert.deepEqual(loaded.dressings, { dressing: 0, bandage: 0, bigDressing: 0, bakedWheat: 0, veggieSalad: 0, stew: 0 });
  assertLaterDefaults(createProgression(storage, line(20)));
  assert.equal(storage.getItem(LEGACY_KEY), fixture, "the legacy key is left untouched");
});

test("audit: a v5 save missing every later field loads on defaults and round-trips", () => {
  const fixture = JSON.stringify({ version: 5, edits: [[1, 0, 0, BLOCK.STONE]], materials: [0, 3, 3, 3, 3, 3] });
  const storage = makeStorage([[SAVE_KEY, fixture]]);
  const loaded = roundTrip(storage, line(20));
  assert.deepEqual(loaded.edits, [[1, BLOCK.STONE]]);
  assert.deepEqual(loaded.materials, [3, 3, 3, 3, 3]);
  assert.equal(loaded.axeUnlocked, false);
  assertLaterDefaults(createProgression(storage, line(20)));
});

test("audit: pre-R6 crops and a durability-less piece land on their defaults", () => {
  // Crops written before the watering round have no `watered` flag;
  // a piece written before durability was tracked has none either.
  // Both must load as unwatered / fully durable — never undefined —
  // and a stored stage that disagrees with the growth is recomputed.
  const fixture = JSON.stringify({ version: 5, edits: [], materials: [0, 0, 0, 0, 0, 0],
    axeUnlocked: true, wateringCanOwned: true, dressings: { dressing: 1 },
    rareMaterials: { emberCore: 2 }, equipment: { weapon: { key: "emberSword", tier: "ember" } },
    techUnlocked: ["workbench"], workbenchBuilt: true, stats: { blocksMined: 12 },
    seeds: { wheatSeed: 3, wheat: 1, fertilizer: 0 },
    crops: { "5": { crop: "wheat", stage: 0, plantedAt: 100, growth: 40000, fertilized: true } } });
  const storage = makeStorage([[SAVE_KEY, fixture]]);
  const game = createProgression(storage, line(20));
  const crop = game.cropAt(5);
  assert.equal(crop.watered, false);
  assert.equal(crop.fertilized, true);
  assert.equal(crop.stage, growthStage(CROPS.wheat, 40000), "the stage is recomputed from growth, not trusted");
  assert.deepEqual(game.equipment.weapon, { key: "emberSword", tier: "ember", durability: 200 });
  assert.equal(game.stats.blocksMined, 12);
  assert.equal(game.stats.cropsHarvested, 0, "a missing counter lands on 0");
  const loaded = roundTrip(storage, line(20));
  assert.equal(loaded.crops["5"].watered, false);
  assert.equal(loaded.equipment.weapon.durability, 200);
});
