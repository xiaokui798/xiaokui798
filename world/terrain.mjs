export const LEGACY_WORLD = Object.freeze({ minX: 0, minZ: 0, width: 32, height: 24, depth: 32 });
export const WORLD = Object.freeze({ minX: -16, minZ: -16, width: 64, height: 24, depth: 64 });
export const CHUNK_SIZE = 8;

export function contains(layout, x, y, z) {
  return x >= layout.minX && x < layout.minX + layout.width && y >= 0 && y < layout.height
    && z >= layout.minZ && z < layout.minZ + layout.depth;
}

export function voxelIndex(layout, x, y, z) {
  return (x - layout.minX) + layout.width * (y + layout.height * (z - layout.minZ));
}

export function voxelPosition(layout, cell) {
  return [cell % layout.width + layout.minX, Math.floor(cell / layout.width) % layout.height,
    Math.floor(cell / (layout.width * layout.height)) + layout.minZ];
}

function terrainHeight(x, z) {
  const waves = Math.sin(x * .32) * 1.5 + Math.cos(z * .27) * 1.35 + Math.sin((x + z) * .16) * 1.15;
  const ridge = Math.sin(x * .095 - z * .11) * 1.7;
  return Math.max(3, Math.min(11, Math.floor(6 + waves + ridge)));
}

