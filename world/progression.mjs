import { WORLD, LEGACY_WORLD, DAY_LENGTH, contains, voxelIndex, voxelPosition } from "./terrain.mjs";
import { BLOCK, RECIPES, validateRecipes } from "./recipes.mjs";
import { ENEMIES, RARE_MATERIALS } from "./enemies.mjs";
import { TECH, TECH_EFFECTS, assertValidTech, canUnlockTech, techForRecipe } from "./tech.mjs";
import { DURABILITY_MAX, REPAIR_COSTS, assertValidDurability, durabilityMax, repairCost } from "./durability.mjs";
import { CROPS, FARM_MATERIALS, STARTER_SEEDS, RAIN_GROWTH_MULTIPLIER, FERTILIZER_GROWTH_MULTIPLIER, WATERING_GROWTH_MULTIPLIER, growthStage, isMature } from "./crops.mjs";
export { BLOCK, RECIPES, RARE_MATERIALS };

// The recipe table is validated once at startup: a bad table (an
// unregistered block in a cost, a healing recipe without a cost, a
// duplicated name) fails the import instead of silently mis-crafting
// later. Exported so tests can check the failure without a bad table.
export function assertValidRecipes(recipes = RECIPES) {
  const { valid, errors } = validateRecipes(recipes, RARE_MATERIALS, FARM_MATERIALS);
  if (!valid) throw new Error(`配方表校验失败：${errors.join("；")}`);
  return true;
}
assertValidRecipes();

// The tech table is validated the same way, against the real recipe
// table so a node that claims to unlock a non-recipe fails the import.
assertValidTech(TECH, RECIPES);
assertValidDurability(DURABILITY_MAX, REPAIR_COSTS, RARE_MATERIALS);

// The healing recipes, in table order: every per-recipe dressing count
// is keyed by one of these.
export const HEALING_KEYS = Object.keys(RECIPES).filter(key => RECIPES[key].healing > 0);

// The cooking recipes (R4), a subset of HEALING_KEYS flagged in the
// table: dishes share the dressings' counts and useDressing road, but
// crafting them needs the workbench and the backpack eats them instead
// of crafting them.
export const COOKING_KEYS = Object.keys(RECIPES).filter(key => RECIPES[key].cooking);

// Boss drops, by boss id ("boss" is the forge guardian, "colossus" is
// the star-shattering colossus): which rare material a boss win pays.
// The count is decided by the caller — 2 for a first kill, 1 for a
// repeat — so this table only maps the boss to its material.
export const BOSS_DROPS = Object.freeze({ boss: "emberCore", colossus: "starShard" });

// The drop table's fallback: an unknown kind pays what every kill used
// to pay, so a kind that somehow spawns unregistered still drops
// something instead of nothing.
const DEFAULT_DROPS = Object.freeze([[BLOCK.STONE, 1], [BLOCK.LEAF, 1]]);

export const SAVE_KEY = "block-world:save:v5";
export const V4_SAVE_KEY = "block-world:save:v4";
export const V3_SAVE_KEY = "block-world:save:v3";
export const PREVIOUS_SAVE_KEY = "block-world:save:v2";
export const LEGACY_KEY = "block-world:edits:v1";
export const PROGRESS_KEY = "block-world:progress:v2";
export const V1_PROGRESS_KEY = "block-world:progress:v1";
export const PROGRESS_VERSION = 2;
export const SAVE_SLOT_1_KEY = "block-world:save:v5:slot1";
export const SAVE_SLOT_2_KEY = "block-world:save:v5:slot2";
export const V4_SLOT_1_KEY = "block-world:save:v4:slot1";
export const V4_SLOT_2_KEY = "block-world:save:v4:slot2";

// The building-save migration chain, newest first. This table is the only
// place that defines the save versions and which key holds each one: the
// version check, the fallback order and the corrupt-newest quarantine all
// come from here, so adding a v5 means adding one entry — not hunting
// version literals through the loader. `shaped` marks the { version,
// edits, materials, axeUnlocked, dressings, rareMaterials, equipment,
// techUnlocked, workbenchBuilt, stats, seeds, crops } saves (v5, v4, v3, v2) apart from
// the bare legacy edits array (v1); `coordinates` says whether the edits
// are [x, y, z, block] (v5, v4, v3) or legacy cell indices (v2 and v1).
// A bump never destroys the old primary or its slots — they stay in the
// chain as fallbacks, so an upgrade that goes wrong still leaves the
// previous save reachable.
// v4 is the first version whose dressings is a per-recipe object
// { dressing, bandage, bigDressing }; v3 and v2 wrote one number counting
// dressings only, which reloadState migrates into that object. v5 adds
// equipment, techUnlocked, workbenchBuilt and stats, and carries the
// rareMaterials field the v4 round added without a bump. The farming
// round (R2) adds seeds and crops the same way — additive with safe
// defaults, so a save written before them existed loads without a bump.
export const SAVE_MIGRATIONS = Object.freeze([
  { version: 5, key: SAVE_KEY, quarantine: true, coordinates: true, shaped: true },
  { version: 4, key: V4_SAVE_KEY, quarantine: true, coordinates: true, shaped: true },
  { version: 3, key: V3_SAVE_KEY, quarantine: true, coordinates: true, shaped: true },
  { version: 2, key: PREVIOUS_SAVE_KEY, quarantine: false, coordinates: false, shaped: true },
  { version: 1, key: LEGACY_KEY, quarantine: false, coordinates: false, shaped: false }
]);

// Rotation slots for the current version: the two saves before the
// primary, newest first. They read as v5 snapshots (same version, shape
// and coordinates) but are not versions themselves, so they are not
// entries in SAVE_MIGRATIONS — the migration chain is untouched. A slot
// never quarantines: a corrupt slot is just skipped, since the primary's
// quarantine already preserves the newest corrupt text. The v4 pair
// stays in the chain so a v5 save that goes wrong can still fall back
// to the last v4 backup.
const SAVE_SLOT_ENTRIES = Object.freeze([
  Object.freeze({ version: 5, key: SAVE_SLOT_1_KEY, quarantine: false, coordinates: true, shaped: true }),
  Object.freeze({ version: 5, key: SAVE_SLOT_2_KEY, quarantine: false, coordinates: true, shaped: true })
]);
const V4_SLOT_ENTRIES = Object.freeze([
  Object.freeze({ version: 4, key: V4_SLOT_1_KEY, quarantine: false, coordinates: true, shaped: true }),
  Object.freeze({ version: 4, key: V4_SLOT_2_KEY, quarantine: false, coordinates: true, shaped: true })
]);

