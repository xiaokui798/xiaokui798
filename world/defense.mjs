import { ENEMIES, validateEnemies, assertValidEnemies } from "./enemies.mjs";
export { ENEMIES, validateEnemies, assertValidEnemies };
import { DEFENSE_WAVES, BEACON, validateWaves, assertValidWaves } from "./waves.mjs";
export { DEFENSE_WAVES, BEACON, validateWaves, assertValidWaves };
import { SURVIVAL_DIFFICULTY, validateDifficulty, assertValidDifficulty } from "./difficulty.mjs";
export { SURVIVAL_DIFFICULTY, validateDifficulty, assertValidDifficulty };

// Defense runs past the five configured waves: waves 6-8 repeat the
// final wave (see defenseWaveRoster), and clearing wave 8 wins.
export const DEFENSE_TOTAL_WAVES = 8;

export function choosesBeacon(kind, hasBeacon, distanceToPlayer, playerReachable, beaconReachable) {
  if (!hasBeacon) return false;
  if (kind === "breaker") return beaconReachable || !playerReachable;
  if (!playerReachable && beaconReachable) return true;
  return kind === "runner" && distanceToPlayer > 5.5 && beaconReachable;
}

// The roster a defense wave actually spawns: the configured roster from
// waves.mjs, except the later waves gain one spitter, so the beacon
// faces ranged pressure from wave 4 on without rebalancing the first
// three waves. Returns a copy — the configured roster is never mutated.
export function defenseWaveRoster(waveIndex) {
  if (!Number.isInteger(waveIndex) || waveIndex < 0) return [];
  // Past the configured waves the final wave repeats, so the ramp stays
  // defined for any wave number.
  const wave = DEFENSE_WAVES[waveIndex] ?? DEFENSE_WAVES[DEFENSE_WAVES.length - 1];
  // The spitter count ramps with the wave number (1-based): none before
  // wave 4, one on waves 4-5, two from wave 6 on.
  const spitters = waveIndex >= 5 ? 2 : waveIndex >= 3 ? 1 : 0;
  return [...wave.enemies, ...Array(spitters).fill("spitter")];
}

export function selectWaveSpawns(roster, candidates, alternateSides) {
  for (const spacing of [2, 1]) {
    const selected = [];
    for (const [i, kind] of roster.entries()) {
      const hasSpace = ({ x, z }) => selected.every(spawn => (spawn.x - x) ** 2 + (spawn.z - z) ** 2 >= spacing ** 2);
      const preferred = alternateSides && candidates.find(entry => entry.side === (i % 2 === 0) && hasSpace(entry));
      const spawn = preferred || candidates.find(hasSpace);
      if (!spawn) break;
      selected.push({ ...spawn, kind });
    }
    if (selected.length === roster.length) return selected;
  }
  return [];
}

export function repairPlan(hp, stone) {
  if (hp >= BEACON.hp) return { reason: "full" };
  if (stone < BEACON.repairCost) return { reason: "materials" };
  return { cost: BEACON.repairCost, restored: Math.min(BEACON.repairedHp, BEACON.hp - hp) };
}

// The single defense-victory predicate, shared by both victory paths:
// the per-frame defenseResult below, and the clear-wave gate in game.js
// (attack(), on the last kill — wired up separately, it still uses its
// own inline check until the visual group closes 验收 1 and HQ clears
// the game.js change). Both call sites must pass the alive count —
// zombies still in their 0.5s death sink do not count — so victory keeps
// the gate's timing instead of waiting for the sink to empty the array.
// `wave >= TOTAL`, not `==`: a wave past eight still clears instead of
// marching on to a ninth wave nobody configured.
export function defenseCleared(wave, alive) {
  return alive === 0 && wave >= DEFENSE_TOTAL_WAVES;
}

export function defenseResult(wave, remaining, beaconHp, playerHp, seconds) {
  if (beaconHp <= 0) return "beacon-destroyed";
  if (playerHp <= 0) return "player-down";
  if (defenseCleared(wave, remaining)) return "cleared";
  if (remaining > 0 && seconds <= 0) return "timeout";
  return "playing";
}

