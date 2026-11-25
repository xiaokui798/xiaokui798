import { WORLD, LEGACY_WORLD, contains, voxelIndex, voxelPosition } from "./terrain.mjs";

export const BLOCK = Object.freeze({ AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAF: 5 });
export const SAVE_KEY = "block-world:save:v3";
export const PREVIOUS_SAVE_KEY = "block-world:save:v2";
export const LEGACY_KEY = "block-world:edits:v1";
export const RECIPES = Object.freeze({
  axe: { name: "石斧", cost: [[BLOCK.STONE, 3], [BLOCK.WOOD, 2]] },
  dressing: { name: "树叶敷料", cost: [[BLOCK.LEAF, 2]], healing: 30 }
});

const starterMaterials = [0, 0, 10, 0, 2, 0];
const stackLimit = 999;
const validBlock = value => Number.isInteger(value) && value >= BLOCK.AIR && value <= BLOCK.LEAF;

export function createProgression(storage, layout = WORLD) {
  function readText(key) {
    try { return storage?.getItem(key) ?? null; }
    catch { return null; }
  }

  function parse(value) {
    try { return JSON.parse(value ?? "null"); }
    catch { return null; }
  }

  let lastSave = readText(SAVE_KEY);
  const previous = readText(PREVIOUS_SAVE_KEY);
  const legacy = readText(LEGACY_KEY);
  const stored = parse(lastSave);
  const old = parse(previous);
  const current = stored?.version === 3 ? stored : null;
  const snapshot = current ?? (old?.version === 2 ? old : null);
  const coordinatesStored = current && Array.isArray(current.edits);
  const savedEdits = coordinatesStored ? current.edits : (old?.version === 2 && Array.isArray(old.edits) ? old.edits : parse(legacy));
  let migrating = !current;
  const edits = new Map();
  const cellCount = layout.width * layout.height * layout.depth;
  const oldCellCount = LEGACY_WORLD.width * LEGACY_WORLD.height * LEGACY_WORLD.depth;
  const validCell = value => Number.isInteger(value) && value >= 0 && value < cellCount;
  if (Array.isArray(savedEdits)) {
    for (const entry of savedEdits) {
      if (!Array.isArray(entry)) continue;
      let position, block;
      if (coordinatesStored && entry.length === 4) {
        position = entry.slice(0, 3);
        block = entry[3];
      } else if (!coordinatesStored && entry.length === 2 && Number.isInteger(entry[0]) && entry[0] >= 0 && entry[0] < oldCellCount) {
        position = voxelPosition(LEGACY_WORLD, entry[0]);
        block = entry[1];
      }
      if (position?.every(Number.isInteger) && contains(layout, ...position) && validBlock(block)) {
        edits.set(voxelIndex(layout, ...position), block);
      }
    }
  }
  function savedCount(value, fallback) {
    return Number.isInteger(value) && value >= 0 ? Math.min(value, stackLimit) : fallback;
  }
  const materials = starterMaterials.map((amount, block) => block ? savedCount(snapshot?.materials?.[block], amount) : 0);
  let axeUnlocked = snapshot?.axeUnlocked === true;
  let dressings = savedCount(snapshot?.dressings, 0);

  function isStale() {
    return Boolean(storage && (storage.getItem(SAVE_KEY) !== lastSave || (migrating &&
      (storage.getItem(PREVIOUS_SAVE_KEY) !== previous || storage.getItem(LEGACY_KEY) !== legacy))));
  }

  function save() {
    if (!storage) return { saved: false };
    try {
      if (isStale()) return { saved: false, conflict: true };
      const positions = Array.from(edits, ([cell, block]) => [...voxelPosition(layout, cell), block]);
      const updated = JSON.stringify({ version: 3, edits: positions, materials, axeUnlocked, dressings });
      storage.setItem(SAVE_KEY, updated);
      lastSave = updated;
      migrating = false;
      return { saved: true };
    } catch {
      return { saved: false };
    }
  }

  function change(apply, cell) {
    const previousMaterials = materials.slice(), previousAxe = axeUnlocked, previousDressings = dressings;
    const priorBlock = edits.get(cell);
    apply();
    const result = save();
    if (result.conflict) {
      materials.splice(0, materials.length, ...previousMaterials);
      axeUnlocked = previousAxe;
      dressings = previousDressings;
      if (cell !== undefined) {
        if (priorBlock === undefined) edits.delete(cell);
        else edits.set(cell, priorBlock);
      }
    }
    return result;
  }

  function count(block) { return materials[block] ?? 0; }
  function collect(block) { materials[block] = Math.min(stackLimit, materials[block] + 1); }

  function editBlock(cell, before, after, limited) {
    if (!validCell(cell) || !validBlock(before) || !validBlock(after) || Boolean(before) === Boolean(after)) return null;
    if (limited && after !== BLOCK.AIR && count(after) < 1) return null;
    return change(() => {
      if (limited) {
        if (after !== BLOCK.AIR) materials[after]--;
        else collect(before);
      }
      edits.set(cell, after);
    }, cell);
  }

  function canCraft(key) {
    if (!Object.hasOwn(RECIPES, key)) return false;
    if (key === "axe" ? axeUnlocked : dressings >= stackLimit) return false;
    return RECIPES[key].cost.every(([block, amount]) => count(block) >= amount);
  }

  function craft(key) {
    if (!canCraft(key)) return null;
    return change(() => {
      for (const [block, amount] of RECIPES[key].cost) materials[block] -= amount;
      if (key === "axe") axeUnlocked = true;
      else dressings++;
    });
  }

  function useDressing() {
    if (!dressings) return null;
    return change(() => { dressings--; });
  }

  function grantLoot() {
    return change(() => {
      collect(BLOCK.STONE);
      collect(BLOCK.LEAF);
    });
  }

  function spendMaterial(block, amount) {
    if (!validBlock(block) || block === BLOCK.AIR || !Number.isInteger(amount) || amount <= 0 || count(block) < amount) return null;
    return change(() => { materials[block] -= amount; });
  }

  return {
    blockEdits: () => edits.entries(), count, editBlock, canCraft, craft, useDressing, grantLoot, spendMaterial,
    get stale() { try { return isStale(); } catch { return false; } },
    get axeUnlocked() { return axeUnlocked; },
    get dressings() { return dressings; }
  };
}
