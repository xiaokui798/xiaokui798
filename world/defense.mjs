export const ENEMIES = Object.freeze({
  walker: { name: "游荡者", hp: 70, speed: 1.52, reach: 1.18, damage: 12, strikeDelay: .32, cooldown: 1.28,
    width: 1, height: 1, armor: false, coat: [.24, .31, .36], skin: [.54, .57, .40], eyes: [.96, .59, .21] },
  runner: { name: "突袭者", hp: 43, speed: 2.52, reach: 1.14, damage: 8, strikeDelay: .18, cooldown: .94,
    width: .8, height: .86, armor: false, coat: [.36, .26, .27], skin: [.58, .46, .40], eyes: [.91, .34, .20] },
  breaker: { name: "破城者", hp: 155, speed: 1.13, reach: 1.44, damage: 22, strikeDelay: .70, cooldown: 1.55,
    width: 1.20, height: 1.13, armor: true, coat: [.28, .27, .26], skin: [.55, .55, .50], eyes: [.89, .40, .14] }
});

export const DEFENSE_WAVES = Object.freeze([
  { name: "前哨接触", enemies: ["walker", "runner"], seconds: 65 },
  { name: "快速突袭", enemies: ["runner", "runner", "walker"], seconds: 70 },
  { name: "重型来袭", enemies: ["breaker", "walker", "runner"], seconds: 77 },
  { name: "两面夹击", enemies: ["breaker", "runner", "runner", "walker", "walker"], seconds: 83 },
  { name: "黎明前的攻势", enemies: ["breaker", "breaker", "runner", "runner", "walker", "walker"], seconds: 92 }
]);

export const BEACON = Object.freeze({ hp: 120, radius: .43, height: 1.93, repairRange: 3.1, repairCost: 3, repairedHp: 30 });

export function choosesBeacon(kind, hasBeacon, distanceToPlayer, playerReachable, beaconReachable) {
  if (!hasBeacon) return false;
  if (kind === "breaker") return beaconReachable || !playerReachable;
  if (!playerReachable && beaconReachable) return true;
  return kind === "runner" && distanceToPlayer > 5.5 && beaconReachable;
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

export function defenseResult(wave, remaining, beaconHp, playerHp, seconds) {
  if (beaconHp <= 0) return "beacon-destroyed";
  if (playerHp <= 0) return "player-down";
  if (remaining === 0 && wave >= DEFENSE_WAVES.length) return "cleared";
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
