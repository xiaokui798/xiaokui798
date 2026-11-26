// Tech tree registry: a linear trunk the player must walk, plus three
// optional branches with independent thresholds. Each tech is
// { id, name, desc, requires, unlocks, mount? }: `requires` may name a
// prerequisite tech, boss kills, a survival best wave, a defense best
// wave, a lifetime mining count, or a lifetime kill count; `unlocks`
// lists the recipe keys the node opens (empty for gate nodes, whose only
// job is to be the next node's prerequisite, and for the branches, whose
// effect is a mechanism keyed by the node id). `mount` is the trunk node
// a branch hangs under in the UI — visual grouping only, never a
// prerequisite. The state canUnlockTech reads is
// { techUnlocked: string[], progress: { bossKills?, bestWave?,
//   defense?: { bestWave? }, kills? }, blocksMined?: number }.
export const TECH = Object.freeze({
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
});

export const TRUNK = Object.freeze(["workbench", "stoneGear", "emberTech", "emberGear", "starTech", "starGear"]);

// The three branch effects, in the units their call sites use: a
// reduction-rate bonus, seconds per block, and healing points.
export const TECH_EFFECTS = Object.freeze({ toughnessReduction: 0.05, swiftHandsSeconds: 0.02, firstAidHealing: 10 });

// Boss display names for the threshold lines ("击败熔炉守卫 1/1 次").
// The two ids are the same keys BOSS_DROPS uses in progression.mjs.
const BOSS_NAMES = Object.freeze({ boss: "熔炉守卫", colossus: "断星巨像" });

export function hasTech(techUnlocked, id) {
  return Array.isArray(techUnlocked) && techUnlocked.includes(id);
}

// Every requirement of one tech as a display line, prerequisite first:
// { text, met }. The UI renders them joined with " · " (unmet lines in
// gold); canUnlockTech and techLockReason read the same list, so the
// tree and the workbench tab never disagree about what is missing.
export function techConditions(state, id) {
  const tech = TECH[id];
  if (!tech) return [];
  const requires = tech.requires ?? {};
  const progress = state?.progress ?? {};
  const conditions = [];
  if (requires.tech) {
    const met = hasTech(state?.techUnlocked, requires.tech);
    conditions.push({ text: met ? `已解锁${TECH[requires.tech]?.name ?? requires.tech}` : `需先解锁：${TECH[requires.tech]?.name ?? requires.tech}`, met });
  }
  for (const [bossId, need] of Object.entries(requires.bossKills ?? {})) {
    const have = progress.bossKills?.[bossId] ?? 0;
    conditions.push({ text: `击败${BOSS_NAMES[bossId] ?? bossId} ${have}/${need} 次`, met: have >= need });
  }
  if (requires.bestWave !== undefined) {
    const have = progress.bestWave ?? 0;
    conditions.push({ text: `生存最佳波次 ${have}/${requires.bestWave}`, met: have >= requires.bestWave });
  }
  if (requires.defenseWave !== undefined) {
    const have = progress.defense?.bestWave ?? 0;
    conditions.push({ text: `防守最佳波次 ${have}/${requires.defenseWave}`, met: have >= requires.defenseWave });
  }
  if (requires.blocksMined !== undefined) {
    const have = state?.blocksMined ?? 0;
    conditions.push({ text: `累计挖掘 ${have}/${requires.blocksMined} 块`, met: have >= requires.blocksMined });
  }
  if (requires.kills !== undefined) {
    const have = progress.kills ?? 0;
    conditions.push({ text: `累计击杀 ${have}/${requires.kills} 只`, met: have >= requires.kills });
  }
  return conditions;
}

// Pure unlock check: every requirement met, and not already unlocked.
// Unknown ids are never unlockable.
export function canUnlockTech(state, id) {
  if (!TECH[id] || hasTech(state?.techUnlocked, id)) return false;
  return techConditions(state, id).every(condition => condition.met);
}

// The first unmet requirement, for a lock line ("需先解锁：熔火科技").
// Null when the tech is unlockable or already unlocked.
export function techLockReason(state, id) {
  if (!TECH[id] || hasTech(state?.techUnlocked, id)) return null;
  return techConditions(state, id).find(condition => !condition.met)?.text ?? null;
}