export function seeded(x, z) {
  let n = (x * 374761393 + z * 668265263) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function generateTerrain(layout, { AIR, GRASS, DIRT, STONE, WOOD, LEAF }) {
  const world = new Uint8Array(layout.width * layout.height * layout.depth);
  // Generation variants: one atlas tile override per cell, 0 for the plain
  // tile of the block type.  The mesh reads this record (via getVariant) so
  // a ruin stone renders mossy or cracked and a flower renders flowery,
  // without new block types: game logic still sees plain STONE and LEAF.
  // The record rides on the returned array as `world.variants`, so it
  // survives regeneration the same way the blocks do.
  const variants = new Uint8Array(world.length);
  function setVariant(x, y, z, tile) {
    if (contains(layout, x, y, z)) variants[voxelIndex(layout, x, y, z)] = tile;
  }
  const { minX, minZ } = layout;
  const maxX = minX + layout.width, maxZ = minZ + layout.depth;
  const isOldMap = (x, z) => contains(LEGACY_WORLD, x, 0, z);
  function write(x, y, z, block) {
    if (contains(layout, x, y, z)) world[voxelIndex(layout, x, y, z)] = block;
  }
  function makeTree(x, y, z, onOldMap, forceVariant = null) {
    // Five variants, chosen deterministically from the tree's position.
    // The original three are used everywhere; some extension trees that
    // would have been the original wide crown become a tall conical pine
    // or a low wide willow, and half the short wide trees become willows.
    // Variant 1 is untouched, and old-map trees always use the original
    // three, so legacy saves keep their trees exactly.  A forced variant
    // skips the seeded choice: the oasis plants pines on purpose, so its
    // grove reads above the sand.
    const oldVariant = Math.floor(seeded(x + 101, z - 57) * 3);
    let variant = forceVariant ?? oldVariant;
    // In the snowfield every tree is a pine: a pure conifer forest, not
    // the mixed woodland of the grassland.
    if (forceVariant === null) {
      if (!onOldMap && biomeAt(x, z) === "snow") {
        variant = 3;
      } else if (!onOldMap && oldVariant === 0 && seeded(x + 201, z - 77) < .8) {
        variant = seeded(x + 301, z + 41) < .5 ? 3 : 4;
      } else if (!onOldMap && oldVariant === 2 && seeded(x + 401, z - 91) < .5) {
        variant = 4;
      }
    }
    const trunk = variant === 1 ? 5 + Math.floor(seeded(x + 13, z + 29) * 2)
      : variant === 2 ? 2
      : variant === 3 ? 6 + Math.floor(seeded(x + 13, z + 29) * 2)
      : variant === 4 ? 4
      : 3 + Math.floor(seeded(x + 31, z - 17) * 2);
    for (let dy = 0; dy < trunk; dy++) write(x, y + dy, z, WOOD);
    const crownY = y + trunk - 2;
    function leaf(dx, dy, dz) {
      // Extension trees must not change blocks in the original save area.
      if (!onOldMap && isOldMap(x + dx, z + dz)) return;
      write(x + dx, crownY + dy, z + dz, LEAF);
    }
    function leafAir(dx, dy, dz) {
      // Like leaf, but only into empty cells, so a wide willow canopy
      // never splits a neighbouring trunk by overwriting its wood.
      if (!onOldMap && isOldMap(x + dx, z + dz)) return;
      const tx = x + dx, ty = crownY + dy, tz = z + dz;
      if (contains(layout, tx, ty, tz) && world[voxelIndex(layout, tx, ty, tz)] === AIR) {
        write(tx, ty, tz, LEAF);
      }
    }
    if (variant === 1) {
      // Tall slim pine: narrow 3x3 crown with a single tip.
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 2; dy++) {
        if (dx === 0 && dz === 0 && dy < 2) continue;
        if (Math.abs(dx) + Math.abs(dz) > 1 && dy === 2) continue;
        leaf(dx, dy, dz);
      }
      leaf(0, 3, 0);
    } else if (variant === 3) {
      // Tall conical pine: a 6-7 block trunk with a four-layer cone — a
      // wide 5x5 base tapering to a single tip.
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (Math.abs(dx) + Math.abs(dz) > 3) continue;
        leaf(dx, 0, dz);
      }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (Math.abs(dx) + Math.abs(dz) > 2) continue;
        leaf(dx, 1, dz);
      }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 1) continue;
        leaf(dx, 2, dz);
      }
      leaf(0, 3, 0);
    } else if (variant === 4) {
      // Low wide willow: a flat 7x7 canopy with leaf strands drooping
      // below its edge.  All willow writes are AIR-only, so the wide
      // canopy never overwrites a neighbouring trunk.
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (Math.abs(dx) + Math.abs(dz) > 4) continue;
        leafAir(dx, 0, dz);
      }
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (Math.abs(dx) + Math.abs(dz) > 3) continue;
        leafAir(dx, 1, dz);
      }
      // Drooping strands hang from the radius-2 ring of the canopy: at
      // radius 3 they would read as bushes to the flower/bush detector,
      // whose premise is that crown leaves always have their trunk within
      // two columns.
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
        if (seeded(x + dx * 7 + 11, z + dz * 5 - 3) > .55) continue;
        leafAir(dx, -1, dz);
        if (seeded(x + dx * 3 + 5, z + dz * 7 + 9) < .5) leafAir(dx, -2, dz);
      }
    } else if (variant === 2) {
      // Short wide tree: flat 5x5 crown, only two blocks tall.
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 1; dy++) {
        if (dx === 0 && dz === 0 && dy < 2) continue;
        if (Math.abs(dx) + Math.abs(dz) > 2) continue;
        leaf(dx, dy, dz);
      }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) leaf(dx, 2, dz);
    } else {
      // Original 5x5x4 crown.
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 3; dy++) {
        const radius = dy === 3 ? 1 : 2;
        if (dx === 0 && dz === 0 && dy < 2) continue;
        if (Math.abs(dx) + Math.abs(dz) > radius + (dy === 0 ? 1 : 0)) continue;
        leaf(dx, dy, dz);
      }
    }
  }
  for (let x = minX; x < maxX; x++) for (let z = minZ; z < maxZ; z++) {
    const top = terrainHeight(x, z);
    for (let y = 0; y <= top; y++) write(x, y, z, y === top ? GRASS : y > top - 3 ? DIRT : STONE);
  }
  for (let x = minX + 3; x < maxX - 3; x++) for (let z = minZ + 3; z < maxZ - 3; z++) {
    const onOldMap = isOldMap(x, z);
    if (onOldMap && (x < 3 || x >= 29 || z < 3 || z >= 29)) continue;
    const top = terrainHeight(x, z);
    // Snow grows a conifer forest: trees take root on lower ground there
    // and far more often, so the snowfield is wooded while the grassland
    // keeps exactly the trees it had.
    const snow = !onOldMap && biomeAt(x, z) === "snow";
    const minTop = snow ? 3 : 5;
    const seedCut = snow ? .85 : .945;
    // A tree never grows on a hilltop: ground higher than 8 stays bare,
    // so the hills keep a clean treeline.
    if (top > minTop && top <= 8 && seeded(x, z) > seedCut && seeded(x - 1, z + 2) > .42) makeTree(x, top + 1, z, onOldMap);
  }
  // Rubble and grass tufts, scattered sparsely in the extension ring only.
  // They never touch the original save area or the central spawn clearing,
  // and never overwrite a tree: a column is only used when the cell above
  // its grass top is still empty.
  for (let x = minX; x < maxX; x++) for (let z = minZ; z < maxZ; z++) {
    if (isOldMap(x, z)) continue;
    if (x >= 14 && x <= 18 && z >= 14 && z <= 18) continue;
    const top = terrainHeight(x, z);
    if (world[voxelIndex(layout, x, top + 1, z)] !== AIR) continue;
    if (seeded(x + 211, z - 137) > .99) write(x, top + 1, z, STONE);
    else if (seeded(x - 53, z + 91) > .985) write(x, top + 1, z, LEAF);
  }
  // Ruins and dead trees, extension ring only.  Both only ever write into
  // cells that are still AIR, so they never overwrite trees, rubble or each
  // other, and never touch the original save area or the spawn clearing.
  // Columns are built upward and stop at the first occupied cell, so no
  // stone ever floats above a leaf crown.
  const inRing = (x, z) => !isOldMap(x, z) && !(x >= 14 && x <= 18 && z >= 14 && z <= 18);
  function stackStone(x, z, height, pickVariant = null) {
    if (!inRing(x, z)) return 0;
    const top = terrainHeight(x, z);
    let built = 0;
    for (let dy = 1; dy <= height; dy++) {
      if (top + dy >= layout.height) break;
      if (world[voxelIndex(layout, x, top + dy, z)] !== AIR) break;
      write(x, top + dy, z, STONE);
      if (pickVariant) setVariant(x, top + dy, z, pickVariant(x, top + dy, z));
      built++;
    }
    return built;
  }
  function makeRuin(cx, cz) {
    // Wall stones are mostly mossy (old and overgrown), some cracked;
    // pillar stubs and fallen blocks are cracked (broken, not overgrown).
    const wallVariant = (x, _y, z) => seeded(x + 501, z - 301) > .3 ? TILE.MOSS_STONE : TILE.CRACK_STONE;
    if (seeded(cx + 911, cz - 77) < .5) {
      // Broken wall: a straight run of stone with a ragged top and gaps
      // where whole columns are missing.
      const alongX = seeded(cx - 31, cz + 17) > .5;
      const length = 4 + Math.floor(seeded(cx + 7, cz - 3) * 3);
      const start = -Math.floor(length / 2);
      for (let i = 0; i < length; i++) {
        const x = alongX ? cx + start + i : cx;
        const z = alongX ? cz : cz + start + i;
        if (seeded(cx + i * 7 + 1, cz + i * 3 - 5) < .18) continue;
        stackStone(x, z, 2 + Math.floor(seeded(cx + i * 13, cz - i * 11) * 2), wallVariant);
      }
    } else {
      // Collapsed pillar: a standing stub, plus the fallen top lying as
      // rubble in a line on the ground.
      stackStone(cx, cz, 3 + Math.floor(seeded(cx + 5, cz + 9) * 3), () => TILE.CRACK_STONE);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const [dx, dz] = dirs[Math.floor(seeded(cx - 19, cz + 41) * 4)];
      const fallen = 2 + Math.floor(seeded(cx + 23, cz - 29) * 2);
      for (let k = 1; k <= fallen; k++) {
        const x = cx + dx * k, z = cz + dz * k;
        if (!inRing(x, z)) continue;
        const top = terrainHeight(x, z);
        if (top + 1 < layout.height && world[voxelIndex(layout, x, top + 1, z)] === AIR) {
          write(x, top + 1, z, STONE);
          setVariant(x, top + 1, z, TILE.CRACK_STONE);
        }
      }
    }
  }
  // One ruin site per 9x9 plot at most, so ruins stay scattered instead of
  // clumping into a stone field.
  for (let gx = minX; gx < maxX; gx += 9) for (let gz = minZ; gz < maxZ; gz += 9) {
    if (seeded(gx + 911, gz - 607) <= .5) continue;
    const cx = gx + 3 + Math.floor(seeded(gx + 521, gz - 433) * 3);
    const cz = gz + 3 + Math.floor(seeded(gx - 149, gz + 271) * 3);
    if (!inRing(cx, cz)) continue;
    makeRuin(cx, cz);
  }
  // Dead trees: leafless trunks with one or two dry side branches, no crown.
  // They grow only where the column above the grass top is still empty, so
  // they never replace a live tree or a ruin.  Around ruins they grow
  // twice as often: the old walls stand in a grove of dead wood.
  function nearRuin(x, z) {
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const nx = x + dx, nz = z + dz;
      if (!contains(layout, nx, 0, nz)) continue;
      const top = terrainHeight(nx, nz);
      if (top + 1 >= layout.height) continue;
      const i = voxelIndex(layout, nx, top + 1, nz);
      if (world[i] === STONE && (variants[i] === TILE.MOSS_STONE || variants[i] === TILE.CRACK_STONE)) return true;
    }
    return false;
  }
  for (let x = minX; x < maxX; x++) for (let z = minZ; z < maxZ; z++) {
    if (!inRing(x, z)) continue;
    const top = terrainHeight(x, z);
    if (top + 1 >= layout.height) continue;
    if (world[voxelIndex(layout, x, top + 1, z)] !== AIR) continue;
    const roll = seeded(x + 317, z - 251);
    if (roll <= .992 && (roll <= .976 || !nearRuin(x, z))) continue;
    const trunk = 2 + Math.floor(seeded(x + 71, z - 43) * 3);
    let built = 0;
    for (let dy = 1; dy <= trunk; dy++) {
      if (world[voxelIndex(layout, x, top + dy, z)] !== AIR) break;
      write(x, top + dy, z, WOOD);
      built++;
    }
    if (built < 2) continue;
    const branches = 1 + Math.floor(seeded(x - 83, z + 59) * 2);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let b = 0; b < branches; b++) {
      const [dx, dz] = dirs[Math.floor(seeded(x + b * 37, z - b * 19) * 4)];
      const by = top + built - b;
      const len = 1 + Math.floor(seeded(x + b * 11, z + b * 23) * 2);
      for (let k = 1; k <= len; k++) {
        const bx = x + dx * k, bz = z + dz * k;
        if (!contains(layout, bx, by, bz)) break;
        // A branch never reaches into the original save area: the
        // extension ring's dead wood stays out of it.
        if (!inRing(bx, bz)) break;
        if (world[voxelIndex(layout, bx, by, bz)] !== AIR) break;
        write(bx, by, bz, WOOD);
      }
    }
  }
  // Caves: deterministic worms dug deep in the stone layer of the
  // extension ring only.  A worm walks horizontally, carving a tunnel two
  // blocks tall with occasional wider chambers, and never climbs above
  // three blocks below the grass top, so the surface (and the dirt under
  // it) is never broken.  Every carved cell is checked against the ring,
  // the spawn clearing and the height band, so the original save area is
  // untouched and the bottom stone layer stays in place.
  function carveCave(x, y, z) {
    if (!inRing(x, z)) return;
    const top = terrainHeight(x, z);
    if (y < 1 || y > top - 4) return;
    write(x, y, z, AIR);
  }
  function makeCave(sx, sy, sz) {
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    let heading = Math.floor(seeded(sx + 3, sz - 5) * 8);
    let x = sx, y = sy, z = sz;
    const length = 8 + Math.floor(seeded(sx - 11, sz + 7) * 10);
    for (let step = 0; step < length; step++) {
      // Stay in the stone band of the current column: without the clamp a
      // worm that drifts out of the band stops carving for the rest of its
      // walk and the caves come out too sparse to find.
      const bandTop = terrainHeight(x, z) - 4;
      if (bandTop >= 1) y = Math.min(Math.max(y, 1), bandTop);
      // Two blocks tall, usually one wide, sometimes two.
      carveCave(x, y, z);
      carveCave(x, y + 1, z);
      const [hx, hz] = dirs[heading];
      const [px, pz] = [-hz, hx];
      if (seeded(sx + step * 13, sz - step * 7) > .5) {
        carveCave(x + px, y, z + pz);
        carveCave(x + px, y + 1, z + pz);
      }
      // An occasional chamber: a 3x3 blob, two tall.
      if (seeded(sx - step * 3, sz + step * 11) > .82) {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          carveCave(x + dx, y, z + dz);
          carveCave(x + dx, y + 1, z + dz);
        }
      }
      // Turn a little, drift up or down, stay in the stone band.
      if (seeded(sx + step * 5, sz + step * 3) < .45) {
        heading = (heading + (seeded(sx - step, sz + step) > .5 ? 1 : 7)) % 8;
      }
      const drift = seeded(sx + step * 17, sz - step * 13);
      if (drift < .25) y--;
      else if (drift > .75) y++;
      x += dirs[heading][0];
      z += dirs[heading][1];
    }
  }
  // One worm per 8x8 plot at most, so the underground stays a network of
  // separate tunnels instead of one hollowed-out layer.
  for (let gx = minX; gx < maxX; gx += 8) for (let gz = minZ; gz < maxZ; gz += 8) {
    if (seeded(gx + 701, gz - 509) <= .3) continue;
    const sx = gx + 2 + Math.floor(seeded(gx + 331, gz - 271) * 5);
    const sz = gz + 2 + Math.floor(seeded(gx - 173, gz + 199) * 5);
    if (!inRing(sx, sz)) continue;
    const top = terrainHeight(sx, sz);
    if (top < 6) continue;
    const sy = 1 + Math.floor(seeded(sx + 61, sz - 37) * (top - 4));
    makeCave(sx, sy, sz);
  }
  // Hills: smooth seeded blobs in the extension ring that raise the ground
  // 2-4 blocks, with bare stone on the summit.  Raises are computed for
  // every blob first (overlaps take the tallest) and applied afterwards, so
  // a column is only ever raised once.  A column is raised only when the
  // exact cells the hill would fill are empty — trees, ruins, dead trees
  // and rubble are never buried, though a hill may rise under a tree
  // crown's overhang when the fill stays below the leaves — and never in
  // the original save area or the spawn clearing.
  const hillRaises = new Map();
  for (let gx = minX; gx < maxX; gx += 12) for (let gz = minZ; gz < maxZ; gz += 12) {
    if (seeded(gx + 401, gz - 233) <= .3) continue;
    const cx = gx + 4 + Math.floor(seeded(gx + 121, gz - 77) * 4);
    const cz = gz + 4 + Math.floor(seeded(gx - 57, gz + 189) * 4);
    if (!inRing(cx, cz)) continue;
    const radius = 4 + Math.floor(seeded(cx + 17, cz - 29) * 3);
    const peak = 2 + Math.floor(seeded(cx - 43, cz + 61) * 3);
    for (let x = cx - radius; x <= cx + radius; x++) for (let z = cz - radius; z <= cz + radius; z++) {
      if (!contains(layout, x, 0, z) || !inRing(x, z)) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d >= radius) continue;
      const falloff = 0.5 + 0.5 * Math.cos(Math.PI * d / radius);
      const raise = Math.round(peak * falloff);
      if (raise < 1) continue;
      const top = terrainHeight(x, z);
      let empty = true;
      for (let y = top + 1; y <= top + raise; y++) {
        if (world[voxelIndex(layout, x, y, z)] !== AIR) { empty = false; break; }
      }
      if (!empty) continue;
      const key = (x - minX) + layout.width * (z - minZ);
      const prev = hillRaises.get(key);
      if (!prev || raise > prev.raise) hillRaises.set(key, { x, z, raise, peak });
    }
  }
  for (const { x, z, raise, peak } of hillRaises.values()) {
    const top = terrainHeight(x, z);
    for (let k = 1; k <= raise; k++) {
      // The summit stays bare one ring further out than before: the
      // top cell is stone whenever the raise is within one of the peak,
      // not only when it equals the peak.
      const block = k === raise ? (raise >= peak - 1 ? STONE : GRASS) : k === raise - 1 ? DIRT : STONE;
      write(x, top + k, z, block);
    }
  }
  // Desert oasis: one 3x3 patch of green grass in the sand, with two
  // trees.  The sand's ground is grass blocks wearing a sand colour, so
  // the oasis is marked with the OASIS variant: buildChunkMesh keeps
  // those nine tops green.  The site sits near the middle of the first
  // sand region, on flat open ground, so it reads as a green patch
  // rather than a strip at the map edge.
  const oasisGround = (x, z) => {
    for (let y = layout.height - 1; y >= 0; y--) {
      if (world[voxelIndex(layout, x, y, z)] === DIRT) return y + 1;
    }
    return -1;
  };
  // The visible top of a column: the highest grass block.  On flat
  // ground that is the dirt-level grass, but a hill can raise a column
  // by one, burying the dirt-level grass under a fresh grass top — the
  // variant has to go on the grass the player actually sees.
  const oasisTop = (x, z) => {
    for (let y = layout.height - 1; y >= 0; y--) {
      if (world[voxelIndex(layout, x, y, z)] === GRASS) return y;
    }
    return -1;
  };
  let oasisRegion = null;
  outer: for (let rx = -1; rx <= 3; rx++) for (let rz = -1; rz <= 3; rz++) {
    if (biomeAt(rx * 16, rz * 16) === "sand") { oasisRegion = [rx, rz]; break outer; }
  }
  if (oasisRegion) {
    const centre = [oasisRegion[0] * 16 + 8, oasisRegion[1] * 16 + 8];
    let best = null, bestDist = Infinity;
    for (let ox = minX; ox + 2 < maxX; ox++) for (let oz = minZ; oz + 2 < maxZ; oz++) {
      let ok = true;
      const heights = [];
      for (let x = ox; x < ox + 3 && ok; x++) for (let z = oz; z < oz + 3; z++) {
        if (biomeAt(x, z) !== "sand" || !inRing(x, z)) { ok = false; break; }
        const g = oasisGround(x, z);
        if (g < 0 || world[voxelIndex(layout, x, g, z)] !== GRASS
          || world[voxelIndex(layout, x, g + 1, z)] !== AIR) { ok = false; break; }
        heights.push(g);
      }
      if (!ok || Math.max(...heights) - Math.min(...heights) > 1) continue;
      const dist = Math.max(Math.abs(ox + 1 - centre[0]), Math.abs(oz + 1 - centre[1]));
      if (dist < bestDist) { bestDist = dist; best = [ox, oz]; }
    }
    if (best) {
      const [ox, oz] = best;
      // The oasis is five cells across: the inner 3x3 the site was
      // picked for, plus one ring of green grass around it.  Only sand
      // grass in the ring is marked — a cell that is not sand grass
      // keeps its own colour.
      for (let x = ox - 1; x <= ox + 3; x++) for (let z = oz - 1; z <= oz + 3; z++) {
        if (biomeAt(x, z) !== "sand" || !inRing(x, z)) continue;
        const g = oasisTop(x, z);
        if (g < 0) continue;
        setVariant(x, g, z, TILE.OASIS);
      }
      // Two trees: one in the middle of the patch, one at its corner.
      // Both are tall pines on purpose: a flat green patch is edge-on
      // from nine cells away, so the grove is the part of the oasis a
      // player actually sees coming, and two pines in the sand read as
      // an oasis where two ordinary trees do not.
      makeTree(ox + 1, oasisGround(ox + 1, oz + 1) + 1, oz + 1, false, 3);
      makeTree(ox, oasisGround(ox, oz) + 1, oz, false, 3);
      // The patch reads as a low green mound, not a flat patch: grass
      // tops are horizontal, so a flat patch is edge-on and invisible
      // from nine cells away at eye level, while a one-block rise gives
      // the green a face toward the desert.  Only the non-tree cells
      // rise — the trees stay rooted on the flat ground, standing in
      // shallow dips — and the variant moves up with the top, so the
      // count of green cells stays twenty-five.
      const treeCells = new Set([`${ox + 1},${oz + 1}`, `${ox},${oz}`]);
      for (let x = ox - 1; x <= ox + 3; x++) for (let z = oz - 1; z <= oz + 3; z++) {
        if (treeCells.has(`${x},${z}`)) continue;
        if (biomeAt(x, z) !== "sand" || !inRing(x, z)) continue;
        const g = oasisTop(x, z);
        if (g < 0) continue;
        write(x, g + 1, z, GRASS);
        setVariant(x, g, z, 0);
        setVariant(x, g + 1, z, TILE.OASIS);
      }
    }
  }
  // Flowers and bushes: small LEAF growth on grass in the extension ring
  // only.  Flowers are flat clusters of 2-3 LEAF cells, one block high;
  // bushes are clumps with a two-block centre and one-block sides, and no
  // trunk.  Every cell is placed only onto grass whose cell above is still
  // AIR, so nothing already standing — trees, ruins, dead trees, rubble —
  // is ever covered.  Ground level is the top of the dirt layer, which
  // stays correct on hillsides (and skips bare-stone summits, whose top is
  // STONE rather than GRASS).
  function groundTop(x, z) {
    for (let y = layout.height - 1; y >= 0; y--) {
      if (world[voxelIndex(layout, x, y, z)] === DIRT) return y + 1;
    }
    return -1;
  }
  function canPlant(x, z, dy) {
    if (!inRing(x, z) || !contains(layout, x, 0, z)) return -1;
    const g = groundTop(x, z);
    if (g < 0 || world[voxelIndex(layout, x, g, z)] !== GRASS) return -1;
    if (world[voxelIndex(layout, x, g + dy, z)] !== AIR) return -1;
    return g;
  }
  function plantLeaf(x, z, dy, tile = 0) {
    const g = canPlant(x, z, dy);
    if (g < 0) return false;
    write(x, g + dy, z, LEAF);
    if (tile) setVariant(x, g + dy, z, tile);
    return true;
  }
  const plantDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let gx = minX; gx < maxX; gx += 5) for (let gz = minZ; gz < maxZ; gz += 5) {
    if (seeded(gx + 211, gz - 137) <= .5) continue;
    const cx = gx + Math.floor(seeded(gx + 71, gz - 43) * 5);
    const cz = gz + Math.floor(seeded(gx - 29, gz + 97) * 5);
    if (!plantLeaf(cx, cz, 1, TILE.FLOWER)) continue;
    // One or two extra flowers beside the first, trying the four
    // directions in a seeded rotation so a repeated direction never wastes
    // an attempt.
    const extra = 1 + Math.floor(seeded(cx + 13, cz - 19) * 2);
    const start = Math.floor(seeded(cx + 5, cz - 7) * 4);
    let placed = 1;
    for (let i = 0; i < 4 && placed <= extra; i++) {
      const [dx, dz] = plantDirs[(start + i) % 4];
      if (plantLeaf(cx + dx, cz + dz, 1, TILE.FLOWER)) placed++;
    }
  }
  for (let gx = minX; gx < maxX; gx += 6) for (let gz = minZ; gz < maxZ; gz += 6) {
    if (seeded(gx + 503, gz - 311) <= .45) continue;
    const cx = gx + Math.floor(seeded(gx + 89, gz - 53) * 6);
    const cz = gz + Math.floor(seeded(gx - 41, gz + 113) * 6);
    // The centre is two blocks tall: check both cells before planting
    // either, so a blocked top never leaves a lone one-block leaf behind.
    if (canPlant(cx, cz, 1) < 0 || canPlant(cx, cz, 2) < 0) continue;
    plantLeaf(cx, cz, 1);
    plantLeaf(cx, cz, 2);
    // One or two one-block sides beside the two-block centre, trying the
    // four directions in a seeded rotation.
    const sides = 1 + Math.floor(seeded(cx + 23, cz - 31) * 2);
    const sideStart = Math.floor(seeded(cx - 9, cz + 3) * 4);
    let placed = 0;
    for (let i = 0; i < 4 && placed < sides; i++) {
      const [dx, dz] = plantDirs[(sideStart + i) % 4];
      if (plantLeaf(cx + dx, cz + dz, 1)) placed++;
    }
  }
  // Cave entrances: 2x2 shafts from the surface down into caves that
  // already exist below.  A shaft is only ever opened where a cave is
  // already waiting underneath — no new caves are dug — and only in the
  // extension ring, on open ground with nothing standing above it.  The
  // scan is a fixed grid in scan order, so the entrances are
  // deterministic; they are kept spread out and capped at three.
  const shafts = [];
  for (let gx = minX + 2; gx + 1 < maxX && shafts.length < 3; gx += 4) {
    for (let gz = minZ + 2; gz + 1 < maxZ && shafts.length < 3; gz += 4) {
      let ok = true;
      let depth = Infinity;
      const tops = [];
      for (let dx = 0; dx <= 1 && ok; dx++) for (let dz = 0; dz <= 1 && ok; dz++) {
        const x = gx + dx, z = gz + dz;
        if (!inRing(x, z)) { ok = false; break; }
        const g = groundTop(x, z);
        if (g < 0) { ok = false; break; }
        // Nothing rooted in the footprint: no tree, ruin, dead tree or
        // flower standing on the surface.  Only the two cells just above
        // the ground are checked — a neighbouring crown overhanging
        // higher up is held by its own trunk and stays put.
        for (let y = g + 1; y <= g + 2; y++) {
          if (world[voxelIndex(layout, x, y, z)] !== AIR) { ok = false; break; }
        }
        if (!ok) break;
        // The first air below the surface is a cave cell: nothing else
        // ever hollows out the ground.  One caved column is enough — the
        // shaft opens through it, and the rest are cut to the same floor.
        let cave = -1;
        for (let y = g - 1; y >= 1; y--) {
          if (world[voxelIndex(layout, x, y, z)] === AIR) { cave = y; break; }
        }
        if (cave >= 0) depth = Math.min(depth, cave);
        tops.push([x, z, g]);
      }
      if (!ok || depth === Infinity) continue;
      // Keep entrances spread out.
      if (shafts.some(([sx, sz]) => Math.max(Math.abs(sx - gx), Math.abs(sz - gz)) < 16)) continue;
      for (const [x, z, g] of tops) {
        for (let y = g; y >= depth; y--) write(x, y, z, AIR);
      }
      shafts.push([gx, gz]);
    }
  }
  // Stone rings mark the shaft mouths: four plain stones around each
  // 2x2 entrance, one near each corner, so a shaft reads from a
  // distance.  A stone sits on its own column's grass top and never
  // inside the mouth, so the entrance stays open.  A corner whose stone
  // would land in the original save area, or on a trunk, a crown leaf
  // or a flower, falls back to the nearest open cell on the same side
  // of the mouth.
  const ringUsed = new Set();
  for (const [sx, sz] of shafts) {
    const corners = [
      [[sx - 1, sz - 1], [sx - 1, sz], [sx, sz - 1]],
      [[sx + 2, sz - 1], [sx + 2, sz], [sx + 1, sz - 1]],
      [[sx - 1, sz + 2], [sx - 1, sz + 1], [sx, sz + 2]],
      [[sx + 2, sz + 2], [sx + 2, sz + 1], [sx + 1, sz + 2]],
    ];
    for (const fallbacks of corners) {
      for (const [x, z] of fallbacks) {
        if (ringUsed.has(`${x},${z}`)) continue;
        if (!inRing(x, z)) continue;
        const g = groundTop(x, z);
        if (g < 0 || world[voxelIndex(layout, x, g, z)] !== GRASS) continue;
        if (world[voxelIndex(layout, x, g + 1, z)] !== AIR) continue;
        write(x, g + 1, z, STONE);
        // The ring stands two stones tall, so the mouth reads from six
        // cells away instead of vanishing into the grass at eye level.
        if (world[voxelIndex(layout, x, g + 2, z)] === AIR) write(x, g + 2, z, STONE);
        ringUsed.add(`${x},${z}`);
        break;
      }
    }
  }
  // Shaft stairwells: a stone staircase descends from the surface
  // beside each mouth, so a player who falls in can climb back out.
  // One step per column, each a block lower, running south from the
  // mouth: the bottom step meets the cave floor beside the mouth, the
  // top step meets the surface.  Every step is one block up from the
  // last, so it is climbed by jumping.  The stairwell columns are
  // recorded on the world (world.stairwells) because the stair cuts
  // the dirt layer the same way a shaft does, and the tests that guard
  // the dirt layer need to know about both intentional openings.
  const stairwells = new Set();
  // The stair runs in the first direction that fits: south, north,
  // east, west.  A direction fits when every step column stays in the
  // extension ring (a stair must never cut into the original save
  // area or the spawn clearing), no trunk stands in the way, and the
  // ground under each step is high enough to hold it — a step whose
  // cap would float above the ground is not a step.  The south side
  // is tried first; the shaft at (2,-2) takes the east side because
  // its south side runs into the original save area and its north side
  // has a tree in the way.
  const stairDirs = [
    { dx: 0, dz: 1, ox: 0, oz: 2 },
    { dx: 0, dz: -1, ox: 0, oz: -1 },
    { dx: 1, dz: 0, ox: 2, oz: 0 },
    { dx: -1, dz: 0, ox: -1, oz: 0 },
  ];
  for (const [sx, sz] of shafts) {
    let surface = -1;
    for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 2; dz++) {
      if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue;
      const g = groundTop(sx + dx, sz + dz);
      if (g >= 0) surface = Math.max(surface, g);
    }
    let floor = -1;
    for (let y = layout.height - 1; y >= 0; y--) {
      if ([0, 1].every(dx => [0, 1].every(dz => {
        const c = world[voxelIndex(layout, sx + dx, y, sz + dz)];
        return c === AIR || c === LEAF;
      }))) floor = y;
      else break;
    }
    if (surface < 0 || floor < 0 || surface - floor < 3) continue;
    const depth = surface - floor;
    let dir = null;
    for (const d of stairDirs) {
      let ok = true;
      for (let i = 0; i < depth && ok; i++) {
        const x = sx + d.ox + d.dx * i, z = sz + d.oz + d.dz * i;
        if (!contains(layout, x, 0, z) || !inRing(x, z)) { ok = false; break; }
        const g = groundTop(x, z);
        if (g < 0 || g < floor + i) { ok = false; break; }
        for (let y = g + 1; y < layout.height; y++) {
          const b = world[voxelIndex(layout, x, y, z)];
          if (b === WOOD || b === STONE) { ok = false; break; }
        }
      }
      if (ok) { dir = d; break; }
    }
    if (!dir) continue;
    for (let i = 0; i < depth; i++) {
      const x = sx + dir.ox + dir.dx * i, z = sz + dir.oz + dir.dz * i;
      const capY = floor + 1 + i;
      let top = -1;
      for (let y = layout.height - 1; y >= 0; y--) {
        if (world[voxelIndex(layout, x, y, z)] !== AIR) { top = y; break; }
      }
      // Clearing a block clears its variant too: a flower leaf cut away
      // above a step must not leave its flower tile on an air cell.
      for (let y = top; y > capY; y--) { write(x, y, z, AIR); setVariant(x, y, z, 0); }
      write(x, capY, z, STONE);
      setVariant(x, capY, z, 0);
      stairwells.add(`${x},${z}`);
    }
  }
  // Gullies: shallow linear dips in the extension ring.  A worm walks a
  // meandering line and digs the grass top — one or two blocks — off each
  // column it crosses, leaving a dirt floor.  It only ever digs
  // grass-topped columns with nothing standing above them, so trees,
  // ruins, dead trees and flowers are never undercut, and it never
  // enters the original save area or the spawn clearing.  The dirt layer
  // is three thick and caves live below it, so a two-block dig can never
  // open a cave.  Starts are tried in scan order until two gullies of a
  // decent length are dug, so the result is deterministic.
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  function gullyClear(x, z) {
    if (!inRing(x, z)) return false;
    const g = groundTop(x, z);
    if (g < 0 || world[voxelIndex(layout, x, g, z)] !== GRASS) return false;
    if (world[voxelIndex(layout, x, g + 1, z)] !== AIR) return false;
    return true;
  }
  function digGully(sx, sz) {
    if (!gullyClear(sx, sz)) return 0;
    // Every removed cell is recorded, so a path that turns out too short
    // can be put back exactly — a rejected start must leave no trace.
    const removed = [];
    let dug = 0;
    let x = sx, z = sz;
    let heading = Math.floor(seeded(sx + 11, sz - 7) * 8);
    for (let step = 0; step < 18; step++) {
      // Dig this column and the one beside it, so the gully is two wide.
      const [px, pz] = [-dirs[heading][1], dirs[heading][0]];
      for (const [cx, cz] of [[x, z], [x + px, z + pz]]) {
        if (!gullyClear(cx, cz)) continue;
        const g = groundTop(cx, cz);
        const depth = seeded(cx + 5, cz - 3) < .5 ? 1 : 2;
        for (let y = g; y > g - depth; y--) {
          removed.push([cx, y, cz, world[voxelIndex(layout, cx, y, cz)]]);
          write(cx, y, cz, AIR);
        }
        dug++;
      }
      // Step on: keep the heading if it stays clear, otherwise turn
      // until a clear column is found; boxed in, the gully ends here.
      let nx = -1, nz = -1;
      for (let t = 0; t < 8; t++) {
        const h = (heading + t) % 8;
        const [dx, dz] = dirs[h];
        if (gullyClear(x + dx, z + dz)) { nx = x + dx; nz = z + dz; heading = h; break; }
      }
      if (nx < 0) break;
      x = nx; z = nz;
      // Occasionally wander off the straight line.
      if (seeded(sx + step * 7, sz - step * 5) < .15) {
        heading = (heading + (seeded(sx - step, sz + step) > .5 ? 1 : 7)) % 8;
      }
    }
    if (dug < 12) {
      for (const [cx, y, cz, block] of removed) write(cx, y, cz, block);
      return 0;
    }
    return dug;
  }
  let gullies = 0;
  const gullyStarts = [];
  for (let gx = minX + 2; gx < maxX && gullies < 2; gx += 8) {
    for (let gz = minZ + 2; gz < maxZ && gullies < 2; gz += 8) {
      if (gullyStarts.some(([sx, sz]) => Math.max(Math.abs(sx - gx), Math.abs(sz - gz)) < 24)) continue;
      if (digGully(gx, gz) >= 12) {
        gullies++;
        gullyStarts.push([gx, gz]);
      }
    }
  }
  // Gully-edge wildflowers: flower clusters grow twice as thick on the
  // grass within two cells of a gully edge.  The gullies are only dug
  // after the first flower pass, so a second pass runs here, planting
  // extra clusters only on grass near a gully floor — the rest of the
  // map keeps exactly the flowers it already had.  A new flower never
  // lands beside an existing one, so clusters stay separate and countable.
  const gullyCols = new Set();
  for (let x = minX; x < maxX; x++) for (let z = minZ; z < maxZ; z++) {
    const g = groundTop(x, z);
    if (g >= 0 && world[voxelIndex(layout, x, g, z)] === AIR) gullyCols.add(`${x},${z}`);
  }
  const nearGully = (x, z) => {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (gullyCols.has(`${x + dx},${z + dz}`)) return true;
    }
    return false;
  };
  // Chebyshev distance to the nearest gully floor.  Edge flowers are
  // planted only at distance two: a flower on the lip itself (distance
  // one) stands over the trench and hides the dirt floor from six
  // cells away, while flowers two cells out frame the gully without
  // covering it.
  const gullyDist = (x, z) => {
    let best = Infinity;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (gullyCols.has(`${x + dx},${z + dz}`)) best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dz)));
    }
    return best;
  };
  const nearFlower = (x, z, excludeX = null, excludeZ = null) => {
    for (const [dx, dz] of plantDirs) {
      const nx = x + dx, nz = z + dz;
      if (nx === excludeX && nz === excludeZ) continue;
      if (!contains(layout, nx, 0, nz)) continue;
      const ng = groundTop(nx, nz);
      if (ng >= 0 && world[voxelIndex(layout, nx, ng + 1, nz)] === LEAF
        && variants[voxelIndex(layout, nx, ng + 1, nz)] === TILE.FLOWER) return true;
    }
    return false;
  };
  // A cluster next to a trunk is never counted as a flower cluster (the
  // flower test excludes growth near wood), so the new clusters are only
  // planted where they will be seen as flowers.
  const nearWood = (x, z, g) => {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const nx = x + dx, nz = z + dz;
      if (!contains(layout, nx, 0, nz)) continue;
      for (let y = g + 1; y <= g + 5; y++) {
        if (world[voxelIndex(layout, nx, y, nz)] === WOOD) return true;
      }
    }
    return false;
  };
  for (let x = minX; x < maxX; x++) for (let z = minZ; z < maxZ; z++) {
    if (gullyDist(x, z) !== 2) continue;
    // A quarter of the ring columns get a cluster: the ring is narrower
    // than the old two-cell band, so the chance is raised to keep at
    // least four clusters standing by a gully edge.
    if (seeded(x + 901, z - 701) <= .75) continue;
    if (nearFlower(x, z)) continue;
    const g = groundTop(x, z);
    if (g < 0 || nearWood(x, z, g)) continue;
    if (!plantLeaf(x, z, 1, TILE.FLOWER)) continue;
    const extra = 1 + Math.floor(seeded(x + 13, z - 19) * 2);
    const start = Math.floor(seeded(x + 5, z - 7) * 4);
    let placed = 1;
    for (let i = 0; i < 4 && placed <= extra; i++) {
      const [dx, dz] = plantDirs[(start + i) % 4];
      // The centre flower itself is next door by design, so it does not
      // count as a neighbouring flower here.
      if (nearFlower(x + dx, z + dz, x, z)) continue;
      // An extra flower never steps back onto the lip either: the whole
      // cluster stays two cells out.
      if (gullyDist(x + dx, z + dz) < 2) continue;
      if (plantLeaf(x + dx, z + dz, 1, TILE.FLOWER)) placed++;
    }
  }
  // Boulder piles: 1-2 small stacks of stone on the grass in the
  // extension ring.  Each pile is 3-5 stones: a bottom layer of 2-3
  // stones sitting on grass, with 1-2 stones stacked directly on top
  // of them.  A site is only used when every stone would land in open
  // air on grass, with no other stone touching the pile, so a pile
  // never buries anything and never merges with a ruin.
  const cardDirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const boulderStarts = [];
  let boulders = 0;
  for (let gx = minX + 3; gx < maxX - 3 && boulders < 2; gx += 8) {
    for (let gz = minZ + 3; gz < maxZ - 3 && boulders < 2; gz += 8) {
      if (boulderStarts.some(([sx, sz]) => Math.max(Math.abs(sx - gx), Math.abs(sz - gz)) < 16)) continue;
      // Bottom layer: a row of 2 or 3, or an L of 3, in a seeded direction.
      const [dx, dz] = cardDirs[Math.floor(seeded(gx + 19, gz - 13) * 4)];
      const bottomN = seeded(gx + 17, gz - 23) < .45 ? 2 : 3;
      const lShape = bottomN === 3 && seeded(gx - 29, gz + 7) < .5;
      const bottom = [];
      for (let i = 0; i < bottomN; i++) bottom.push([gx + dx * i, gz + dz * i]);
      if (lShape) bottom[2] = [gx + dx - dz, gz + dz + dx];
      // Top layer: two stones, each directly above a bottom stone, so
      // the pile reads as a blocky stack from a distance instead of a
      // single pebble on a row.
      const topN = 2;
      const top = bottom.slice(0, topN);
      let ok = true;
      const baseY = new Map();
      for (const [x, z] of bottom) {
        if (!inRing(x, z)) { ok = false; break; }
        const g = groundTop(x, z);
        if (g < 0 || world[voxelIndex(layout, x, g, z)] !== GRASS) { ok = false; break; }
        if (world[voxelIndex(layout, x, g + 1, z)] !== AIR) { ok = false; break; }
        if (top.some(([tx, tz]) => tx === x && tz === z)
          && world[voxelIndex(layout, x, g + 2, z)] !== AIR) { ok = false; break; }
        baseY.set(`${x},${z}`, g + 1);
        // No other stone touching the pile at either layer.
        for (let nx = x - 1; nx <= x + 1 && ok; nx++) for (let nz = z - 1; nz <= z + 1 && ok; nz++) {
          if (nx === x && nz === z) continue;
          if (bottom.some(([bx, bz]) => bx === nx && bz === nz)) continue;
          for (let y = g; y <= g + 2; y++) {
            if (world[voxelIndex(layout, nx, y, nz)] === STONE) { ok = false; break; }
          }
        }
        if (!ok) break;
      }
      if (!ok) continue;
      for (const [x, z] of bottom) write(x, baseY.get(`${x},${z}`), z, STONE);
      for (const [x, z] of top) write(x, baseY.get(`${x},${z}`) + 1, z, STONE);
      boulders++;
      boulderStarts.push([gx, gz]);
    }
  }
  // Flower fields: 1-2 dense 5x5 patches of flowers in the extension
  // ring.  An ordinary flower cluster is 2-3 flowers in a 5x5 plot, so
  // a field plants a flower on most of the open grass in its 5x5 — far
  // denser than the scattered clusters.  A site is only used when most
  // of its 25 columns are open grass, so the field is actually dense.
  // The two fields are spread apart: the second must sit in the opposite
  // quarter of the map from the first (split at the centre, x=16 and
  // z=16), so they never bunch up in one corner.
  const fieldStarts = [];
  let fields = 0;
  for (let fx = minX + 2; fx + 4 < maxX && fields < 2; fx += 4) {
    for (let fz = minZ + 2; fz + 4 < maxZ && fields < 2; fz += 4) {
      if (fieldStarts.some(([sx, sz]) => Math.max(Math.abs(sx - fx), Math.abs(sz - fz)) < 16)) continue;
      if (fieldStarts.length > 0) {
        // The second field must sit in the opposite quarter from the
        // first — a different half on both axes — so the two fields are
        // never in the same half of the map by either split.
        const [px, pz] = fieldStarts[0];
        if ((fx + 2 < 16) === (px + 2 < 16) || (fz + 2 < 16) === (pz + 2 < 16)) continue;
      }
      let open = 0;
      for (let x = fx; x < fx + 5; x++) for (let z = fz; z < fz + 5; z++) {
        if (canPlant(x, z, 1) >= 0) open++;
      }
      if (open < 18) continue;
      for (let x = fx; x < fx + 5; x++) for (let z = fz; z < fz + 5; z++) {
        if (seeded(x + 601, z - 701) < .75) plantLeaf(x, z, 1, TILE.FLOWER);
      }
      fields++;
      fieldStarts.push([fx, fz]);
    }
  }
  const top = terrainHeight(16, 16);
  for (let x = 14; x <= 18; x++) for (let z = 14; z <= 18; z++) {
    if (!contains(layout, x, 0, z)) continue;
    for (let y = top + 1; y < layout.height; y++) {
      const cell = voxelIndex(layout, x, y, z);
      if (world[cell] === LEAF || world[cell] === WOOD) world[cell] = AIR;
    }
  }
  // Oasis sightlines: the desert reads from nine cells away only when
  // nothing stands between the viewer and the green.  Two corridors —
  // east of the oasis and south of it — are cleared back to the bare
  // ground: hill fill, rubble and lone ruin fragments above the base
  // height come out, so the mound and its pines show.  Trees are not
  // touched here — their crowns hang above the sightline — and the
  // oasis cells themselves are out of the corridors, so the mound and
  // its trees are never levelled by their own clearing.
  for (const [x0, x1, z0, z1] of [[-5, 3, 6, 10], [-10, -6, 11, 18]]) {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const base = terrainHeight(x, z);
      for (let y = base + 1; y < layout.height; y++) {
        const b = world[voxelIndex(layout, x, y, z)];
        if (b === AIR || b === WOOD || b === LEAF) continue;
        write(x, y, z, AIR);
        setVariant(x, y, z, 0);
      }
    }
  }
  world.variants = variants;
  world.stairwells = stairwells;
  return world;
}

