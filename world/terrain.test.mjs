import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK } from "./progression.mjs";
import { WORLD, LEGACY_WORLD, contains, voxelIndex, voxelPosition, generateTerrain, createChunkGrid, buildChunkMesh,
  ATLAS_TILES, TILE, atlasTileFor, faceUV, biomeAt, BIOME_GRASS, grassTopColor, FLOWER_COLORS, flowerColorFor, seeded,
  crackStage, crackPolylines, faceCorners, createBurst, stepParticles,
  POP_DURATION, POP_START_SCALE, popScale, DAY_LENGTH, dayCycle, fogAmount, fogDensityForRange } from "./terrain.mjs";

test("the extended terrain contains the original region unchanged", () => {
  const legacy = generateTerrain(LEGACY_WORLD, BLOCK);
  const extended = generateTerrain(WORLD, BLOCK);
  assert.equal(extended.length, 64 * 24 * 64);
  for (let cell = 0; cell < legacy.length; cell++) {
    const position = voxelPosition(LEGACY_WORLD, cell);
    assert.equal(extended[voxelIndex(WORLD, ...position)], legacy[cell]);
  }
  for (const position of [[-16, 0, -16], [47, 23, 47], [15, 5, -9]]) {
    assert.ok(contains(WORLD, ...position));
    assert.deepEqual(voxelPosition(WORLD, voxelIndex(WORLD, ...position)), position);
  }
  assert.equal(contains(LEGACY_WORLD, -1, 0, 15), false);
  assert.equal(extended[voxelIndex(WORLD, -1, 0, 15)], BLOCK.STONE);
});

test("only the owning chunk and face neighbors are affected by local edits", () => {
  const grid = createChunkGrid(WORLD);
  assert.deepEqual(grid.affected(-5, -5), [grid.at(-5, -5)]);
  assert.deepEqual(grid.affected(0, 3), [grid.at(0, 3), grid.at(-1, 3)]);
  assert.deepEqual(grid.affected(0, 0), [grid.at(0, 0), grid.at(-1, 0), grid.at(0, -1)]);
  assert.equal(grid.affected(-16, -16).length, 1);
  assert.equal(grid.at(-17, 0), null);
  assert.equal(grid.nearby(-15.5, -15.5, 15)[0], grid.at(-15, -15));
  assert.ok(!grid.nearby(-15.5, -15.5, 15).includes(grid.at(45, 45)));
});

test("meshes hide solid seams and reveal them when a neighbor is removed", () => {
  const grid = createChunkGrid(WORLD);
  const stone = "-1/3/4", grass = "0/3/4";
  const cells = new Map([[stone, BLOCK.STONE], [grass, BLOCK.GRASS]]);
  const get = (...position) => cells.get(position.join("/")) ?? BLOCK.AIR;
  const colors = Array.from({ length: 6 }, () => [.4, .5, .3]);
  const flags = { grass: BLOCK.GRASS, leaf: BLOCK.LEAF };
  const mesh = (x, z) => buildChunkMesh(WORLD, grid.at(x, z), get, colors, flags);
  assert.equal(mesh(-1, 4).indices.length, 5 * 6);
  assert.equal(mesh(0, 4).indices.length, 5 * 6);
  cells.delete(stone);
  const exposed = mesh(0, 4);
  assert.equal(exposed.indices.length, 6 * 6);
  assert.equal(exposed.vertices.length, 6 * 4 * 12);
  assert.equal(mesh(-1, 4).indices.length, 0);
});

