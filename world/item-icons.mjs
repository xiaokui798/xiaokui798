// The one icon-key resolver for the whole UI (batch 81, visual
// batch 80's wiring spec): every surface that shows an item, recipe
// or tech name with its icon — the craft toast, the material strips,
// recipe / tech / farm rows, the equipment cards, the detail panel,
// the hotbar — resolves its asset key here, so the one rename the
// asset set needs (the recipe key "axe" ships as the stoneAxe
// artwork) exists exactly once. Keys that already name their asset
// pass through unchanged; block ids resolve through the block
// table. Rendering follows the toast's convention: a plain
// <img src="icons/<key>.svg" alt="">, the name beside it doing the
// talking.

import { BLOCK } from "./recipes.mjs";
import { WEAPONS } from "./weapons.mjs";

const RENAMED = { axe: "stoneAxe" };
const BLOCK_ICONS = {
  [BLOCK.GRASS]: "grass", [BLOCK.DIRT]: "dirt", [BLOCK.STONE]: "stone",
  [BLOCK.WOOD]: "wood", [BLOCK.LEAF]: "leaf"
};

// An item / recipe / tech / material key (or a block id) -> the
// icon asset key under icons/.
export function itemIconKey(key) {
  if (typeof key === "number") return BLOCK_ICONS[key] ?? "stone";
  return RENAMED[key] ?? key;
}

// A weapon object from the WEAPONS registry -> its asset key (the
// registry values carry no key of their own, so resolve by
// identity).
export function weaponIconKey(weapon) {
  return Object.keys(WEAPONS).find(key => WEAPONS[key] === weapon) ?? "stoneSword";
}

// The icon <img> markup for innerHTML renderers; size is one of
// the .item-icon tiers in styles.css (16 / 20 / 24 / 26 / 28 / 36).
export function itemIconImg(key, size) {
  return `<img class="item-icon s${size}" src="icons/${itemIconKey(key)}.svg" alt="">`;
}