// Normalizes one stored payload against its table entry into the current
// shape, or null when the payload is not that version. Shaped saves (v5,
// v4, v3, v2) are { version, edits, materials, axeUnlocked, dressings,
// rareMaterials, equipment, techUnlocked, workbenchBuilt, stats, seeds, crops } objects;
// the legacy v1 save is a bare array of [cell, block] edits with no
// supplies. `coordinates` says whether the edits are [x, y, z, block]
// (v5, v4, v3) or legacy cell indices (v2 and v1). The dressings field
// is passed through as stored — a number in v3/v2, an object in v4 — and
// reloadState normalizes it into the per-recipe object. The v5 fields
// (equipment, techUnlocked, workbenchBuilt, stats) and rareMaterials are
// additive with safe defaults, so a save written before them existed
// loads without another bump; reloadState normalizes each of them. The
// farming fields (seeds, crops) are additive the same way.
function normalizeSave(entry, stored) {
  if (entry.shaped) {
    if (stored?.version !== entry.version) return null;
    return { edits: Array.isArray(stored.edits) ? stored.edits : null,
      materials: stored.materials, axeUnlocked: stored.axeUnlocked, wateringCanOwned: stored.wateringCanOwned, hunger: stored.hunger, dressings: stored.dressings,
      rareMaterials: stored.rareMaterials, equipment: stored.equipment,
      techUnlocked: stored.techUnlocked, workbenchBuilt: stored.workbenchBuilt, stats: stored.stats,
      seeds: stored.seeds, crops: stored.crops,
      coordinates: entry.coordinates };
  }
  if (!Array.isArray(stored)) return null;
  return { edits: stored, materials: undefined, axeUnlocked: undefined, wateringCanOwned: undefined, hunger: undefined, dressings: undefined,
    rareMaterials: undefined, equipment: undefined, techUnlocked: undefined,
    workbenchBuilt: undefined, stats: undefined, seeds: undefined, crops: undefined, coordinates: false };
}

// The version new saves are written with: the newest entry of the table,
// so the writer can never drift from the migration chain.
export const SAVE_VERSION = SAVE_MIGRATIONS[0].version;

// Run progress lives apart from the building save: survival wave, kills,
// Boss defeats and defense progress. game.js owns the live values (its
// survival.wave / survival.kills, BOSS.id / COLOSSUS.id, defense wave and
// cleared state); this module only persists them. bossesDefeated maps a
// Boss id (e.g. "boss", "colossus") to true once that Boss is defeated.
export function emptyProgress() {
  return { version: PROGRESS_VERSION, wave: 0, kills: 0, bossesDefeated: {}, bossKills: {}, bestWave: 0,
    defense: { wave: 0, cleared: false, bestWave: 0 } };
}

const nonNegativeInt = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function sanitizeProgress(value) {
  const input = value && typeof value === "object" ? value : {};
  const defenseInput = input.defense && typeof input.defense === "object" ? input.defense : {};
  const bossesDefeated = {};
  if (input.bossesDefeated && typeof input.bossesDefeated === "object") {
    for (const [id, defeated] of Object.entries(input.bossesDefeated)) {
      if (defeated === true && id) bossesDefeated[id] = true;
    }
  }
  // Kill counts per boss: only positive whole counts survive (a zero
  // count is the same as never having killed that boss). A kill implies
  // a defeat, so a counted boss is marked defeated even when the old
  // boolean record does not say so; the reverse does not hold — a v1
  // defeat with no count cannot invent one.
  const bossKills = {};
  if (input.bossKills && typeof input.bossKills === "object") {
    for (const [id, count] of Object.entries(input.bossKills)) {
      if (id && nonNegativeInt(count) > 0) bossKills[id] = nonNegativeInt(count);
    }
  }
  for (const id of Object.keys(bossKills)) bossesDefeated[id] = true;
  // The furthest survival wave. `wave` is the legacy field game.js
  // still reads and writes; `bestWave` is the v2 canonical field. Both
  // are kept at the max of the two, so a record merged by the old
  // game.js (which only writes `wave`) and a record written with
  // `bestWave` can never drift apart.
  const furthestWave = Math.max(nonNegativeInt(input.wave), nonNegativeInt(input.bestWave));
  return {
    version: PROGRESS_VERSION,
    wave: furthestWave,
    kills: nonNegativeInt(input.kills),
    bossesDefeated,
    bossKills,
    bestWave: furthestWave,
    defense: {
      wave: nonNegativeInt(defenseInput.wave),
      cleared: defenseInput.cleared === true,
      bestWave: nonNegativeInt(defenseInput.bestWave)
    }
  };
}

// Records one boss kill: the kill count for that boss goes up by one,
// and the boss is marked defeated. Returns a new record; the input is
// not mutated. game.js calls this from the boss-win path before saving.
export function recordBossKill(progress, bossId) {
  const record = sanitizeProgress(progress);
  if (!bossId) return record;
  record.bossKills[bossId] = (record.bossKills[bossId] ?? 0) + 1;
  record.bossesDefeated[bossId] = true;
  return record;
}

export function loadProgress(storage) {
  let raw = null;
  try { raw = storage?.getItem(PROGRESS_KEY) ?? null; }
  catch { return emptyProgress(); }
  // The raw text this call saw becomes the baseline for staleness: a later
  // save is refused when another tab has changed the key since. The
  // baseline is always the current key's text, even when the record
  // itself comes from the v1 fallback below.
  recordProgressSnapshot(storage, raw);
  if (raw !== null) {
    const record = parseProgress(storage, raw, PROGRESS_KEY);
    if (record) return record;
  }
  // An older save under the v1 key migrates: the new fields fill with
  // their defaults (no boss kills yet, best wave from the old wave).
  let oldRaw = null;
  try { oldRaw = storage?.getItem(V1_PROGRESS_KEY) ?? null; }
  catch { return emptyProgress(); }
  if (oldRaw === null) return emptyProgress();
  return parseProgress(storage, oldRaw, V1_PROGRESS_KEY) ?? emptyProgress();
}

// Parses one progress text into the current shape, or null when it is
// unusable. Corrupt JSON is quarantined under a timestamped key next to
// the key it came from (mirroring the building-save rule); a parseable
// record with a version other than 1 or 2 is not quarantined — it just
// does not load. A version-1 record migrates: sanitizeProgress fills
// the new fields with their defaults.
function parseProgress(storage, raw, key) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    if (typeof raw === "string" && raw.length) {
      try { storage?.setItem(`${key}.corrupt:${Date.now()}`, raw); } catch {}
    }
    return null;
  }
  if (!parsed || typeof parsed !== "object" || (parsed.version !== PROGRESS_VERSION && parsed.version !== 1)) return null;
  return sanitizeProgress(parsed);
}

// The last progress text each storage object saw, keyed by the storage
// object itself: every tab has its own localStorage object over the same
// underlying store, so each tab tracks its own baseline. A WeakMap keeps
// the entry alive only while its storage object is.
const progressSnapshots = new WeakMap();

function recordProgressSnapshot(storage, raw) {
  if (storage) progressSnapshots.set(storage, raw);
}

// True when the stored progress differs from what this storage object
// last read or wrote — another tab has saved since. False when nothing
// has been read or written yet in this session (no baseline to compare
// against) or when the storage cannot be read.
export function isProgressStale(storage) {
  if (!storage || !progressSnapshots.has(storage)) return false;
  let current = null;
  try { current = storage.getItem(PROGRESS_KEY) ?? null; }
  catch { return false; }
  return current !== progressSnapshots.get(storage);
}

export function saveProgress(storage, progress, options = {}) {
  if (!storage) return { saved: false, reason: "error" };
  // A stale save is refused instead of silently overwriting the other
  // tab's progress; pass { force: true } only after an explicit user
  // choice to keep this tab's progress. The stale check runs before any
  // write is attempted, so a stale tab also never hits the quota path.
  if (!options.force && isProgressStale(storage)) return { saved: false, reason: "stale" };
  try {
    const text = JSON.stringify(sanitizeProgress(progress));
    storage.setItem(PROGRESS_KEY, text);
    recordProgressSnapshot(storage, text);
    return { saved: true };
  } catch (error) {
    return { saved: false, reason: error?.name === "QuotaExceededError" ? "quota" : "error" };
  }
}
const starterMaterials = [0, 0, 10, 0, 2, 0];
const stackLimit = 999;
// Hunger points drained per game day at a walk (batch 86): a full
// belly empties in about two days; sprinting doubles the rate.
export const HUNGER_DRAIN_PER_DAY = 50;
const validBlock = value => Number.isInteger(value) && value >= BLOCK.AIR && value <= BLOCK.LEAF;

