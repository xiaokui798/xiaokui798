import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mountGame, seedProgress, sharedStorage, v5SaveWithSeeds, v5SaveForCooking, takeHitsUntil, nearestZombieVertex, steerTowardVertex, swingAtNearestZombie } from "./game-harness.mjs";
import { BLOCK, SAVE_KEY, V4_SAVE_KEY, PROGRESS_KEY, createProgression, saveProgress } from "./progression.mjs";
import { SURVIVAL_DIFFICULTY, survivalRoster, hpMultiplier, scaledHp } from "./difficulty.mjs";
import { ENEMIES, defenseWaveRoster } from "./defense.mjs";
import { WORLD, voxelIndex } from "./terrain.mjs";

// Backpack & crafting integration tests: dressing/food rows, backpack grid, workbench gate, tabs, craft toast and item icons. Split from game.test.mjs (batch 108).

test("the backpack lists every healing recipe and the HUD shows all three counts", () => {
  // A preloaded v4 save: enough wood and leaves to craft one of each,
  // and one healing item of each recipe already owned.
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 0, 0, 0, 4, 8],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 1, bigDressing: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  // The HUD label already says 敷料, so the dressing count stands bare.
  assert.equal(game.get("hud-dressings").textContent, "1 · 树皮绷带 1 · 树叶大敷料 1 · 烤麦饼 0 · 果蔬沙拉 0 · 炖菜 0");
  game.key("KeyC");
  frame();
  assert.equal(game.get("inventory-screen").hidden, false);
  // Every healing recipe in RECIPES gets a row, with its own cost line
  // and craft / use buttons — not just the dressing row from the markup.
  const rows = game.get("healing-recipes").innerHTML;
  assert.match(rows, /树皮绷带/);
  assert.match(rows, /树叶大敷料/);
  assert.match(rows, /craft-bandage/);
  assert.match(rows, /use-bigDressing/);
  assert.match(game.get("dressing-cost").textContent, /恢复 30 点生命/);
  assert.match(game.get("bandage-cost").textContent, /恢复 20 点生命/);
  assert.match(game.get("bigDressing-cost").textContent, /恢复 50 点生命/);
  assert.equal(game.get("inventory-dressings").textContent,
    "树叶敷料 1 件 · 树皮绷带 1 件 · 树叶大敷料 1 件 · 烤麦饼 0 件 · 果蔬沙拉 0 件 · 炖菜 0 件 · 当前生命 100/100");
  // At full health every use button is disabled, whatever the counts are.
  assert.equal(game.get("use-dressing").disabled, true);
  assert.equal(game.get("use-bandage").disabled, true);
  assert.equal(game.get("use-bigDressing").disabled, true);
  assert.equal(game.get("craft-dressing").disabled, false);
  assert.equal(game.get("craft-bandage").disabled, false);
  assert.equal(game.get("craft-bigDressing").disabled, false);
  game.click("craft-bandage");
  game.click("craft-bigDressing");
  game.click("craft-dressing");
  assert.equal(game.get("inventory-dressings").textContent,
    "树叶敷料 2 件 · 树皮绷带 2 件 · 树叶大敷料 2 件 · 烤麦饼 0 件 · 果蔬沙拉 0 件 · 炖菜 0 件 · 当前生命 100/100");
  assert.equal(game.get("hud-dressings").textContent, "2 · 树皮绷带 2 · 树叶大敷料 2 · 烤麦饼 0 · 果蔬沙拉 0 · 炖菜 0");
  // One leaf left: another big dressing (4 leaves) can no longer be made,
  // and clicking its disabled button changes nothing.
  assert.equal(game.get("craft-bigDressing").disabled, true);
  game.click("craft-bigDressing");
  assert.match(game.get("inventory-dressings").textContent, /树叶大敷料 2 件/);
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("inventory-screen").hidden, true);
});