export const FACES = [
  { d: [ 1, 0, 0], v: [[1,0,0],[1,0,1],[1,1,1],[1,1,0]], light: .82 },
  { d: [-1, 0, 0], v: [[0,0,1],[0,0,0],[0,1,0],[0,1,1]], light: .70 },
  { d: [ 0, 1, 0], v: [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], light: 1.14 },
  { d: [ 0,-1, 0], v: [[0,0,1],[1,0,1],[1,0,0],[0,0,0]], light: .46 },
  { d: [ 0, 0, 1], v: [[1,0,1],[0,0,1],[0,1,1],[1,1,1]], light: .92 },
  { d: [ 0, 0,-1], v: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], light: .64 }
];

export function distanceSquared(chunk, x, z) {
  const dx = Math.max(chunk.minX - x, 0, x - chunk.maxX);
  const dz = Math.max(chunk.minZ - z, 0, z - chunk.maxZ);
  return dx * dx + dz * dz;
}

export function createChunkGrid(layout, size = CHUNK_SIZE) {
  const columns = Math.ceil(layout.width / size);
  const rows = Math.ceil(layout.depth / size);
  const chunks = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const minX = layout.minX + column * size;
    const minZ = layout.minZ + row * size;
    chunks.push({ id: chunks.length, minX, minZ,
      maxX: Math.min(layout.minX + layout.width, minX + size),
      maxZ: Math.min(layout.minZ + layout.depth, minZ + size) });
  }

  function at(x, z) {
    if (!contains(layout, x, 0, z)) return null;
    return chunks[Math.floor((x - layout.minX) / size) + columns * Math.floor((z - layout.minZ) / size)];
  }

  function affected(x, z) {
    const own = at(x, z);
    if (!own) return [];
    const result = new Set([own]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbor = at(x + dx, z + dz);
      if (neighbor) result.add(neighbor);
    }
    return [...result];
  }

  function nearby(x, z, radius) {
    return chunks.map(chunk => ({ chunk, distance: distanceSquared(chunk, x, z) }))
      .filter(entry => entry.distance <= radius * radius)
      .sort((a, b) => a.distance - b.distance)
      .map(entry => entry.chunk);
  }

  return { at, affected, nearby };
}