test("chunk mesh darkens face corners next to occluding blocks", () => {
  // One stone block with three occluders beside its top face: the corner
  // next to both occluders is darkest (0.55), corners next to one are
  // mid (0.85), the open corner is full brightness (1.0). Top-face light
  // is 1.14 and the test color is 0.4, so the expected red channel is
  // 0.4 * 1.14 * AO factor.
  const grid = createChunkGrid(WORLD);
  const cells = new Map([
    ["0/3/4", BLOCK.STONE],
    ["1/4/4", BLOCK.STONE], ["0/4/5", BLOCK.STONE], ["1/4/5", BLOCK.STONE]
  ]);
  const get = (...position) => cells.get(position.join("/")) ?? BLOCK.AIR;
  const colors = Array.from({ length: 6 }, () => [.4, .5, .3]);
  const mesh = buildChunkMesh(WORLD, grid.at(0, 4), get, colors, { grass: BLOCK.GRASS, leaf: BLOCK.LEAF });
  const topFace = new Map();
  for (let i = 0; i < mesh.vertices.length; i += 12) {
    if (mesh.vertices[i + 7] === 1 && mesh.vertices[i + 1] === 4) {
      topFace.set(`${mesh.vertices[i]}/${mesh.vertices[i + 2]}`, mesh.vertices[i + 3]);
    }
  }
  assert.equal(topFace.size, 4);
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} ~= ${expected}`);
  close(topFace.get("0/4"), .4 * 1.14);
  close(topFace.get("1/4"), .4 * 1.14 * .85);
  close(topFace.get("0/5"), .4 * 1.14 * .85);
  close(topFace.get("1/5"), .4 * 1.14 * .55);
});

test("chunk mesh carries atlas UVs: one tile per block face, inside [0, 1]", () => {
  // Tile columns: 0 grass top, 1 grass side, 2 dirt, 3 stone, 4 wood, 5 leaf,
  // 6 mossy stone, 7 cracked stone, 8 flower.
  const ids = { grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, wood: BLOCK.WOOD, leaf: BLOCK.LEAF };
  assert.equal(ATLAS_TILES, 9);
  assert.equal(atlasTileFor(BLOCK.GRASS, [0, 1, 0], ids), 0);
  assert.equal(atlasTileFor(BLOCK.GRASS, [1, 0, 0], ids), 1);
  assert.equal(atlasTileFor(BLOCK.GRASS, [0, -1, 0], ids), 2);
  assert.equal(atlasTileFor(BLOCK.DIRT, [0, 1, 0], ids), 2);
  assert.equal(atlasTileFor(BLOCK.STONE, [0, 0, 1], ids), 3);
  assert.equal(atlasTileFor(BLOCK.WOOD, [0, 0, 1], ids), 4);
  assert.equal(atlasTileFor(BLOCK.LEAF, [0, 1, 0], ids), 5);
  assert.equal(atlasTileFor(99, [0, 1, 0], ids), 3); // unknown blocks fall back to stone
  // A generation variant overrides the tile outright, on every face.
  assert.equal(atlasTileFor(BLOCK.STONE, [0, 1, 0], ids, TILE.MOSS_STONE), 6);
  assert.equal(atlasTileFor(BLOCK.STONE, [0, 1, 0], ids, TILE.CRACK_STONE), 7);
  assert.equal(atlasTileFor(BLOCK.LEAF, [0, 1, 0], ids, TILE.FLOWER), 8);
  assert.equal(atlasTileFor(BLOCK.STONE, [0, 1, 0], ids, 0), 3); // no override: plain tile
  // A side face's v follows height: the top corner samples the top of the
  // tile (v=0) and the bottom corner the bottom (v=1).
  assert.deepEqual(faceUV([1, 0, 0], [1, 1, 0]), [0, 0]);
  assert.deepEqual(faceUV([1, 0, 0], [1, 0, 1]), [1, 1]);

  const grid = createChunkGrid(WORLD);
  const cells = new Map([
    ["0/3/4", BLOCK.GRASS], ["1/3/4", BLOCK.STONE], ["0/3/5", BLOCK.WOOD], ["2/3/4", BLOCK.LEAF]
  ]);
  const get = (...position) => cells.get(position.join("/")) ?? BLOCK.AIR;
  const colors = Array.from({ length: 6 }, () => [.4, .5, .3]);
  const mesh = buildChunkMesh(WORLD, grid.at(0, 4), get, colors, ids);
  // 12 floats per vertex: position 3, colour 3, face 4, UV 2.  Four
  // consecutive vertices make one face; the face's tile is the minimum u
  // over its corners (one corner always has fu=0), which avoids the
  // boundary where a corner with fu=1 reads as the next tile.
  assert.equal(mesh.vertices.length % 12, 0);
  const tiles = new Set();
  for (let i = 0; i < mesh.vertices.length; i += 48) {
    let minU = Infinity;
    for (let k = 0; k < 4; k++) {
      const u = mesh.vertices[i + k * 12 + 10], v = mesh.vertices[i + k * 12 + 11];
      assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, `uv ${u},${v} in range`);
      minU = Math.min(minU, u);
    }
    tiles.add(Math.round(minU * ATLAS_TILES));
  }
  // Grass (top/side), stone and wood/leaf tiles all appear.
  assert.ok(tiles.has(0) && tiles.has(1) && tiles.has(3), `tiles: ${[...tiles]}`);
  assert.ok(tiles.has(4) || tiles.has(5), `tiles: ${[...tiles]}`);
});

test("trees vary in shape and the extension ring has sparse rubble and tufts", () => {
  const world = generateTerrain(WORLD, BLOCK);
  // Ground level is the top of the dirt layer: hills bury the old grass
  // and cap some summits with stone, so the highest grass is no longer a
  // reliable ground marker.
  const topGround = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (world[voxelIndex(WORLD, x, y, z)] === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const heights = new Map();
  let rubble = 0, legacyRubble = 0, tufts = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const top = topGround(x, z);
      if (top < 0) continue;
      const above = world[voxelIndex(WORLD, x, top + 1, z)];
      // Rubble is an isolated single stone: ruin walls, pillars and fallen
      // blocks are also stone sitting on grass, but they touch other stone
      // at the same height, so they are not counted here.
      if (above === BLOCK.STONE) {
        if (isOld(x, z)) legacyRubble++;
        else {
          const neighbor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
            const nx = x + dx, nz = z + dz;
            if (nx < WORLD.minX || nx >= WORLD.minX + WORLD.width || nz < WORLD.minZ || nz >= WORLD.minZ + WORLD.depth) return false;
            return world[voxelIndex(WORLD, nx, top + 1, nz)] === BLOCK.STONE;
          });
          if (!neighbor) rubble++;
        }
      }
      if (isOld(x, z) || (x >= 14 && x <= 18 && z >= 14 && z <= 18)) continue;
      let height = 0;
      for (let y = top + 1; y < WORLD.height && world[voxelIndex(WORLD, x, y, z)] === BLOCK.WOOD; y++) height++;
      if (height > 0) heights.set(height, (heights.get(height) ?? 0) + 1);
      // An isolated tuft is a lone LEAF above grass: no trunk in its column
      // and no LEAF in the neighboring columns at the same height or above,
      // so tree crowns are not mistaken for tufts.
      if (above !== BLOCK.LEAF) continue;
      let wood = false;
      for (let y = top + 1; y < WORLD.height; y++) {
        if (world[voxelIndex(WORLD, x, y, z)] === BLOCK.WOOD) wood = true;
      }
      if (wood) continue;
      let nearLeaf = false;
      for (let dx = -1; dx <= 1 && !nearLeaf; dx++) for (let dz = -1; dz <= 1 && !nearLeaf; dz++) {
        if (!dx && !dz) continue;
        for (let dy = 1; dy <= 2; dy++) {
          const nx = x + dx, nz = z + dz;
          if (nx < WORLD.minX || nx >= WORLD.minX + WORLD.width || nz < WORLD.minZ || nz >= WORLD.minZ + WORLD.depth) continue;
          if (world[voxelIndex(WORLD, nx, top + dy, nz)] === BLOCK.LEAF) nearLeaf = true;
        }
      }
      if (!nearLeaf) tufts++;
    }
  }
  // Old trees were always 3-4 blocks tall; the new variants add 2-block
  // short trees and 5-6 block tall pines.
  assert.ok((heights.get(2) ?? 0) >= 5, `short trees: ${heights.get(2) ?? 0}`);
  assert.ok(((heights.get(5) ?? 0) + (heights.get(6) ?? 0)) >= 5,
    `tall trees: ${(heights.get(5) ?? 0) + (heights.get(6) ?? 0)}`);
  // Sparse scatter: dozens of pieces across ~3000 extension columns, none
  // in the original save area.
  assert.ok(rubble > 0 && rubble < 100, `rubble: ${rubble}`);
  assert.equal(legacyRubble, 0);
  assert.ok(tufts > 0 && tufts < 100, `tufts: ${tufts}`);
});

test("mining cracks grow in three stages and never jump around", () => {
  assert.equal(crackStage(0), 0);
  assert.equal(crackStage(-0.5), 0);
  assert.equal(crackStage(0.1), 1);
  assert.equal(crackStage(1 / 3), 2);
  assert.equal(crackStage(0.5), 2);
  assert.equal(crackStage(2 / 3), 3);
  assert.equal(crackStage(1), 3);
  const one = crackPolylines(5, 3, 4, 1);
  const two = crackPolylines(5, 3, 4, 2);
  const three = crackPolylines(5, 3, 4, 3);
  assert.equal(crackPolylines(5, 3, 4, 0).length, 0);
  assert.equal(one.length, 2);
  assert.equal(two.length, 4);
  assert.equal(three.length, 6);
  // Deterministic: the same block always cracks the same way, and a later
  // stage keeps the earlier lines instead of redrawing them.
  assert.deepEqual(crackPolylines(5, 3, 4, 3), three);
  assert.deepEqual(two.slice(0, 2), one);
  assert.deepEqual(three.slice(0, 4), two);
  for (const lines of [one, two, three]) {
    for (const line of lines) {
      assert.equal(line.length, 5, "each crack is a 4-segment jagged line");
      for (const [u, v] of line) {
        assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, `crack point ${u},${v} stays on the face`);
      }
    }
  }
  // Different blocks crack differently.
  assert.notDeepEqual(crackPolylines(6, 3, 4, 3), three);
});

test("face corners give the four corners of the hit face", () => {
  const cell = [5, 3, 4];
  const plusX = faceCorners(cell, [1, 0, 0]);
  assert.equal(plusX.length, 4);
  assert.ok(plusX.every(corner => corner[0] === 6), "the +x face sits at x=6");
  assert.deepEqual(new Set(plusX.map(corner => corner[1])), new Set([3, 4]));
  assert.deepEqual(new Set(plusX.map(corner => corner[2])), new Set([4, 5]));
  const bottom = faceCorners(cell, [0, -1, 0]);
  assert.ok(bottom.every(corner => corner[1] === 3), "the bottom face sits at y=3");
  const plusZ = faceCorners(cell, [0, 0, 1]);
  assert.ok(plusZ.every(corner => corner[2] === 5), "the +z face sits at z=5");
  for (const face of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const corners = faceCorners(cell, face);
    assert.equal(new Set(corners.map(corner => corner.join("/"))).size, 4, `face ${face} has 4 distinct corners`);
  }
});

test("particle bursts fly out with gravity and rest on the floor", () => {
  const colors = [[1, 0, 0], [0, 1, 0]];
  const burst = createBurst(5, 8, 4, 12, { colors, speed: 3, up: 3, life: 0.6, gravity: 14, floor: 6, seed: 42 });
  assert.equal(burst.length, 12);
  // Deterministic for a given seed, different for another seed.
  assert.deepEqual(createBurst(5, 8, 4, 12, { colors, speed: 3, up: 3, life: 0.6, gravity: 14, floor: 6, seed: 42 }), burst);
  assert.notDeepEqual(createBurst(5, 8, 4, 12, { colors, speed: 3, up: 3, life: 0.6, gravity: 14, floor: 6, seed: 43 }), burst);
  for (const p of burst) {
    assert.equal(p.age, 0);
    assert.equal(p.life, 0.6);
    assert.equal(p.gravity, 14);
    assert.equal(p.floor, 6);
    assert.ok(p.vy > 0, "cubes start moving up");
    assert.ok(Math.hypot(p.vx, p.vz) > 0.5 && Math.hypot(p.vx, p.vz) <= 3.01, "horizontal speed in range");
    assert.ok(p.size > 0.05 && p.size < 0.16, `cube size ${p.size}`);
    assert.ok(colors.some(c => c.every((v, i) => Math.abs(p.color[i] - v) < 0.31)), "colour comes from the palette");
  }
  // Gravity pulls the burst down over time.
  const falling = createBurst(0, 10, 0, 1, { colors, speed: 0, up: 0, life: 1, gravity: 10, floor: 0, seed: 7 });
  const before = falling[0].vy;
  stepParticles(falling, 0.1);
  assert.ok(falling[0].vy < before, "gravity reduces upward velocity");
  assert.ok(falling[0].y < 10, "the cube has started to fall");
  // A cube that reaches the floor stops there instead of sinking through it.
  const low = [{ x: 0, y: 0.2, z: 0, vx: 2, vy: -3, vz: 0, size: 0.1, life: 1, age: 0, gravity: 10, floor: 0, color: [1, 1, 1] }];
  stepParticles(low, 0.1);
  assert.equal(low[0].y, 0.05, "the cube rests on the floor");
  assert.equal(low[0].vy, 0);
  assert.ok(low[0].vx < 2, "resting friction bleeds horizontal speed");
  // Cubes vanish at the end of their life, not before.
  const short = createBurst(0, 5, 0, 3, { colors, life: 0.6, floor: 0, seed: 1 });
  stepParticles(short, 0.5);
  assert.equal(short.length, 3);
  stepParticles(short, 0.2);
  assert.equal(short.length, 0);
});

test("placement pop scales 0.9 to 1 over 0.12s and never overshoots", () => {
  assert.equal(POP_DURATION, 0.12);
  assert.equal(POP_START_SCALE, 0.9);
  assert.equal(popScale(0), 0.9);
  assert.equal(popScale(0.06), 0.95);
  assert.equal(popScale(0.12), 1);
  assert.equal(popScale(0.3), 1, "the pop stops at full size instead of growing past it");
  assert.equal(popScale(-1), 0.9, "a negative age still starts at 0.9");
});

test("day/night cycle keys sun, sky, light and fog to the time of day", () => {
  const noon = dayCycle(60);
  assert.equal(noon.phase, 0.25);
  assert.ok(noon.sunDir[1] > 0.9, "the sun is overhead at noon");
  assert.equal(noon.dayFactor, 1);
  assert.deepEqual(noon.skyTint, [1, 1, 1]);
  assert.ok(Math.abs(noon.light - 1) < 1e-9, "noon is full brightness");
  const midnight = dayCycle(180);
  assert.equal(midnight.phase, 0.75);
  assert.ok(midnight.sunDir[1] < -0.9, "the sun is below the horizon at midnight");
  assert.equal(midnight.dayFactor, 0);
  assert.ok(midnight.skyTint.every(v => v < 0.3), "the night sky tint is dark");
  assert.ok(midnight.light > 0.3 && midnight.light < 0.4, "night is dim but not pitch black");
  assert.ok(midnight.fogDensity > noon.fogDensity, "night fog is denser than day fog");
  const sunrise = dayCycle(0);
  assert.ok(Math.abs(sunrise.duskFactor - 1) < 1e-9, "dawn is full dusk");
  assert.ok(sunrise.sunDir[0] > 0.8 && Math.abs(sunrise.sunDir[1]) < 0.05, "the sun rises in the east, on the horizon");
  assert.ok(sunrise.skyTint[0] > sunrise.skyTint[1] && sunrise.skyTint[1] > sunrise.skyTint[2],
    "dawn tints the sky orange");
  const sunset = dayCycle(120);
  assert.ok(Math.abs(sunset.duskFactor - 1) < 1e-9, "dusk is full dusk");
  assert.ok(sunset.sunDir[0] < -0.8, "the sun sets in the west");
  assert.deepEqual(dayCycle(0), dayCycle(DAY_LENGTH), "the cycle repeats every day");
});

test("squared-distance fog starts at zero and thickens with range", () => {
  assert.equal(fogAmount(0.032, 0), 0);
  assert.ok(fogAmount(0.032, 10) < fogAmount(0.032, 30) && fogAmount(0.032, 30) < fogAmount(0.032, 60),
    "fog only ever thickens with distance");
  assert.ok(fogAmount(0.032, 50) > 0.85, "day fog is nearly opaque by 50 blocks");
  assert.ok(fogAmount(0.055, 20) > fogAmount(0.032, 20), "night fog is thicker at the same distance");
  assert.equal(fogDensityForRange(25), 1.35 / 25);
});

test("the extension ring has ruined walls, collapsed pillars and dead trees", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const inWorld = (x, z) => x >= WORLD.minX && x < WORLD.minX + WORLD.width && z >= WORLD.minZ && z < WORLD.minZ + WORLD.depth;
  // Ground level is the top of the dirt layer, for the same reason as in
  // the tree test: hills bury the old grass and cap summits with stone.
  const topGround = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // Ruin walls and fallen lines are connected runs of stone sitting on
  // grass; count distinct runs of at least 3 cells.
  const seen = new Set();
  let wallRuns = 0, pillars = 0, stoneInClearing = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const top = topGround(x, z);
      if (top < 0) continue;
      if (inClearing(x, z) && at(x, top + 1, z) === BLOCK.STONE) stoneInClearing++;
      if (isOld(x, z) || at(x, top + 1, z) !== BLOCK.STONE) continue;
      let height = 0;
      for (let y = top + 1; y < WORLD.height && at(x, y, z) === BLOCK.STONE; y++) height++;
      if (height >= 4) pillars++;
      const key = `${x},${z}`;
      if (seen.has(key)) continue;
      let run = 0;
      const stack = [[x, z]];
      while (stack.length) {
        const [cx, cz] = stack.pop();
        const cellKey = `${cx},${cz}`;
        if (seen.has(cellKey)) continue;
        seen.add(cellKey);
        run++;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, nz = cz + dz;
          if (!inWorld(nx, nz) || isOld(nx, nz)) continue;
          const nt = topGround(nx, nz);
          if (nt >= 0 && at(nx, nt + 1, nz) === BLOCK.STONE) stack.push([nx, nz]);
        }
      }
      if (run >= 3) wallRuns++;
    }
  }
  assert.ok(wallRuns >= 5, `ruined wall runs: ${wallRuns}`);
  assert.ok(pillars >= 3, `collapsed pillar stubs 4+ tall: ${pillars}`);
  assert.equal(stoneInClearing, 0, "no ruin stone inside the spawn clearing");
  // Dead trees: a 2-4 tall wood trunk with no leaf anywhere in its column
  // and a dry branch in a neighbouring column near the top.  Live trees
  // always carry leaves in the trunk column, so this never mistakes one.
  let deadTrees = 0, deadInOld = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const top = topGround(x, z);
      if (top < 0) continue;
      let woodHeight = 0;
      for (let y = top + 1; y < WORLD.height && at(x, y, z) === BLOCK.WOOD; y++) woodHeight++;
      if (woodHeight < 2 || woodHeight > 4) continue;
      let leaf = false;
      for (let y = top + 1; y < WORLD.height; y++) {
        if (at(x, y, z) === BLOCK.LEAF) leaf = true;
      }
      if (leaf) continue;
      const branchHeight = top + woodHeight;
      const branch = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) =>
        at(x + dx, branchHeight, z + dz) === BLOCK.WOOD || at(x + dx, branchHeight - 1, z + dz) === BLOCK.WOOD);
      if (!branch) continue;
      if (isOld(x, z)) deadInOld++;
      else if (!inClearing(x, z)) deadTrees++;
    }
  }
  assert.ok(deadTrees >= 10, `dead trees: ${deadTrees}`);
  assert.equal(deadInOld, 0, "no dead trees inside the original save area");
  // Ruins and dead trees use only stone and wood, and generation is
  // deterministic: the same world comes out every time.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("caves wind through the deep stone of the extension ring only", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  // A cave cell is air at least three blocks under the dirt layer: the
  // highest dirt in a column is top-1, so cave air lives at y <= d-2.
  // The dirt layer itself (d and d-1) must be solid everywhere, which is
  // what "the surface is never broken" means here: a cave can never open
  // to the sky, and the bottom stone layer stays in place too.
  // Shafts cut the dirt layer on purpose (see the V15 test): a column
  // with no dirt left that belongs to a 2x2 no-dirt block is a shaft
  // column, not a cave breaking the surface, so it is skipped here.
  const noDirt = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      let dirt = false;
      for (let y = 0; y < WORLD.height; y++) {
        if (at(x, y, z) === BLOCK.DIRT) { dirt = true; break; }
      }
      if (!dirt) noDirt.add(`${x},${z}`);
    }
  }
  const shaftCol = (x, z) => {
    for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      if (noDirt.has(`${x + ox},${z + oz}`) && noDirt.has(`${x + ox + 1},${z + oz}`)
        && noDirt.has(`${x + ox},${z + oz + 1}`) && noDirt.has(`${x + ox + 1},${z + oz + 1}`)) return true;
    }
    return false;
  };
  // Gullies cut the dirt layer on purpose too (see the V16 test): a
  // column whose highest dirt has air above it is a gully floor, not a
  // cave breaking the surface — caves can never reach the dirt layer —
  // so columns in a gully-sized group of such columns skip the dirt
  // check.  An isolated exposed-dirt column is not a gully and still
  // fails, so a cave breaking through would still be caught.
  const exposed = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      let d = -1;
      for (let y = WORLD.height - 1; y >= 0; y--) {
        if (at(x, y, z) === BLOCK.DIRT) { d = y; break; }
      }
      if (d >= 0 && at(x, d + 1, z) === BLOCK.AIR) exposed.add(`${x},${z}`);
    }
  }
  const gullySeen = new Set();
  const gullyCol = new Set();
  for (const key of exposed) {
    if (gullySeen.has(key)) continue;
    const cells = [];
    const stack = [key];
    while (stack.length) {
      const k = stack.pop();
      if (gullySeen.has(k)) continue;
      gullySeen.add(k);
      cells.push(k);
      const [cx, cz] = k.split(",").map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nk = `${cx + dx},${cz + dz}`;
        if (exposed.has(nk)) stack.push(nk);
      }
    }
    if (cells.length >= 8) for (const k of cells) gullyCol.add(k);
  }
  let caveCells = 0, caveInOld = 0, caveInClearing = 0, connected = 0;
  let dirtBad = 0, bottomBad = 0;
  const caveSet = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      // A dirtless stairwell column is a second intentional opening,
      // like a shaft column: the stair cuts the dirt layer on purpose,
      // so it is skipped the same way.  A stairwell column that kept
      // its dirt goes through the checks below — its highest dirt has
      // the stone step above it, so it still reads as solid ground.
      if (shaftCol(x, z)
        || (noDirt.has(`${x},${z}`) && (world.stairwells ?? new Set()).has(`${x},${z}`))) continue;
      if (at(x, 0, z) !== BLOCK.STONE) bottomBad++;
      let d = -1;
      for (let y = WORLD.height - 1; y >= 0; y--) {
        if (at(x, y, z) === BLOCK.DIRT) { d = y; break; }
      }
      if (d < 1) { dirtBad++; continue; }
      const above = at(x, d + 1, z);
      // The ground top is grass, a tree leaf, or a hill summit's bare
      // stone — never air — and the layer under the top dirt is solid too
      // (dirt in flat ground, old grass or stone under a hill).  Together
      // with the cave band below, that is what "the surface is never
      // broken" means here.
      if (!gullyCol.has(`${x},${z}`)) {
        if (above !== BLOCK.GRASS && above !== BLOCK.LEAF && above !== BLOCK.STONE) dirtBad++;
        if (at(x, d - 1, z) === BLOCK.AIR) dirtBad++;
      }
      for (let y = 0; y <= d - 2; y++) {
        if (at(x, y, z) !== BLOCK.AIR) continue;
        caveCells++;
        caveSet.add(`${x},${y},${z}`);
        if (isOld(x, z)) caveInOld++;
        if (inClearing(x, z)) caveInClearing++;
      }
    }
  }
  assert.equal(dirtBad, 0, "the dirt layer under the surface is solid everywhere");
  assert.equal(bottomBad, 0, "the bottom stone layer is never carved");
  assert.ok(caveCells > 200 && caveCells < 800, `cave cells in range: ${caveCells}`);
  assert.equal(caveInOld, 0, "no caves inside the original save area");
  assert.equal(caveInClearing, 0, "no caves under the spawn clearing");
  // Tunnels, not pinholes: most cave cells touch at least two other cave
  // cells, so the caves join up into walkable passages.
  for (const key of caveSet) {
    const [x, y, z] = key.split(",").map(Number);
    const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      .filter(([dx, dy, dz]) => caveSet.has(`${x + dx},${y + dy},${z + dz}`)).length;
    if (neighbors >= 2) connected++;
  }
  assert.ok(connected / caveCells > 0.6, `connected cave cells: ${connected}/${caveCells}`);
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world, "cave generation is deterministic");
});

test("hills raise bare ground in the extension ring and cap summits with stone", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const ground = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // A raised column still has its old grass buried under the fill: the
  // ground top sits above a grass block, with stone or dirt between them.
  // A column that was never raised has its grass right at the ground top.
  let raised = 0, raisedInOld = 0, raisedInClearing = 0, stoneTops = 0, maxRaise = 0;
  let buriedWood = 0, buriedLeaf = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const g = ground(x, z);
      if (g < 0) continue;
      let buried = -1;
      for (let y = g - 1; y >= 0; y--) {
        if (at(x, y, z) === BLOCK.GRASS) { buried = y; break; }
      }
      if (buried < 0 || g - buried < 1) continue;
      raised++;
      maxRaise = Math.max(maxRaise, g - buried);
      if (isOld(x, z)) raisedInOld++;
      if (inClearing(x, z)) raisedInClearing++;
      if (at(x, g, z) === BLOCK.STONE) stoneTops++;
      for (let y = 0; y < g; y++) {
        if (at(x, y, z) === BLOCK.WOOD) buriedWood++;
        if (at(x, y, z) === BLOCK.LEAF) buriedLeaf++;
      }
    }
  }
  assert.ok(raised > 100 && raised < 300, `raised hill columns: ${raised}`);
  assert.ok(maxRaise >= 3, `tallest hill raises the ground ${maxRaise} blocks`);
  assert.ok(stoneTops >= 20, `bare-stone summits: ${stoneTops}`);
  assert.equal(raisedInOld, 0, "no hills inside the original save area");
  assert.equal(raisedInClearing, 0, "no hills inside the spawn clearing");
  assert.equal(buriedWood, 0, "no tree trunk is buried under a hill");
  assert.equal(buriedLeaf, 0, "no tree crown is buried under a hill");
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world, "hill generation is deterministic");
});

test("flowers and bushes grow on grass in the extension ring only", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const inWorld = (x, z) => x >= WORLD.minX && x < WORLD.minX + WORLD.width && z >= WORLD.minZ && z < WORLD.minZ + WORLD.depth;
  const ground = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // A tree crown's leaves can sit at the same height as a flower, so the
  // detectors below only trust growth with no trunk within two columns:
  // crown leaves always have their trunk that close, flowers and bushes
  // do not.  The detectors also require the growth to sit on grass, which
  // is what "never covers an existing structure" means here — a flower or
  // bush is only ever planted onto bare grass with air above it.
  const nearWood = (x, z, g) => {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const nx = x + dx, nz = z + dz;
      if (!inWorld(nx, nz)) continue;
      for (let y = g + 1; y <= g + 5; y++) {
        if (at(nx, y, nz) === BLOCK.WOOD) return true;
      }
    }
    return false;
  };
  const level = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const g = ground(x, z);
      if (g < 0 || at(x, g, z) !== BLOCK.GRASS) continue;
      // Only true flowers count here: a tree crown's leaves can sit at
      // the same height as a flower, and a crown leaf next to a flower
      // cluster merges it into a group too big to count.  The FLOWER
      // variant is the authoritative flower marker.
      if (at(x, g + 1, z) === BLOCK.LEAF
        && world.variants[voxelIndex(WORLD, x, g + 1, z)] === TILE.FLOWER) level.add(`${x},${z}`);
    }
  }
  // Flower clusters are connected groups of 2-3 one-block leaves.
  const seen = new Set();
  let flowerClusters = 0, flowerCells = 0, flowerInOld = 0, flowerInClearing = 0;
  for (const key of level) {
    if (seen.has(key)) continue;
    const cells = [];
    const stack = [key];
    while (stack.length) {
      const k = stack.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      cells.push(k);
      const [cx, cz] = k.split(",").map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${cx + dx},${cz + dz}`;
        if (level.has(nk)) stack.push(nk);
      }
    }
    if (cells.length < 2 || cells.length > 3) continue;
    let wood = false, old = false, clearing = false;
    for (const k of cells) {
      const [x, z] = k.split(",").map(Number);
      if (nearWood(x, z, ground(x, z))) wood = true;
      if (isOld(x, z)) old = true;
      if (inClearing(x, z)) clearing = true;
    }
    if (wood) continue;
    flowerClusters++;
    flowerCells += cells.length;
    if (old) flowerInOld++;
    if (clearing) flowerInClearing++;
  }
  // A bush is a two-block leaf stack on grass, with one-block sides.
  let bushes = 0, bushSides = 0, bushInOld = 0, bushInClearing = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const g = ground(x, z);
      if (g < 0 || at(x, g, z) !== BLOCK.GRASS) continue;
      if (at(x, g + 1, z) !== BLOCK.LEAF || at(x, g + 2, z) !== BLOCK.LEAF) continue;
      if (nearWood(x, z, g)) continue;
      bushes++;
      if (isOld(x, z)) bushInOld++;
      if (inClearing(x, z)) bushInClearing++;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, ng = ground(nx, nz);
        if (ng >= 0 && at(nx, ng, nz) === BLOCK.GRASS && at(nx, ng + 1, nz) === BLOCK.LEAF
          && at(nx, ng + 2, nz) !== BLOCK.LEAF && !nearWood(nx, nz, ng)) bushSides++;
      }
    }
  }
  // The bounds count true flowers only (the FLOWER variant above): the
  // old detector also counted crown leaves that happened to sit at
  // flower height, inflating the count to the high thirties.  The true
  // scattered clusters number about twenty, with about fifty leaves.
  assert.ok(flowerClusters > 15 && flowerClusters < 50, `flower clusters: ${flowerClusters}`);
  assert.ok(flowerCells > 30 && flowerCells < 130, `flower leaves: ${flowerCells}`);
  assert.equal(flowerInOld, 0, "no flowers inside the original save area");
  assert.equal(flowerInClearing, 0, "no flowers inside the spawn clearing");
  assert.ok(bushes > 15 && bushes < 35, `bushes: ${bushes}`);
  assert.ok(bushSides >= Math.floor(bushes / 2), `bush side leaves: ${bushSides} for ${bushes} bushes`);
  assert.equal(bushInOld, 0, "no bushes inside the original save area");
  assert.equal(bushInClearing, 0, "no bushes inside the spawn clearing");
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world, "flower and bush generation is deterministic");
});