test("a crafted dressing appears in the backpack grid and KeyH spends it everywhere at once", t => {
  // Batch 101 regression (player report): the player crafted a leaf
  // dressing, saw the craft-complete toast and "H 敷料 1" on the HUD,
  // but the backpack grid held only the seven material cells — the
  // dressing counts live in dressingsByRecipe, and the grid never read
  // them. The chain pinned here: craft -> grid cell shows the count ->
  // KeyH use -> grid, foot line and HUD all drop together.
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  // The player's own counts: grass 19, dirt 11, stone 23, wood 0,
  // leaves 12, no healing items yet (materials are indexed by block id).
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 19, 11, 23, 0, 12],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  const hp = () => Number(game.get("health-value").textContent);
  const cellFor = name => game.get("inventory-materials").children
    .find(cell => cell.children[1]?.textContent === name);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  assert.equal(game.get("inventory-screen").hidden, false);
  assert.equal(game.get("inventory-materials").children.length, 13,
    "the backpack grid lists the seven materials plus every healing / food item");
  assert.equal(cellFor("树叶敷料").children[2].textContent, "0");
  assert.equal(cellFor("树叶").children[2].textContent, "12");
  game.click("craft-dressing");
  assert.equal(cellFor("树叶敷料").children[2].textContent, "1",
    "the crafted dressing is visible in the backpack grid");
  assert.equal(cellFor("树叶").children[2].textContent, "10", "crafting spent two leaves");
  assert.match(game.get("inventory-dressings").textContent, /树叶敷料 1 件/);
  assert.match(game.get("hud-dressings").textContent, /^1 · /);
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  // Take wave-1 spitter hits until a 30 heal fits, then spend the
  // dressing with the H hotkey, outside the backpack.
  for (let i = 0; i < 3000 && game.get("death-screen").hidden && hp() > 70; i++) frame();
  assert.equal(game.get("death-screen").hidden, true, "the player must survive the beating");
  const beforeKeyH = hp();
  assert.ok(beforeKeyH <= 70 && beforeKeyH > 0, `health must be low enough to prove a 30 heal (now ${beforeKeyH})`);
  game.key("KeyH");
  frame();
  assert.equal(hp(), beforeKeyH + 30, "KeyH heals the dressing's 30");
  assert.match(game.get("hud-dressings").textContent, /^0 · /, "the HUD count drops with the use");
  game.key("KeyC");
  frame();
  assert.equal(cellFor("树叶敷料").children[2].textContent, "0",
    "the backpack grid drops with the use, in sync with the HUD");
  assert.match(game.get("inventory-dressings").textContent, /树叶敷料 0 件/);
});

test("using a healing item heals by its own recipe amount", t => {
  let seed = 1;
  t.mock.method(Math, "random", () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
  // One of each healing item, no materials: the test spends what it owns.
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 0, 0, 0, 0, 0],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 1, bigDressing: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  frame();
  const hp = () => Number(game.get("health-value").textContent);
  const openBag = () => { game.key("KeyC"); frame(); assert.equal(game.get("inventory-screen").hidden, false); };
  const closeBag = () => { game.key("KeyC"); game.grantPointerLock(); frame(); assert.equal(game.get("inventory-screen").hidden, true); };
  // Stand still and let wave 1 spitters throw until the health is at
  // most the target: each throw is 13, so the wait stops on a known,
  // unclamped range.
  const takeHitsUntil = target => {
    for (let i = 0; i < 3000 && game.get("death-screen").hidden && hp() > target; i++) frame();
  };
  takeHitsUntil(40);
  assert.equal(game.get("death-screen").hidden, true, "the player must survive the beating");
  assert.ok(hp() <= 50 && hp() > 0, `health must be low enough to prove a 50 heal (now ${hp()})`);
  openBag();
  assert.equal(game.get("use-bigDressing").disabled, false);
  const beforeBig = hp();
  game.click("use-bigDressing");
  assert.equal(hp(), beforeBig + 50, "a big dressing heals 50, not the dressing's 30");
  assert.equal(game.get("inventory-notice").textContent, "生命 +50");
  assert.match(game.get("inventory-dressings").textContent, /树叶大敷料 0 件/);
  closeBag();
  takeHitsUntil(70);
  assert.equal(game.get("death-screen").hidden, true);
  openBag();
  const beforeDressing = hp();
  assert.ok(beforeDressing <= 70, `health must be low enough to prove a 30 heal (now ${beforeDressing})`);
  game.click("use-dressing");
  assert.equal(hp(), beforeDressing + 30, "a dressing heals 30");
  assert.equal(game.get("inventory-notice").textContent, "生命 +30");
  assert.match(game.get("inventory-dressings").textContent, /树叶敷料 0 件/);
  closeBag();
  takeHitsUntil(80);
  assert.equal(game.get("death-screen").hidden, true);
  openBag();
  const beforeBandage = hp();
  assert.ok(beforeBandage <= 80, `health must be low enough to prove a 20 heal (now ${beforeBandage})`);
  game.click("use-bandage");
  assert.equal(hp(), beforeBandage + 20, "a bandage heals 20, not the dressing's 30");
  assert.equal(game.get("inventory-notice").textContent, "生命 +20");
  assert.match(game.get("inventory-dressings").textContent, /树皮绷带 0 件/);
  // Out of bandages: its use button stays disabled even while hurt.
  assert.equal(game.get("use-bandage").disabled, true);
  assert.equal(game.get("use-dressing").disabled, true);
  closeBag();
  takeHitsUntil(90);
  assert.equal(game.get("death-screen").hidden, true);
  // KeyH is the dressing hotkey: with no dressing left it heals nothing.
  const beforeKeyH = hp();
  assert.ok(beforeKeyH < 100, `health must be below full for the KeyH check (now ${beforeKeyH})`);
  game.key("KeyH");
  frame();
  assert.equal(hp(), beforeKeyH, "KeyH with no dressing must not heal");
  assert.equal(game.get("death-screen").hidden, true);
});