// Per-vertex ambient occlusion for one corner of an exposed face.
// The three occluders are the blocks next to the empty cell in front of
// the face: one along each tangent axis from the corner, plus the diagonal
// corner block. Both tangent neighbors occluded is the darkest case.
// Returns 1.0 (open) down to 0.55 (fully occluded).
function aoFactor(layout, getBlock, x, y, z, d, corner) {
  const tangents = [0, 1, 2].filter(axis => d[axis] === 0);
  const front = [x + d[0], y + d[1], z + d[2]];
  const signs = tangents.map(axis => (corner[axis] ? 1 : -1));
  const occupied = (ox, oy, oz) => contains(layout, ox, oy, oz) && Boolean(getBlock(ox, oy, oz));
  const side = tangents.map((axis, i) => {
    const cell = [...front];
    cell[axis] += signs[i];
    return occupied(cell[0], cell[1], cell[2]) ? 1 : 0;
  });
  const cornerCell = [...front];
  tangents.forEach((axis, i) => { cornerCell[axis] += signs[i]; });
  const cornerHit = occupied(cornerCell[0], cornerCell[1], cornerCell[2]) ? 1 : 0;
  if (side[0] && side[1]) return .55;
  return 1 - .15 * (side[0] + side[1] + cornerHit);
}