export function createProgression(storage, layout = WORLD) {
  function readText(key) {
    try { return storage?.getItem(key) ?? null; }
    catch { return null; }
  }

  function writeText(key, value) {
    try { storage?.setItem(key, value); return true; }
    catch { return false; }
  }

  function parse(value, entry) {
    try { return JSON.parse(value ?? "null"); }
    catch {
      // A corrupt save in a quarantining entry must not be silently
      // discarded: keep the original text under a timestamped key next
      // to that entry's key so it can be inspected or repaired, then
      // fall back to the older saves below.
      if (entry?.quarantine && typeof value === "string" && value.length) {
        writeText(`${entry.key}.corrupt:${Date.now()}`, value);
      }
      return null;
    }
  }

  let lastSave = null, savedRaws = [], migrating = true;
  const edits = new Map();
  const cellCount = layout.width * layout.height * layout.depth;
  const oldCellCount = LEGACY_WORLD.width * LEGACY_WORLD.height * LEGACY_WORLD.depth;
  const validCell = value => Number.isInteger(value) && value >= 0 && value < cellCount;
  const materials = [0, 0, 0, 0, 0, 0];
  let axeUnlocked = false;
  // The watering can (R6): a one-time craft grant like the axe —
  // owning it is a save flag, the can itself occupies no slot.
  let wateringCanOwned = false;
  // Hunger (batch 86): 0..100, a float — the drain is continuous,
  // so the fraction carries between frames; the HUD floors it. A
  // save written before the field existed loads as a full belly.
  let hunger = 100;
  // Healing items counted per healing recipe, keyed by recipe: adding a
  // healing recipe to RECIPES adds its counter here automatically.
  const dressingCounts = Object.fromEntries(HEALING_KEYS.map(key => [key, 0]));
  function savedCount(value, fallback) {
    return Number.isInteger(value) && value >= 0 ? Math.min(value, stackLimit) : fallback;
  }
  function clampHunger(value) {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 100;
  }
  // v4 writes dressing counts per healing recipe ({ dressing, bandage,
  // bigDressing }); v3 and older wrote one number counting dressings
  // only. Both shapes normalize to the same per-key object: unknown keys
  // dropped, counts clamped to the stack limit.
  function normalizeDressings(value) {
    const counts = Object.fromEntries(HEALING_KEYS.map(key => [key, 0]));
    if (typeof value === "number") counts.dressing = savedCount(value, 0);
    else if (value && typeof value === "object") {
      for (const key of HEALING_KEYS) counts[key] = savedCount(value[key], 0);
    }
    return counts;
  }
  // Rare crafting materials (boss drops), counted per id. A save written
  // before this field existed loads with all zeros; unknown ids are
  // dropped and counts are clamped to the stack limit, like dressings.
  const rareMaterials = Object.fromEntries(Object.keys(RARE_MATERIALS).map(id => [id, 0]));
  function normalizeRareMaterials(value) {
    const counts = Object.fromEntries(Object.keys(RARE_MATERIALS).map(id => [id, 0]));
    if (value && typeof value === "object") {
      for (const id of Object.keys(RARE_MATERIALS)) counts[id] = savedCount(value[id], 0);
    }
    return counts;
  }
  // Farm materials (seeds and harvested products), counted per id — the
  // same shape as rareMaterials, a different name, because seeds are a
  // different economy (grown, not boss-dropped). A save written before
  // this field existed loads the starter seeds as its fallback, the way
  // materials loads the starter blocks; unknown ids are dropped and
  // counts are clamped to the stack limit, like dressings.
  const seeds = Object.fromEntries(Object.keys(FARM_MATERIALS).map(id => [id, 0]));
  function normalizeSeeds(value) {
    const counts = Object.fromEntries(Object.keys(FARM_MATERIALS).map(id => [id, 0]));
    if (value && typeof value === "object") {
      for (const id of Object.keys(FARM_MATERIALS)) counts[id] = savedCount(value[id], STARTER_SEEDS[id] ?? 0);
    } else {
      for (const id of Object.keys(FARM_MATERIALS)) counts[id] = STARTER_SEEDS[id] ?? 0;
    }
    return counts;
  }
  // Planted crops, by cell index: { crop, stage, plantedAt, growth,
  // fertilized }. `growth` is the accumulated effective-growth seconds (rain already
  // folded in by advanceCrops) and is the source of truth — `stage` is
  // derived from it and recomputed on load, so a stored stage that
  // disagrees with the growth is repaired instead of trusted. `plantedAt`
  // is the game-time (dayTime seconds) the seed went in; it is only
  // informational, the growth clock is `growth`. `fertilized` (R3) is
  // set once by fertilizeCrop and lasts the crop's whole cycle; an old
  // save (no flag) loads it as false. The edits Map cannot
  // hold this (it maps a cell to one block id), so crops live in their
  // own field — the crop is not a block, and its cell stays a block
  // (the soil below it) in the edits.
  const crops = {};
  function normalizeCrops(value) {
    const planted = {};
    if (!value || typeof value !== "object") return planted;
    for (const [key, entry] of Object.entries(value)) {
      const cell = Number(key);
      const def = entry && typeof entry === "object" ? CROPS[entry.crop] : null;
      if (!Number.isInteger(cell) || !validCell(cell) || !def) continue;
      const growth = entry.growth;
      if (typeof growth !== "number" || !Number.isFinite(growth) || growth < 0) continue;
      const plantedAt = entry.plantedAt;
      if (typeof plantedAt !== "number" || !Number.isFinite(plantedAt) || plantedAt < 0) continue;
      planted[cell] = { crop: entry.crop, stage: growthStage(def, growth), plantedAt, growth,
        fertilized: entry.fertilized === true, watered: entry.watered === true };
    }
    return planted;
  }
  // Fully restore the crop table from a snapshot (clear, then assign):
  // the keys are dynamic (one per planted cell), so Object.assign alone
  // would leave a crop planted since the snapshot in place. Used by the
  // loader, the importer and change()'s rollback.
  function restoreCrops(previous) {
    for (const key of Object.keys(crops)) delete crops[key];
    Object.assign(crops, previous);
  }
  // Equipment, one piece per slot (null when empty): { key, tier }, where
  // key is a recipe whose `equipment` names the slot. A piece from an
  // unknown recipe, or a recipe that does not fill this slot, drops to
  // null instead of crashing the load — recipes are data, and data can
  // be removed. The tier is the piece's own rank, so a rebalanced recipe
  // never rewrites what a player already owns.
  const EQUIPMENT_SLOTS = ["weapon", "armor", "tool"];
  const EQUIPMENT_TIERS = ["stone", "ember", "star"];
  const equipment = { weapon: null, armor: null, tool: null };
  function normalizeEquipment(value) {
    const pieces = { weapon: null, armor: null, tool: null };
    if (value && typeof value === "object") {
      for (const slot of EQUIPMENT_SLOTS) {
        const piece = value[slot];
        const recipe = RECIPES[piece?.key];
        if (piece && typeof piece === "object" && recipe?.equipment === slot
          && typeof piece.tier === "string" && piece.tier) {
          const max = durabilityMax(piece.tier);
          const stored = piece.durability;
          pieces[slot] = { key: piece.key, tier: piece.tier,
            durability: Number.isInteger(stored) ? Math.min(max, Math.max(0, stored)) : max };
        }
      }
    }
    return pieces;
  }
  // Tech unlocks, as plain ids (the tree itself lands in R7). Only
  // strings survive; duplicates collapse.
  let techUnlocked = [];
  function normalizeTechUnlocked(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(entry => typeof entry === "string"))];
  }
  let workbenchBuilt = false;
  // Run counters the tech tree reads (the swift-hands branch needs the
  // lifetime mining count). Only survival mining counts: creative edits
  // are free, so they are not progress. Unlike the material counts this
  // is a lifetime counter, so it is not clamped to the stack limit. The
  // farming counters (planted / harvested) live here too, so the tech
  // tree's farming branch can read them the same way.
  const stats = { blocksMined: 0, cropsPlanted: 0, cropsHarvested: 0 };
  function normalizeStats(value) {
    const count = field => {
      const amount = value?.[field];
      return Number.isInteger(amount) && amount >= 0 ? amount : 0;
    };
    return { blocksMined: count("blocksMined"), cropsPlanted: count("cropsPlanted"), cropsHarvested: count("cropsHarvested") };
  }
  // Rebuilds all in-memory save state from storage. Runs once at
  // construction and again from loadRemote(), so both paths share the
  // v5 → slots → v4 → slots → v3 → v2 → legacy fallback and the corrupt-newest quarantine instead of
  // drifting apart.
  // Rebuilds the block-edit map from one snapshot's edit list. Coordinate
  // saves store [x, y, z, block]; legacy saves store [cell, block].
  // Shared by the startup load and save import, so both validate edits
  // the same way.
  function applyEdits(entries, coordinates) {
    edits.clear();
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!Array.isArray(entry)) continue;
      let position, block;
      if (coordinates && entry.length === 4) {
        position = entry.slice(0, 3);
        block = entry[3];
      } else if (!coordinates && entry.length === 2 && Number.isInteger(entry[0]) && entry[0] >= 0 && entry[0] < oldCellCount) {
        position = voxelPosition(LEGACY_WORLD, entry[0]);
        block = entry[1];
      }
      if (position?.every(Number.isInteger) && contains(layout, ...position) && validBlock(block)) {
        edits.set(voxelIndex(layout, ...position), block);
      }
    }
  }

  // Every key reloadState reads, newest first: the v5 primary, its two
  // rotation slots, the v4 primary, its two slots, then the older
  // migration versions. Each slot pair sits between its primary and the
  // next older version, so a corrupt primary falls back to the previous
  // save before any older version.
  const saveEntries = [SAVE_MIGRATIONS[0], ...SAVE_SLOT_ENTRIES, SAVE_MIGRATIONS[1],
    ...V4_SLOT_ENTRIES, ...SAVE_MIGRATIONS.slice(2)];

  function reloadState() {
    const raws = saveEntries.map(entry => readText(entry.key));
    lastSave = raws[0];
    savedRaws = raws;
    const snapshots = saveEntries.map((entry, index) => normalizeSave(entry, parse(raws[index], entry)));
    const current = snapshots[0];
    // The first snapshot with supplies, newest first — but never the
    // legacy v1 entry (last in the chain), which has no supplies at all.
    const snapshot = snapshots.slice(0, saveEntries.length - 1).find(entry => entry) ?? null;
    const editSource = snapshots.find(entry => entry?.edits);
    const savedEdits = editSource?.edits ?? null;
    // The coordinates flag comes from the snapshot that actually
    // supplied the edits — not from whether it is the primary. The old
    // `editSource === current` test dropped a v3 save's coordinate edits
    // whenever the v4 primary was corrupt or had no edits, because it
    // then read the [x, y, z, block] entries as legacy cell indices.
    const coordinatesStored = editSource?.coordinates === true;
    migrating = !current;
    applyEdits(savedEdits, coordinatesStored);
    materials.splice(0, materials.length,
      ...starterMaterials.map((amount, block) => block ? savedCount(snapshot?.materials?.[block], amount) : 0));
    axeUnlocked = snapshot?.axeUnlocked === true;
    wateringCanOwned = snapshot?.wateringCanOwned === true;
    hunger = clampHunger(snapshot?.hunger);
    Object.assign(dressingCounts, normalizeDressings(snapshot?.dressings));
    Object.assign(rareMaterials, normalizeRareMaterials(snapshot?.rareMaterials));
    Object.assign(seeds, normalizeSeeds(snapshot?.seeds));
    restoreCrops(normalizeCrops(snapshot?.crops));
    Object.assign(equipment, normalizeEquipment(snapshot?.equipment));
    techUnlocked = normalizeTechUnlocked(snapshot?.techUnlocked);
    workbenchBuilt = snapshot?.workbenchBuilt === true;
    Object.assign(stats, normalizeStats(snapshot?.stats));
  }
  reloadState();

  function isStale() {
    return Boolean(storage && (storage.getItem(SAVE_KEY) !== lastSave || (migrating &&
      saveEntries.slice(1).some((entry, index) => storage.getItem(entry.key) !== savedRaws[index + 1]))));
  }

  function serializeSave() {
    const positions = Array.from(edits, ([cell, block]) => [...voxelPosition(layout, cell), block]);
    return JSON.stringify({ version: SAVE_VERSION, edits: positions, materials, axeUnlocked, wateringCanOwned, hunger, dressings: { ...dressingCounts },
      rareMaterials: { ...rareMaterials }, equipment: { ...equipment }, techUnlocked: [...techUnlocked],
      workbenchBuilt, stats: { ...stats }, seeds: { ...seeds },
      crops: Object.fromEntries(Object.entries(crops).map(([cell, crop]) => [cell, { ...crop }])) });
  }

  function save() {
    if (!storage) return { saved: false, reason: "error" };
    try {
      if (isStale()) { noteConflict(); return { saved: false, conflict: true }; }
      const updated = serializeSave();
      const previous = readText(SAVE_KEY);
      const previousSlot = readText(SAVE_SLOT_1_KEY);
      storage.setItem(SAVE_KEY, updated);
      lastSave = updated;
      migrating = false;
      dirty = false;
      lastWrite = Date.now();
      pendingConflict = null;
      rotateSlots(previous, previousSlot);
      return { saved: true };
    } catch (error) {
      return { saved: false, reason: error?.name === "QuotaExceededError" ? "quota" : "error" };
    }
  }

  // Shifts the previous primary into slot 1 and the old slot 1 into slot
  // 2, so the three newest saves survive. Only a text that parses as a
  // current-version save moves down: after a fallback load the primary
  // may hold the corrupt text that was fallen back from, and rotating
  // that would poison slot 1 with garbage instead of the good backup.
  // And slot 2 only moves when slot 1 actually changes — if the old
  // primary was corrupt and slot 1 keeps its backup, slot 2 must keep
  // the older backup instead of duplicating slot 1. Slot writes are
  // best-effort — the new save is already on disk, so a slot write that
  // fails (quota) must not report the save as failed.
  function rotateSlots(previous, previousSlot) {
    if (previous === null || parse(previous, SAVE_SLOT_ENTRIES[0])?.version !== SAVE_VERSION) return;
    if (previousSlot !== null && parse(previousSlot, SAVE_SLOT_ENTRIES[0])?.version === SAVE_VERSION) {
      writeText(SAVE_SLOT_2_KEY, previousSlot);
    }
    writeText(SAVE_SLOT_1_KEY, previous);
  }

  // Block edits are batched: the first edit after a quiet period writes
  // synchronously (which also claims the save for cross-tab conflict
  // detection), while further edits within 300ms only mark the save dirty
  // and schedule one write, so digging a tunnel no longer serializes the
  // whole save per block. Crafting/loot still save synchronously through
  // change() and pick up any pending edits.
  let saveTimer = null, dirty = false, lastWrite = 0, lastFlushError = null;
  function scheduleFlush() {
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => { saveTimer = null; flush(); }, 300);
  }
  function flush() {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
    if (!dirty) return { saved: true };
    const result = save();
    lastFlushError = result.saved ? null : result;
    // A failed flush stays dirty so the next flush retries.
    if (!result.saved) dirty = true;
    return result;
  }

  // Cross-tab conflict decision state. A conflict latches here the first
  // time it is observed — a failed save, a refused edit, or an explicit
  // checkConflict() poll — and stays until the player picks one side.
  // Until then, saves keep failing with { conflict: true } instead of
  // silently overwriting the other tab or dropping this tab's edits.
  // The pending state is deliberately separate from the `stale` getter:
  // `stale` is a live read, while this is the latched "a decision is owed"
  // flag the UI shows the keep-or-load choice for.
  let pendingConflict = null;
  function noteConflict() {
    if (!pendingConflict) pendingConflict = { detectedAt: Date.now() };
  }

  // Poll entry point for the UI: returns true when another tab has saved
  // since this tab last wrote, and latches the pending decision. Call it
  // on storage events / visibility changes; a failed save or refused edit
  // latches the same state on its own, so polling is only needed to catch
  // a conflict before the player next tries to save.
  function checkConflict() {
    let stale = false;
    try { stale = isStale(); } catch { return false; }
    if (stale) noteConflict();
    return stale;
  }

  // "保留本局": overwrite the remote save with this tab's in-memory state.
  // This is the player's explicit choice, so it writes even if the remote
  // save changed again after the conflict was detected. On quota or any
  // other write failure the decision stays pending, so the player can
  // retry or pick the other side instead.
  function keepLocal() {
    if (!storage) return { saved: false, reason: "error" };
    try {
      const updated = serializeSave();
      const previous = readText(SAVE_KEY);
      const previousSlot = readText(SAVE_SLOT_1_KEY);
      storage.setItem(SAVE_KEY, updated);
      lastSave = updated;
      migrating = false;
      dirty = false;
      lastWrite = Date.now();
      lastFlushError = null;
      if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
      pendingConflict = null;
      rotateSlots(previous, previousSlot);
      return { saved: true };
    } catch (error) {
      return { saved: false, reason: error?.name === "QuotaExceededError" ? "quota" : "error" };
    }
  }

  // "载入对方存档": discard this tab's in-memory state — including any
  // unflushed batched edits — and rebuild from the remote save, using the
  // same v3 → v2 → legacy fallback and corrupt-v3 quarantine as startup.
  // A storage that throws on read reports the failure and leaves the
  // session untouched instead of wiping it.
  function loadRemote() {
    if (!storage) return { loaded: false, reason: "error" };
    try {
      storage.getItem(SAVE_KEY);
    } catch {
      return { loaded: false, reason: "error" };
    }
    reloadState();
    dirty = false;
    lastFlushError = null;
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
    pendingConflict = null;
    return { loaded: true };
  }

  // The current building save as a JSON string: the same text save()
  // writes to storage, from the live in-memory state (including any
  // unflushed batched edits). game.js flushes before exporting, so the
  // download matches what is on disk. The run-progress record is a
  // separate save and is not part of this file.
  function exportSave() {
    return serializeSave();
  }

  // Restores the building save from a file's text. The file is validated
  // first — parseable JSON whose version matches a migration-table entry
  // and normalizes cleanly — and only then applied and written back as
  // the current version, so a bad file can never clobber the existing
  // save or the live session. A failed write (quota, cross-tab conflict)
  // rolls the in-memory state back to what it was before the import.
  // Returns { imported: true } or { imported: false, reason }, where
  // reason is "invalid-json", "unknown-version", "invalid-save", or the
  // save failure's reason ("quota", "error", "conflict").
  function importSave(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { return { imported: false, reason: "invalid-json" }; }
    const entry = SAVE_MIGRATIONS.find(candidate => candidate.version === parsed?.version);
    if (!entry) return { imported: false, reason: "unknown-version" };
    const snapshot = normalizeSave(entry, parsed);
    if (!snapshot) return { imported: false, reason: "invalid-save" };
    // A shaped save must carry its edits and materials lists: a file
    // with the right version but a mangled body (e.g. truncated in the
    // middle) must not wipe the world to empty. Supplies fall back the
    // way the loader treats them; the edits list is the part that cannot
    // be rebuilt, so a missing one rejects the file outright.
    if (entry.shaped && (!Array.isArray(snapshot.edits) || !Array.isArray(snapshot.materials))) {
      return { imported: false, reason: "invalid-save" };
    }
    const previousMaterials = materials.slice(), previousAxe = axeUnlocked, previousWateringCan = wateringCanOwned, previousHunger = hunger,
      previousDressings = { ...dressingCounts }, previousRare = { ...rareMaterials }, previousEdits = new Map(edits),
      previousEquipment = { ...equipment }, previousTech = [...techUnlocked],
      previousWorkbench = workbenchBuilt, previousStats = { ...stats },
      previousSeeds = { ...seeds }, previousCrops = { ...crops };
    applyEdits(snapshot.edits, snapshot.coordinates);
    materials.splice(0, materials.length,
      ...starterMaterials.map((amount, block) => block ? savedCount(snapshot?.materials?.[block], amount) : 0));
    axeUnlocked = snapshot?.axeUnlocked === true;
    wateringCanOwned = snapshot?.wateringCanOwned === true;
    hunger = clampHunger(snapshot?.hunger);
    Object.assign(dressingCounts, normalizeDressings(snapshot?.dressings));
    Object.assign(rareMaterials, normalizeRareMaterials(snapshot?.rareMaterials));
    Object.assign(seeds, normalizeSeeds(snapshot?.seeds));
    restoreCrops(normalizeCrops(snapshot?.crops));
    Object.assign(equipment, normalizeEquipment(snapshot?.equipment));
    techUnlocked = normalizeTechUnlocked(snapshot?.techUnlocked);
    workbenchBuilt = snapshot?.workbenchBuilt === true;
    Object.assign(stats, normalizeStats(snapshot?.stats));
    const result = save();
    if (!result.saved) {
      materials.splice(0, materials.length, ...previousMaterials);
      axeUnlocked = previousAxe;
      wateringCanOwned = previousWateringCan;
      hunger = previousHunger;
      Object.assign(dressingCounts, previousDressings);
      Object.assign(rareMaterials, previousRare);
      Object.assign(seeds, previousSeeds);
      restoreCrops(previousCrops);
      Object.assign(equipment, previousEquipment);
      techUnlocked = previousTech;
      workbenchBuilt = previousWorkbench;
      Object.assign(stats, previousStats);
      edits.clear();
      for (const [cell, block] of previousEdits) edits.set(cell, block);
      return { imported: false, reason: result.conflict ? "conflict" : (result.reason ?? "error") };
    }
    dirty = false;
    lastFlushError = null;
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
    pendingConflict = null;
    return { imported: true };
  }

  function change(apply, cell) {
    const previousMaterials = materials.slice(), previousAxe = axeUnlocked, previousWateringCan = wateringCanOwned, previousHunger = hunger, previousDressings = { ...dressingCounts },
      previousRare = { ...rareMaterials }, previousEquipment = { ...equipment }, previousTech = [...techUnlocked],
      previousWorkbench = workbenchBuilt, previousStats = { ...stats },
      previousSeeds = { ...seeds }, previousCrops = { ...crops };
    const priorBlock = edits.get(cell);
    apply();
    const result = save();
    // Any failed write rolls the change back, not just a cross-tab conflict:
    // on quota (or any other save error) the materials / recipe / block
    // change must not stay in memory while the disk still holds the old
    // save, or it would silently vanish on reload. The reason is returned
    // unchanged so the caller can tell quota apart from a generic error.
    if (!result.saved) {
      materials.splice(0, materials.length, ...previousMaterials);
      axeUnlocked = previousAxe;
      wateringCanOwned = previousWateringCan;
      hunger = previousHunger;
      Object.assign(dressingCounts, previousDressings);
      Object.assign(rareMaterials, previousRare);
      Object.assign(seeds, previousSeeds);
      restoreCrops(previousCrops);
      Object.assign(equipment, previousEquipment);
      techUnlocked = previousTech;
      workbenchBuilt = previousWorkbench;
      Object.assign(stats, previousStats);
      if (cell !== undefined) {
        if (priorBlock === undefined) edits.delete(cell);
        else edits.set(cell, priorBlock);
      }
    }
    return result;
  }

  // String-id counts live in one of two tables: boss-drop rare materials
  // or farm materials (seeds and harvested products). One helper owns the
  // routing so count, loot, crafting and harvest all agree on where a
  // string id is stored — a caller that hardcodes rareMaterials here
  // would spend a seed from the wrong table.
  function stringCounts(id) {
    if (Object.hasOwn(RARE_MATERIALS, id)) return rareMaterials;
    if (Object.hasOwn(FARM_MATERIALS, id)) return seeds;
    return null;
  }

  // Counts by material id: a numeric id reads the block counts, a
  // string id (a boss-drop rare material or a farm material) reads the
  // matching string table.
  function count(id) { return typeof id === "string" ? (stringCounts(id)?.[id] ?? 0) : (materials[id] ?? 0); }
  function collect(block) { materials[block] = Math.min(stackLimit, materials[block] + 1); }

  function editBlock(cell, before, after, limited) {
    if (!validCell(cell) || !validBlock(before) || !validBlock(after) || Boolean(before) === Boolean(after)) return null;
    if (limited && after !== BLOCK.AIR && count(after) < 1) return null;
    // Staleness is checked synchronously before anything is applied, so a
    // conflict never lands in memory. A storage that throws on read is
    // treated as unavailable: the edit still applies to the session (the
    // game stays playable) but reports the failure.
    let storageBroken = false;
    try {
      if (storage && isStale()) { noteConflict(); return { saved: false, conflict: true }; }
    } catch {
      storageBroken = true;
    }
    const previousMaterials = materials.slice();
    const priorBlock = edits.get(cell);
    const previousMined = stats.blocksMined;
    if (limited) {
      if (after !== BLOCK.AIR) materials[after]--;
      else { collect(before); stats.blocksMined++; }
    }
    edits.set(cell, after);
    // A storage read failure must not silently drop the edit: it stays
    // in memory (the session stays playable) and is marked dirty, so a
    // later flush retries the write once storage works again instead of
    // reporting success while the edit is nowhere on disk.
    if (storageBroken) { dirty = true; scheduleFlush(); return { saved: false, reason: "error" }; }
    // First edit after a quiet period writes now; rapid follow-ups batch.
    if (Date.now() - lastWrite >= 300) {
      const result = save();
      // Same rule as change(): a failed immediate write (conflict, quota
      // or other error) rolls the block and materials back. Batched edits
      // are different — a failed flush stays dirty so the next flush
      // retries instead of dropping the edit.
      if (!result.saved) {
        materials.splice(0, materials.length, ...previousMaterials);
        stats.blocksMined = previousMined;
        if (priorBlock === undefined) edits.delete(cell);
        else edits.set(cell, priorBlock);
      }
      return result;
    }
    dirty = true;
    scheduleFlush();
    return { saved: true };
  }

  // An equipment recipe is craftable only with a workbench, only when
  // Equipment needs the workbench built, its trunk node unlocked (the
  // node, not the boss kill directly — the kill gates the 熔火科技 /
  // 断星科技 node, and the node gates the recipes, so the tree and the
  // workbench tab read one source), and only when the slot does not
  // already hold an equal or better tier — a re-craft of the same tier
  // would burn materials for nothing. The workbench itself is the
  // exception: it is built without one.
  function canCraft(key) {
    if (!Object.hasOwn(RECIPES, key)) return false;
    const recipe = RECIPES[key];
    if (recipe.equipment) {
      if (!workbenchBuilt) return false;
      const node = techForRecipe(key);
      if (node && !techUnlocked.includes(node)) return false;
      const owned = equipment[recipe.equipment];
      if (owned && EQUIPMENT_TIERS.indexOf(owned.tier) >= EQUIPMENT_TIERS.indexOf(recipe.tier)) return false;
    } else if (recipe.cooking) {
      // Cooking reuses the workbench gate, the way equipment does —
      // no workbench, no dishes — with no tech node behind it. The
      // count cap is the dressings' one: a dish is a healing item.
      if (!workbenchBuilt) return false;
      if ((dressingCounts[key] ?? 0) >= stackLimit) return false;
    } else if (key === "axe" ? axeUnlocked : key === "wateringCan" ? wateringCanOwned : key === "workbench" ? workbenchBuilt
      : Object.hasOwn(FARM_MATERIALS, key) ? (seeds[key] ?? 0) >= stackLimit
      : (dressingCounts[key] ?? 0) >= stackLimit) return false;
    return recipe.cost.every(([block, amount]) => count(block) >= amount);
  }

  // The state the tech registry reads: the unlocked list, the progress
  // save (boss kills, best waves, lifetime kills) and the lifetime
  // mining count. An already-loaded progress can be passed in so a
  // caller that just loaded it does not read storage twice.
  function techState(progress = loadProgress(storage)) {
    return { techUnlocked: [...techUnlocked], progress, blocksMined: stats.blocksMined, cropsHarvested: stats.cropsHarvested };
  }

  // Unlock one tech node when its requirements are met. Goes through
  // change() like any other save write, so a failed save rolls the
  // unlock back instead of claiming it on reload. Returns null when
  // the node is already unlocked or its requirements are not met.
  function unlockTech(id) {
    if (!canUnlockTech(techState(), id)) return null;
    return change(() => { techUnlocked = [...techUnlocked, id]; });
  }

  function craft(key) {
    if (!canCraft(key)) return null;
    return change(() => {
      for (const [id, amount] of RECIPES[key].cost) {
        if (typeof id === "string") { const table = stringCounts(id); if (table) table[id] -= amount; }
        else materials[id] -= amount;
      }
      if (key === "axe") axeUnlocked = true;
      else if (key === "wateringCan") wateringCanOwned = true;
      else if (key === "workbench") workbenchBuilt = true;
      else if (RECIPES[key].equipment) {
        equipment[RECIPES[key].equipment] = { key, tier: RECIPES[key].tier, durability: durabilityMax(RECIPES[key].tier) };
      } else if (RECIPES[key].healing > 0) dressingCounts[key]++;
      // A recipe whose key is a farm material id (compost) credits the
      // seed counts instead of the dressings: the material is grown /
      // crafted, not a dressing, and the farm tab reads it from there.
      else if (Object.hasOwn(FARM_MATERIALS, key)) seeds[key]++;
    });
  }

  // Wear one equipped piece by 1 (floor 0): a weapon on a hit, armor
  // on a hit taken, a tool on a block mined. Returns null when nothing
  // is equipped or the piece is already at 0; otherwise change()'s
  // result, so a failed write rolls the -1 back.
  function wearEquipment(slot) {
    const piece = equipment[slot];
    if (!piece || piece.durability <= 0) return null;
    return change(() => { equipment[slot] = { ...piece, durability: piece.durability - 1 }; });
  }

  // Repair one equipped piece to full at the workbench: the tier's
  // repair cost, deducted from materials / rare materials. Returns
  // null when nothing is equipped, there is no workbench yet, the piece
  // is already full, or the materials are short; otherwise change()'s
  // result, so a failed write rolls the deduction and the repair back
  // together.
  function repairEquipment(slot) {
    const piece = equipment[slot];
    if (!piece || !workbenchBuilt) return null;
    const max = durabilityMax(piece.tier);
    if (piece.durability >= max) return null;
    const cost = repairCost(piece.tier);
    for (const [id, amount] of cost) if (count(id) < amount) return null;
    return change(() => {
      for (const [id, amount] of cost) {
        if (typeof id === "string") rareMaterials[id] -= amount;
        else materials[id] -= amount;
      }
      equipment[slot] = { ...piece, durability: max };
    });
  }

  // Use one healing item of the given recipe (default "dressing", so the
  // existing game.js call keeps working unchanged). Returns null when
  // there is none to use or the key is not a healing recipe; on a
  // successful save the result also carries the healed amount from the
  // recipe table, so the UI can add it without hardcoding per-key values.
  function useDressing(key = "dressing") {
    const recipe = RECIPES[key];
    if (!recipe?.healing || !(dressingCounts[key] > 0)) return null;
    // A dish feeds hunger instead of health (batch 86): the gain is
    // applied inside the same change as the spend, capped at a full
    // belly, and reported as `healed` like a dressing's heal — the
    // amount that actually landed. A bite that would land under 1
    // hunger is refused outright, item unspent (batch 89): hunger
    // drains in fractions from the first frame, so a belly that
    // displays full sits at 99.9x, and the old exact-100 refusal
    // never fired — the dish was spent for a +0.02 gain.
    let fed = 0;
    if (recipe.cooking) {
      fed = Math.min(recipe.healing, 100 - hunger);
      if (fed < 1) return null;
    }
    const result = change(() => {
      dressingCounts[key]--;
      if (recipe.cooking) hunger += fed;
    });
    if (recipe.cooking) return result.saved ? { ...result, healed: fed } : result;
    // The 急救 tech adds 10 healing to every dressing use (dressing,
    // bandage and big dressing share this one call); without it the
    // recipe amount is unchanged. It never inflates a dish's feed.
    const bonus = techUnlocked.includes("firstAid") ? TECH_EFFECTS.firstAidHealing : 0;
    return result.saved ? { ...result, healed: recipe.healing + bonus } : result;
  }

  // The hunger drain (batch 86): HUNGER_DRAIN_PER_DAY points per
  // game day, doubled while sprinting. Continuous in memory; the
  // batched save is only marked when the floored value moves, so a
  // quiet walk does not serialize every frame. The mode gating
  // (survival only, frozen in boss / defense / creative) is the
  // caller's — this just moves the number.
  function advanceHunger(dt, sprinting) {
    if (!(dt > 0) || hunger <= 0) return;
    const before = Math.floor(hunger);
    hunger = Math.max(0, hunger - HUNGER_DRAIN_PER_DAY / DAY_LENGTH * dt * (sprinting ? 2 : 1));
    if (Math.floor(hunger) !== before) { dirty = true; scheduleFlush(); }
  }

  // Respawn refills the belly like it refills health (batch 86): a
  // starved save must not reload into an instant re-starve.
  function restoreHunger() {
    return change(() => { hunger = 100; });
  }

  // Pays one kill's drops from the enemy registry: block materials add
  // to the block counts, string ids add to the matching string table
  // (rare materials for boss drops, farm materials for a seed drop).
  // An unknown kind (or no kind, as the old callers pass) pays the old
  // fixed drop, so existing callers keep working unchanged.
  function grantLoot(kind) {
    const drops = ENEMIES[kind]?.drops ?? DEFAULT_DROPS;
    // The juggernaut's ember core is a 25% bonus rolled outside the
    // deterministic drop table (the caller reads `bonus` off the
    // result; a rolled-back save reports saved: false, so a bonus the
    // save rejected is never announced).
    const coreBonus = kind === "juggernaut" && Math.random() < .25;
    const result = change(() => {
      for (const [id, amount] of drops) {
        if (typeof id === "string") { const table = stringCounts(id); if (table) table[id] = Math.min(stackLimit, (table[id] ?? 0) + amount); }
        else materials[id] = Math.min(stackLimit, materials[id] + amount);
      }
      if (coreBonus) rareMaterials.emberCore = Math.min(stackLimit, (rareMaterials.emberCore ?? 0) + 1);
    });
    return coreBonus ? { ...result, bonus: "emberCore" } : result;
  }

  // Pays a boss win's rare material: 2 for a first kill, 1 for a repeat
  // (the caller decides the count). Unknown boss ids and non-positive
  // counts pay nothing. Goes through change() like any other reward, so
  // a failed save rolls the drop back instead of vanishing on reload.
  function grantBossLoot(bossId, count = 1) {
    const rare = BOSS_DROPS[bossId];
    if (!rare || !Number.isInteger(count) || count <= 0) return null;
    return change(() => { rareMaterials[rare] = Math.min(stackLimit, rareMaterials[rare] + count); });
  }

  // Plant one seed in the cell above the soil: consumes 1 seed of the
  // crop's kind, starts the growth clock at `now` (game-time seconds,
  // the dayTime the caller reads), and counts the planting. Returns null
  // when the crop is unknown, the cell is invalid or already planted, or
  // the player holds no seed of that kind; otherwise change()'s result,
  // so a failed save rolls the seed and the planting back together.
  function plantCrop(cell, cropId, now) {
    const def = CROPS[cropId];
    if (!def || !validCell(cell) || crops[cell]
      || typeof now !== "number" || !Number.isFinite(now) || now < 0) return null;
    if ((seeds[def.seed] ?? 0) < 1) return null;
    return change(() => {
      seeds[def.seed]--;
      crops[cell] = { crop: cropId, stage: 0, plantedAt: now, growth: 0, fertilized: false, watered: false };
      stats.cropsPlanted++;
    });
  }

  // True when the crop at this cell is mature (a full growthSeconds of
  // effective growth). The game reads this before harvesting so an
  // immature crop falls through to the normal mining path instead of
  // being eaten by the harvest branch.
  function isCropMature(cell) {
    const crop = crops[cell];
    const def = crop && CROPS[crop.crop];
    return Boolean(def && isMature(def, crop.growth));
  }

  // Harvest a mature crop: pays the crop's yield (farm materials and/or
  // blocks) and counts the harvest. Returns null when nothing is planted
  // there or it is not mature yet; otherwise change()'s result, so a
  // failed save rolls the yield and the removal back together. On a
  // successful save the result also carries the yield, so the UI can
  // list what was harvested without hardcoding the crop's table.
  function harvestCrop(cell) {
    const crop = crops[cell];
    const def = crop && CROPS[crop.crop];
    if (!def || !isMature(def, crop.growth)) return null;
    // The 丰收 tech branch (R6) adds its bonus to every yield entry;
    // the paid table is computed once, here, so the single-crop click
    // and the batch harvest (which calls this per crop) settle
    // identically, and the returned yield is what was actually paid.
    const bonus = techUnlocked.includes("bountifulHarvest") ? TECH_EFFECTS.bountifulHarvestBonus : 0;
    const paidYield = def.yield.map(([id, amount]) => [id, amount + bonus]);
    const result = change(() => {
      for (const [id, amount] of paidYield) {
        if (typeof id === "string") { const table = stringCounts(id); if (table) table[id] = Math.min(stackLimit, (table[id] ?? 0) + amount); }
        else materials[id] = Math.min(stackLimit, materials[id] + amount);
      }
      delete crops[cell];
      stats.cropsHarvested++;
    });
    return result.saved ? { ...result, yield: paidYield } : result;
  }

  // Uproot a crop without a yield (its soil was mined out from under
  // it): the crop is gone, nothing is paid. Returns null when nothing is
  // planted there.
  function removeCrop(cell) {
    if (!crops[cell]) return null;
    return change(() => { delete crops[cell]; });
  }

  // Fertilize one planted crop: spends 1 compost (the "fertilizer" farm
  // material) and sets the crop's fertilized flag for its whole cycle —
  // one application, never re-applied, and it does not stack with a
  // second one. Returns null when nothing is planted there, it is
  // already fertilized, or the player holds no compost; otherwise
  // change()'s result. The record is replaced, never mutated, so a
  // failed save rolls the flag and the compost back together (the same
  // shallow-rollback rule as advanceCrops).
  function fertilizeCrop(cell) {
    const crop = crops[cell];
    if (!crop || !CROPS[crop.crop] || crop.fertilized) return null;
    if ((seeds.fertilizer ?? 0) < 1) return null;
    return change(() => {
      seeds.fertilizer--;
      crops[cell] = { ...crop, fertilized: true };
    });
  }

  // Water one planted crop with the watering can (R6): sets the
  // crop's watered flag for its whole cycle — one application, never
  // re-applied, exactly like fertilizer, and it spends nothing (the
  // can is a durable tool). Returns null when nothing is planted
  // there, it is already watered, or the player does not own the can;
  // otherwise change()'s result. The record is replaced, never
  // mutated, so a failed save rolls the flag back.
  function waterCrop(cell) {
    const crop = crops[cell];
    if (!crop || !CROPS[crop.crop] || crop.watered || !wateringCanOwned) return null;
    return change(() => {
      crops[cell] = { ...crop, watered: true };
    });
  }

  // Advance every planted crop's growth by dt game-time seconds (rain
  // doubles the rate, fertilizer and watering double it again per
  // crop — a watered, fertilized crop in the rain grows at x8). The growth accumulator
  // changes every frame, so this marks the save dirty and schedules one
  // flush (the batched path, like block edits) instead of writing
  // synchronously — a frame's growth tick must never serialize the whole
  // save. Crop records are replaced, never mutated, so a change()
  // snapshot taken before the tick still holds the old record on a
  // rollback.
  function advanceCrops(dt, raining) {
    if (!Number.isFinite(dt) || dt <= 0 || !Object.keys(crops).length) return { saved: true };
    for (const [cell, crop] of Object.entries(crops)) {
      const def = CROPS[crop.crop];
      if (!def) continue;
      const rate = (raining ? RAIN_GROWTH_MULTIPLIER : 1) * (crop.fertilized ? FERTILIZER_GROWTH_MULTIPLIER : 1) * (crop.watered ? WATERING_GROWTH_MULTIPLIER : 1);
      const growth = (crop.growth ?? 0) + dt * rate;
      crops[cell] = { ...crop, growth, stage: growthStage(def, growth) };
    }
    dirty = true;
    scheduleFlush();
    return { saved: true };
  }

  function spendMaterial(block, amount) {
    if (!validBlock(block) || block === BLOCK.AIR || !Number.isInteger(amount) || amount <= 0 || count(block) < amount) return null;
    return change(() => { materials[block] -= amount; });
  }

  return {
    blockEdits: () => edits.entries(), count, editBlock, canCraft, craft, useDressing, unlockTech, techState,
    wearEquipment, repairEquipment, plantCrop, harvestCrop, removeCrop, advanceCrops, isCropMature, fertilizeCrop, waterCrop,
    cropAt: cell => { const crop = crops[cell]; return crop ? { ...crop } : null; },
    grantLoot, grantBossLoot, spendMaterial, flush, advanceHunger, restoreHunger,
    checkConflict, keepLocal, loadRemote, exportSave, importSave,
    get pendingConflict() { return pendingConflict ? { ...pendingConflict } : null; },
    saveProgress: (progress, options) => saveProgress(storage, progress, options),
    loadProgress: () => loadProgress(storage),
    get progressStale() { return isProgressStale(storage); },
    get pendingSave() { return dirty; },
    get lastFlushError() { return lastFlushError; },
    get stale() { try { return isStale(); } catch { return false; } },
    get axeUnlocked() { return axeUnlocked; },
    get wateringCanOwned() { return wateringCanOwned; },
    get hunger() { return hunger; },
    // The dressing count game.js displays and spends: the "dressing"
    // recipe only, so the existing HUD ("敷料 N 件") keeps working
    // unchanged until the UI is rewired per recipe. The full per-recipe
    // counts are in dressingsByRecipe.
    get dressings() { return dressingCounts.dressing; },
    get dressingsByRecipe() { return { ...dressingCounts }; },
    // Rare crafting materials (boss drops), by id. A fresh copy each
    // read, so callers cannot mutate the live counts.
    get rareMaterials() { return { ...rareMaterials }; },
    // Farm materials (seeds and harvested products), by id. A fresh copy
    // each read, so callers cannot mutate the live counts.
    get seeds() { return { ...seeds }; },
    // Planted crops, by cell index. Each record is copied so callers
    // cannot mutate the live crop state.
    get crops() {
      return Object.fromEntries(Object.entries(crops).map(([cell, crop]) => [cell, { ...crop }]));
    },
    get workbenchBuilt() { return workbenchBuilt; },
    // The equipped piece per slot, or null. Each piece is copied so
    // callers cannot mutate the live equipment.
    get equipment() {
      return Object.fromEntries(Object.entries(equipment).map(([slot, piece]) => [slot, piece ? { ...piece } : null]));
    },
    get techUnlocked() { return [...techUnlocked]; },
    get stats() { return { ...stats }; }
  };
}
