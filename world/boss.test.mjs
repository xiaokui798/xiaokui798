import test from "node:test";
import assert from "node:assert/strict";
import { ARENA, BOSS, GUARDIAN_WAVES, COLOSSUS, SKY_COURT, SKY_COURT_COVERS, BOSS_ATTACKS, buildArena, buildBossTerrain,
  createBossFight, advanceBoss, strikeBoss, interruptFurnace, damagePrism, posedColossus, insideColossusHazard, modelHit, pulseViewModel } from "./boss.mjs";
import { WORLD, voxelIndex } from "./terrain.mjs";

const player = { x: ARENA.x, y: ARENA.floor, z: ARENA.spawnZ };

test("guardian counterplay changes from flanking to interrupting a cast to baiting a charge", () => {
  const front = createBossFight();
  advanceBoss(front, player, front.time);
  assert.equal(strikeBoss(front, 27, false, player), 0);
  assert.equal(strikeBoss(front, 27, false, { x: front.x, z: front.z - 1 }), 27);

  const caster = createBossFight();
  caster.phase = 2;
  advanceBoss(caster, { ...player, vx: 5 }, caster.time);
  assert.equal(caster.attack.marks[1].x, player.x + 2.75);
  assert.ok(interruptFurnace(caster));
  assert.equal(advanceBoss(caster, player, 2).damage, 0);
  assert.equal(strikeBoss(caster, 20), 18);

  for (const dodge of [true, false]) {
    const ram = createBossFight();
    ram.phase = 3;
    advanceBoss(ram, player, ram.time);
    const start = ram.z;
    advanceBoss(ram, player, ram.time);
    const result = advanceBoss(ram, { ...player, x: player.x + (dodge ? 3 : 0) }, ram.time);
    assert.ok(ram.z > start);
    assert.equal(result.damage, dodge ? 0 : BOSS_ATTACKS.ram.damage);
    assert.equal(ram.time, dodge ? 3 : .85);
  }
});

test("a diagonal pursuit takes an open aisle past each pillar", () => {
  const terrain = buildBossTerrain(COLOSSUS, WORLD);
  for (const pillar of SKY_COURT_COVERS) {
    const fight = createBossFight(COLOSSUS);
    const target = { x: pillar.x + Math.sign(pillar.x - fight.x) * 4,
      z: pillar.z + Math.sign(pillar.z - fight.z) * 4, y: fight.y };
    fight.state = "recovery";
    advanceBoss(fight, target, fight.time);
    assert.equal(fight.travel.pursuit, true);
    const initial = Math.hypot(target.x - fight.x, target.z - fight.z);
    while (fight.state === "reposition") {
      advanceBoss(fight, target, .02);
      for (let x = Math.floor(fight.x - COLOSSUS.radius); x <= Math.floor(fight.x + COLOSSUS.radius); x++) {
        for (let z = Math.floor(fight.z - COLOSSUS.radius); z <= Math.floor(fight.z + COLOSSUS.radius); z++) {
          assert.equal(terrain[voxelIndex(WORLD, x, fight.y, z)], 0);
        }
      }
    }
    assert.ok(Math.hypot(target.x - fight.x, target.z - fight.z) < initial - 2);
  }
});

test("the arena has a clear spawn, a level fight floor, and a tall perimeter", () => {
  const arena = buildArena(WORLD);
  const block = (x, y, z) => arena[voxelIndex(WORLD, x, y, z)];
  assert.ok(block(16, ARENA.floor - 1, Math.floor(ARENA.spawnZ)));
  assert.equal(block(16, ARENA.floor, Math.floor(ARENA.spawnZ)), 0);
  assert.equal(block(16, ARENA.floor + 1, Math.floor(ARENA.spawnZ)), 0);
  assert.equal(block(16, ARENA.floor, 16), 0);
  assert.ok(block(30, ARENA.floor + 2, 16));
  assert.notEqual(block(16, ARENA.floor - 1, 16), block(19, ARENA.floor - 1, 20));
});