function rayBox(origin, direction, min, max) {
  let near = 0, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < .00001) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return Infinity;
      continue;
    }
    const a = (min[axis] - origin[axis]) / direction[axis], b = (max[axis] - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return Infinity;
  }
  return near;
}

export function actorRay(origin, direction, actor, angle, width = 1, height = 1) {
  const s = Math.sin(angle), c = Math.cos(angle);
  const x = origin[0] - actor.x, z = origin[2] - actor.z;
  const localOrigin = [(x * c - z * s) / width, (origin[1] - actor.y) / height, (x * s + z * c) / width];
  const localDirection = [(direction[0] * c - direction[2] * s) / width, direction[1] / height,
    (direction[0] * s + direction[2] * c) / width];
  return (x, y, z, w, h, d) => rayBox(localOrigin, localDirection, [x, y, z], [x + w, y + h, z + d]);
}

export function zombieParts(zombie, style, part) {
  const pace = Math.sin(zombie.walk) * .11;
  const raised = zombie.windup > 0 ? .18 : zombie.cooldown > style.cooldown - .15 ? .08 : 0;
  part(-.26, .48, -.15, .52, .70, .30, ...style.coat);
  part(-.23, 1.16, -.19, .46, .48, .38, ...style.skin);
  part(-.15, 1.40, .191, .084, .068, .019, ...style.eyes);
  part(.066, 1.40, .191, .084, .068, .019, ...style.eyes);
  part(-.43, .72 + raised, -.04 + pace, .19, .38, .49, ...style.skin);
  part(.24, .72 + raised, -.04 - pace, .19, .38, .49, ...style.skin);
  part(-.23, .02 + Math.max(pace, 0), -.13 + pace, .20, .50, .27, .28, .23, .18);
  part(.03, .02 + Math.max(-pace, 0), -.13 - pace, .20, .50, .27, .28, .23, .18);
  if (style.armor) {
    part(-.31, .98, -.2, .62, .22, .4, .53, .49, .38);
    part(-.25, 1.6, -.20, .50, .14, .40, .59, .54, .42);
  }
}

export function beaconParts(beacon, elapsed, fixed, rotating) {
  const pulse = beacon.hp > 0 ? .76 + Math.sin(elapsed * 4) * .12 : .24;
  fixed(-.42, 0, -.42, .84, .19, .84, .31, .37, .36);
  fixed(-.33, .19, -.33, .66, .22, .66, .41, .38, .27);
  fixed(-.13, .41, -.13, .26, .87, .26, .39, .45, .43);
  fixed(-.34, .90, -.17, .13, .41, .34, .51, .48, .33);
  fixed(.21, .90, -.17, .13, .41, .34, .51, .48, .33);
  fixed(-.28, 1.26, -.28, .56, .13, .56, .33, .39, .37);
  rotating(-.16, 1.39, -.16, .32, .34, .32, .38 * pulse, .98 * pulse, .92 * pulse);
  rotating(-.075, 1.73, -.075, .15, .19, .15, .74 * pulse, pulse, .93 * pulse);
}

export function findMeleeTarget(origin, direction, nearest, zombies, beacon, elapsed) {
  let aim = null;
  if (beacon && zombies.length) {
    const fixed = actorRay(origin, direction, beacon, 0);
    const rotating = actorRay(origin, direction, beacon, elapsed * .82);
    beaconParts(beacon, elapsed, (...part) => { nearest = Math.min(nearest, fixed(...part)); },
      (...part) => { nearest = Math.min(nearest, rotating(...part)); });
  }
  for (const zombie of zombies) {
    if (zombie.dying !== undefined) continue;
    const profile = ENEMIES[zombie.kind] ?? ENEMIES.walker;
    const hit = actorRay(origin, direction, zombie, zombie.angle, profile.width, profile.height);
    let distance = nearest;
    zombieParts(zombie, profile, (...part) => { distance = Math.min(distance, hit(...part)); });
    if (distance >= nearest) continue;
    nearest = distance;
    aim = { zombie, distance };
  }
  return aim;
}
