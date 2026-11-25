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
  const { minX, minZ } = layout;
  const maxX = minX + layout.width, maxZ = minZ + layout.depth;
  const isOldMap = (x, z) => contains(LEGACY_WORLD, x, 0, z);
  function write(x, y, z, block) {
    if (contains(layout, x, y, z)) world[voxelIndex(layout, x, y, z)] = block;
  }
  function makeTree(x, y, z, onOldMap) {
    const trunk = 3 + Math.floor(seeded(x + 31, z - 17) * 2);
    for (let dy = 0; dy < trunk; dy++) write(x, y + dy, z, WOOD);
    const crownY = y + trunk - 2;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 3; dy++) {
      const radius = dy === 3 ? 1 : 2;
      if (dx === 0 && dz === 0 && dy < 2) continue;
      if (Math.abs(dx) + Math.abs(dz) > radius + (dy === 0 ? 1 : 0)) continue;
      // Extension trees must not change blocks in the original save area.
      if (!onOldMap && isOldMap(x + dx, z + dz)) continue;
      write(x + dx, crownY + dy, z + dz, LEAF);
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
    if (top > 5 && seeded(x, z) > .945 && seeded(x - 1, z + 2) > .42) makeTree(x, top + 1, z, onOldMap);
  }
  const top = terrainHeight(16, 16);
  for (let x = 14; x <= 18; x++) for (let z = 14; z <= 18; z++) {
    if (!contains(layout, x, 0, z)) continue;
    for (let y = top + 1; y < layout.height; y++) {
      const cell = voxelIndex(layout, x, y, z);
      if (world[cell] === LEAF || world[cell] === WOOD) world[cell] = AIR;
    }
  }
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

export function buildChunkMesh(layout, chunk, getBlock, colors, { grass, leaf }) {
  const vertices = [], indices = [];
  for (let x = chunk.minX; x < chunk.maxX; x++) for (let z = chunk.minZ; z < chunk.maxZ; z++) {
    for (let y = 0; y < layout.height; y++) {
      const type = getBlock(x, y, z);
      if (!type) continue;
      const color = colors[type];
      for (const { d, v, light } of FACES) {
        const nx = x + d[0], ny = y + d[1], nz = z + d[2];
        if (contains(layout, nx, ny, nz) && getBlock(nx, ny, nz)) continue;
        const base = vertices.length / 10;
        const shade = light * (type === leaf ? .92 : 1);
        const grassSide = type === grass && d[1] === 0 ? light : 0;
        for (const corner of v) vertices.push(x + corner[0], y + corner[1], z + corner[2],
          color[0] * shade, color[1] * shade, color[2] * shade, d[0], d[1], d[2], grassSide);
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
