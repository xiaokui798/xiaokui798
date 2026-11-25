import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK } from "./progression.mjs";
import { WORLD, LEGACY_WORLD, contains, voxelIndex, voxelPosition, generateTerrain, createChunkGrid, buildChunkMesh } from "./terrain.mjs";

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
  assert.equal(exposed.vertices.length, 6 * 4 * 10);
  assert.equal(mesh(-1, 4).indices.length, 0);
});
