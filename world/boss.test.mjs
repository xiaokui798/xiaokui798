import test from "node:test";
import assert from "node:assert/strict";
import { ARENA, BOSS, GUARDIAN_WAVES, COLOSSUS, SKY_COURT, SKY_COURT_COVERS, BOSS_ATTACKS, buildArena, buildBossTerrain,
  createBossFight, advanceBoss, strikeBoss, interruptFurnace, damagePrism, posedColossus, insideColossusHazard, insideHazard, posedGuardian, modelHit, pulseViewModel, meleeViewModel } from "./boss.mjs";
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
  assert.equal(boss.phaseShift, 1.2);
  advanceBoss(boss, player, .35);
  assert.ok(boss.phaseShift > .84 && boss.phaseShift < .86);
  advanceBoss(boss, player, .85);
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
  // The hover rides 0.8 lower since batch 49 (lift base 2.26), so
  // the weak point cruises at ~3.65 instead of ~4.45 — still far
  // above melee until the recovery dip brings it under 1.9.
  assert.ok(weakY() > 3.4);
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

test("the melee view model is a 3D sword or axe that moves through a swing", () => {
  const rest = meleeViewModel({ style: "sword", swing: 0, bob: [0, 0] });
  const mid = meleeViewModel({ style: "sword", swing: .135, bob: [0, 0] });
  const axe = meleeViewModel({ style: "axe", swing: 0, bob: [0, 0] });
  assert.ok(rest.parts.length >= 4 && mid.parts.length === rest.parts.length);
  assert.ok(axe.parts.length >= 3);
  // A mid-swing sword is somewhere else than at rest: the swing changes
  // the aim basis, so the blade tip moves. The axe head is a different
  // shape than the sword blade.
  const tip = model => model.parts[2].center;
  assert.notDeepEqual(tip(mid), tip(rest));
  assert.notDeepEqual(axe.parts[2].dimensions, rest.parts[2].dimensions);
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

test("insideHazard covers the guardian's sector, marks and wavefronts", () => {
  // Sweep: the second phase-1 attack. In front of the guardian,
  // inside the sector, is danger during the windup; behind it and
  // beyond its reach are not.
  const sweep = createBossFight(BOSS);
  sweep.attacks = 1;
  const front = { x: sweep.x, y: sweep.y, z: sweep.z + 3 };
  advanceBoss(sweep, front, 1.2);
  assert.equal(sweep.attack.kind, "sweep");
  assert.equal(sweep.state, "windup");
  assert.equal(insideHazard(sweep, front), true);
  assert.equal(insideHazard(sweep, { ...front, z: sweep.z - 3 }), false);
  assert.equal(insideHazard(sweep, { ...front, z: sweep.z + 8 }), false);

  // Flare: phase 2 marks the player's spot; standing on a mark is
  // danger, standing clear of every mark is not.
  const flare = createBossFight(BOSS);
  flare.phase = 2;
  flare.hp = GUARDIAN_WAVES[1].hp;
  const marked = { x: flare.x + 6, y: flare.y, z: flare.z + 6 };
  advanceBoss(flare, marked, 1.2);
  assert.equal(flare.attack.kind, "flare");
  assert.equal(insideHazard(flare, marked), true);
  assert.equal(insideHazard(flare, { ...marked, x: marked.x + 4 }), false);

  // Shock: no wavefront exists during the windup; once the wave is
  // travelling, danger is the 1.2 band around its front, which
  // passes a standing player exactly once.
  const shock = createBossFight(BOSS);
  const victim = { x: shock.x, y: shock.y, z: shock.z + 5 };
  advanceBoss(shock, victim, 1.2);
  assert.equal(shock.attack.kind, "shock");
  assert.equal(insideHazard(shock, victim), false);
  advanceBoss(shock, victim, BOSS_ATTACKS.shock.windup);
  assert.equal(shock.state, "attack");
  let sawDanger = false, sawCalm = false;
  for (let i = 0; i < 24; i++) {
    advanceBoss(shock, victim, .05);
    if (insideHazard(shock, victim)) sawDanger = true; else sawCalm = true;
  }
  assert.ok(sawDanger && sawCalm, "the wavefront band must pass the player exactly once");
});

test("the guardian squashes and its core brightens across a windup", () => {
  const fight = createBossFight(BOSS);
  fight.elapsed = 2; // freeze the idle bob so only the pose moves
  const torsoY = parts => parts[2].center[1];
  const coreRed = parts => parts.find(p => p.glow && p.dimensions[0] === .46).color[0];
  const restY = torsoY(posedGuardian(fight));
  fight.state = "windup";
  fight.attack = { kind: "shock", windup: BOSS_ATTACKS.shock.windup, angle: 0, x: fight.x, z: fight.z };
  fight.time = BOSS_ATTACKS.shock.windup;
  const startY = torsoY(posedGuardian(fight)), startCore = coreRed(posedGuardian(fight));
  assert.ok(Math.abs(startY - restY) < .01, "no squash at windup start");
  fight.time = BOSS_ATTACKS.shock.windup * .1;
  const endY = torsoY(posedGuardian(fight)), endCore = coreRed(posedGuardian(fight));
  assert.ok(restY - endY > .09 && restY - endY < .13, `the squash bottoms out at 0.12 (got ${restY - endY})`);
  assert.ok(endCore / startCore > 1.6, `the core brightens toward 1.8x (got ${endCore / startCore})`);
  // Release: the pose rebounds above rest for the first 0.12s.
  fight.state = "attack";
  fight.time = BOSS_ATTACKS.shock.duration - .06;
  assert.ok(torsoY(posedGuardian(fight)) > restY + .01, "the strike rebounds +0.04");
});

test("the colossus hovers 0.8 lower on a 3 second cycle", () => {
  const fight = createBossFight(COLOSSUS);
  fight.state = "ready";
  fight.time = 1.2; // entrance approach spent: no drive, no dip
  const hullY = () => posedColossus(fight)[0].center[1] - fight.y;
  fight.elapsed = 0;
  const base = hullY();
  assert.ok(Math.abs(base - 3.56) < .02, `lift base 2.26 + hull 1.30 (got ${base})`);
  fight.elapsed = .75;
  assert.ok(Math.abs(hullY() - (base + .15)) < .02, "hover peaks at +0.15 a quarter cycle in");
  fight.elapsed = 2.25;
  assert.ok(Math.abs(hullY() - (base - .15)) < .02, "hover troughs at -0.15 three quarters in");
  fight.elapsed = 3;
  assert.ok(Math.abs(hullY() - base) < .02, "the cycle closes at 3 seconds");
});

test("the prism crystals light one by one across the windup", () => {
  const fight = createBossFight(COLOSSUS);
  fight.state = "windup";
  fight.attack = { kind: "prism", windup: 1.8, angle: 0, x: fight.x, z: fight.z, tracks: [] };
  const litCount = () => posedColossus(fight)
    .filter(p => p.dimensions[0] === .15 && p.dimensions[1] === .58 && p.color[0] === 1 && p.color[1] === .68).length;
  fight.time = 1.8 - .2;
  assert.equal(litCount(), 1);
  fight.time = 1.8 - .7;
  assert.equal(litCount(), 2);
  fight.time = 1.8 - 1.2;
  assert.equal(litCount(), 3);
});

test("the colossus phase change also raises the 1.2 second shift", () => {
  const fight = createBossFight(COLOSSUS);
  fight.hp = COLOSSUS.maxHp / 2 - 10;
  advanceBoss(fight, { x: fight.x, y: fight.y, z: fight.z + 20 }, 1.25);
  assert.equal(fight.phase, 2);
  assert.equal(fight.phaseShift, 1.2);
});