test("ruin stones and flowers carry atlas variants the mesh uses", () => {
  const world = generateTerrain(WORLD, BLOCK);
  assert.ok(world.variants instanceof Uint8Array);
  assert.equal(world.variants.length, world.length);
  const ids = { grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, wood: BLOCK.WOOD, leaf: BLOCK.LEAF };
  const colors = Array.from({ length: 6 }, () => [.4, .5, .3]);
  const grid = createChunkGrid(WORLD);
  const get = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const getVariant = (x, y, z) => world.variants[voxelIndex(WORLD, x, y, z)];
  let moss = 0, crack = 0, flower = 0, oasis = 0, plainStone = 0, plainLeaf = 0, legacyVariant = 0, mismatched = 0;
  for (let i = 0; i < world.length; i++) {
    const v = world.variants[i];
    if (v === TILE.MOSS_STONE) moss++;
    else if (v === TILE.CRACK_STONE) crack++;
    else if (v === TILE.FLOWER) flower++;
    else if (v === TILE.OASIS) oasis++;
    if (world[i] === BLOCK.STONE && v === 0) plainStone++;
    if (world[i] === BLOCK.LEAF && v === 0) plainLeaf++;
    if ((v === TILE.MOSS_STONE || v === TILE.CRACK_STONE) && world[i] !== BLOCK.STONE) mismatched++;
    if (v === TILE.FLOWER && world[i] !== BLOCK.LEAF) mismatched++;
    if (v === TILE.OASIS && world[i] !== BLOCK.GRASS) mismatched++;
    const p = voxelPosition(WORLD, i);
    if (p[0] >= 0 && p[0] < 32 && p[2] >= 0 && p[2] < 32 && v !== 0) legacyVariant++;
  }
  assert.ok(moss > 20 && moss < 100, `mossy ruin stones: ${moss}`);
  assert.ok(crack > 20 && crack < 150, `cracked ruin stones: ${crack}`);
  assert.ok(flower > 50 && flower < 150, `flower leaves: ${flower}`);
  assert.equal(oasis, 25, `oasis grass cells: ${oasis}`);
  assert.ok(plainStone > 10000, `plain stones: ${plainStone}`);
  assert.ok(plainLeaf > 1000, `plain leaves: ${plainLeaf}`);
  assert.equal(mismatched, 0, "every variant sits on the block type its tile belongs to");
  assert.equal(legacyVariant, 0, "no variants inside the original save area");
  // The mesh uses the variants: with them, tiles 6-8 appear; without
  // them, the same world meshes with plain tiles only.
  const faceTiles = (useVariants) => {
    const tiles = new Set();
    for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x += 8) {
      for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z += 8) {
        const mesh = buildChunkMesh(WORLD, grid.at(x, z), get, colors, ids, useVariants ? getVariant : undefined);
        for (let i = 0; i < mesh.vertices.length; i += 48) {
          let minU = Infinity;
          for (let k = 0; k < 4; k++) minU = Math.min(minU, mesh.vertices[i + k * 12 + 10]);
          tiles.add(Math.round(minU * ATLAS_TILES));
        }
      }
    }
    return tiles;
  };
  const withVariants = faceTiles(true), withoutVariants = faceTiles(false);
  assert.ok(withVariants.has(6) && withVariants.has(7) && withVariants.has(8), `tiles with variants: ${[...withVariants]}`);
  assert.ok(!withoutVariants.has(6) && !withoutVariants.has(7) && !withoutVariants.has(8), `tiles without variants: ${[...withoutVariants]}`);
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again.variants, world.variants, "variant records are deterministic");
});