test("the guardian advances from spawn and tracks a retreat after exposing its core", () => {
  const boss = createBossFight();
  const entrance = { x: ARENA.x, y: ARENA.floor, z: ARENA.spawnZ };
  advanceBoss(boss, entrance, 1.2);
  assert.ok(Math.hypot(entrance.x - boss.x, entrance.z - boss.z) >= 4.59,
    "the guardian keeps enough room for the player to see its attack pose");
  const planted = boss.z;
  advanceBoss(boss, entrance, boss.time + BOSS_ATTACKS.shock.duration + GUARDIAN_WAVES[0].recovery);
  assert.equal(boss.z, planted);
  assert.equal(boss.state, "ready");
  advanceBoss(boss, { ...entrance, x: ARENA.x + 8 }, .6);
  assert.ok(boss.x > ARENA.x + 1);
});

test("guardian phase changes broadcast a brief ignition before the next pattern", () => {
  const boss = createBossFight();
  boss.state = "recovery";
  assert.equal(strikeBoss(boss, BOSS.maxHp), BOSS.maxHp);
  assert.equal(boss.phase, 2);
  assert.equal(boss.phaseShift, .85);
  advanceBoss(boss, player, .35);
  assert.ok(boss.phaseShift > .49 && boss.phaseShift < .51);
  advanceBoss(boss, player, .5);
  assert.equal(boss.phaseShift, 0);
});

test("the colossus advances on a stationary player at the far end of the entrance", () => {
  const fight = createBossFight(COLOSSUS);
  const entrance = { x: 16.3, y: SKY_COURT.floor, z: 31.7 };
  advanceBoss(fight, entrance, .6);
  assert.ok(fight.z > SKY_COURT.z + 2, "the player did not have to move into a wake radius");
  assert.equal(fight.state, "ready");
  advanceBoss(fight, entrance, .6);
  assert.equal(fight.state, "windup");
  assert.equal(fight.attack.kind, "meteor");
  assert.deepEqual([fight.attack.x, fight.attack.z], [entrance.x, entrance.z]);
  assert.equal(advanceBoss(fight, entrance, fight.time + .08).damage, BOSS_ATTACKS.meteor.damage);

  const retreat = { ...entrance, z: SKY_COURT.z - 14 };
  advanceBoss(fight, retreat, fight.time + COLOSSUS.recovery[0]);
  assert.equal(fight.state, "reposition");
  assert.equal(fight.travel.pursuit, true);
  const before = Math.hypot(fight.x - retreat.x, fight.z - retreat.z);
  advanceBoss(fight, retreat, fight.time);
  assert.ok(Math.hypot(fight.x - retreat.x, fight.z - retreat.z) < before - 4);
  assert.ok(Math.hypot(fight.x - SKY_COURT.x, fight.z - SKY_COURT.z) < SKY_COURT.radius - fight.profile.radius);
});

test("the expanding shock wave warns first, hits only once, and can be jumped", () => {
  const target = { ...player, z: ARENA.z + 4.6 };
  const hit = createBossFight(), dodge = createBossFight();
  const jump = { ...target, y: ARENA.floor + .9 };
  assert.equal(advanceBoss(hit, target, 1.2).cue, "boss-charge");
  advanceBoss(dodge, target, 1.2);
  assert.equal(hit.attack.kind, "shock");
  assert.equal(advanceBoss(hit, target, BOSS_ATTACKS.shock.windup - .05).damage, 0);
  advanceBoss(dodge, target, BOSS_ATTACKS.shock.windup);
  let landed = 0, dodged = 0;
  for (let i = 0; i < 70; i++) {
    landed += advanceBoss(hit, target, .02).damage;
    dodged += advanceBoss(dodge, jump, .02).damage;
  }
  assert.equal(landed, BOSS_ATTACKS.shock.damage);
  assert.equal(dodged, 0);
  assert.equal(hit.state, "recovery");
});