// The trunk node that opens a recipe, or null for recipes no tech
// gates (dressings, the workbench itself, the axe). The recipe gate in
// progression.mjs and the lock line in game.js both read this, so there
// is one mapping, not two.
export function techForRecipe(key) {
  for (const tech of Object.values(TECH)) {
    if (tech.unlocks.includes(key)) return tech.id;
  }
  return null;
}

// The trunk in display order, each node followed by the branches that
// hang under it (their mount is visual grouping only).
export function techDisplayOrder() {
  const order = [];
  for (const id of TRUNK) {
    order.push(id);
    for (const tech of Object.values(TECH)) {
      if (tech.mount === id) order.push(tech.id);
    }
  }
  return order;
}

// Validate a tech table (defaults to this module's own): every node
// names a non-empty name and effect line, every referenced tech and
// mount exists, every boss id is one of the two bosses, every numeric
// threshold is a positive integer, every unlock names a recipe (when a
// recipe table is passed — without one, only non-emptiness is checked,
// the same split validateRecipes uses), no recipe is unlocked by two
// nodes, and the trunk is a linear chain (each node after the first
// requires exactly the previous one). Returns { valid, errors }.
export function validateTech(tech = TECH, recipes = null) {
  const errors = [];
  if (!tech || typeof tech !== "object") return { valid: false, errors: ["科技表不是对象"] };
  const ids = Object.keys(tech);
  if (ids.length === 0) return { valid: false, errors: ["科技表为空"] };
  const unlockedBy = new Map();
  for (const [id, node] of Object.entries(tech)) {
    const label = `科技“${id}”`;
    if (!node || typeof node !== "object") { errors.push(`${label}不是对象`); continue; }
    if (typeof node.name !== "string" || !node.name) errors.push(`${label}：名字必须是非空字符串`);
    if (typeof node.desc !== "string" || !node.desc) errors.push(`${label}：效果文案必须是非空字符串`);
    const requires = node.requires;
    if (!requires || typeof requires !== "object") { errors.push(`${label}：门槛不是对象`); continue; }
    if (requires.tech !== undefined && !Object.hasOwn(tech, requires.tech)) {
      errors.push(`${label}：前置科技“${requires.tech}”未注册`);
    }
    if (requires.bossKills !== undefined) {
      if (!requires.bossKills || typeof requires.bossKills !== "object") {
        errors.push(`${label}：Boss 击杀门槛不是对象`);
      } else {
        for (const [bossId, count] of Object.entries(requires.bossKills)) {
          if (!Object.hasOwn(BOSS_NAMES, bossId)) errors.push(`${label}：Boss“${bossId}”未注册`);
          else if (!Number.isInteger(count) || count <= 0) errors.push(`${label}：Boss“${bossId}”的击杀数不是正整数`);
        }
      }
    }
    for (const field of ["bestWave", "defenseWave", "blocksMined", "kills"]) {
      const value = requires[field];
      if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
        errors.push(`${label}：${field}必须是正整数（现在是 ${value}）`);
      }
    }
    if (node.mount !== undefined && !Object.hasOwn(tech, node.mount)) {
      errors.push(`${label}：挂点科技“${node.mount}”未注册`);
    }
    if (!Array.isArray(node.unlocks)) { errors.push(`${label}：解锁列表不是数组`); continue; }
    node.unlocks.forEach((key, index) => {
      if (typeof key !== "string" || !key) { errors.push(`${label}：解锁[${index}]不是配方 key`); return; }
      if (recipes && !Object.hasOwn(recipes, key)) errors.push(`${label}：解锁“${key}”不是配方`);
      const other = unlockedBy.get(key);
      if (other) errors.push(`${label}：配方“${key}”已被科技“${other}”解锁`);
      else unlockedBy.set(key, id);
    });
  }
  for (const [index, id] of TRUNK.entries()) {
    if (!Object.hasOwn(tech, id)) { errors.push(`主干科技“${id}”未注册`); continue; }
    const previous = TRUNK[index - 1];
    if (index === 0) {
      if (tech[id].requires?.tech) errors.push(`主干起点“${id}”不应有前置科技`);
    } else if (tech[id].requires?.tech !== previous) {
      errors.push(`主干“${id}”的前置不是“${previous}”`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidTech(tech = TECH, recipes = null) {
  const { valid, errors } = validateTech(tech, recipes);
  if (!valid) throw new Error(`科技表校验失败：${errors.join("；")}`);
  return true;
}

assertValidTech();