test("biomes colour grass tops by 16x16 region, leaving the old map grassland", () => {
  // The region map is pinned: a seeded assignment, with the four regions
  // of the original save area forced to grassland.  Pinning the map also
  // pins determinism — any seed change fails here.
  const expected = {
    "-1,-1": "snow", "-1,0": "sand", "-1,1": "grass", "-1,2": "grass",
    "0,-1": "grass", "0,0": "grass", "0,1": "grass", "0,2": "grass",
    "1,-1": "grass", "1,0": "grass", "1,1": "grass", "1,2": "sand",
    "2,-1": "snow", "2,0": "grass", "2,1": "sand", "2,2": "grass",
  };
  for (const [key, biome] of Object.entries(expected)) {
    const [rx, rz] = key.split(",").map(Number);
    assert.equal(biomeAt(rx * 16, rz * 16), biome, `region ${key} near corner`);
    assert.equal(biomeAt(rx * 16 + 15, rz * 16 + 15), biome, `region ${key} far corner`);
  }
  // The spawn clearing sits inside the legacy area, so it is grassland.
  for (let x = 14; x <= 18; x++) for (let z = 14; z <= 18; z++) assert.equal(biomeAt(x, z), "grass");
  // All three biomes exist in the ring.
  const seen = new Set(Object.values(expected));
  assert.ok(seen.has("snow") && seen.has("sand") && seen.has("grass"));
  // Spot checks use region interiors: edge cells blend (see the V12 test).
  assert.deepEqual(grassTopColor(0, 0, [.4, .5, .3]), [.4, .5, .3]);
  assert.deepEqual(grassTopColor(-8, -8, [.4, .5, .3]), BIOME_GRASS.snow);
  assert.deepEqual(grassTopColor(-8, 8, [.4, .5, .3]), BIOME_GRASS.sand);

  // Mesh colours: grass top faces take the biome colour, side faces keep
  // the base green.  Shading multiplies all three channels by one scalar,
  // so the test classifies by channel ratios, which shading preserves.
  const world = generateTerrain(WORLD, BLOCK);
  const ids = { grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, wood: BLOCK.WOOD, leaf: BLOCK.LEAF };
  const colors = Array.from({ length: 6 }, () => [.4, .5, .3]);
  const grid = createChunkGrid(WORLD);
  const get = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const getVariant = (x, y, z) => world.variants[voxelIndex(WORLD, x, y, z)];
  const classify = (r, g, b) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max / min < 1.1) return "snow";
    if (r > g && r / b > 1.5) return "sand";
    if (g > r && g / r > 1.1) return "grass";
    return "other";
  };
  const tops = { grass: 0, snow: 0, sand: 0 };
  let disagreements = 0, sideMismatch = 0, legacySnowSand = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x += 8) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z += 8) {
      const mesh = buildChunkMesh(WORLD, grid.at(x, z), get, colors, ids, getVariant);
      for (let i = 0; i < mesh.vertices.length; i += 48) {
        // Four vertices make one face; recover its cell from the face
        // direction and the vertices' shared plane.
        const vs = [0, 1, 2, 3].map(k => [
          mesh.vertices[i + k * 12], mesh.vertices[i + k * 12 + 1], mesh.vertices[i + k * 12 + 2],
          mesh.vertices[i + k * 12 + 6], mesh.vertices[i + k * 12 + 7], mesh.vertices[i + k * 12 + 8]]);
        const d = [vs[0][3], vs[0][4], vs[0][5]];
        if (d[1] === -1) continue;
        const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2]);
        const cell = d[1] === 1 ? [Math.min(...xs), ys[0] - 1, Math.min(...zs)]
          : d[0] === 1 ? [xs[0] - 1, Math.min(...ys), Math.min(...zs)]
          : d[0] === -1 ? [xs[0], Math.min(...ys), Math.min(...zs)]
          : d[2] === 1 ? [Math.min(...xs), Math.min(...ys), zs[0] - 1]
          : [Math.min(...xs), Math.min(...ys), zs[0]];
        const [cx, cy, cz] = cell;
        if (!contains(WORLD, cx, cy, cz) || world[voxelIndex(WORLD, cx, cy, cz)] !== BLOCK.GRASS) continue;
        if (d[1] === 1) {
          // Border faces blend (V12 test); this test only checks interiors.
          const rx = Math.floor(cx / 16), rz = Math.floor(cz / 16);
          const borderDist = Math.min(cx - rx * 16, rx * 16 + 15 - cx, cz - rz * 16, rz * 16 + 15 - cz);
          if (borderDist < 2) continue;
        }
        const got = classify(mesh.vertices[i + 3], mesh.vertices[i + 4], mesh.vertices[i + 5]);
        if (d[1] === 1) {
          // Oasis grass stays green in the desert: its top is green
          // where its biome is sand, by design, so it is not a
          // disagreement with the biome colour.
          if (getVariant(cx, cy, cz) === TILE.OASIS) continue;
          if (got === "other" || got !== biomeAt(cx, cz)) disagreements++;
          else tops[got]++;
          if (cx >= 0 && cx < 32 && cz >= 0 && cz < 32 && got !== "grass") legacySnowSand++;
        } else if (got !== "grass") {
          sideMismatch++;
        }
      }
    }
  }
  assert.ok(tops.snow > 100, `snow grass tops: ${tops.snow}`);
  assert.ok(tops.sand > 100, `sand grass tops: ${tops.sand}`);
  assert.ok(tops.grass > 500, `grass grass tops: ${tops.grass}`);
  assert.equal(disagreements, 0, "top faces whose colour disagrees with their biome");
  assert.equal(sideMismatch, 0, "grass side faces keep the base green");
  assert.equal(legacySnowSand, 0, "no snow or sand grass tops inside the original save area");
});

test("biome borders blend grass tops over two cells", () => {
  const base = [.4, .5, .3];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const close = (actual, expected) => {
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-9, `${actual} ~= ${expected}`);
  };
  // Snow | grass border (x = 0; z = -8 is mid-region, so only the x
  // border matters).  The border cell is the midpoint, one cell in is a
  // quarter, two cells in is pure.
  close(grassTopColor(-1, -8, base), lerp(BIOME_GRASS.snow, base, 0.5));
  close(grassTopColor(-2, -8, base), lerp(BIOME_GRASS.snow, base, 0.25));
  close(grassTopColor(-3, -8, base), BIOME_GRASS.snow);
  close(grassTopColor(0, -8, base), lerp(base, BIOME_GRASS.snow, 0.5));
  close(grassTopColor(1, -8, base), lerp(base, BIOME_GRASS.snow, 0.25));
  close(grassTopColor(2, -8, base), base);
  // Snow | sand border (z = 0; x = -8 is mid-region).
  close(grassTopColor(-8, -1, base), lerp(BIOME_GRASS.snow, BIOME_GRASS.sand, 0.5));
  close(grassTopColor(-8, -2, base), lerp(BIOME_GRASS.snow, BIOME_GRASS.sand, 0.25));
  close(grassTopColor(-8, -3, base), BIOME_GRASS.snow);
  close(grassTopColor(-8, 0, base), lerp(BIOME_GRASS.sand, BIOME_GRASS.snow, 0.5));
  close(grassTopColor(-8, 1, base), lerp(BIOME_GRASS.sand, BIOME_GRASS.snow, 0.25));
  close(grassTopColor(-8, 2, base), BIOME_GRASS.sand);
  // Region centres are untouched by the blend.
  close(grassTopColor(-8, -8, base), BIOME_GRASS.snow);
  close(grassTopColor(-8, 8, base), BIOME_GRASS.sand);
  close(grassTopColor(40, 40, base), base);
  // The original save area never blends, even right on a border.
  for (const [x, z] of [[0, 8], [1, 8], [0, 0], [31, 31], [16, 0]]) {
    assert.deepEqual(grassTopColor(x, z, base), base, `legacy cell ${x},${z}`);
  }
  // Determinism: the blend is a pure function of the cell.
  for (const [x, z] of [[-1, -8], [-8, -1], [0, 8]]) {
    assert.deepEqual(grassTopColor(x, z, base), grassTopColor(x, z, base));
  }

  // Mesh level: border top faces render the blended colour.  Shading
  // multiplies all three channels by one scalar, so ratios are compared.
  const world = generateTerrain(WORLD, BLOCK);
  const ids = { grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, wood: BLOCK.WOOD, leaf: BLOCK.LEAF };
  const colors = Array.from({ length: 6 }, () => base);
  const grid = createChunkGrid(WORLD);
  const get = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const getVariant = (x, y, z) => world.variants[voxelIndex(WORLD, x, y, z)];
  let mismatches = 0, borderFaces = 0, borderChanged = 0, sideMismatch = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x += 8) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z += 8) {
      const mesh = buildChunkMesh(WORLD, grid.at(x, z), get, colors, ids, getVariant);
      for (let i = 0; i < mesh.vertices.length; i += 48) {
        const vs = [0, 1, 2, 3].map(k => [
          mesh.vertices[i + k * 12], mesh.vertices[i + k * 12 + 1], mesh.vertices[i + k * 12 + 2],
          mesh.vertices[i + k * 12 + 6], mesh.vertices[i + k * 12 + 7], mesh.vertices[i + k * 12 + 8]]);
        const d = [vs[0][3], vs[0][4], vs[0][5]];
        if (d[1] === -1) continue;
        const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2]);
        const cell = d[1] === 1 ? [Math.min(...xs), ys[0] - 1, Math.min(...zs)]
          : d[0] === 1 ? [xs[0] - 1, Math.min(...ys), Math.min(...zs)]
          : d[0] === -1 ? [xs[0], Math.min(...ys), Math.min(...zs)]
          : d[2] === 1 ? [Math.min(...xs), Math.min(...ys), zs[0] - 1]
          : [Math.min(...xs), Math.min(...ys), zs[0]];
        const [cx, cy, cz] = cell;
        if (!contains(WORLD, cx, cy, cz) || world[voxelIndex(WORLD, cx, cy, cz)] !== BLOCK.GRASS) continue;
        const r = mesh.vertices[i + 3], g = mesh.vertices[i + 4], b = mesh.vertices[i + 5];
        if (d[1] === 1) {
          // Oasis grass stays green in the desert: its top is green
          // where the blend expects sand, by design, so it is not a
          // mismatch with the blended colour.
          if (getVariant(cx, cy, cz) === TILE.OASIS) continue;
          const expected = grassTopColor(cx, cz, base);
          const own = biomeAt(cx, cz) === "grass" ? base : BIOME_GRASS[biomeAt(cx, cz)];
          const er = [expected[0] / expected[1], expected[2] / expected[1]];
          const vr = [r / g, b / g];
          if (Math.abs(vr[0] - er[0]) > 1e-4 || Math.abs(vr[1] - er[1]) > 1e-4) mismatches++;
          const orr = [own[0] / own[1], own[2] / own[1]];
          if (Math.abs(er[0] - orr[0]) > 1e-3 || Math.abs(er[1] - orr[1]) > 1e-3) {
            borderFaces++;
            if (Math.abs(vr[0] - orr[0]) > 1e-3 || Math.abs(vr[1] - orr[1]) > 1e-3) borderChanged++;
          }
        } else {
          // Side faces keep the base green, borders included.
          if (Math.abs(r / g - base[0] / base[1]) > 1e-4 || Math.abs(b / g - base[2] / base[1]) > 1e-4) sideMismatch++;
        }
      }
    }
  }
  assert.equal(mismatches, 0, "top faces whose colour disagrees with grassTopColor");
  assert.ok(borderFaces > 100, `blended top faces: ${borderFaces}`);
  assert.equal(borderChanged, borderFaces, "every blended top face renders a colour different from its own biome");
  assert.equal(sideMismatch, 0, "grass side faces keep the base green");
});

