// Inventory / workbench UI split out of game.js (batch 54, split
// piece 3). The factory builds the inventory screen's dynamic DOM
// once — healing rows, the five tab panels, the workbench list, the
// tech tree, the repair rows, the farm rows, the sow hint — and
// refreshes it per updateInventory(campaign, env) call.
//
// The boundary follows the earlier pieces: the RULES stay outside.
// Whether something can be crafted, what it costs and what is locked
// are decided by progression / recipes / tech (imported here as data,
// exactly as game.js imports them) and by the campaign object the
// caller hands in per refresh; what the player DOES — craft, eat,
// unlock, repair, sow — leaves through the injected actions and is
// executed by game.js. This module holds no game state: its only
// memory is presentation state (the selected tab and recipe), and
// per-frame facts it cannot know (player hp, rain, shelter, the
// block palette) arrive in the env argument. It does not import
// game.js.

import { RECIPES, HEALING_KEYS, COOKING_KEYS, RARE_MATERIALS } from "./progression.mjs";
import { TECH, TECH_EFFECTS, canUnlockTech, techConditions, techDisplayOrder, techForRecipe, techLockReason } from "./tech.mjs";
import { WEAPONS } from "./weapons.mjs";
import { armorReduction } from "./armor.mjs";
import { miningInterval } from "./tools.mjs";
import { durabilityMax, repairCost } from "./durability.mjs";
import { CROPS, FARM_MATERIALS, isMature } from "./crops.mjs";
import { WORLD, voxelPosition, DAY_LENGTH } from "./terrain.mjs";
import { itemIconKey, itemIconImg } from "./item-icons.mjs";

// The food-buff labels (R5), shared with the HUD buff lines: game.js
// imports this back for its status refresh.
export const BUFF_LABELS = { speed: "移速", attack: "攻击" };