// Procedural texture atlas: nine 16px tiles in one row — grass top, grass
// side, dirt, stone, wood, leaf, mossy stone, cracked stone, flower.
// Tiles are painted as detail modulation (near-white with a per-tile tint),
// never as the block colour itself: the vertex colour already carries the
// block colour, so the shader multiplies the two.  Painting the block
// colour into the tile would square it and darken every block.  `ids`
// defaults to the BLOCK ids (1..5) so callers that only pass { grass,
// leaf } still get the right tile.
export const ATLAS_TILES = 9;
export const ATLAS_TILE_SIZE = 16;

// Tile indices in the atlas row.  The first six are the original tiles;
// the last three are the V10 additions: ruin stone variants and flowers.
// OASIS is not an atlas tile: it marks oasis grass, whose top face keeps
// the base green instead of the desert sand colour (see buildChunkMesh).
export const TILE = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAF: 5,
  MOSS_STONE: 6, CRACK_STONE: 7, FLOWER: 8, OASIS: 9,
};

export function atlasTileFor(type, d, { grass, dirt, stone, wood, leaf } = {}, tileOverride = 0) {
  // A generation variant overrides the tile outright: a ruin stone is
  // mossy or cracked on every face, a flower is flowery on every face.
  if (tileOverride) return tileOverride;
  const g = grass ?? 1, di = dirt ?? 2, s = stone ?? 3, w = wood ?? 4, l = leaf ?? 5;
  if (type === g) return d[1] === 1 ? 0 : d[1] === -1 ? 2 : 1;
  if (type === di) return 2;
  if (type === s) return 3;
  if (type === w) return 4;
  if (type === l) return 5;
  return 3;
}