test("flowers take pink, yellow or white vertex colours; tree leaves stay green", () => {
  const world = generateTerrain(WORLD, BLOCK);
  // Function level: every flower cell maps to one of the three colours,
  // all three occur, and none sits in the original save area.
  const counts = { pink: 0, yellow: 0, white: 0 };
  let flowerCells = 0, legacyFlower = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let y = 0; y < WORLD.height; y++) {
      for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
        const i = voxelIndex(WORLD, x, y, z);
        if (world[i] !== BLOCK.LEAF || world.variants[i] !== TILE.FLOWER) continue;
        flowerCells++;
        if (x >= 0 && x < 32 && z >= 0 && z < 32) legacyFlower++;
        const color = flowerColorFor(x, z);
        assert.ok(Object.values(FLOWER_COLORS).includes(color), `flower colour at ${x},${z}`);
        const name = Object.keys(FLOWER_COLORS).find(k => FLOWER_COLORS[k] === color);
        counts[name]++;
        // Determinism: the colour is a pure function of the cell.
        assert.strictEqual(flowerColorFor(x, z), color);
      }
    }
  }
  assert.ok(flowerCells > 50, `flower cells: ${flowerCells}`);
  assert.ok(counts.pink > 10 && counts.yellow > 10 && counts.white > 10, `flower colours: ${JSON.stringify(counts)}`);
  assert.equal(legacyFlower, 0, "no flower cells inside the original save area");

  // Mesh level: flower faces render their seeded colour on every face
  // (ratios, which shading preserves), while all other leaves stay green.
  const ids = { grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, wood: BLOCK.WOOD, leaf: BLOCK.LEAF };
  const base = [.4, .5, .3];
  const colors = Array.from({ length: 6 }, () => base);
  const grid = createChunkGrid(WORLD);
  const get = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const getVariant = (x, y, z) => world.variants[voxelIndex(WORLD, x, y, z)];
  const classifyLeaf = (r, g, b) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max / min < 1.1) return "white";
    if (r > g && r / g > 1.5) return "pink";
    if (r > g && b / g < 0.5) return "yellow";
    if (g > r && g / r > 1.1) return "green";
    return "other";
  };
  const flowerFaces = { pink: 0, yellow: 0, white: 0, other: 0 };
  let mismatches = 0, greenLeafFaces = 0, nonGreenLeafFaces = 0, legacyNonGreen = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x += 8) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z += 8) {
      const mesh = buildChunkMesh(WORLD, grid.at(x, z), get, colors, ids, getVariant);
      for (let i = 0; i < mesh.vertices.length; i += 48) {
        const vs = [0, 1, 2, 3].map(k => [
          mesh.vertices[i + k * 12], mesh.vertices[i + k * 12 + 1], mesh.vertices[i + k * 12 + 2],
          mesh.vertices[i + k * 12 + 6], mesh.vertices[i + k * 12 + 7], mesh.vertices[i + k * 12 + 8]]);
        const d = [vs[0][3], vs[0][4], vs[0][5]];
        if (d[1] === -1) continue;
        const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2]);
        const cell = d[1] === 1 ? [Math.min(...xs), ys[0] - 1, Math.min(...zs)]
          : d[0] === 1 ? [xs[0] - 1, Math.min(...ys), Math.min(...zs)]
          : d[0] === -1 ? [xs[0], Math.min(...ys), Math.min(...zs)]
          : d[2] === 1 ? [Math.min(...xs), Math.min(...ys), zs[0] - 1]
          : [Math.min(...xs), Math.min(...ys), zs[0]];
        const [cx, cy, cz] = cell;
        if (!contains(WORLD, cx, cy, cz) || world[voxelIndex(WORLD, cx, cy, cz)] !== BLOCK.LEAF) continue;
        const r = mesh.vertices[i + 3], g = mesh.vertices[i + 4], b = mesh.vertices[i + 5];
        const got = classifyLeaf(r, g, b);
        if (world.variants[voxelIndex(WORLD, cx, cy, cz)] === TILE.FLOWER) {
          const expected = flowerColorFor(cx, cz);
          const er = [expected[0] / expected[1], expected[2] / expected[1]];
          if (Math.abs(r / g - er[0]) > 1e-4 || Math.abs(b / g - er[1]) > 1e-4) mismatches++;
          flowerFaces[got]++;
        } else {
          if (got === "green") greenLeafFaces++;
          else {
            nonGreenLeafFaces++;
            if (cx >= 0 && cx < 32 && cz >= 0 && cz < 32) legacyNonGreen++;
          }
        }
      }
    }
  }
  assert.ok(flowerFaces.pink > 10 && flowerFaces.yellow > 10 && flowerFaces.white > 10,
    `flower faces: ${JSON.stringify(flowerFaces)}`);
  assert.equal(flowerFaces.other, 0, "flower faces classify as pink, yellow or white");
  assert.equal(mismatches, 0, "flower faces whose colour disagrees with flowerColorFor");
  assert.ok(greenLeafFaces > 1000, `green leaf faces: ${greenLeafFaces}`);
  assert.equal(nonGreenLeafFaces, 0, "tree leaves and bushes keep the base green");
  assert.equal(legacyNonGreen, 0, "no recoloured leaves inside the original save area");
});

test("new pine and willow shapes grow in the extension ring only", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const topGround = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (world[voxelIndex(WORLD, x, y, z)] === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  // Planted trees are located by the placement contract (top > 5 and the
  // two placement seeds), and classified by the variant rule.  Trunk
  // heights come from the variant rule, not from measuring the column:
  // neighbouring crowns overwrite trunk cells with leaves, so a measured
  // trunk can read short.  The shape checks below are the real
  // verification — they would fail if the crown code were wrong.
  const pines = [], willows = [];
  for (let x = WORLD.minX + 3; x < WORLD.minX + WORLD.width - 3; x++) {
    for (let z = WORLD.minZ + 3; z < WORLD.minZ + WORLD.depth - 3; z++) {
      const top = topGround(x, z);
      if (top <= 5 || inClearing(x, z)) continue;
      if (!(seeded(x, z) > .945) || !(seeded(x - 1, z + 2) > .42)) continue;
      let wood = false;
      for (let y = top + 1; y < WORLD.height; y++) {
        if (at(x, y, z) === BLOCK.WOOD) { wood = true; break; }
      }
      if (!wood) continue;
      const oldVariant = Math.floor(seeded(x + 101, z - 57) * 3);
      let variant = oldVariant;
      if (!isOld(x, z) && oldVariant === 0 && seeded(x + 201, z - 77) < .8) {
        variant = seeded(x + 301, z + 41) < .5 ? 3 : 4;
      } else if (!isOld(x, z) && oldVariant === 2 && seeded(x + 401, z - 91) < .5) {
        variant = 4;
      }
      if (variant === 3) pines.push({ x, z, base: top + 1, trunk: 6 + Math.floor(seeded(x + 13, z + 29) * 2) });
      if (variant === 4) willows.push({ x, z, base: top + 1, trunk: 4 });
    }
  }
  assert.ok(pines.length >= 5, `pines: ${pines.length}`);
  assert.ok(willows.length >= 5, `willows: ${willows.length}`);
  // Determinism: the same trees are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
  // Pine: a 6-7 trunk with a four-layer cone — a wide 5x5 base (radius-2
  // leaves at the crown bottom), a plus layer below the tip, and a single
  // tip leaf.  Only presence is checked: neighbouring crowns may add
  // leaves, but they cannot remove the pine's own.
  for (const p of pines) {
    const crownY = p.base + p.trunk - 2;
    const card2 = [[2, 0], [-2, 0], [0, 2], [0, -2]]
      .filter(([dx, dz]) => at(p.x + dx, crownY, p.z + dz) === BLOCK.LEAF).length;
    assert.ok(card2 >= 3, `pine at ${p.x},${p.z}: radius-2 crown bottom leaves: ${card2}`);
    assert.equal(at(p.x, crownY + 3, p.z), BLOCK.LEAF, `pine at ${p.x},${p.z}: single tip`);
    const plus = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
      .filter(([dx, dz]) => at(p.x + dx, crownY + 2, p.z + dz) === BLOCK.LEAF).length;
    assert.ok(plus >= 3, `pine at ${p.x},${p.z}: plus layer below the tip: ${plus}`);
  }
  // Willow: a 4 trunk with a flat 7x7 canopy (radius-3 leaves at the
  // crown) and at least two drooping strands — a leaf hanging below the
  // canopy edge with a canopy leaf directly above it.
  for (const w of willows) {
    const crownY = w.base + w.trunk - 2;
    const card3 = [[3, 0], [-3, 0], [0, 3], [0, -3]]
      .filter(([dx, dz]) => at(w.x + dx, crownY, w.z + dz) === BLOCK.LEAF
        || at(w.x + dx, crownY + 1, w.z + dz) === BLOCK.LEAF).length;
    assert.ok(card3 >= 2, `willow at ${w.x},${w.z}: radius-3 canopy leaves: ${card3}`);
    let strands = 0;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) < 2 || Math.abs(dx) + Math.abs(dz) > 4) continue;
      if (at(w.x + dx, crownY - 1, w.z + dz) === BLOCK.LEAF && at(w.x + dx, crownY, w.z + dz) === BLOCK.LEAF) strands++;
    }
    assert.ok(strands >= 2, `willow at ${w.x},${w.z}: drooping strands: ${strands}`);
  }
  // Legacy trees are unchanged: the same nine trees with the same measured
  // trunk heights as before this task, and no 7-tall trunk (pines are
  // 6-7, the old tall variant tops out at 6).
  const legacyHeights = new Map();
  let legacyTrees = 0;
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) {
    const top = topGround(x, z);
    if (top < 0) continue;
    let h = 0;
    for (let y = top + 1; y < WORLD.height && at(x, y, z) === BLOCK.WOOD; y++) h++;
    if (h > 0) {
      legacyTrees++;
      legacyHeights.set(h, (legacyHeights.get(h) ?? 0) + 1);
    }
  }
  assert.equal(legacyTrees, 9, `legacy trees: ${legacyTrees}`);
  assert.deepEqual(Object.fromEntries(legacyHeights), { 2: 4, 3: 1, 4: 2, 5: 1, 6: 1 });
  // The spawn clearing has no trees at all.
  for (let x = 14; x <= 18; x++) for (let z = 14; z <= 18; z++) {
    const top = topGround(x, z);
    for (let y = top + 1; y < WORLD.height; y++) {
      assert.notEqual(at(x, y, z), BLOCK.WOOD, `wood in the clearing at ${x},${y},${z}`);
      assert.notEqual(at(x, y, z), BLOCK.LEAF, `leaf in the clearing at ${x},${y},${z}`);
    }
  }
});