test("the sweep keeps its telegraphed direction, and a flare stays at its marked position", () => {
  const target = { ...player, z: ARENA.z + 3 };
  const boss = createBossFight();
  boss.attacks = 1;
  advanceBoss(boss, target, 1.2);
  assert.equal(boss.attack.kind, "sweep");
  const markedAngle = boss.attack.angle;
  const behind = { ...target, z: ARENA.z - 3 };
  assert.equal(advanceBoss(boss, behind, 1.08).damage, 0);
  assert.equal(boss.angle, markedAngle);

  const flare = createBossFight();
  flare.phase = 2;
  advanceBoss(flare, target, 1.2);
  assert.equal(flare.phase, 2);
  assert.equal(flare.attack.kind, "flare");
  assert.deepEqual([flare.attack.x, flare.attack.z], [target.x, target.z]);
  assert.equal(advanceBoss(flare, behind, 1.02).damage, 0);
});

test("damage only applies during recovery and defeating the boss ends its attacks", () => {
  const boss = createBossFight();
  const nearby = { ...player, z: ARENA.z + 4 };
  assert.equal(strikeBoss(boss, 60), 0);
  advanceBoss(boss, nearby, 3.5);
  assert.equal(boss.state, "recovery");
  assert.equal(strikeBoss(boss, 60), 60);
  assert.equal(strikeBoss(boss, BOSS.maxHp), BOSS.maxHp - 60);
  assert.equal(boss.hits, 2);
  for (const [phase, maxHp, expected] of [[2, 100, 18], [3, 120, 16]]) {
    assert.equal(boss.phase, phase);
    assert.equal(boss.hp, maxHp);
    assert.equal(strikeBoss(boss, 50), 0);
    while (boss.state !== "recovery") advanceBoss(boss, nearby, boss.time);
    assert.equal(strikeBoss(boss, 20), expected);
    assert.equal(strikeBoss(boss, 999), maxHp - expected);
  }
  assert.equal(boss.state, "defeated");
  assert.deepEqual(advanceBoss(boss, player, 20), { damage: 0, cue: null });
});

test("the colossus has a distinct arena and lowers a separate weak point into melee range", () => {
  const arena = buildBossTerrain(COLOSSUS, WORLD);
  const spawn = [Math.floor(SKY_COURT.x), SKY_COURT.floor, Math.floor(SKY_COURT.spawnZ)];
  const spawnCell = voxelIndex(WORLD, ...spawn);
  assert.equal(arena[spawnCell], 0);
  assert.ok(arena[voxelIndex(WORLD, spawn[0], spawn[1] - 1, spawn[2])] > 10);
  for (const cover of SKY_COURT_COVERS) {
    assert.ok(arena[voxelIndex(WORLD, Math.floor(cover.x), SKY_COURT.floor + 1, Math.floor(cover.z))], "cover is solid");
    assert.equal(arena[voxelIndex(WORLD, Math.floor(cover.x) + 2, SKY_COURT.floor, Math.floor(cover.z))], 0, "a route remains beside cover");
  }
  const fight = createBossFight(COLOSSUS);
  const weakY = () => {
    return posedColossus(fight).find(part => part.target === 1).center[1] - fight.y;
  };
  assert.ok(weakY() > 4);
  const target = { x: fight.x, y: fight.y, z: fight.z + 3 };
  advanceBoss(fight, target, 3.3);
  assert.equal(fight.state, "recovery");
  assert.ok(weakY() < 1.9);
  assert.equal(strikeBoss(fight, 44, false), 0);
  assert.equal(strikeBoss(fight, 44, true), 44);
});

test("the same ray hits the shutter when closed and the crystal when it opens", () => {
  const boss = createBossFight(COLOSSUS);
  for (const open of [false, true]) {
    boss.lowered = Number(open);
    boss.state = open ? "recovery" : "ready";
    const parts = posedColossus(boss);
    const core = parts.find(part => part.target === 1);
    const origin = core.center.map((v, i) => v + (i === 2 ? 8 : 0));
    const hit = modelHit(parts, origin, [0, 0, -1], 12);
    assert.equal(hit?.weak, open);
    assert.equal(modelHit(parts, origin, [0, 0, -1], 2), null);
  }
});