test("the backpack shows the workbench gate, and crafting unlocks the equipment rows", () => {
  // A preloaded v4 save: 14 stone and 10 wood — the bench (5+5), the
  // armor (6+2) and the pickaxe (3+2) all fit, nothing else to spend.
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 0, 0, 14, 10, 0],
    axeUnlocked: false, dressings: { dressing: 0, bandage: 0, bigDressing: 0 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  assert.equal(game.get("inventory-screen").hidden, false);
  // The workbench rows live in the workbench tab, not the backpack tab.
  game.click("tab-btn-workbench");
  assert.equal(game.get("tab-workbench").hidden, false);
  assert.equal(game.get("tab-backpack").hidden, true);
  // The workbench row is buildable; the equipment rows are locked.
  assert.equal(game.get("craft-workbench").disabled, false);
  assert.match(game.get("workbench-cost").textContent, /石头 14\/5 · 木头 10\/5/);
  assert.equal(game.get("craft-stoneArmor").disabled, true);
  assert.equal(game.get("craft-stonePickaxe").disabled, true);
  assert.match(game.get("stoneArmor-cost").textContent, /需先建造工作台/);
  // The ember rows name the workbench first: the tier kill comes second.
  assert.equal(game.get("craft-emberSword").disabled, true);
  assert.match(game.get("emberSword-cost").textContent, /需先建造工作台/);
  // Build the bench: the cost line says built, but the equipment
  // rows stay locked — the workbench alone no longer opens them; the
  // 石阶装备 trunk node does. The stone row names its trunk node, the
  // ember row names its own.
  game.click("craft-workbench");
  assert.match(game.get("inventory-notice").textContent, /已制作工作台/);
  assert.equal(game.get("workbench-cost").textContent, "已建造");
  assert.equal(game.get("craft-workbench").disabled, true);
  assert.equal(game.get("craft-stoneArmor").disabled, true);
  assert.equal(game.get("craft-stonePickaxe").disabled, true);
  assert.match(game.get("stoneArmor-cost").textContent, /需先解锁：工作台/);
  assert.match(game.get("emberSword-cost").textContent, /需先解锁：熔火科技/);
  assert.equal(game.get("detail-name").textContent, "石甲");
  assert.equal(game.get("detail-tier").textContent, "石阶");
  assert.match(game.get("detail-materials").innerHTML, /石头 9\/6/);
  assert.match(game.get("detail-materials").innerHTML, /木头 5\/2/);
  // Unlock the trunk in the tech tab: the stone rows open.
  game.click("tab-btn-tech");
  assert.equal(game.get("tech-unlock-workbench").disabled, false);
  game.click("tech-unlock-workbench");
  assert.match(game.get("inventory-notice").textContent, /已解锁工作台/);
  assert.equal(game.get("tech-unlock-workbench").textContent, "已解锁");
  assert.equal(game.get("tech-unlock-stoneGear").disabled, false);
  assert.match(game.get("tech-cond-stoneGear").innerHTML, /已解锁工作台/);
  game.click("tech-unlock-stoneGear");
  assert.match(game.get("inventory-notice").textContent, /已解锁石阶装备/);
  game.click("tab-btn-workbench");
  assert.equal(game.get("craft-stoneArmor").disabled, false);
  assert.equal(game.get("craft-stonePickaxe").disabled, false);
  // Craft the armor: the row says equipped, and the equipment tab's
  // armor card shows it.
  game.click("craft-stoneArmor");
  assert.match(game.get("stoneArmor-cost").textContent, /已装备石甲/);
  assert.equal(game.get("craft-stoneArmor").disabled, true);
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-weapon-name").textContent, "石剑");
  assert.equal(game.get("equip-weapon-info").textContent, "石阶 · 伤害 27");
  assert.equal(game.get("equip-weapon-state").textContent, "默认武器");
  assert.equal(game.get("equip-armor-name").textContent, "石甲");
  assert.equal(game.get("equip-armor-info").textContent, "石阶 · 减伤 10%");
  assert.equal(game.get("equip-armor-state").textContent, "已装备");
  assert.equal(game.get("equip-tool-name").textContent, "石镐");
  assert.equal(game.get("equip-tool-info").textContent, "未获得——在工作台制作");
  assert.equal(game.get("equip-tool-state").textContent, "未获得");
  // And the pickaxe the same way.
  game.click("tab-btn-workbench");
  game.click("craft-stonePickaxe");
  game.click("tab-btn-equipment");
  assert.equal(game.get("equip-tool-name").textContent, "石镐");
  assert.equal(game.get("equip-tool-state").textContent, "已装备");
  game.key("KeyC");
  game.grantPointerLock();
  frame();
  assert.equal(game.get("inventory-screen").hidden, true);
});