test("cave entrance shafts open 2x2 holes into caves below", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  // A shaft column has no dirt left: the shaft cut the whole dirt layer
  // away, and nothing else ever removes dirt — except a shaft stairwell,
  // which cuts the dirt layer on purpose the same way (see the V15 test
  // and the stairwell step).  The stairwell columns are recorded on the
  // world, so they are taken out of the no-dirt set before grouping:
  // every remaining no-dirt column belongs to a shaft.
  const noDirt = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      let dirt = false;
      for (let y = 0; y < WORLD.height; y++) {
        if (at(x, y, z) === BLOCK.DIRT) { dirt = true; break; }
      }
      if (!dirt) noDirt.add(`${x},${z}`);
    }
  }
  for (const key of world.stairwells ?? []) noDirt.delete(key);
  // Group into 2x2 shafts by their top-left corner.
  const shafts = [];
  for (const key of noDirt) {
    const [x, z] = key.split(",").map(Number);
    if (noDirt.has(`${x + 1},${z}`) && noDirt.has(`${x},${z + 1}`) && noDirt.has(`${x + 1},${z + 1}`)) {
      shafts.push([x, z]);
    }
  }
  assert.ok(shafts.length >= 2 && shafts.length <= 3, `shafts: ${shafts.length}`);
  // Every no-dirt column belongs to a shaft: the surface is intact elsewhere.
  assert.equal(noDirt.size, shafts.length * 4, `no-dirt columns: ${noDirt.size} for ${shafts.length} shafts`);
  for (const [sx, sz] of shafts) {
    for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
      assert.ok(!isOld(sx + dx, sz + dz), `shaft in the original save area at ${sx + dx},${sz + dz}`);
      assert.ok(!inClearing(sx + dx, sz + dz), `shaft in the spawn clearing at ${sx + dx},${sz + dz}`);
      assert.equal(at(sx + dx, 0, sz + dz), BLOCK.STONE, `shaft cuts the bottom layer at ${sx + dx},${sz + dz}`);
    }
    // The floor is where the open column ends: walk down from the sky
    // while all four columns are air or leaf.  A neighbouring tree's
    // crown can overhang a shaft, and a leaf up there is not the floor —
    // the shaft's open column continues below it.
    let floor = -1;
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if ([0, 1].every(dx => [0, 1].every(dz => {
        const c = at(sx + dx, y, sz + dz);
        return c === BLOCK.AIR || c === BLOCK.LEAF;
      }))) floor = y;
      else break;
    }
    // The surface is the neighbours' ground top; the shaft must drop at
    // least three blocks from it to the floor.
    let surface = -1;
    for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 2; dz++) {
      if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue;
      for (let y = WORLD.height - 1; y >= 0; y--) {
        if (at(sx + dx, y, sz + dz) === BLOCK.DIRT) { surface = Math.max(surface, y + 1); break; }
      }
    }
    assert.ok(surface - floor >= 3, `shaft at ${sx},${sz}: depth ${surface - floor}`);
    // The floor opens into a cave: air continues sideways at the floor
    // or the level below it, outside the 2x2.
    let side = 0;
    for (const y of [floor, floor - 1]) {
      for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 2; dz++) {
        if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue;
        if (at(sx + dx, y, sz + dz) === BLOCK.AIR) side++;
      }
    }
    assert.ok(side >= 2, `shaft at ${sx},${sz}: sideways air at the floor: ${side}`);
  }
  // Determinism: the same shafts are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("surface gullies dip 1-2 blocks in the extension ring only", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  // A gully column is one whose highest dirt is exposed: the grass top
  // was dug away, so the cell above the dirt is air.  A normal column
  // has grass there, a hill summit has stone, a shaft column has no
  // dirt at all — so only gully floors read this way.  (A crown leaf
  // overhanging exactly at that level would read as a leaf, not air, so
  // a few dug columns hide from this detector; the worm digs 29 columns
  // per gully and the detector still finds all of them here.)
  const gully = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      let d = -1;
      for (let y = WORLD.height - 1; y >= 0; y--) {
        if (at(x, y, z) === BLOCK.DIRT) { d = y; break; }
      }
      if (d >= 0 && at(x, d + 1, z) === BLOCK.AIR) gully.add(`${x},${z}`);
    }
  }
  // Group into gullies.  The worm steps diagonally too, so the grouping
  // counts diagonal neighbours — a ribbon joined only at a corner is
  // still one gully.
  const seen = new Set();
  const comps = [];
  for (const key of gully) {
    if (seen.has(key)) continue;
    const cells = [];
    const stack = [key];
    while (stack.length) {
      const k = stack.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      cells.push(k);
      const [cx, cz] = k.split(",").map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nk = `${cx + dx},${cz + dz}`;
        if (gully.has(nk)) stack.push(nk);
      }
    }
    comps.push(cells);
  }
  assert.ok(comps.length >= 1 && comps.length <= 2, `gullies: ${comps.length}`);
  for (const cells of comps) {
    // A real gully, not a stub or a scattered pit: a decent length of
    // connected floor, spanning a good distance in at least one direction.
    assert.ok(cells.length >= 12 && cells.length <= 40, `gully size: ${cells.length}`);
    const pts = cells.map(k => k.split(",").map(Number));
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 1;
    assert.ok(span >= 8, `gully span: ${span}`);
    for (const [x, z] of pts) {
      assert.ok(!isOld(x, z), `gully in the original save area at ${x},${z}`);
      assert.ok(!inClearing(x, z), `gully in the spawn clearing at ${x},${z}`);
    }
    // The floor dips: each floor cell sits below the grass tops around
    // it.  The dip is measured against the highest neighbouring grass
    // top, so natural height variation adds noise — most cells dip 1-2
    // and none dips more than 3.
    const set = new Set(cells);
    let dips = 0, in12 = 0;
    for (const [x, z] of pts) {
      let floor = -1;
      for (let y = WORLD.height - 1; y >= 0; y--) {
        if (at(x, y, z) === BLOCK.DIRT) { floor = y; break; }
      }
      let nb = -1;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (set.has(`${x + dx},${z + dz}`)) continue;
        for (let y = WORLD.height - 1; y >= 0; y--) {
          if (at(x + dx, y, z + dz) === BLOCK.DIRT) { nb = Math.max(nb, y + 1); break; }
        }
      }
      if (nb < 0) continue;
      const dip = nb - floor;
      assert.ok(dip >= 1 && dip <= 3, `gully floor at ${x},${z} dips ${dip}`);
      dips++;
      if (dip === 1 || dip === 2) in12++;
    }
    assert.ok(dips > 0 && in12 / dips >= 2 / 3, `gully dips 1-2: ${in12}/${dips}`);
  }
  // Determinism: the same gullies are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("boulder piles stack 3-5 stones on grass in the extension ring only", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const groundTop = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // A boulder column is one with a stone sitting on the grass top.  Ruin
  // walls, pillars and fallen blocks are stone on grass too, so a pile
  // is only recognised by its whole shape: a footprint of 2-3 columns,
  // 3-5 stones in total, 1-2 of them stacked on top of a bottom stone —
  // and every stone plain.  Ruin stones all carry a moss or crack
  // variant, so a varianted cluster is a ruin, not a boulder.
  const cols = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const g = groundTop(x, z);
      if (g >= 0 && at(x, g + 1, z) === BLOCK.STONE) cols.add(`${x},${z}`);
    }
  }
  const seen = new Set();
  const boulders = [];
  for (const key of cols) {
    if (seen.has(key)) continue;
    const cells = [];
    const stack = [key];
    while (stack.length) {
      const k = stack.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      cells.push(k);
      const [cx, cz] = k.split(",").map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${cx + dx},${cz + dz}`;
        if (cols.has(nk)) stack.push(nk);
      }
    }
    let total = 0, tops = 0, allPlain = true;
    for (const k of cells) {
      const [x, z] = k.split(",").map(Number);
      const g = groundTop(x, z);
      let n = 0;
      for (let y = g + 1; y <= g + 2; y++) {
        if (at(x, y, z) === BLOCK.STONE) {
          n++;
          total++;
          if (world.variants[voxelIndex(WORLD, x, y, z)] !== 0) allPlain = false;
        }
      }
      if (n === 2) tops++;
      if (n > 2) allPlain = false;
    }
    if (cells.length >= 2 && cells.length <= 3 && total >= 3 && total <= 5
      && tops >= 1 && tops <= 2 && allPlain) {
      boulders.push(cells);
    }
  }
  assert.ok(boulders.length >= 1 && boulders.length <= 2, `boulder piles: ${boulders.length}`);
  for (const cells of boulders) {
    for (const k of cells) {
      const [x, z] = k.split(",").map(Number);
      assert.ok(!isOld(x, z), `boulder in the original save area at ${x},${z}`);
      assert.ok(!inClearing(x, z), `boulder in the spawn clearing at ${x},${z}`);
      const g = groundTop(x, z);
      // The pile sits on grass: it digs nothing, it only stacks on top.
      assert.equal(at(x, g, z), BLOCK.GRASS, `boulder at ${x},${z} sits on grass`);
      // A top stone sits directly above a bottom stone in the same column.
      if (at(x, g + 2, z) === BLOCK.STONE) {
        assert.equal(at(x, g + 1, z), BLOCK.STONE, `top stone at ${x},${z} floats`);
      }
    }
  }
  // Determinism: the same piles are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("flower fields are dense 5x5 patches in the extension ring only", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const groundTop = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // A flower is a leaf on the grass top carrying the flower variant.
  const flowers = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const g = groundTop(x, z);
      if (g >= 0 && at(x, g + 1, z) === BLOCK.LEAF
        && world.variants[voxelIndex(WORLD, x, g + 1, z)] === TILE.FLOWER) {
        flowers.add(`${x},${z}`);
      }
    }
  }
  // Count flowers in every 5x5 window.  An ordinary cluster is 2-3
  // flowers, and no ordinary 5x5 holds more than 6, so a window with
  // 10 or more is a field.
  const dense = [];
  for (let x0 = WORLD.minX; x0 <= WORLD.minX + WORLD.width - 5; x0++) {
    for (let z0 = WORLD.minZ; z0 <= WORLD.minZ + WORLD.depth - 5; z0++) {
      let n = 0;
      for (let x = x0; x < x0 + 5; x++) for (let z = z0; z < z0 + 5; z++) {
        if (flowers.has(`${x},${z}`)) n++;
      }
      if (n >= 10) dense.push([n, x0, z0]);
    }
  }
  // Merge windows that belong to one field: a window joins a field when
  // it is within 4 cells of any window already in that field, so a field
  // whose dense windows span the whole 5x5 patch still counts as one.
  // Two fields are at least 16 apart, so their windows can never chain.
  // Each field remembers its densest window: its centre stands in for
  // the field's centre when the two fields' spread is checked.
  const fields = [];
  for (const [n, x0, z0] of dense) {
    const field = fields.find(f => f.windows.some(([wx, wz]) =>
      Math.max(Math.abs(wx - x0), Math.abs(wz - z0)) <= 4));
    if (field) {
      field.windows.push([x0, z0]);
      if (n > field.n) { field.n = n; field.bx = x0; field.bz = z0; }
    } else {
      fields.push({ x: x0, z: z0, n, bx: x0, bz: z0, windows: [[x0, z0]] });
    }
  }
  assert.ok(fields.length >= 1 && fields.length <= 2, `flower fields: ${fields.length}`);
  if (fields.length === 2) {
    // The two fields are spread apart: their centres are at least 16
    // cells apart, and they sit in opposite quarters of the map (split
    // at the centre, x=16 and z=16), never bunched in one corner.
    const [a, b] = fields;
    const ac = [a.bx + 2, a.bz + 2], bc = [b.bx + 2, b.bz + 2];
    const gap = Math.max(Math.abs(ac[0] - bc[0]), Math.abs(ac[1] - bc[1]));
    assert.ok(gap >= 16, `field centres ${ac} and ${bc} are ${gap} apart`);
    assert.ok((ac[0] < 16) !== (bc[0] < 16) && (ac[1] < 16) !== (bc[1] < 16),
      `field centres ${ac} and ${bc} are in the same half of the map`);
  }
  for (const f of fields) {
    assert.ok(f.n >= 10, `field at ${f.x},${f.z} holds ${f.n} flowers in its 5x5`);
    // The field sits on grass in the extension ring: every flower in its
    // 5x5 grows on a grass top, none in the original save area or the
    // spawn clearing.
    for (let x = f.x; x < f.x + 5; x++) for (let z = f.z; z < f.z + 5; z++) {
      if (!flowers.has(`${x},${z}`)) continue;
      assert.ok(!isOld(x, z), `field flower in the original save area at ${x},${z}`);
      assert.ok(!inClearing(x, z), `field flower in the spawn clearing at ${x},${z}`);
      const g = groundTop(x, z);
      assert.equal(at(x, g, z), BLOCK.GRASS, `field flower at ${x},${z} sits on grass`);
    }
  }
  // Outside the fields, no 5x5 window is dense: the fields really are
  // denser than the ordinary scattered clusters.  A window counts as
  // outside only when it overlaps no dense window of any field.
  let ordinaryMax = 0;
  for (let x0 = WORLD.minX; x0 <= WORLD.minX + WORLD.width - 5; x0++) {
    for (let z0 = WORLD.minZ; z0 <= WORLD.minZ + WORLD.depth - 5; z0++) {
      if (fields.some(f => f.windows.some(([wx, wz]) =>
        Math.abs(wx - x0) < 5 && Math.abs(wz - z0) < 5))) continue;
      let n = 0;
      for (let x = x0; x < x0 + 5; x++) for (let z = z0; z < z0 + 5; z++) {
        if (flowers.has(`${x},${z}`)) n++;
      }
      ordinaryMax = Math.max(ordinaryMax, n);
    }
  }
  assert.ok(ordinaryMax <= 7, `densest ordinary 5x5: ${ordinaryMax}`);
  // Determinism: the same fields are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("the snowfield grows a dense conifer forest; the grassland is unchanged", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const topGround = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (world[voxelIndex(WORLD, x, y, z)] === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  // Trees are located by the placement contract, with the snowfield's
  // own thresholds (lower ground, more often), and classified by the
  // variant rule including the snowfield's pine override.  Trunk heights
  // come from the rule, not from measuring the column, for the same
  // reason as the pine/willow test: neighbouring crowns overwrite
  // trunk cells with leaves.
  const trees = { snow: [], grass: [], sand: [], legacy: [] };
  for (let x = WORLD.minX + 3; x < WORLD.minX + WORLD.width - 3; x++) {
    for (let z = WORLD.minZ + 3; z < WORLD.minZ + WORLD.depth - 3; z++) {
      const snow = !isOld(x, z) && biomeAt(x, z) === "snow";
      const minTop = snow ? 3 : 5;
      const seedCut = snow ? .85 : .945;
      const top = topGround(x, z);
      if (top <= minTop || inClearing(x, z)) continue;
      if (!(seeded(x, z) > seedCut) || !(seeded(x - 1, z + 2) > .42)) continue;
      let wood = false;
      for (let y = top + 1; y < WORLD.height; y++) {
        if (at(x, y, z) === BLOCK.WOOD) { wood = true; break; }
      }
      if (!wood) continue;
      const oldVariant = Math.floor(seeded(x + 101, z - 57) * 3);
      let variant = oldVariant;
      if (!isOld(x, z) && biomeAt(x, z) === "snow") {
        variant = 3;
      } else if (!isOld(x, z) && oldVariant === 0 && seeded(x + 201, z - 77) < .8) {
        variant = seeded(x + 301, z + 41) < .5 ? 3 : 4;
      } else if (!isOld(x, z) && oldVariant === 2 && seeded(x + 401, z - 91) < .5) {
        variant = 4;
      }
      const trunk = variant === 1 ? 5 + Math.floor(seeded(x + 13, z + 29) * 2)
        : variant === 2 ? 2
        : variant === 3 ? 6 + Math.floor(seeded(x + 13, z + 29) * 2)
        : variant === 4 ? 4
        : 3 + Math.floor(seeded(x + 31, z - 17) * 2);
      const bucket = isOld(x, z) ? "legacy" : biomeAt(x, z);
      trees[bucket].push({ x, z, base: top + 1, trunk, variant });
    }
  }
  // Area of each biome in the ring, for density.
  const area = { snow: 0, grass: 0, sand: 0 };
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      if (isOld(x, z) || inClearing(x, z)) continue;
      area[biomeAt(x, z)]++;
    }
  }
  const snow = trees.snow, grass = trees.grass;
  const snowPines = snow.filter(t => t.variant === 3).length;
  assert.ok(snow.length >= 10, `snow trees: ${snow.length}`);
  assert.equal(snowPines, snow.length, `snow pines: ${snowPines}/${snow.length}`);
  // The snowfield is about twice as wooded as the grassland, per column.
  const snowDensity = snow.length / area.snow;
  const grassDensity = grass.length / area.grass;
  assert.ok(snowDensity >= grassDensity * 1.8,
    `snow density ${snowDensity.toFixed(3)} vs grass ${grassDensity.toFixed(3)}`);
  // The grassland keeps its lowland trees: the same pines as before,
  // one fewer willow, and four fewer trees in total — the four that
  // stood on ground higher than 8, which the treeline task removed.
  assert.equal(grass.length, 22, `grass trees: ${grass.length}`);
  assert.equal(grass.filter(t => t.variant === 3).length, 5, `grass pines: ${grass.filter(t => t.variant === 3).length}`);
  assert.equal(grass.filter(t => t.variant === 4).length, 6, `grass willows: ${grass.filter(t => t.variant === 4).length}`);
  // The original save area keeps its nine trees.
  assert.equal(trees.legacy.length, 9, `legacy trees: ${trees.legacy.length}`);
  // Snow pines really are pines: a 6-7 trunk with a four-layer cone, the
  // same presence-only shape checks as the pine/willow test.
  for (const p of snow.filter(t => t.variant === 3)) {
    const crownY = p.base + p.trunk - 2;
    const card2 = [[2, 0], [-2, 0], [0, 2], [0, -2]]
      .filter(([dx, dz]) => at(p.x + dx, crownY, p.z + dz) === BLOCK.LEAF).length;
    assert.ok(card2 >= 3, `snow pine at ${p.x},${p.z}: radius-2 crown bottom leaves: ${card2}`);
    assert.equal(at(p.x, crownY + 3, p.z), BLOCK.LEAF, `snow pine at ${p.x},${p.z}: single tip`);
    const plus = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
      .filter(([dx, dz]) => at(p.x + dx, crownY + 2, p.z + dz) === BLOCK.LEAF).length;
    assert.ok(plus >= 3, `snow pine at ${p.x},${p.z}: plus layer below the tip: ${plus}`);
  }
  // Determinism: the same trees are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("dead trees cluster around ruins; ordinary ground is unchanged", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const groundTop = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // A ruin column carries a mossy or cracked stone on its grass top.
  // Rubble and boulders are plain stone, so they are not ruins.
  const ruinCols = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const g = groundTop(x, z);
      if (g < 0) continue;
      const i = voxelIndex(WORLD, x, g + 1, z);
      if (at(x, g + 1, z) === BLOCK.STONE
        && (world.variants[i] === TILE.MOSS_STONE || world.variants[i] === TILE.CRACK_STONE)) {
        ruinCols.add(`${x},${z}`);
      }
    }
  }
  const nearRuin = (x, z) => {
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (ruinCols.has(`${x + dx},${z + dz}`)) return true;
    }
    return false;
  };
  // Dead trees: a 2-4 tall wood trunk with no leaf anywhere in its column
  // and a side branch, the same detector as the ruins test.
  const dead = [];
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const top = groundTop(x, z);
      if (top < 0) continue;
      let woodHeight = 0;
      for (let y = top + 1; y < WORLD.height && at(x, y, z) === BLOCK.WOOD; y++) woodHeight++;
      if (woodHeight < 2 || woodHeight > 4) continue;
      let leaf = false;
      for (let y = top + 1; y < WORLD.height; y++) {
        if (at(x, y, z) === BLOCK.LEAF) leaf = true;
      }
      if (leaf) continue;
      const branchHeight = top + woodHeight;
      const branch = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) =>
        at(x + dx, branchHeight, z + dz) === BLOCK.WOOD || at(x + dx, branchHeight - 1, z + dz) === BLOCK.WOOD);
      if (!branch) continue;
      dead.push([x, z]);
    }
  }
  let nearDead = 0, ordDead = 0, legacyDead = 0;
  for (const [x, z] of dead) {
    if (isOld(x, z)) legacyDead++;
    else if (inClearing(x, z)) continue;
    else if (nearRuin(x, z)) nearDead++;
    else ordDead++;
  }
  // Areas: ring columns a dead tree could grow on (grass top, air above).
  let nearArea = 0, ordArea = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      if (isOld(x, z) || inClearing(x, z)) continue;
      const g = groundTop(x, z);
      if (g < 0 || at(x, g, z) !== BLOCK.GRASS || at(x, g + 1, z) !== BLOCK.AIR) continue;
      if (nearRuin(x, z)) nearArea++;
      else ordArea++;
    }
  }
  const nearDensity = nearDead / nearArea;
  const ordDensity = ordDead / ordArea;
  // Around ruins dead trees grow three times as often as on ordinary
  // ground.
  assert.ok(nearDensity >= ordDensity * 2.5,
    `dead-tree density near ruins ${nearDensity.toFixed(3)} vs ordinary ${ordDensity.toFixed(3)}`);
  assert.ok(nearDead >= 22, `dead trees near ruins: ${nearDead}`);
  // Ordinary ground keeps the dead trees it had: the same count as
  // before this task.
  assert.ok(ordDead >= 10 && ordDead <= 18, `dead trees on ordinary ground: ${ordDead}`);
  assert.equal(legacyDead, 0, "no dead trees inside the original save area");
  // Determinism: the same dead trees are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("hilltops above 8 grow no trees; the lowland keeps its trees", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const groundTop = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // Locate the live trees with the placement contract (the same gates
  // the generator uses): a wood trunk above the ground top, on ground
  // the seeds accept.  A physical wood-and-leaf scan is not enough
  // here: a dead tree under a neighbour's crown overhang reads as a
  // live tree, and one such dead trunk stands on ground higher than 8.
  const trees = [];
  for (let x = WORLD.minX + 3; x < WORLD.minX + WORLD.width - 3; x++) {
    for (let z = WORLD.minZ + 3; z < WORLD.minZ + WORLD.depth - 3; z++) {
      const top = groundTop(x, z);
      if (top < 0) continue;
      const onOld = isOld(x, z);
      if (onOld && (x < 3 || x > 28 || z < 3 || z > 28)) continue;
      const snow = !onOld && biomeAt(x, z) === "snow";
      const minTop = snow ? 3 : 5;
      if (top <= minTop) continue;
      if (seeded(x, z) <= (snow ? .85 : .945)) continue;
      if (seeded(x - 1, z + 2) <= .42) continue;
      let wood = false;
      for (let y = top + 1; y < WORLD.height; y++) {
        if (at(x, y, z) === BLOCK.WOOD) { wood = true; break; }
      }
      if (!wood) continue;
      trees.push({ x, z, top, onOld });
    }
  }
  // No tree stands on ground higher than 8: the hills keep a bare top.
  const high = trees.filter(t => t.top > 8);
  assert.equal(high.length, 0, `trees on ground higher than 8: ${high.map(t => `(${t.x},${t.z},h${t.top})`).join(" ")}`);
  // The lowland keeps exactly the trees it had: 51 in total, nine of
  // them in the original save area.
  assert.equal(trees.length, 51, `trees on ground 8 or lower: ${trees.length}`);
  assert.equal(trees.filter(t => t.onOld).length, 9, `legacy trees: ${trees.filter(t => t.onOld).length}`);
  // None of the high ground is wooded at all: no live trunk stands on
  // any of the 359 columns whose final ground top is above 8.
  let highCols = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      if (isOld(x, z) || inClearing(x, z)) continue;
      if (groundTop(x, z) > 8) highCols++;
    }
  }
  assert.ok(highCols > 100, `columns with ground above 8: ${highCols}`);
  // Determinism: the same trees are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("hill summits carry a wider bare-stone band; the lowland is untouched", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const ground = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // The same raised-column detector as the hills test: a column is
  // raised when its ground top sits above a buried grass block.
  let raised = 0, stoneTops = 0, legacyStone = 0, lowGrass = 0;
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const g = ground(x, z);
      if (g < 0) continue;
      let buried = -1;
      for (let y = g - 1; y >= 0; y--) {
        if (at(x, y, z) === BLOCK.GRASS) { buried = y; break; }
      }
      if (buried >= 0 && g - buried >= 1) {
        raised++;
        if (at(x, g, z) === BLOCK.STONE) {
          stoneTops++;
          if (isOld(x, z)) legacyStone++;
        }
      } else if (!isOld(x, z) && !inClearing(x, z) && at(x, g, z) === BLOCK.GRASS) {
        lowGrass++;
      }
    }
  }
  // The bare-stone band is wider than before: 45 summits carried stone
  // when only the peak column was bare; now the ring one step out from
  // the peak is bare too.
  assert.ok(stoneTops >= 100, `bare-stone summits: ${stoneTops}`);
  // The hills themselves did not grow: the same raised columns, and the
  // lowland grass around them is untouched.
  assert.ok(raised > 100 && raised < 300, `raised hill columns: ${raised}`);
  assert.ok(lowGrass >= 2750 && lowGrass <= 2850, `lowland grass columns: ${lowGrass}`);
  assert.equal(legacyStone, 0, "no bare-stone summit inside the original save area");
  // Determinism: the same summits are bare in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("one 5x5 desert oasis grows green grass and one or two trees", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const groundTop = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // The oasis is the twenty-five grass cells carrying the OASIS variant.
  // A cell is found by its visible top — the highest grass block — since
  // a hill can raise a column by one and bury the dirt-level grass.
  const cells = [];
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      let g = -1;
      for (let y = WORLD.height - 1; y >= 0; y--) {
        if (at(x, y, z) === BLOCK.GRASS) { g = y; break; }
      }
      if (g >= 0 && world.variants[voxelIndex(WORLD, x, g, z)] === TILE.OASIS) cells.push([x, z]);
    }
  }
  assert.equal(cells.length, 25, `oasis grass cells: ${cells.length}`);
  const xs = cells.map(c => c[0]), zs = cells.map(c => c[1]);
  const ox = Math.min(...xs), oz = Math.min(...zs);
  assert.equal(Math.max(...xs) - ox, 4, "oasis spans five columns");
  assert.equal(Math.max(...zs) - oz, 4, "oasis spans five rows");
  for (let x = ox; x < ox + 5; x++) for (let z = oz; z < oz + 5; z++) {
    assert.ok(cells.some(c => c[0] === x && c[1] === z), `oasis is missing its cell at ${x},${z}`);
    assert.equal(biomeAt(x, z), "sand", `oasis cell ${x},${z} is not in the desert`);
    assert.ok(!isOld(x, z), `oasis cell ${x},${z} is inside the original save area`);
    assert.ok(!inClearing(x, z), `oasis cell ${x},${z} is inside the spawn clearing`);
  }
  // One or two trees grow on the oasis: a wood trunk of two or more
  // blocks above an oasis cell, with leaves above it.  The trees are
  // the same two as before the expansion — the outer ring adds grass,
  // not trees — and they stand on the inner 3x3.
  let trees = 0;
  const treeCells = [];
  for (const [x, z] of cells) {
    const g = groundTop(x, z);
    let wood = 0;
    for (let y = g + 1; y < WORLD.height && at(x, y, z) === BLOCK.WOOD; y++) wood++;
    if (wood < 2) continue;
    let leaf = false;
    for (let y = g + 1; y < WORLD.height; y++) {
      if (at(x, y, z) === BLOCK.LEAF) leaf = true;
    }
    if (leaf) { trees++; treeCells.push(`${x},${z}`); }
  }
  assert.ok(trees >= 1 && trees <= 2, `oasis trees: ${trees}`);
  assert.deepEqual(treeCells.sort(), ["-8,8", "-9,7"], `oasis tree positions: ${treeCells}`);
  // The oasis tops really are green in the mesh, not sand-coloured:
  // a top face's green channel is its largest, the way grass reads.
  // Each chunk covering the oasis is meshed once, and each green top
  // face is credited to the cell it belongs to, so no face is counted
  // twice where the 5x5 straddles a chunk border.
  const ids = { grass: BLOCK.GRASS, dirt: BLOCK.DIRT, stone: BLOCK.STONE, wood: BLOCK.WOOD, leaf: BLOCK.LEAF };
  const colors = Array.from({ length: 6 }, () => [.4, .5, .3]);
  const grid = createChunkGrid(WORLD);
  const get = (x, y, z) => world[voxelIndex(WORLD, x, y, z)];
  const getVariant = (x, y, z) => world.variants[voxelIndex(WORLD, x, y, z)];
  const oasisSet = new Set(cells.map(([x, z]) => `${x},${z}`));
  const chunkKeys = new Set(cells.map(([x, z]) => `${grid.at(x, z).minX},${grid.at(x, z).minZ}`));
  const greenCells = new Set();
  for (const key of chunkKeys) {
    const [cx, cz] = key.split(",").map(Number);
    const mesh = buildChunkMesh(WORLD, grid.at(cx, cz), get, colors, ids, getVariant);
    for (let i = 0; i < mesh.vertices.length; i += 48) {
      const d = [mesh.vertices[i + 6], mesh.vertices[i + 7], mesh.vertices[i + 8]];
      if (d[1] !== 1) continue;
      const xs = [0, 1, 2, 3].map(k => mesh.vertices[i + k * 12]);
      const ys = [0, 1, 2, 3].map(k => mesh.vertices[i + k * 12 + 1]);
      const zs = [0, 1, 2, 3].map(k => mesh.vertices[i + k * 12 + 2]);
      const cell = `${Math.min(...xs)},${Math.min(...zs)}`;
      if (!oasisSet.has(cell)) continue;
      const r = mesh.vertices[i + 3], gg = mesh.vertices[i + 4], b = mesh.vertices[i + 5];
      if (gg > r && gg / r > 1.1) greenCells.add(cell);
    }
  }
  assert.equal(greenCells.size, 25, `oasis grass tops that render green: ${greenCells.size}`);
  // Determinism: the same oasis is found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("every shaft mouth wears a four-stone ring that leaves the mouth open", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const groundTop = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // Shafts are the 2x2 blocks with no dirt in any column (the shaft
  // cut the dirt away); the same detector as the shaft test.
  const shafts = [];
  for (let x = WORLD.minX; x + 1 < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z + 1 < WORLD.minZ + WORLD.depth; z++) {
      let noDirt = true;
      for (let dx = 0; dx <= 1 && noDirt; dx++) for (let dz = 0; dz <= 1; dz++) {
        for (let y = 0; y < WORLD.height; y++) {
          if (at(x + dx, y, z + dz) === BLOCK.DIRT) { noDirt = false; break; }
        }
      }
      if (noDirt) shafts.push([x, z]);
    }
  }
  assert.equal(shafts.length, 3, `shafts: ${shafts.length}`);
  for (const [sx, sz] of shafts) {
    // The ring: plain stones sitting on the grass top, in the 4x4 frame
    // around the 2x2 mouth but never inside it.
    const stones = [];
    for (let x = sx - 1; x <= sx + 2; x++) {
      for (let z = sz - 1; z <= sz + 2; z++) {
        if (x >= sx && x <= sx + 1 && z >= sz && z <= sz + 1) continue;
        const g = groundTop(x, z);
        if (g >= 0 && at(x, g + 1, z) === BLOCK.STONE
          && world.variants[voxelIndex(WORLD, x, g + 1, z)] === 0) stones.push([x, z]);
        assert.ok(!isOld(x, z) || at(x, groundTop(x, z) + 1, z) !== BLOCK.STONE,
          `ring stone at ${x},${z} is inside the original save area`);
        assert.ok(!inClearing(x, z) || at(x, groundTop(x, z) + 1, z) !== BLOCK.STONE,
          `ring stone at ${x},${z} is inside the spawn clearing`);
      }
    }
    assert.equal(stones.length, 4, `ring stones around shaft (${sx},${sz}): ${stones.length}`);
    // The mouth is open: every shaft column is air at the level the
    // ring stones sit at and just below it, so no stone caps or blocks
    // the entrance.  A crown leaf overhanging higher up is fine — it
    // hangs above the entrance, held by its own trunk.
    const stoneLevel = Math.min(...stones.map(([x, z]) => groundTop(x, z) + 1));
    for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) {
      for (let y = stoneLevel; y >= stoneLevel - 2; y--) {
        assert.equal(at(sx + dx, y, sz + dz), BLOCK.AIR,
          `shaft column (${sx + dx},${sz + dz}) is blocked at ${y}, ring sits at ${stoneLevel}`);
      }
    }
  }
  // Determinism: the same rings are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});

test("flower clusters grow thicker on the grass within two cells of a gully edge", () => {
  const world = generateTerrain(WORLD, BLOCK);
  const at = (x, y, z) => (x < WORLD.minX || x >= WORLD.minX + WORLD.width || z < WORLD.minZ || z >= WORLD.minZ + WORLD.depth
    || y < 0 || y >= WORLD.height) ? -1 : world[voxelIndex(WORLD, x, y, z)];
  const isOld = (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32;
  const inClearing = (x, z) => x >= 14 && x <= 18 && z >= 14 && z <= 18;
  const inWorld = (x, z) => x >= WORLD.minX && x < WORLD.minX + WORLD.width && z >= WORLD.minZ && z < WORLD.minZ + WORLD.depth;
  const groundTop = (x, z) => {
    for (let y = WORLD.height - 1; y >= 0; y--) {
      if (at(x, y, z) === BLOCK.DIRT) return y + 1;
    }
    return -1;
  };
  // Gully columns are the exposed dirt floors: the highest dirt has air
  // above it.  Grouped into 8-connected components, the gullies are the
  // components of eight or more — the same detector as the gully test.
  const exposed = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const g = groundTop(x, z);
      if (g >= 0 && at(x, g, z) === BLOCK.AIR) exposed.add(`${x},${z}`);
    }
  }
  const gullyCols = new Set();
  const seenE = new Set();
  for (const key of exposed) {
    if (seenE.has(key)) continue;
    const cells = [];
    const stack = [key];
    while (stack.length) {
      const k = stack.pop();
      if (seenE.has(k)) continue;
      seenE.add(k);
      cells.push(k);
      const [cx, cz] = k.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const nk = `${cx + dx},${cz + dz}`;
        if (exposed.has(nk)) stack.push(nk);
      }
    }
    if (cells.length >= 8) for (const k of cells) gullyCols.add(k);
  }
  assert.ok(gullyCols.size >= 40, `gully floor columns: ${gullyCols.size}`);
  // Flower clusters are the FLOWER-variant leaves at ground level,
  // grouped into 2-3 connected cells with no trunk nearby — the same
  // detector as the flower test.
  const nearWood = (x, z, g) => {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const nx = x + dx, nz = z + dz;
      if (!inWorld(nx, nz)) continue;
      for (let y = g + 1; y <= g + 5; y++) {
        if (at(nx, y, nz) === BLOCK.WOOD) return true;
      }
    }
    return false;
  };
  const level = new Set();
  for (let x = WORLD.minX; x < WORLD.minX + WORLD.width; x++) {
    for (let z = WORLD.minZ; z < WORLD.minZ + WORLD.depth; z++) {
      const g = groundTop(x, z);
      if (g < 0 || at(x, g, z) !== BLOCK.GRASS) continue;
      if (at(x, g + 1, z) === BLOCK.LEAF
        && world.variants[voxelIndex(WORLD, x, g + 1, z)] === TILE.FLOWER) level.add(`${x},${z}`);
    }
  }
  const seenF = new Set();
  let nearGully = 0, elsewhere = 0, inOld = 0;
  for (const key of level) {
    if (seenF.has(key)) continue;
    const cells = [];
    const stack = [key];
    while (stack.length) {
      const k = stack.pop();
      if (seenF.has(k)) continue;
      seenF.add(k);
      cells.push(k);
      const [cx, cz] = k.split(",").map(Number);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${cx + dx},${cz + dz}`;
        if (level.has(nk)) stack.push(nk);
      }
    }
    if (cells.length < 2 || cells.length > 3) continue;
    let wood = false, old = false;
    for (const k of cells) {
      const [x, z] = k.split(",").map(Number);
      if (nearWood(x, z, groundTop(x, z))) wood = true;
      if (isOld(x, z)) old = true;
    }
    if (wood) continue;
    if (old) inOld++;
    let near = false;
    for (const k of cells) {
      const [x, z] = k.split(",").map(Number);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (gullyCols.has(`${x + dx},${z + dz}`)) { near = true; break; }
      }
      if (near) break;
    }
    if (near) nearGully++;
    else elsewhere++;
  }
  // Before this task only one flower cluster stood within two cells of
  // a gully edge; the edge is now thick with them.
  assert.ok(nearGully >= 4, `flower clusters within two cells of a gully edge: ${nearGully}`);
  // The rest of the map keeps exactly the flowers it already had.
  assert.equal(elsewhere, 17, `flower clusters away from gullies: ${elsewhere}`);
  assert.equal(inOld, 0, "no flower cluster inside the original save area");
  // Determinism: the same edge flowers are found in a second generation.
  const again = generateTerrain(WORLD, BLOCK);
  assert.deepEqual(again, world);
});