test("the view model moves the muzzle and energy cell independently", () => {
  const rest = { charge: 0, recharge: 0, recoiling: 0, bob: [0, 0], ammo: 6, charged: false };
  const ready = pulseViewModel(rest);
  const charging = pulseViewModel({ ...rest, charge: 1, charged: true });
  const recoil = pulseViewModel({ ...rest, recoiling: 1 });
  const reloading = pulseViewModel({ ...rest, recharge: .5, ammo: 2 });
  assert.ok(charging.muzzle[0] < ready.muzzle[0]);
  assert.ok(recoil.muzzle[2] > ready.muzzle[2]);
  assert.ok(reloading.parts.filter(part => part.glow).length < ready.parts.filter(part => part.glow).length);
  const cellHeight = model => model.parts.find(part => part.dimensions[2] === .158).center[1];
  assert.ok(cellHeight(reloading) < cellHeight(ready) - .15);
});

test("the colossus marks a delayed meteor and expands its rift after half health", () => {
  const fight = createBossFight(COLOSSUS);
  const target = { x: fight.x, y: fight.y, z: fight.z + 5 };
  advanceBoss(fight, target, 1.2);
  assert.equal(fight.attack.kind, "meteor");
  assert.equal(insideColossusHazard(fight, target), true);
  assert.equal(advanceBoss(fight, target, BOSS_ATTACKS.meteor.windup - .02).damage, 0);
  const outsideMark = { ...target, x: target.x + 3.2 };
  assert.equal(insideColossusHazard(fight, outsideMark), false);
  assert.equal(advanceBoss(fight, outsideMark, .12).damage, 0);
  assert.equal(advanceBoss(fight, target, .06).damage, BOSS_ATTACKS.meteor.damage);
  assert.equal(advanceBoss(fight, target, .06).damage, 0);

  const enraged = createBossFight(COLOSSUS);
  enraged.hp = COLOSSUS.maxHp / 2;
  enraged.phase = 2;
  enraged.attacks = 3;
  advanceBoss(enraged, target, 1.2);
  assert.equal(enraged.phase, 2);
  assert.equal(enraged.attack.kind, "rift");
  assert.ok(enraged.attack.width > BOSS_ATTACKS.rift.width);
  assert.equal(advanceBoss(enraged, { ...target, x: target.x + 2.5 }, 1.10).damage, 0);
  assert.equal(advanceBoss(enraged, { ...target, x: target.x + 1.9 }, .06).damage, BOSS_ATTACKS.rift.damage);
});

test("the colossus relocates between attacks and stops short of the player", () => {
  const fight = createBossFight(COLOSSUS);
  const player = { x: fight.x, y: fight.y, z: fight.z + 6 };
  advanceBoss(fight, player, 1.2 + BOSS_ATTACKS.meteor.windup + BOSS_ATTACKS.meteor.duration + COLOSSUS.recovery[0]);
  assert.equal(fight.state, "reposition");
  const blocker = { x: fight.x + 3.4, y: fight.y, z: fight.z };
  const original = fight.x;
  for (let i = 0; i < 23; i++) {
    advanceBoss(fight, blocker, .05);
    assert.ok(Math.abs(fight.x - blocker.x) >= COLOSSUS.radius + .33 || Math.abs(fight.z - blocker.z) >= COLOSSUS.radius + .33);
  }
  assert.ok(fight.x > original, "the boss began moving");
  assert.equal(fight.state, "windup");
  assert.equal(fight.attack.x, fight.x, "the next strike originates from the new position");
});

