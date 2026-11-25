import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK, LEGACY_KEY, PREVIOUS_SAVE_KEY, SAVE_KEY, createProgression } from "./progression.mjs";
import { LEGACY_WORLD, WORLD, voxelIndex } from "./terrain.mjs";

const line = width => ({ minX: 0, minZ: 0, width, height: 1, depth: 1 });

function makeStorage(entries = []) {
  const data = new Map(entries);
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
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
  assert.deepEqual(game.editBlock(1, BLOCK.WOOD, BLOCK.AIR, true), { saved: false });
  assert.equal(game.count(BLOCK.WOOD), 3);
  assert.deepEqual([...game.blockEdits()], [[1, BLOCK.AIR]]);
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