// UV inside one atlas tile for a face corner.  Side faces use the block's
// height as v (flipped: canvas row 0 is the top of the tile, GL v=0 samples
// it), so the grass fringe stays on top and the dirt band stays at the
// bottom; top/bottom faces use the two horizontal axes.
export function faceUV(d, corner) {
  if (d[1] !== 0) return [corner[0], corner[2]];
  if (d[0] !== 0) return [corner[2], 1 - corner[1]];
  return [corner[0], 1 - corner[1]];
}

// Mining cracks: three stages driven by hold-to-mine progress.  The lines
// are deterministic per block (seeded from its coordinates), and each stage
// only adds lines, so cracks grow while the player holds the button instead
// of jumping around.  Coordinates are face-local [0, 1] pairs; game.js maps
// them onto the hit face's projected quad.
export function crackStage(progress) {
  if (!(progress > 0)) return 0;
  if (progress < 1 / 3) return 1;
  if (progress < 2 / 3) return 2;
  return 3;
}

export function crackPolylines(x, y, z, stage) {
  if (stage <= 0) return [];
  const lines = [];
  const count = stage === 1 ? 2 : stage === 2 ? 4 : 6;
  for (let i = 0; i < count; i++) {
    const startSeed = seeded(x * 7 + i * 13, z * 11 + y * 5 + i * 29);
    const wobbleSeed = seeded(x * 3 + i * 31, y * 17 + z * 7 + i);
    const centre = [0.5 + (wobbleSeed - 0.5) * 0.2, 0.5 + (seeded(x + i, z - i) - 0.5) * 0.2];
    const points = [centre];
    let [u, v] = centre;
    let dir = startSeed * Math.PI * 2;
    for (let s = 0; s < 4; s++) {
      dir += (seeded(x + i * 7 + s * 3, y + z + s * 11) - 0.5) * 1.1;
      const len = 0.10 + seeded(x + s * 5, z + i * 5 + s * 11) * 0.08;
      u = Math.min(0.98, Math.max(0.02, u + Math.cos(dir) * len));
      v = Math.min(0.98, Math.max(0.02, v + Math.sin(dir) * len));
      points.push([u, v]);
    }
    lines.push(points);
  }
  return lines;
}