export function createInventoryUi({ document, base, buffLabels, actions, refresh }) {
  const { inventoryMaterials, inventoryDressings, dressingCost, craftDressingButton, useDressingButton } = base;

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  // One backpack row per healing recipe. The dressing row already exists
  // in the markup; the rest are built here from RECIPES, so adding a
  // healing recipe needs no markup change. Each row reuses recipeCost()
  // for its cost line and craftItem() / healWithDressing() for its
  // buttons; the dressing entry reuses the static elements above.
  const healingList = document.querySelector("#healing-recipes") ?? (() => {
    const list = document.createElement("div");
    list.id = "healing-recipes";
    inventoryDressings.parentElement?.before?.(list);
    return list;
  })();
  healingList.innerHTML = HEALING_KEYS.filter(key => key !== "dressing").map(key => COOKING_KEYS.includes(key) ? `
    <div class="recipe">
      ${itemIconImg(key, 28)}
      <div><h3>${RECIPES[key].name}</h3><p id="${key}-effect"></p></div>
      <button id="use-${key}" type="button">食用</button>
      <button id="goto-workbench-${key}" class="secondary-button" type="button">去工作台</button>
    </div>` : `
    <div class="recipe">
      ${itemIconImg(key, 28)}
      <div><h3>${RECIPES[key].name}</h3><p id="${key}-cost"></p></div>
      <button id="craft-${key}" type="button">制作${RECIPES[key].name}</button>
      <button id="use-${key}" class="secondary-button" type="button">使用${RECIPES[key].name}</button>
    </div>`).join("");
  const healingControls = HEALING_KEYS.map(key => {
    if (COOKING_KEYS.includes(key)) {
      // A food row has no craft button: dishes are made on the
      // workbench tab, eaten here. Its left line is the effect line
      // (filled by updateInventory, first-aid bonus included), its
      // main button eats, its secondary button jumps to the workbench
      // tab with the dish selected.
      const controls = {
        cost: document.querySelector(`#${key}-effect`),
        craft: null,
        use: document.querySelector(`#use-${key}`),
        goto: document.querySelector(`#goto-workbench-${key}`),
        cooking: true
      };
      controls.use.addEventListener("click", () => actions.healWithDressing(key));
      controls.goto.addEventListener("click", () => { selectRecipe(key); selectInventoryTab("workbench"); });
      return { key, ...controls };
    }
    const controls = key === "dressing"
      ? { cost: dressingCost, craft: craftDressingButton, use: useDressingButton }
      : {
        cost: document.querySelector(`#${key}-cost`),
        craft: document.querySelector(`#craft-${key}`),
        use: document.querySelector(`#use-${key}`)
      };
    controls.craft.addEventListener("click", () => actions.craftItem(key));
    controls.use.addEventListener("click", () => actions.healWithDressing(key));
    return { key, ...controls };
  });

  // Backpack tabs (打造-UI设计.md §③⑧): 背包 | 工作台 | 装备 | 科技树.
  // Built here from RECIPES like the healing rows, so index.html needs
  // no markup change. The static backpack rows (materials, dressing,
  // healing, foot) move into the backpack panel; the workbench, equipment
  // and tech panels are built below. One tab is visible at a time; the
  // workbench and tech panels widen the panel to 46rem, the others keep
  // 38rem. The workbench list groups equipment recipes by tier, with the
  // build row on top and the stone axe — a weapon recipe, not an
  // equipment recipe — in the stone group; rows keep the R3 ids
  // (#craft-<key>, #<key>-cost) so existing wiring keeps working.
  const INVENTORY_TABS = ["backpack", "workbench", "equipment", "tech", "farm"];
  const TAB_TITLES = { backpack: "背包", workbench: "工作台", equipment: "装备", tech: "科技树", farm: "种田" };
  const EQUIPMENT_KEYS = Object.keys(RECIPES).filter(key => RECIPES[key].equipment);
  const TIER_TITLES = { stone: "石阶", ember: "熔火阶", star: "断星阶" };
  const TIER_DOT = { stone: "#c5d3bd", ember: "#f0d285", star: "#edf2e7" };
  const RARE_SOURCE = { emberCore: "熔炉守卫", starShard: "断星巨像" };
  const inventoryPanel = document.querySelector("#inventory-screen .inventory-panel");
  // Query-first like the healing rows: in the harness querySelector
  // creates the element the tests later read, so the tabs' innerHTML
  // must live on that element, not on a detached createElement node.
  const inventoryTabs = document.querySelector("#inventory-tabs") ?? (() => {
    const tabs = document.createElement("div");
    tabs.id = "inventory-tabs";
    return tabs;
  })();
  inventoryTabs.innerHTML = `
    <div id="inventory-tab-row" role="tablist">
      ${INVENTORY_TABS.map(tab => `<button id="tab-btn-${tab}" type="button" role="tab"${tab === "backpack" ? "" : " class=\"secondary-button\""}>${TAB_TITLES[tab]}</button>`).join("")}
    </div>
    <div id="tab-backpack" role="tabpanel"></div>
    <div id="tab-workbench" role="tabpanel" hidden>
      <dl id="workbench-materials" class="inventory-materials" aria-label="工作台材料数量"></dl>
      <div class="workbench-columns">
        <div id="workbench-list"></div>
        <div id="workbench-detail" class="recipe">
          <img id="detail-icon" class="item-icon s36" src="icons/workbench.svg" alt="">
          <div><h3 id="detail-name"></h3><p id="detail-tier"></p><div id="detail-materials"></div><p id="detail-lock"></p></div>
          <button id="detail-craft" type="button"></button>
        </div>
      </div>
      <div style="margin-top: .75rem;">
        <h3 style="margin: 0 0 .25rem;">修理装备</h3>
        <div id="repair-list"></div>
        <p id="repair-empty" style="margin: 0;"></p>
      </div>
    </div>
    <div id="tab-equipment" role="tabpanel" hidden>
      <div class="recipe" id="equip-weapon-card">
        <img id="equip-weapon-icon" class="item-icon s36" src="icons/stoneSword.svg" alt="">
        <div><h3 id="equip-weapon-name"></h3><p id="equip-weapon-info"></p></div>
        <div><div style="width: 6rem; height: 6px; background: #273526;"><span id="equip-weapon-durability" style="display: block; width: 100%; height: 6px; background: #f0d285;"></span></div><p id="equip-weapon-durability-text"></p></div>
        <button id="equip-weapon-state" type="button" disabled></button>
      </div>
      <div class="recipe" id="equip-armor-card">
        <img id="equip-armor-icon" class="item-icon s36" src="icons/stoneArmor.svg" alt="" style=\"opacity: .35;\">
        <div><h3 id="equip-armor-name"></h3><p id="equip-armor-info"></p></div>
        <div><div style="width: 6rem; height: 6px; background: #273526;"><span id="equip-armor-durability" style="display: block; width: 100%; height: 6px; background: #f0d285;"></span></div><p id="equip-armor-durability-text"></p></div>
        <button id="equip-armor-state" type="button" disabled></button>
      </div>
      <div class="recipe" id="equip-tool-card">
        <img id="equip-tool-icon" class="item-icon s36" src="icons/stonePickaxe.svg" alt="" style=\"opacity: .35;\">
        <div><h3 id="equip-tool-name"></h3><p id="equip-tool-info"></p></div>
        <div><div style="width: 6rem; height: 6px; background: #273526;"><span id="equip-tool-durability" style="display: block; width: 100%; height: 6px; background: #f0d285;"></span></div><p id="equip-tool-durability-text"></p></div>
        <button id="equip-tool-state" type="button" disabled></button>
      </div>
    </div>
    <div id="tab-tech" role="tabpanel" hidden>
      <p>解锁科技强化生存能力；条件满足后点解锁，立即生效</p>
      <p id="tech-empty">完成主干解锁更多分支</p>
      <div id="tech-list" style="border-left: 2px solid rgba(235,244,220,.18); padding-left: .75rem;"></div>
    </div>
    <div id="tab-farm" role="tabpanel" hidden>
      <dl id="farm-materials" class="inventory-materials" aria-label="农场材料数量"></dl>
      <div id="farm-sow-list"></div>
      <div class="recipe" id="farm-fertilizer-row">
        ${itemIconImg("fertilizer", 28)}
        <div><h3>${RECIPES.fertilizer.name}</h3><p id="farm-fertilizer-cost"></p></div>
        <button id="craft-fertilizer" type="button">制作${RECIPES.fertilizer.name}</button>
      </div>
      <div class="recipe" id="farm-watering-can-row">
        ${itemIconImg("wateringCan", 28)}
        <div><h3>${RECIPES.wateringCan.name}</h3><p id="farm-watering-can-cost"></p></div>
        <button id="craft-watering-can" type="button">制作${RECIPES.wateringCan.name}</button>
      </div>
      <div id="farm-crops"></div>
      <p id="farm-empty" class="inventory-notice" style="margin: .45rem 0 0;"></p>
      <p class="inventory-notice" style="margin: .75rem 0 0;">对准耕地播种，成熟后到田里左键收割；下雨时作物长得更快</p>
    </div>`;
  inventoryMaterials.before?.(inventoryTabs);
  // The static backpack rows move into the backpack panel, so hiding the
  // panel hides them all at once. (In the test harness append is a
  // no-op, so the rows stay queryable by id there either way.)
  const backpackPanel = document.querySelector("#tab-backpack");
  const dressingRow = dressingCost.parentElement?.parentElement;
  const inventoryFoot = inventoryDressings.parentElement;
  backpackPanel.append(...[inventoryMaterials, dressingRow, healingList, inventoryFoot].filter(Boolean));
  const workbenchList = document.querySelector("#workbench-list");
  workbenchList.innerHTML = `
    <div class="recipe" id="wb-row-workbench">
      ${itemIconImg("workbench", 28)}
      <div><h3>${RECIPES.workbench.name}</h3><p id="workbench-cost"></p></div>
      <button id="craft-workbench" type="button">建造${RECIPES.workbench.name}</button>
    </div>
    ${["stone", "ember", "star"].map(tier => `
    <div class="workbench-group">
      <h3><span style="display: inline-block; width: .6rem; height: .6rem; background: ${TIER_DOT[tier]}; margin-right: .4rem;"></span>${TIER_TITLES[tier]}</h3>
      ${tier === "stone" ? `
      <div class="recipe" id="wb-row-axe">
        ${itemIconImg("axe", 28)}
        <div><h3>${RECIPES.axe.name}</h3><p id="axe-cost"></p></div>
        <button id="craft-axe" type="button">制作${RECIPES.axe.name}</button>
      </div>` : ""}
      ${EQUIPMENT_KEYS.filter(key => RECIPES[key].tier === tier).map(key => `
      <div class="recipe" id="wb-row-${key}">
        ${itemIconImg(key, 28)}
        <div><h3>${RECIPES[key].name}</h3><p id="${key}-cost"></p></div>
        <button id="craft-${key}" type="button">打造${RECIPES[key].name}</button>
      </div>`).join("")}
    </div>`).join("")}
    <div class="workbench-group">
      <h3>烹饪</h3>
      ${COOKING_KEYS.map(key => `
      <div class="recipe" id="wb-row-${key}">
        ${itemIconImg(key, 28)}
        <div><h3>${RECIPES[key].name}</h3><p id="${key}-cost"></p></div>
        <button id="craft-${key}" type="button">制作${RECIPES[key].name}</button>
      </div>`).join("")}
    </div>`;
  const workbenchCost = document.querySelector("#workbench-cost");
  const craftWorkbenchButton = document.querySelector("#craft-workbench");
  const axeCost = document.querySelector("#axe-cost");
  const craftAxeButton = document.querySelector("#craft-axe");
  const workbenchMaterials = document.querySelector("#workbench-materials");
  const detailName = document.querySelector("#detail-name");
  const detailIcon = document.querySelector("#detail-icon");
  const detailTier = document.querySelector("#detail-tier");
  const detailMaterials = document.querySelector("#detail-materials");
  const detailLock = document.querySelector("#detail-lock");
  const detailCraft = document.querySelector("#detail-craft");
  craftWorkbenchButton.addEventListener("click", () => actions.craftItem("workbench"));
  const equipmentControls = EQUIPMENT_KEYS.map(key => {
    const controls = { cost: document.querySelector(`#${key}-cost`), craft: document.querySelector(`#craft-${key}`) };
    controls.craft.addEventListener("click", () => actions.craftItem(key));
    return { key, ...controls };
  });
  const cookingControls = COOKING_KEYS.map(key => {
    const controls = { cost: document.querySelector(`#${key}-cost`), craft: document.querySelector(`#craft-${key}`) };
    controls.craft.addEventListener("click", () => actions.craftItem(key));
    return { key, ...controls };
  });
  // The selected workbench recipe drives the detail card on the right;
  // clicking a list row selects it, the row's own button crafts it.
  let selectedRecipe = "workbench";
  let activeTab = "backpack";
  function selectRecipe(key) {
    selectedRecipe = key;
    refresh();
  }
  for (const key of ["workbench", "axe", ...EQUIPMENT_KEYS, ...COOKING_KEYS]) {
    document.querySelector(`#wb-row-${key}`).addEventListener("click", () => selectRecipe(key));
  }
  detailCraft.addEventListener("click", () => actions.craftItem(selectedRecipe));
  function selectInventoryTab(tab) {
    if (!INVENTORY_TABS.includes(tab)) return;
    activeTab = tab;
    for (const name of INVENTORY_TABS) {
      document.querySelector(`#tab-${name}`).hidden = name !== tab;
      document.querySelector(`#tab-btn-${name}`).classList.toggle("secondary-button", name !== tab);
    }
    inventoryPanel?.classList.toggle("wide", tab === "workbench" || tab === "tech");
  }
  for (const tab of INVENTORY_TABS) {
    document.querySelector(`#tab-btn-${tab}`).addEventListener("click", () => selectInventoryTab(tab));
  }
  // The tech tree tab: one card per node, trunk nodes in order with
  // their branches hanging right after them (the mount is visual
  // grouping only — the prerequisite is requires.tech). Listeners
  // attach querySelector-first like the workbench rows, so they work
  // in the harness too.
  const techList = document.querySelector("#tech-list");
  const techEmpty = document.querySelector("#tech-empty");
  techList.innerHTML = techDisplayOrder().map(id => {
    const node = TECH[id];
    return `<div class="recipe tech-node${node.mount ? " tech-branch" : ""}" id="tech-node-${id}"${node.mount ? " style=\"margin-left: 1.5rem;\"" : ""}>
      ${itemIconImg(id, 28)}
      <div><h3>${node.name}</h3><p>${node.desc}</p><p id="tech-cond-${id}"></p></div>
      <button id="tech-unlock-${id}" type="button">解锁</button>
    </div>`;
  }).join("");
  for (const id of Object.keys(TECH)) {
    document.querySelector(`#tech-unlock-${id}`).addEventListener("click", () => actions.unlockTech(id));
  }
  // One repair row per slot, built once and refreshed by
  // updateRepairList; a broken card's state button jumps to the
  // workbench tab, where the repair itself lives.
  document.querySelector("#repair-list").innerHTML = ["weapon", "armor", "tool"].map(slot => `
    <div class="recipe" id="repair-row-${slot}">
      <img id="repair-${slot}-icon" class="item-icon s36" src="" alt="">
      <div><h3 id="repair-${slot}-name"></h3><p id="repair-${slot}-cost"></p></div>
      <button id="repair-${slot}" type="button">修理</button>
    </div>`).join("");
  for (const slot of ["weapon", "armor", "tool"]) {
    document.querySelector(`#repair-${slot}`).addEventListener("click", () => actions.repairEquipment(slot));
    document.querySelector(`#equip-${slot}-state`).addEventListener("click", () => actions.onEquipStateClick(slot));
  }
  // The farm tab: one sow row per seed kind (built once — the seed kinds
  // are fixed by the registry, only the counts change), a compost craft
  // row, and the crop list, which updateFarmTab rebuilds because crops
  // come and go. The crop rows carry no buttons (a growing crop has no
  // action, a mature one only a disabled chip), so rebuilding their
  // innerHTML never drops a listener.
  const FARM_SEEDS = [...new Set(Object.values(CROPS).map(def => def.seed))];
  const farmSowList = document.querySelector("#farm-sow-list");
  farmSowList.innerHTML = FARM_SEEDS.map(seed => `
    <div class="recipe" id="farm-sow-${seed}">
      ${itemIconImg(seed, 28)}
      <div><h3>${FARM_MATERIALS[seed]}</h3><p id="farm-sow-${seed}-cost"></p></div>
      <button id="farm-sow-${seed}-btn" type="button">播种</button>
    </div>`).join("");
  for (const seed of FARM_SEEDS) {
    document.querySelector(`#farm-sow-${seed}-btn`).addEventListener("click", () => actions.enterSowMode(seed));
  }
  const farmFertilizerCost = document.querySelector("#farm-fertilizer-cost");
  const craftFertilizerButton = document.querySelector("#craft-fertilizer");
  craftFertilizerButton.addEventListener("click", () => actions.craftItem("fertilizer"));
  const farmWateringCanCost = document.querySelector("#farm-watering-can-cost");
  const craftWateringCanButton = document.querySelector("#craft-watering-can");
  craftWateringCanButton.addEventListener("click", () => actions.craftItem("wateringCan"));
  // The sow-mode hint: a HUD line that only shows while the mode is
  // armed, styled like #pulse-hint (styles.css is not touched by this
  // change, so the look is inline). Query-first like the tab panels, so
  // the harness reads the same element the game mutates.
  const sowHint = document.querySelector("#sow-hint") ?? (() => {
    const hint = document.createElement("div");
    hint.id = "sow-hint";
    return hint;
  })();
  sowHint.innerHTML = "播种：对准耕地<kbd>左键</kbd>种下，<kbd>右键</kbd>取消";
  sowHint.setAttribute("style", "margin: 0 0 .42rem; color: #e2e8f7; font-size: .75rem;");
  sowHint.hidden = true;
  document.querySelector("#hud")?.append?.(sowHint);

  // A cost id's display name: block ids read the block names, string
  // ids read the farm table first, then the rare table (the loot line's
  // own order) — wheat is a farm material, not a boss drop.
  function materialName(id, env) {
    return typeof id === "string" ? (FARM_MATERIALS[id] ?? RARE_MATERIALS[id]) : env.blockNames[id];
  }

  function recipeCost(campaign, env, key) {
    return RECIPES[key].cost.map(([id, count]) => {
      return `${materialName(id, env)} ${campaign.count(id)}/${count}`;
    }).join(" · ");
  }

  // One material cell per block plus one per rare material; the backpack
  // tab and the workbench strip render the same seven cells.
  function renderMaterials(campaign, list, env) {
    const iconFor = key => {
      const icon = document.createElement("img");
      icon.className = "item-icon s20";
      icon.src = `icons/${itemIconKey(key)}.svg`;
      icon.alt = "";
      return icon;
    };
    list.replaceChildren(...env.palette.map(block => {
      const entry = document.createElement("div");
      const label = document.createElement("dt"), value = document.createElement("dd");
      label.textContent = env.blockNames[block];
      value.textContent = String(campaign.count(block));
      entry.append(iconFor(block), label, value);
      return entry;
    }), ...Object.entries(campaign.rareMaterials).map(([id, count]) => {
      const entry = document.createElement("div");
      const label = document.createElement("dt"), value = document.createElement("dd");
      label.textContent = RARE_MATERIALS[id];
      value.textContent = String(count);
      entry.append(iconFor(id), label, value);
      return entry;
    }));
  }

  // The lock line for one equipment recipe: no workbench yet, or the
  // tier's boss kill (from weapons.mjs); null when it is open.
  function recipeLockReason(campaign, key, state) {
    if (!campaign.workbenchBuilt) return "需先建造工作台";
    const node = techForRecipe(key);
    if (!node) return null;
    return techLockReason(state, node);
  }

  // The tech tree tab: each node's condition line (have/need per
  // requirement, unmet in gold) and button state (unlocked / unlockable
  // / locked), all from the same techConditions/canUnlockTech the
  // campaign uses — the tree and the workbench tab cannot disagree.
  // The empty-state line shows only while nothing is unlocked at all.
  function updateTechTree(state) {
    techEmpty.hidden = state.techUnlocked.length > 0;
    for (const id of Object.keys(TECH)) {
      const conditions = techConditions(state, id);
      const cond = document.querySelector(`#tech-cond-${id}`);
      cond.innerHTML = conditions.map(condition => `<span${condition.met ? "" : " style=\"color: #f0d285;\""}>${condition.text}</span>`).join(" · ");
      const button = document.querySelector(`#tech-unlock-${id}`);
      const unlocked = state.techUnlocked.includes(id);
      button.disabled = unlocked || !canUnlockTech(state, id);
      setText(button, unlocked ? "已解锁" : "解锁");
      document.querySelector(`#tech-node-${id}`).style.setProperty("border-left", unlocked ? "3px solid #d9e5c6" : "");
    }
  }

  // The workbench detail card (right column): the selected recipe's
  // name, tier, material list with have/need (shortfalls in gold, rare
  // materials with their boss source), lock line and craft button.
  function updateWorkbenchDetail(campaign, env, state) {
    if (selectedRecipe === "workbench" && campaign.workbenchBuilt) selectedRecipe = EQUIPMENT_KEYS[0];
    const key = selectedRecipe;
    const recipe = RECIPES[key];
    if (!recipe) return;
    const owned = recipe.equipment ? campaign.equipment[recipe.equipment] : null;
    setText(detailName, recipe.name);
    detailIcon.src = `icons/${itemIconKey(key)}.svg`;
    setText(detailTier, recipe.tier ? TIER_TITLES[recipe.tier] : recipe.cooking ? "烹饪" : key === "workbench" ? "一次性，永久解锁" : "");
    // Built as innerHTML like the healing rows, so the list is readable
    // in tests too (replaceChildren is a no-op in the harness).
    detailMaterials.innerHTML = recipe.cost.map(([id, amount]) => {
      const name = materialName(id, env);
      const source = typeof id === "string" && RARE_SOURCE[id] ? `（${RARE_SOURCE[id]}掉落）` : "";
      const have = campaign.count(id);
      const short = have < amount ? " style=\"color: #f0d285;\"" : "";
      return `<p${short}>${itemIconImg(id, 16)}${name}${source} ${have}/${amount}</p>`;
    }).join("");
    const reason = recipe.equipment ? recipeLockReason(campaign, key, state)
      : recipe.cooking && !campaign.workbenchBuilt ? "需先建造工作台" : null;
    setText(detailLock, reason ?? "");
    detailCraft.disabled = !campaign.canCraft(key);
    setText(detailCraft, owned ? "已拥有" : key === "workbench" ? "建造工作台" : key === "axe" ? "制作石斧" : recipe.cooking ? `制作${recipe.name}` : `打造${recipe.name}`);
  }

  // The equipment tab's three slot cards. The weapon card always shows
  // the current weapon — the crafted one, or the stone sword by default.
  // The durability bars are live: width and text follow the piece, gold
  // above 25%, the health bar's red below it. A broken piece greys its
  // card, gains "（已损坏，无法使用）", and its state button becomes a
  // jump to the workbench tab ("在工作台修理（石头 5）") — the repair
  // itself only lives on the workbench tab.
  function setEquipIcon(slot, key, owned) {
    const icon = document.querySelector(`#equip-${slot}-icon`);
    icon.src = `icons/${itemIconKey(key)}.svg`;
    icon.style.setProperty("opacity", owned ? "" : ".35");
  }

  function updateEquipmentCards(campaign, env) {
    const weapon = campaign.equipment.weapon;
    setEquipIcon("weapon", weapon?.key ?? "stoneSword", true);
    setEquipIcon("armor", campaign.equipment.armor?.key ?? "stoneArmor", Boolean(campaign.equipment.armor));
    setEquipIcon("tool", campaign.equipment.tool?.key ?? "stonePickaxe", Boolean(campaign.equipment.tool));
    const current = weapon ? WEAPONS[weapon.key] : WEAPONS.stoneSword;
    const weaponBroken = weapon && weapon.durability <= 0;
    setText(document.querySelector("#equip-weapon-name"), current.name + (weaponBroken ? "（已损坏，无法使用）" : ""));
    setText(document.querySelector("#equip-weapon-info"), weaponBroken ? "失效，回退到石阶 / 拳头 / 0.28 秒"
      : `${TIER_TITLES[current.tier] ?? "石阶"} · 伤害 ${current.damage}`);
    setDurabilityBar("weapon", weapon);
    setText(document.querySelector("#equip-weapon-state"), weaponBroken ? repairHint(weapon, env) : weapon ? "已装备" : "默认武器");
    document.querySelector("#equip-weapon-state").disabled = !weaponBroken;
    document.querySelector("#equip-weapon-card").style.setProperty("opacity", weaponBroken ? ".58" : "");
    const armor = campaign.equipment.armor;
    const armorBroken = armor && armor.durability <= 0;
    setText(document.querySelector("#equip-armor-name"), (armor ? RECIPES[armor.key].name : "防具") + (armorBroken ? "（已损坏，无法使用）" : ""));
    setText(document.querySelector("#equip-armor-info"), armorBroken ? "失效，回退到石阶 / 拳头 / 0.28 秒"
      : armor ? `${TIER_TITLES[armor.tier]} · 减伤 ${Math.round(armorReduction(armor.tier) * 100)}%` : "未获得——在工作台制作");
    setDurabilityBar("armor", armor);
    setText(document.querySelector("#equip-armor-state"), armorBroken ? repairHint(armor, env) : armor ? "已装备" : "未获得");
    document.querySelector("#equip-armor-state").disabled = !armorBroken;
    document.querySelector("#equip-armor-card").style.setProperty("opacity", armorBroken ? ".58" : "");
    const tool = campaign.equipment.tool;
    const toolBroken = tool && tool.durability <= 0;
    setText(document.querySelector("#equip-tool-name"), (tool ? RECIPES[tool.key].name : "工具") + (toolBroken ? "（已损坏，无法使用）" : ""));
    setText(document.querySelector("#equip-tool-info"), toolBroken ? "失效，回退到石阶 / 拳头 / 0.28 秒"
      : tool ? `${TIER_TITLES[tool.tier]} · 挖掘 ${miningInterval(tool.tier).toFixed(2)} 秒/块` : "未获得——在工作台制作");
    setDurabilityBar("tool", tool);
    setText(document.querySelector("#equip-tool-state"), toolBroken ? repairHint(tool, env) : tool ? "已装备" : "未获得");
    document.querySelector("#equip-tool-state").disabled = !toolBroken;
    document.querySelector("#equip-tool-card").style.setProperty("opacity", toolBroken ? ".58" : "");
  }

  // One slot's durability bar and its "耐久 X%" text. No piece means no
  // bar (width 0, "耐久 —"), so an empty slot never pretends to be full.
  function setDurabilityBar(slot, piece) {
    const bar = document.querySelector(`#equip-${slot}-durability`);
    const text = document.querySelector(`#equip-${slot}-durability-text`);
    if (!piece) {
      bar.style.setProperty("width", "0%");
      setText(text, "耐久 —");
      return;
    }
    const pct = Math.floor(piece.durability / durabilityMax(piece.tier) * 100);
    bar.style.setProperty("width", `${pct}%`);
    bar.style.setProperty("background", pct < 25 ? "#e4725c" : "#f0d285");
    setText(text, `耐久 ${pct}%`);
  }

  // A tier's repair cost as amounts only ("石头 5", "石头 5 + 熔火核心 1").
  function repairCostText(tier, env) {
    return repairCost(tier).map(([id, amount]) => {
      const name = typeof id === "string" ? RARE_MATERIALS[id] : env.blockNames[id];
      return `${name} ${amount}`;
    }).join(" + ");
  }

  // A tier's repair cost with what the player holds ("石头 14/5").
  function repairCostWithCounts(campaign, env, tier) {
    return repairCost(tier).map(([id, amount]) => {
      const name = typeof id === "string" ? RARE_MATERIALS[id] : env.blockNames[id];
      return `${name} ${campaign.count(id)}/${amount}`;
    }).join(" · ");
  }

  function repairAffordable(campaign, tier) {
    return repairCost(tier).every(([id, amount]) => campaign.count(id) >= amount);
  }

  // The broken card's jump line: "在工作台修理（石头 5）".
  function repairHint(piece, env) {
    return `在工作台修理（${repairCostText(piece.tier, env)}）`;
  }

  // A piece's display name, by slot (weapons come from the weapon
  // registry, armor and tools from the recipe table).
  function equipmentPieceName(piece, slot) {
    return slot === "weapon" ? WEAPONS[piece.key].name : RECIPES[piece.key].name;
  }

  // The workbench tab's repair rows: one per damaged piece, hidden
  // otherwise. The empty line reads "没有损坏的装备" (or "需先建造工作台"
  // before the workbench exists, when nothing can be repaired at all).
  function updateRepairList(campaign, env) {
    let anyDamaged = false;
    for (const slot of ["weapon", "armor", "tool"]) {
      const piece = campaign.equipment[slot];
      const row = document.querySelector(`#repair-row-${slot}`);
      if (!piece || piece.durability >= durabilityMax(piece.tier)) { row.hidden = true; continue; }
      anyDamaged = true;
      row.hidden = false;
      document.querySelector(`#repair-${slot}-icon`).src = `icons/${itemIconKey(piece.key)}.svg`;
      setText(document.querySelector(`#repair-${slot}-name`),
        `${equipmentPieceName(piece, slot)} · 耐久 ${Math.floor(piece.durability / durabilityMax(piece.tier) * 100)}%`);
      setText(document.querySelector(`#repair-${slot}-cost`), repairCostWithCounts(campaign, env, piece.tier));
      const button = document.querySelector(`#repair-${slot}`);
      button.disabled = !campaign.workbenchBuilt || !repairAffordable(campaign, piece.tier);
      setText(button, "修理");
    }
    const empty = document.querySelector("#repair-empty");
    empty.hidden = anyDamaged;
    setText(empty, campaign.workbenchBuilt ? "没有损坏的装备" : "需先建造工作台");
  }

  // The farm tab (R3): the farm-material strip (every registered farm
  // material, 0 included, so the player sees a seed exists before
  // owning one), one sow row per seed, the compost craft row, and the
  // crop list — one row per planted crop with its growth bar (the 6px
  // durability bar, gold fill, no red: growth is not damage) and a
  // status line. The rain suffix uses the same signal as the growth
  // rate (env.raining + env.roofed, injected per refresh), so the line never
  // claims a speedup the crop is not getting; per-crop shelter is still
  // deferred to the watering-can round.
  function updateFarmTab(campaign, env) {
    const farmMaterials = document.querySelector("#farm-materials");
    farmMaterials.innerHTML = Object.entries(FARM_MATERIALS).map(([id, name]) =>
      `<div>${itemIconImg(id, 20)}<dt>${name}</dt><dd>${campaign.count(id)}</dd></div>`).join("");
    for (const seed of FARM_SEEDS) {
      const owned = campaign.count(seed);
      setText(document.querySelector(`#farm-sow-${seed}-cost`),
        owned > 0 ? `已有 ${owned} 粒 · 对准耕地播种` : "已有 0 粒 · 投掷者掉落");
      document.querySelector(`#farm-sow-${seed}-btn`).disabled = owned < 1;
    }
    setText(farmFertilizerCost, recipeCost(campaign, env, "fertilizer"));
    craftFertilizerButton.disabled = !campaign.canCraft("fertilizer");
    setText(farmWateringCanCost, campaign.wateringCanOwned ? "已拥有 · 对准作物按 J 浇水" : recipeCost(campaign, env, "wateringCan"));
    craftWateringCanButton.disabled = !campaign.canCraft("wateringCan");
    const crops = campaign.crops;
    const cells = Object.keys(crops);
    const raining = env.raining;
    const roofed = env.roofed;
    document.querySelector("#farm-crops").innerHTML = cells.map(cell => {
      const crop = crops[cell];
      const def = CROPS[crop.crop];
      const mature = isMature(def, crop.growth);
      const [x, , z] = voxelPosition(WORLD, Number(cell));
      const days = (crop.growth / DAY_LENGTH).toFixed(1);
      const totalDays = def.growthSeconds / DAY_LENGTH;
      const pct = Math.min(100, Math.round(crop.growth / def.growthSeconds * 100));
      const rainNote = mature || !raining ? "" : roofed ? " · 有遮挡，雨淋不到" : " · 雨中加速";
      const fedNote = crop.fertilized ? " · 已施肥" : "";
      const waterNote = crop.watered ? " · 已浇水" : "";
      const status = mature ? `${def.name} · 已成熟 · 位于 (${x}, ${z})${fedNote}${waterNote}`
        : `${def.name} · 生长中 · ${days} / ${totalDays} 天${rainNote}${fedNote}${waterNote}`;
      const chip = mature ? `<button type="button" disabled>已成熟</button>` : "";
      return `<div class="recipe" id="farm-crop-${cell}">
        ${itemIconImg(crop.crop, 28)}
        <div><h3>${def.name}</h3><p>${status}</p></div>
        <div><div style="width: 6rem; height: 6px; background: #273526;"><span style="display: block; width: ${pct}%; height: 6px; background: #f0d285;"></span></div></div>
        ${chip}
      </div>`;
    }).join("");
    const empty = document.querySelector("#farm-empty");
    empty.hidden = cells.length > 0;
    const seedsOwned = FARM_SEEDS.reduce((sum, seed) => sum + campaign.count(seed), 0);
    setText(empty, cells.length ? "" : seedsOwned > 0
      ? "还没有种下作物——上面点播种，先选一粒种子"
      : "还没有种子——投掷者掉落小麦种子，开局自带 2 粒");
  }

  function updateInventory(campaign, env) {
    renderMaterials(campaign, inventoryMaterials, env);
    renderMaterials(campaign, workbenchMaterials, env);
    setText(axeCost, campaign.axeUnlocked ? "已解锁，按 7 装备" : recipeCost(campaign, env, "axe"));
    const counts = campaign.dressingsByRecipe;
    // The dressing row shows the heal a use actually gives: the recipe
    // amount plus the 急救 bonus when unlocked, so the line never lies
    // about the +10.
    const firstAid = campaign.techUnlocked.includes("firstAid") ? TECH_EFFECTS.firstAidHealing : 0;
    for (const { key, cost, craft, use, cooking } of healingControls) {
      if (cooking) {
        // The food line shows the heal a bite actually gives (recipe
        // amount plus the 急救 bonus, like the dressing line); a
        // buffed dish names its buff instead of where it is made —
        // its cost lives on the workbench tab, not here. Eating is
        // the only action on this row. The first-aid bonus touches
        // only the heal number, never the buff percent or seconds.
        const buff = RECIPES[key].buff;
        setText(cost, buff
          ? `恢复 ${RECIPES[key].healing + firstAid} 点生命 · ${buffLabels[buff.kind]} +${buff.pct}%（${buff.seconds} 秒）`
          : `恢复 ${RECIPES[key].healing + firstAid} 点生命 · 在工作台烹饪`);
        use.disabled = !counts[key] || env.playerHp >= 100;
        continue;
      }
      setText(cost, `${recipeCost(campaign, env, key)} · 恢复 ${RECIPES[key].healing + firstAid} 点生命`);
      craft.disabled = !campaign.canCraft(key);
      use.disabled = !counts[key] || env.playerHp >= 100;
    }
    for (const { key, cost, craft } of cookingControls) {
      const reason = campaign.workbenchBuilt ? null : "需先建造工作台";
      // A buffed dish names its buff on the workbench line too, in
      // the backpack row's format (batch 48, closing the R5 note).
      const buff = RECIPES[key].buff;
      const line = `${recipeCost(campaign, env, key)} · 恢复 ${RECIPES[key].healing + firstAid} 点生命`
        + (buff ? ` · ${buffLabels[buff.kind]} +${buff.pct}%（${buff.seconds} 秒）` : "");
      setText(cost, reason ? `${reason} · ${line}` : line);
      craft.disabled = !campaign.canCraft(key);
    }
    setText(inventoryDressings, `${HEALING_KEYS.map(key => `${RECIPES[key].name} ${counts[key]} 件`).join(" · ")} · 当前生命 ${env.playerHp}/100`);
    craftAxeButton.disabled = !campaign.canCraft("axe");
    setText(workbenchCost, campaign.workbenchBuilt ? "已建造" : recipeCost(campaign, env, "workbench"));
    craftWorkbenchButton.disabled = !campaign.canCraft("workbench");
    updateRepairList(campaign, env);
    const progress = campaign.loadProgress();
    const state = campaign.techState(progress);
    for (const { key, cost, craft } of equipmentControls) {
      const owned = campaign.equipment[RECIPES[key].equipment];
      const reason = recipeLockReason(campaign, key, state);
      setText(cost, owned ? `已装备${RECIPES[owned.key].name}`
        : reason ? `${reason} · ${recipeCost(campaign, env, key)}` : recipeCost(campaign, env, key));
      craft.disabled = !campaign.canCraft(key);
    }
    updateWorkbenchDetail(campaign, env, state);
    updateEquipmentCards(campaign, env);
    updateTechTree(state);
    updateFarmTab(campaign, env);
  }
  return { updateInventory, selectInventoryTab, selectRecipe, equipmentPieceName, sowHint, farmSeeds: FARM_SEEDS };
}