test("backpack tabs switch panels and widen the panel for workbench and tech", () => {
  const data = new Map([[V4_SAVE_KEY, JSON.stringify({ version: 4, edits: [], materials: [0, 0, 0, 0, 4, 8],
    axeUnlocked: false, dressings: { dressing: 1, bandage: 1, bigDressing: 1 } })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  game.key("KeyC");
  frame();
  const panel = game.document.querySelector("#inventory-screen .inventory-panel");
  // The backpack tab opens by default, on the narrow panel.
  assert.equal(game.get("tab-backpack").hidden, false);
  assert.equal(game.get("tab-workbench").hidden, true);
  assert.equal(game.get("tab-equipment").hidden, true);
  assert.equal(game.get("tab-tech").hidden, true);
  assert.equal(panel.classList.contains("wide"), false);
  assert.equal(game.get("tab-btn-backpack").classList.contains("secondary-button"), false);
  assert.equal(game.get("tab-btn-workbench").classList.contains("secondary-button"), true);
  // The workbench tab widens the panel and shows its two columns.
  game.click("tab-btn-workbench");
  assert.equal(game.get("tab-workbench").hidden, false);
  assert.equal(game.get("tab-backpack").hidden, true);
  assert.equal(panel.classList.contains("wide"), true);
  assert.equal(game.get("tab-btn-workbench").classList.contains("secondary-button"), false);
  assert.match(game.get("workbench-list").innerHTML, /石阶/);
  assert.match(game.get("workbench-list").innerHTML, /熔火阶/);
  assert.match(game.get("workbench-list").innerHTML, /断星阶/);
  // The equipment tab goes back to the narrow panel.
  game.click("tab-btn-equipment");
  assert.equal(game.get("tab-equipment").hidden, false);
  assert.equal(panel.classList.contains("wide"), false);
  // The tech tab widens again; the tree is real now — the empty-state
  // line shows while nothing is unlocked, and the trunk nodes are there.
  game.click("tab-btn-tech");
  assert.equal(game.get("tab-tech").hidden, false);
  assert.equal(panel.classList.contains("wide"), true);
  assert.match(game.get("inventory-tabs").innerHTML, /完成主干解锁更多分支/);
  assert.equal(game.get("tech-empty").hidden, false);
  assert.match(game.get("tech-list").innerHTML, /熔火科技/);
  assert.match(game.get("tech-list").innerHTML, /坚韧/);
  assert.equal(game.get("tech-unlock-workbench").disabled, false);
  assert.equal(game.get("tech-unlock-stoneGear").disabled, true);
  assert.equal(game.get("tech-unlock-toughness").disabled, true);
  game.click("tab-btn-backpack");
  assert.equal(game.get("tab-backpack").hidden, false);
  assert.equal(panel.classList.contains("wide"), false);
});

test("the craft toast lives above the modal screens, not inside the hud layer", () => {
  // Batch 78: the toast sat inside #hud (a z-index 2 stacking
  // context) under the .screen overlays' dim backdrop (z-index 3),
  // so it washed out whenever the inventory was open — which is
  // where crafting happens. The node must stay a sibling above the
  // screens; these source pins keep it there.
  const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="craft-toast"') < html.indexOf('id="hud"'),
    "the toast node sits outside #hud");
  const toastRule = css.match(/#craft-toast \{[^}]*\}/)?.[0] ?? "";
  assert.match(toastRule, /position: fixed/, "the toast positions against the viewport");
  assert.match(toastRule, /z-index: 4/, "the toast layer clears the screens' z-index 3");
});

test("item icons lead the material strips, rows, cards and hotbar slots", () => {
  // Batch 81 (visual batch 80's wiring spec): one resolver
  // (item-icons.mjs) feeds every surface. These pins read the icon
  // each surface actually renders — including the axe -> stoneAxe
  // rename arriving through the workbench template.
  const game = mountGame();
  game.click("start-button");
  game.key("KeyC");
  assert.equal(game.get("inventory-screen").hidden, false);
  const strip = game.get("inventory-materials");
  // Batch 101: the backpack strip is the seven material cells plus one
  // cell per healing / food item (their counts live in dressingsByRecipe,
  // not materials — a grid without them hid every crafted dressing).
  // The workbench strip keeps the original seven material cells.
  assert.equal(strip.children.length, 13);
  assert.equal(strip.children[0].children[0].className, "item-icon s20");
  assert.equal(strip.children[0].children[0].src, "icons/grass.svg");
  assert.equal(strip.children[5].children[0].src, "icons/emberCore.svg");
  assert.equal(strip.children[7].children[0].src, "icons/dressing.svg");
  assert.equal(strip.children[7].children[1].textContent, "树叶敷料");
  assert.equal(game.get("workbench-materials").children.length, 7);
  assert.match(game.get("farm-materials").innerHTML, /icons\/wheatSeed\.svg/);
  assert.match(game.get("healing-recipes").innerHTML, /icons\/bandage\.svg/);
  assert.match(game.get("workbench-list").innerHTML, /icons\/workbench\.svg/);
  assert.match(game.get("workbench-list").innerHTML, /icons\/stoneAxe\.svg/);
  assert.match(game.get("tech-list").innerHTML, /icons\/bountifulHarvest\.svg/);
  assert.equal(game.get("equip-weapon-icon").src, "icons/stoneSword.svg");
  assert.equal(game.get("equip-armor-icon").src, "icons/stoneArmor.svg");
  // Batch 84: an empty slot's title names its preview piece, like
  // its icon — "未获得" is carried by the info and state lines.
  assert.equal(game.get("equip-armor-name").textContent, "石甲");
  assert.equal(game.get("equip-tool-name").textContent, "石镐");
  assert.equal(game.get("detail-icon").src, "icons/workbench.svg");
  const slots = game.get("hotbar").children;
  assert.match(slots[0].innerHTML, /icons\/grass\.svg/);
  assert.match(slots[5].innerHTML, /icons\/stoneSword\.svg/);
});

test("crafting pops the craft-complete toast with the item icon and name", () => {
  const data = new Map([[SAVE_KEY, v5SaveForCooking({ techUnlocked: ["workbench", "stoneGear"] })]]);
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const game = mountGame({ storage, pointerLock: true });
  let time = 0;
  const frame = () => game.frame(time += 20);
  game.click("start-button");
  game.grantPointerLock();
  for (let i = 0; i < 5; i++) frame();
  assert.equal(game.get("craft-toast").hidden, true, "the toast starts hidden");
  game.key("KeyC");
  frame();
  game.click("tab-btn-workbench");
  // The axe is the mapping trap: its recipe key is "axe" but
  // the icon set names it stoneAxe.
  game.click("craft-axe");
  assert.equal(game.get("craft-toast").hidden, false, "the toast shows on craft");
  assert.equal(game.get("craft-toast-icon").src, "icons/stoneAxe.svg");
  assert.equal(game.get("craft-toast-name").textContent, "石斧");
  // A dish rides the same craft funnel; crafting again while
  // the toast is up swaps in the newest item (latest wins).
  game.click("craft-bakedWheat");
  assert.equal(game.get("craft-toast-icon").src, "icons/bakedWheat.svg");
  assert.equal(game.get("craft-toast-name").textContent, "烤麦饼");
});