test("half health unlocks two separate expanding waves that can be jumped independently", () => {
  const attempt = (jumpFirst) => {
    const fight = createBossFight(COLOSSUS);
    fight.hp = COLOSSUS.maxHp / 2;
    const player = { x: fight.x, y: fight.y, z: fight.z + 6 };
    advanceBoss(fight, player, 1.2);
    assert.equal(fight.attack.kind, "nova");
    assert.equal(advanceBoss(fight, player, fight.time).damage, 0);
    const hits = [];
    for (let step = 1; step <= 125; step++) {
      const time = step * .02;
      player.y = fight.y + (jumpFirst && time >= .30 && time <= .58 ? .95 : 0);
      if (advanceBoss(fight, player, .02).damage) hits.push(time);
    }
    return hits;
  };
  const grounded = attempt(false), jumped = attempt(true);
  assert.equal(grounded.length, 2);
  assert.ok(grounded[1] - grounded[0] >= .80);
  assert.deepEqual(jumped, [grounded[1]]);
});

test("three prism tracks leave safe gaps and the crystal can interrupt the attack", () => {
  const center = { x: SKY_COURT.x, y: SKY_COURT.floor, z: SKY_COURT.z + 6 };
  const gap = { ...center, x: center.x + 2.05 };
  function readyPrism() {
    const boss = createBossFight(COLOSSUS);
    boss.hp /= 2;
    boss.phase = 2;
    boss.attacks = 1;
    advanceBoss(boss, center, 1.2);
    assert.equal(boss.attack.kind, "prism");
    return boss;
  }
  const unbroken = readyPrism();
  assert.equal(insideColossusHazard(unbroken, center), true);
  assert.equal(insideColossusHazard(unbroken, gap), false);
  assert.equal(advanceBoss(unbroken, center, unbroken.time).damage, 0);
  assert.equal(damagePrism(unbroken, 62), null);
  assert.equal(advanceBoss(unbroken, gap, .12).damage, 0);
  assert.equal(advanceBoss(unbroken, { ...center, y: center.y + 1 }, .10).damage, BOSS_ATTACKS.prism.damage);
  assert.equal(advanceBoss(unbroken, center, .10).damage, 0);

  const broken = readyPrism();
  assert.equal(damagePrism(broken, 24), 18);
  assert.equal(broken.state, "windup");
  assert.equal(damagePrism(broken, 24), 0);
  assert.equal(broken.state, "recovery");
  assert.ok(broken.time > COLOSSUS.recovery[1]);
  assert.equal(advanceBoss(broken, center, 1).damage, 0);
  assert.equal(strikeBoss(broken, 62, true), 62);
});

test("the colossus uses distance, cover, and a point-blank repulsion without hiding telegraphs", () => {
  const near = createBossFight(COLOSSUS);
  const closePlayer = { x: near.x, y: near.y, z: near.z + 3 };
  advanceBoss(near, closePlayer, 1.2);
  assert.equal(near.attack.kind, "repel");
  assert.equal(advanceBoss(near, closePlayer, near.time).damage, 0);
  const repelled = advanceBoss(near, closePlayer, .08);
  assert.equal(repelled.damage, BOSS_ATTACKS.repel.damage);
  assert.ok(repelled.push.z > 0);

  const covered = createBossFight(COLOSSUS);
  covered.hp /= 2;
  covered.phase = 2;
  covered.attacks = 1;
  const sheltered = { x: covered.x, y: covered.y, z: covered.z + 6, covered: true };
  advanceBoss(covered, sheltered, 1.2);
  assert.equal(covered.attack.kind, "rift", "cover prompts a ground-pressure route");

  const prism = createBossFight(COLOSSUS);
  prism.hp /= 2;
  prism.phase = 2;
  prism.attacks = 1;
  const target = { x: prism.x, y: prism.y, z: prism.z + 6 };
  advanceBoss(prism, target, 1.2);
  assert.equal(prism.attack.kind, "prism");
  advanceBoss(prism, target, prism.time);
  assert.equal(advanceBoss(prism, { ...target, covered: true }, .08).damage, 0, "cover blocks refracted beam");
});