// The four world-space corners of one face of a block, in [c00, c10, c11,
// c01] order (u along the first tangent axis, v along the second), so a
// face-local [u, v] point maps onto the quad by bilinear interpolation.
export function faceCorners(cell, face) {
  const axis = face[0] ? 0 : face[1] ? 1 : 2;
  const sign = face[axis];
  const tangents = [0, 1, 2].filter(a => a !== axis);
  const corners = [];
  for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const corner = [...cell];
    corner[axis] += sign > 0 ? 1 : 0;
    corner[tangents[0]] += u;
    corner[tangents[1]] += v;
    corners.push(corner);
  }
  return corners;
}

// Placement pop: a newly placed block grows from 90% to full size in
// 0.12s.  Linear on purpose — short enough that easing would be invisible,
// and a linear ramp is trivial to test against.
export const POP_DURATION = 0.12;
export const POP_START_SCALE = 0.9;
export function popScale(age) {
  return POP_START_SCALE + (1 - POP_START_SCALE) * Math.min(1, Math.max(0, age) / POP_DURATION);
}

// Day/night cycle: the sun circles the sky once per DAY_LENGTH seconds
// (phase 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight) and the
// sky tint, ambient light and fog density follow it.  Pure functions of
// game time, so tests can check every keyframe without a GL context.
export const DAY_LENGTH = 240;
export function dayPhase(time) {
  return (((time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;
}
function smoothstep01(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
export function dayCycle(time) {
  const phase = dayPhase(time);
  const angle = phase * Math.PI * 2;
  const elevation = Math.sin(angle);
  const raw = [Math.cos(angle) * 0.85, elevation, 0.42];
  const length = Math.hypot(...raw);
  const sunDir = raw.map(value => value / length);
  const dayFactor = smoothstep01(-0.06, 0.22, elevation);
  const duskFactor = Math.max(0, 1 - Math.abs(elevation) / 0.25);
  const nightTint = [0.10, 0.14, 0.26], dayTint = [1, 1, 1], duskTint = [1.0, 0.62, 0.38];
  const skyTint = [0, 1, 2].map(i => {
    const base = nightTint[i] + (dayTint[i] - nightTint[i]) * dayFactor;
    return base + (duskTint[i] - base) * duskFactor * 0.85;
  });
  const light = 0.34 + 0.66 * dayFactor;
  const fogDensity = 0.055 - 0.023 * dayFactor;
  return { phase, sunDir, dayFactor, duskFactor, skyTint, light, fogDensity };
}
// Squared-distance fog: 1 - exp(-(density * distance)^2).  Reaches ~0.9 at
// distance 1.52 / density, so a legacy linear [near, far] range converts
// with 1.35 / far.
export function fogAmount(density, distance) {
  return 1 - Math.exp(-density * density * distance * distance);
}
export function fogDensityForRange(far) {
  return 1.35 / far;
}

// 3D particle bursts: small cubes with velocity, gravity and a lifetime,
// for death debris and landing dust.  `floor` is the world-space y the
// cubes rest on (the top of the ground under the burst); the game computes
// it from the block column.  Velocities come from `seeded`, so a burst is
// deterministic for a given seed and tests can check the motion without a
// GL context.
export function createBurst(x, y, z, count, { colors, speed = 3, up = 3, size = 0.09, life = 0.6,
  gravity = 14, floor = 0, seed = 0 } = {}) {
  const burst = [];
  for (let i = 0; i < count; i++) {
    const angle = seeded(seed + i * 17, seed * 3 + i) * Math.PI * 2;
    const horizontal = (0.4 + seeded(seed + i * 31, i * 7) * 0.6) * speed;
    const color = colors[i % colors.length];
    const shade = 0.85 + seeded(seed + i, seed + i * 13) * 0.3;
    burst.push({ x, y, z,
      vx: Math.cos(angle) * horizontal,
      vy: up * (0.5 + seeded(seed + i * 5, i) * 0.8),
      vz: Math.sin(angle) * horizontal,
      size: size * (0.7 + seeded(seed + i * 11, i * 3) * 0.6),
      life, age: 0, gravity, floor,
      color: color.map(value => Math.min(1, value * shade)) });
  }
  return burst;
}

export function stepParticles(particles, dt) {
  for (const p of particles) {
    p.age += dt;
    p.vy -= p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    // Cubes land on the floor instead of sinking through it; once resting,
    // horizontal speed bleeds off so they settle instead of sliding away.
    const rest = p.floor + p.size / 2;
    if (p.y < rest) {
      p.y = rest;
      p.vy = 0;
      const drag = Math.max(0, 1 - 4 * dt);
      p.vx *= drag;
      p.vz *= drag;
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].age >= particles[i].life) particles.splice(i, 1);
  }
  return particles;
}

// Biomes: the extension ring is divided into 16x16 regions, each seeded to
// grassland, snowfield or sand.  The original save area (regions 0-1 in
// both axes) is always grassland, so old saves and the spawn clearing keep
// their look.  Only the grass top face takes the biome colour — the sides
// stay green — so this needs no shader change: the colour rides the
// existing vertex colour attribute.  No new block types: the layout is
// untouched, only mesh colours vary.
export function biomeAt(x, z) {
  const rx = Math.floor(x / 16), rz = Math.floor(z / 16);
  if (rx >= 0 && rx <= 1 && rz >= 0 && rz <= 1) return "grass";
  const h = seeded(rx * 7 + 3, rz * 5 - 11);
  if (h < .58) return "grass";
  if (h < .79) return "snow";
  return "sand";
}

// Grass top colours for the non-grass biomes.  Snow is near-white, sand is
// sandy yellow; grassland keeps the caller's green.
export const BIOME_GRASS = {
  snow: [0.93, 0.95, 0.98],
  sand: [0.93, 0.82, 0.55],
};

export function grassTopColor(x, z, base) {
  // The original save area is pure grassland: no blending ever touches it,
  // so old saves and the spawn clearing keep their exact look.
  if (x >= 0 && x < 32 && z >= 0 && z < 32) return base;
  const biome = biomeAt(x, z);
  const own = biome === "grass" ? base : BIOME_GRASS[biome];
  // Distance to the nearest region border, per axis.  The border between
  // two regions lies between the edge cells, so an edge cell is distance 0
  // and the blend band is the outer two cells on each side.
  const rx = Math.floor(x / 16), rz = Math.floor(z / 16);
  const dx = Math.min(x - rx * 16, rx * 16 + 15 - x);
  const dz = Math.min(z - rz * 16, rz * 16 + 15 - z);
  const W = 2;
  if (dx >= W && dz >= W) return own;
  // Blend with the neighbour across the nearest border that actually
  // differs; a corner cell takes the nearer differing border.  The factor
  // is 0.5 on the border itself and 0.25 one cell in, so the two sides meet
  // at the same midpoint colour and the transition is continuous.
  const nx = x < rx * 16 + 8 ? rx * 16 - 1 : rx * 16 + 16;
  const nz = z < rz * 16 + 8 ? rz * 16 - 1 : rz * 16 + 16;
  let best = null;
  for (const [dist, neighbor] of [[dx, biomeAt(nx, z)], [dz, biomeAt(x, nz)]]) {
    if (neighbor !== biome && (best === null || dist < best.dist)) best = { dist, neighbor };
  }
  if (best === null || best.dist >= W) return own;
  const next = best.neighbor === "grass" ? base : BIOME_GRASS[best.neighbor];
  const t = 0.5 * (1 - best.dist / W);
  return [
    own[0] + (next[0] - own[0]) * t,
    own[1] + (next[1] - own[1]) * t,
    own[2] + (next[2] - own[2]) * t,
  ];
}

// Flower colours: pink, yellow or white by cell seed.  These replace the
// leaf green entirely — the flower tile only adds pale petal dots on top,
// which is what the tile alone could never do.  Kept just under the leaf
// top-face light (1.14 x 0.92) so no channel clips.
export const FLOWER_COLORS = {
  pink: [0.88, 0.48, 0.62],
  yellow: [0.90, 0.76, 0.30],
  white: [0.88, 0.88, 0.86],
};

export function flowerColorFor(x, z) {
  const h = seeded(x * 3 + 1, z * 5 + 2);
  if (h < .34) return FLOWER_COLORS.pink;
  if (h < .67) return FLOWER_COLORS.yellow;
  return FLOWER_COLORS.white;
}

export function buildChunkMesh(layout, chunk, getBlock, colors, { grass, leaf, dirt, stone, wood }, getVariant = () => 0) {
  const vertices = [], indices = [];
  for (let x = chunk.minX; x < chunk.maxX; x++) for (let z = chunk.minZ; z < chunk.maxZ; z++) {
    for (let y = 0; y < layout.height; y++) {
      const type = getBlock(x, y, z);
      if (!type) continue;
      const color = colors[type];
      // One variant per cell, shared by all its faces: 0 means the plain
      // tile for the block type, 6-9 are the generation variants.  OASIS
      // (9) is a colour marker, not an atlas tile: it never changes the
      // tile, it only keeps an oasis grass top green.
      const variant = getVariant(x, y, z);
      // Grass tops take the biome colour; every other face keeps the
      // block's own colour, so snowy and sandy regions read from above
      // while cliffs keep their green sides.  Oasis grass is the one
      // exception: its top stays the base green, a green patch in the
      // desert.
      const topColor = type === grass ? (variant === TILE.OASIS ? color : grassTopColor(x, z, color)) : color;
      // Flower leaves take a pink/yellow/white vertex colour on every
      // face.  Tree leaves and bushes have variant 0 and keep green.
      const flower = type === leaf && variant === TILE.FLOWER ? flowerColorFor(x, z) : null;
      for (const { d, v, light } of FACES) {
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (contains(layout, nx, ny, nz) && getBlock(nx, ny, nz)) continue;
        const base = vertices.length / 12;
        const shade = light * (type === leaf ? .92 : 1);
        const grassSide = type === grass && d[1] === 0 ? light : 0;
        const tile = atlasTileFor(type, d, { grass, dirt, stone, wood, leaf }, variant === TILE.OASIS ? 0 : variant);
        const faceColor = flower !== null ? flower : (d[1] === 1 ? topColor : color);
        for (const corner of v) {
          const ao = aoFactor(layout, getBlock, x, y, z, d, corner);
          const cornerShade = shade * ao;
          const [fu, fv] = faceUV(d, corner);
          vertices.push(x + corner[0], y + corner[1], z + corner[2],
            faceColor[0] * cornerShade, faceColor[1] * cornerShade, faceColor[2] * cornerShade, d[0], d[1], d[2], grassSide,
            (tile + fu) / ATLAS_TILES, fv);
        }
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
