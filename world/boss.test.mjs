import test from "node:test";
import assert from "node:assert/strict";
import { ARENA, BOSS, GUARDIAN_WAVES, COLOSSUS, SKY_COURT, SKY_COURT_COVERS, BOSS_ATTACKS, buildArena, buildBossTerrain,
  createBossFight, advanceBoss, strikeBoss, interruptFurnace, damagePrism, damageTurret, BAR_COLORS, posedColossus, insideColossusHazard, insideHazard, posedGuardian, modelHit, pulseViewModel, meleeViewModel } from "./boss.mjs";
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
  // Bar-2 flare marks a triangle (batch 61): the player's spot
  // plus two escape points ±40° off the run direction.
  assert.equal(caster.attack.marks.length, 3);
  assert.deepEqual([caster.attack.marks[0].x, caster.attack.marks[0].z], [player.x, player.z]);
  assert.ok(Math.abs(caster.attack.marks[1].x - (player.x + 3.3 * Math.cos(.7))) < 1e-9);
  assert.ok(Math.abs(caster.attack.marks[1].z - (player.z + 3.3 * Math.sin(.7))) < 1e-9);
  assert.ok(Math.abs(caster.attack.marks[2].z - (player.z - 3.3 * Math.sin(.7))) < 1e-9);
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
    assert.equal(result.damage, dodge ? 0 : Math.round(BOSS_ATTACKS.ram.damage * GUARDIAN_WAVES[2].damageScale));
    if (!dodge) {
      assert.equal(ram.time, .85);
    } else {
      // A missed bar-3 charge returns for a second leg (batch
      // 61); only the second miss earns the long stagger.
      assert.equal(ram.state, "windup");
      assert.equal(ram.attack.leg, 2);
      advanceBoss(ram, { ...player, x: player.x + 3 }, ram.time);
      const second = advanceBoss(ram, { ...player, x: player.x + 10 }, ram.time);
      assert.equal(second.damage, 0);
      assert.equal(ram.state, "recovery");
      assert.equal(ram.time, 3);
    }
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
  assert.equal(boss.phaseShift, 2);
  advanceBoss(boss, player, .35);
  assert.ok(boss.phaseShift > 1.64 && boss.phaseShift < 1.66);
  advanceBoss(boss, player, 1.65);
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
  for (let i = 0; i < 400 && fight.state !== "reposition"; i++) advanceBoss(fight, retreat, .05);
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
  for (const [phase, maxHp, expected] of [[2, 420, 18], [3, 500, 16]]) {
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

test("the colossus marks a delayed meteor and expands its rift from the second bar", () => {
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
  enraged.hp = COLOSSUS.bars[1].hp;
  enraged.phase = 2;
  enraged.attacks = 3;
  advanceBoss(enraged, target, 1.2);
  assert.equal(enraged.phase, 2);
  assert.equal(enraged.attack.kind, "rift");
  assert.ok(enraged.attack.width > BOSS_ATTACKS.rift.width);
  assert.equal(advanceBoss(enraged, { ...target, x: target.x + 2.5 }, 1.10).damage, 0);
  assert.equal(advanceBoss(enraged, { ...target, x: target.x + 1.9 }, .06).damage,
    Math.round(BOSS_ATTACKS.rift.damage * COLOSSUS.bars[1].damageScale));
});

test("the colossus relocates between attacks and stops short of the player", () => {
  const fight = createBossFight(COLOSSUS);
  const player = { x: fight.x, y: fight.y, z: fight.z + 6 };
  for (let i = 0; i < 400 && fight.state !== "reposition"; i++) advanceBoss(fight, player, .05);
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

test("the second bar unlocks two separate expanding waves that can be jumped independently", () => {
  const attempt = (jumpFirst) => {
    const fight = createBossFight(COLOSSUS);
    fight.hp = COLOSSUS.bars[1].hp;
    fight.phase = 2;
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
    boss.hp = COLOSSUS.bars[1].hp;
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
  assert.equal(advanceBoss(unbroken, { ...center, y: center.y + 1 }, .10).damage,
    Math.round(BOSS_ATTACKS.prism.damage * COLOSSUS.bars[1].damageScale));
  assert.equal(advanceBoss(unbroken, center, .10).damage, 0);

  const broken = readyPrism();
  assert.equal(damagePrism(broken, 24), 18);
  assert.equal(broken.state, "windup");
  assert.equal(damagePrism(broken, 24), 0);
  assert.equal(broken.state, "recovery");
  assert.ok(broken.time > COLOSSUS.bars[1].recovery);
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
  covered.hp = COLOSSUS.bars[1].hp;
  covered.phase = 2;
  covered.attacks = 1;
  const sheltered = { x: covered.x, y: covered.y, z: covered.z + 6, covered: true };
  advanceBoss(covered, sheltered, 1.2);
  assert.equal(covered.attack.kind, "rift", "cover prompts a ground-pressure route");

  const prism = createBossFight(COLOSSUS);
  prism.hp = COLOSSUS.bars[1].hp;
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
  // Four units clear used to be outside the single mark; a flank
  // mark covers that spot now (batch 61), so clear is seven out.
  assert.equal(insideHazard(flare, { ...marked, x: marked.x + 7 }), false);

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

test("breaking a colossus bar raises the 2 second shift and refills the next bar", () => {
  const fight = createBossFight(COLOSSUS);
  fight.state = "recovery";
  assert.equal(strikeBoss(fight, COLOSSUS.bars[0].hp, true), COLOSSUS.bars[0].hp);
  assert.equal(fight.phase, 2);
  assert.equal(fight.hp, COLOSSUS.bars[1].hp);
  assert.equal(fight.phaseShift, 2);
  assert.equal(fight.state, "ready");
  assert.equal(strikeBoss(fight, 50, true), 0, "no damage lands during the shift");
  // The last bar breaking is the kill.
  fight.phase = 4;
  fight.hp = 30;
  fight.state = "recovery";
  assert.equal(strikeBoss(fight, 30, true), 30);
  assert.equal(fight.state, "defeated");
});

test("the bar tables carry the design values and windups respect the 0.65 floor", () => {
  assert.deepEqual(COLOSSUS.bars.map(bar => bar.hp), [700, 750, 800, 850]);
  assert.deepEqual(COLOSSUS.bars.map(bar => bar.recovery), [2.55, 2.3, 2, 1.7]);
  assert.deepEqual(GUARDIAN_WAVES.map(wave => wave.hp), [520, 420, 500]);
  // Bar 4 repel: .78 windup x .78 scale would be .61 — clamped.
  const fight = createBossFight(COLOSSUS);
  fight.phase = 4;
  fight.hp = COLOSSUS.bars[3].hp;
  fight.attacks = 2; // not the nova slot: the fixed nova preempts repel
  const close = { x: fight.x, y: fight.y, z: fight.z + 3 };
  advanceBoss(fight, close, 1.2);
  assert.equal(fight.attack.kind, "repel");
  assert.equal(fight.attack.windup, .65);
});

test("bar-2 flare marks a triangle of three, moving or standing", () => {
  const moving = createBossFight();
  moving.phase = 2;
  advanceBoss(moving, { ...player, vx: 5 }, moving.time);
  assert.equal(moving.attack.kind, "flare");
  assert.equal(moving.attack.marks.length, 3);
  const still = createBossFight();
  still.phase = 2;
  const target = { ...player, z: ARENA.z + 6 };
  advanceBoss(still, target, still.time);
  assert.equal(still.attack.kind, "flare");
  assert.equal(still.attack.marks.length, 3);
  assert.deepEqual([still.attack.marks[0].x, still.attack.marks[0].z], [target.x, target.z]);
});

test("the bar-2 sweep declares its shock follow-up at windup and fires it after a 0.35s gap", () => {
  const fight = createBossFight();
  fight.phase = 2;
  fight.hp = GUARDIAN_WAVES[1].hp;
  fight.attacks = 1;
  const target = { ...player, z: ARENA.z + 3 };
  advanceBoss(fight, target, 1.2);
  assert.equal(fight.attack.kind, "sweep");
  // The follow-up is on the sweep from its first windup frame —
  // this is what the renderer previews (design §3, rule 5).
  assert.deepEqual(fight.attack.next, { kind: "shock", damage: 18 });
  assert.ok(fight.attack.comboTotal > fight.attack.windup);
  // Slip behind the guardian so the sweep misses; the shock ring
  // is omnidirectional and still connects, for exactly its 18.
  const behind = { x: fight.x, y: ARENA.floor, z: fight.z - 3 };
  let gapTime = null, total = 0, guard = 0;
  while (fight.state !== "recovery" && guard++ < 400) {
    total += advanceBoss(fight, behind, .02).damage;
    if (gapTime === null && fight.state === "windup" && fight.attack.kind === "shock") gapTime = fight.time;
  }
  assert.ok(gapTime !== null && gapTime <= .35 && gapTime > .3, `combo gap ${gapTime}`);
  assert.equal(total, 18);
  assert.equal(fight.state, "recovery");
});

test("the bar-3 ram returns at a corrected angle and only the second miss staggers", () => {
  const fight = createBossFight();
  fight.phase = 3;
  fight.hp = GUARDIAN_WAVES[2].hp;
  const target = { ...player, z: ARENA.z + 7 };
  advanceBoss(fight, target, 1.2);
  assert.equal(fight.attack.kind, "ram");
  assert.equal(fight.attack.leg, 1);
  const firstAngle = fight.attack.angle;
  let guard = 0;
  while (fight.state !== "attack" && guard++ < 200) advanceBoss(fight, target, .02);
  const dodged = { ...target, x: target.x + 4 };
  guard = 0;
  while (fight.state === "attack" && guard++ < 200) advanceBoss(fight, dodged, .02);
  assert.equal(fight.state, "windup");
  assert.equal(fight.attack.kind, "ram");
  assert.equal(fight.attack.leg, 2);
  const reverse = firstAngle + Math.PI;
  const correction = Math.atan2(Math.sin(fight.attack.angle - reverse), Math.cos(fight.attack.angle - reverse));
  assert.ok(Math.abs(correction) <= .436 + 1e-9, `correction ${correction}`);
  assert.ok(correction < 0, "the return corrects toward the dodging player");
  guard = 0;
  while (fight.state !== "recovery" && guard++ < 400) advanceBoss(fight, dodged, .02);
  assert.equal(fight.state, "recovery");
  assert.ok(fight.time > 1.2 && fight.time <= 3, `stagger ${fight.time}`);
});

test("the bar-3 nova fires three rings, slow slow fast; the colossus keeps two", () => {
  const fight = createBossFight();
  fight.phase = 3;
  fight.hp = GUARDIAN_WAVES[2].hp;
  fight.attacks = 1;
  const target = { ...player, z: ARENA.z + 3 };
  advanceBoss(fight, target, 1.2);
  assert.equal(fight.attack.kind, "nova");
  assert.deepEqual(fight.attack.waves.map(wave => Math.round(wave.delay * 100) / 100), [0, .82, 1.37]);
  let total = 0, guard = 0;
  while (fight.state !== "recovery" && guard++ < 600) total += advanceBoss(fight, target, .02).damage;
  assert.equal(total, 3 * Math.round(BOSS_ATTACKS.nova.damage * GUARDIAN_WAVES[2].damageScale));
  const giant = createBossFight(COLOSSUS);
  giant.phase = 2;
  giant.hp = COLOSSUS.bars[1].hp;
  const mid = { x: SKY_COURT.x, y: SKY_COURT.floor, z: SKY_COURT.z + 7 };
  guard = 0;
  while (giant.state !== "windup" && guard++ < 400) advanceBoss(giant, mid, .02);
  assert.equal(giant.attack.kind, "nova");
  assert.equal(giant.attack.waves.length, 2);
});

test("bar-3 flare marks burn as fire zones for two seconds at 5 hp/s, on their own channel", () => {
  const fight = createBossFight();
  fight.phase = 3;
  fight.hp = GUARDIAN_WAVES[2].hp;
  fight.attacks = 2;
  const target = { ...player, z: ARENA.z + 6 };
  let guard = 0;
  while (fight.state !== "recovery" && guard++ < 600) advanceBoss(fight, target, .02);
  assert.equal(fight.fireZones.length, 3);
  for (const zone of fight.fireZones) {
    assert.equal(zone.radius, BOSS_ATTACKS.flare.reach);
    assert.ok(zone.until - fight.elapsed > 1.8 && zone.until - fight.elapsed <= 2.05);
  }
  const standing = { x: fight.fireZones[0].x, y: ARENA.floor, z: fight.fireZones[0].z };
  let fire = 0, damage = 0;
  for (let i = 0; i < 50; i++) {
    const result = advanceBoss(fight, standing, .02);
    fire += result.fire ?? 0;
    damage += result.damage;
  }
  assert.equal(fire, 5);
  assert.equal(damage, 0);
  const away = { ...player, z: ARENA.z - 10 };
  guard = 0;
  while (fight.fireZones.length && guard++ < 300) advanceBoss(fight, away, .02);
  assert.equal(fight.fireZones.length, 0);
  // Bar-2 flare leaves nothing behind.
  const earlier = createBossFight();
  earlier.phase = 2;
  earlier.hp = GUARDIAN_WAVES[1].hp;
  guard = 0;
  while (earlier.state !== "recovery" && guard++ < 600) advanceBoss(earlier, target, .02);
  assert.equal(earlier.fireZones.length, 0);
});

// ---- Batch 62: the colossus's new moves ----

// Step a fight in small increments until a condition holds
// (or the guard runs out) and return the last result.
function stepUntil(fight, player, done, guard = 800) {
  let result = { damage: 0, fire: 0 };
  while (!done() && guard-- > 0) result = advanceBoss(fight, player, .05);
  return result;
}

test("the colossus meteor falls in chains: two in the early bars, three from bar 3", () => {
  const fight = createBossFight(COLOSSUS);
  const player = { x: fight.x, y: fight.y, z: fight.z + 5 };
  advanceBoss(fight, player, 1.2);
  assert.equal(fight.attack.kind, "meteor");
  // The chain is declared on the first windup — the follow-up
  // falls are previewed, never sprung (design §3, rule 5).
  assert.equal(fight.attack.chainTotal, 2);
  assert.equal(fight.attack.chainIndex, 1);
  let first = 0, guard = 0;
  while (!(fight.state === "windup" && fight.attack?.pending) && guard++ < 400) {
    first += advanceBoss(fight, player, .05).damage;
  }
  assert.equal(first, BOSS_ATTACKS.meteor.damage, "the first fall hits once, at full value");
  assert.equal(fight.attack.chainIndex, 2);
  // The second fall locks the player's NEW position half a
  // second after the first one landed.
  player.x += 6;
  stepUntil(fight, player, () => fight.attack?.pending === false);
  assert.equal(fight.attack.x, player.x);
  assert.equal(fight.attack.z, player.z);
  let second = 0;
  guard = 0;
  while (fight.state !== "recovery" && guard++ < 400) second += advanceBoss(fight, player, .05).damage;
  assert.equal(second, BOSS_ATTACKS.meteor.damage, "the chained fall hits once too — no more, no less");

  const late = createBossFight(COLOSSUS);
  late.hp = COLOSSUS.bars[2].hp;
  late.phase = 3;
  late.attacks = 4;
  const latePlayer = { x: late.x, y: late.y, z: late.z + 5 };
  advanceBoss(late, latePlayer, 1.2);
  assert.equal(late.attack.kind, "meteor");
  assert.equal(late.attack.chainTotal, 3);
});

test("the bar-2 converging ring closes to the giant's feet and the pocket inside is safe", () => {
  const fight = createBossFight(COLOSSUS);
  fight.hp = COLOSSUS.bars[1].hp;
  fight.phase = 2;
  fight.attacks = 4;
  const player = { x: fight.x, y: fight.y, z: fight.z + 8 };
  advanceBoss(fight, player, 1.2);
  assert.equal(fight.attack.kind, "converge");
  let total = 0, guard = 0;
  while (fight.state !== "recovery" && guard++ < 400) total += advanceBoss(fight, player, .05).damage;
  assert.equal(total, Math.round(BOSS_ATTACKS.converge.damage * COLOSSUS.bars[1].damageScale));

  const pocket = createBossFight(COLOSSUS);
  pocket.hp = COLOSSUS.bars[1].hp;
  pocket.phase = 2;
  pocket.attacks = 4;
  const inside = { x: pocket.x, y: pocket.y, z: pocket.z + 8 };
  advanceBoss(pocket, inside, 1.2);
  assert.equal(pocket.attack.kind, "converge");
  // The pocket is a place to run to during the windup —
  // standing point-blank at the start would draw a repel.
  inside.z = pocket.z + 2.5;
  let safe = 0;
  guard = 0;
  while (pocket.state !== "recovery" && guard++ < 400) safe += advanceBoss(pocket, inside, .05).damage;
  assert.equal(safe, 0, "inside the ring's end radius the ground stays safe");

  const jumper = createBossFight(COLOSSUS);
  jumper.hp = COLOSSUS.bars[1].hp;
  jumper.phase = 2;
  jumper.attacks = 4;
  const airborne = { x: jumper.x, y: jumper.y + 1, z: jumper.z + 8 };
  advanceBoss(jumper, airborne, 1.2);
  let dodged = 0;
  guard = 0;
  while (jumper.state !== "recovery" && guard++ < 400) dodged += advanceBoss(jumper, airborne, .05).damage;
  assert.equal(dodged, 0, "a jump clears the converging ring like any other");
});

test("the bar-3 charge runs its strip, hits for 30 scaled, and a miss costs a 1.5s stagger", () => {
  const fight = createBossFight(COLOSSUS);
  fight.hp = COLOSSUS.bars[2].hp;
  fight.phase = 3;
  fight.attacks = 2;
  const player = { x: fight.x, y: fight.y, z: fight.z + 8 };
  const startZ = fight.z;
  advanceBoss(fight, player, 1.2);
  assert.equal(fight.attack.kind, "charge");
  let total = 0, guard = 0;
  while (fight.state !== "recovery" && guard++ < 400) total += advanceBoss(fight, player, .05).damage;
  assert.equal(total, Math.round(BOSS_ATTACKS.charge.damage * COLOSSUS.bars[2].damageScale));
  assert.ok(fight.z - startZ > 3, "the giant's body travelled down the strip");

  const dodged = createBossFight(COLOSSUS);
  dodged.hp = COLOSSUS.bars[2].hp;
  dodged.phase = 3;
  dodged.attacks = 2;
  const aside = { x: dodged.x, y: dodged.y, z: dodged.z + 8 };
  advanceBoss(dodged, aside, 1.2);
  assert.equal(dodged.attack.kind, "charge");
  stepUntil(dodged, aside, () => dodged.state === "attack");
  aside.x += 6;
  let missed = 0;
  guard = 0;
  while (dodged.state !== "recovery" && guard++ < 400) missed += advanceBoss(dodged, aside, .02).damage;
  assert.equal(missed, 0);
  assert.ok(Math.abs(dodged.time - 1.5) < .1, `a charge that runs out its strip staggers 1.5s (got ${dodged.time})`);
});

test("the bar-3 turret battery marks the player's spot for small meteors and ends early when broken", () => {
  const fight = createBossFight(COLOSSUS);
  fight.hp = COLOSSUS.bars[2].hp;
  fight.phase = 3;
  fight.attacks = 3;
  const player = { x: fight.x, y: fight.y, z: fight.z + 8 };
  advanceBoss(fight, player, 1.2);
  assert.equal(fight.attack.kind, "turret");
  assert.equal(fight.attack.turrets.length, 4);
  assert.ok(fight.attack.turrets.every(crystal => crystal.hp === BOSS_ATTACKS.turret.crystalHp));
  stepUntil(fight, player, () => fight.state === "attack");
  let sawMini = false, hits = 0, guard = 0;
  while (guard++ < 120) {
    const result = advanceBoss(fight, player, .05);
    if (fight.attack.minis.length) sawMini = true;
    if (result.damage) { assert.equal(result.damage, Math.round(BOSS_ATTACKS.turret.damage * COLOSSUS.bars[2].damageScale)); hits++; }
  }
  assert.ok(sawMini, "the crystals mark shots while the battery runs");
  assert.ok(hits >= 1, "a player standing on the marks takes the small meteors");
  assert.equal(damageTurret(fight, 0, 24), BOSS_ATTACKS.turret.crystalHp - 24);
  for (let index = 0; index < 4; index++) damageTurret(fight, index, 999);
  stepUntil(fight, player, () => fight.state === "recovery", 40);
  assert.equal(fight.state, "recovery", "breaking every crystal ends the move early");
});

test("the last bar arms the starfall every fifth of its health, and its rings leave fire", () => {
  const player = { x: 0, y: 0, z: 0 };
  const fight = createBossFight(COLOSSUS);
  fight.hp = COLOSSUS.bars[3].hp;
  fight.phase = 4;
  fight.state = "recovery";
  fight.time = 10;
  const near = { x: fight.x, y: fight.y, z: fight.z + 9 };
  player.x = near.x; player.y = near.y; player.z = near.z;
  assert.equal(strikeBoss(fight, 200, true, player), 200);
  assert.equal(fight.starfallPending, true, "crossing a fifth of the bar arms the finisher");
  stepUntil(fight, player, () => fight.attack?.kind === "starfall", 400);
  assert.equal(fight.attack.kind, "starfall");
  assert.deepEqual(fight.attack.waves.map(wave => wave.delay), [.9, 1.65, 2.25, 2.75, 3.2]);
  let total = 0, guard = 0;
  while (fight.state !== "recovery" && guard++ < 400) total += advanceBoss(fight, player, .05).damage;
  assert.ok(total > 0, "a standing player is caught by the rings");
  const ring = fight.fireZones.find(zone => zone.ring);
  assert.ok(ring, "each spent ring leaves its band burning");
  assert.equal(ring.radius, BOSS_ATTACKS.starfall.reach);
  // Standing in the band burns; standing inside it does not.
  const inBand = { x: fight.x, y: fight.y, z: fight.z + BOSS_ATTACKS.starfall.reach };
  let fire = 0;
  for (let i = 0; i < 4; i++) fire += advanceBoss(fight, inBand, .05).fire ?? 0;
  assert.ok(fire > 0, "the fire ring burns on the environmental channel");
  const inside = { x: fight.x, y: fight.y, z: fight.z + 10 };
  let calm = 0;
  for (let i = 0; i < 4; i++) calm += advanceBoss(fight, inside, .05).fire ?? 0;
  assert.equal(calm, 0);

  const earlier = createBossFight(COLOSSUS);
  earlier.hp = COLOSSUS.bars[2].hp;
  earlier.phase = 3;
  earlier.state = "recovery";
  earlier.time = 10;
  strikeBoss(earlier, 200, true, player);
  assert.ok(!earlier.starfallPending, "the finisher belongs to the last bar only");
});

test("the last bar refracts on four tracks and answers its nova with an inward ring", () => {
  const fight = createBossFight(COLOSSUS);
  fight.hp = COLOSSUS.bars[3].hp;
  fight.phase = 4;
  fight.attacks = 1;
  const player = { x: fight.x, y: fight.y, z: fight.z + 8 };
  advanceBoss(fight, player, 1.2);
  assert.equal(fight.attack.kind, "prism");
  assert.equal(fight.attack.tracks.length, 4);
  const { angle } = fight.attack;
  const s = Math.sin(angle), c = Math.cos(angle);
  const at = (along, side) => ({ x: fight.x + along * s + side * c, y: fight.y, z: fight.z + along * c - side * s });
  assert.equal(insideColossusHazard(fight, at(10, 0)), false, "the old centre line is a gap now");
  assert.equal(insideColossusHazard(fight, at(10, 2.05)), true, "the new inner tracks threaten their lines");

  const nova = createBossFight(COLOSSUS);
  nova.hp = COLOSSUS.bars[3].hp;
  nova.phase = 4;
  nova.attacks = 0;
  advanceBoss(nova, player, 1.2);
  assert.equal(nova.attack.kind, "nova");
  assert.equal(nova.attack.waves.length, 3);
  assert.equal(nova.attack.waves[2].reverse, true, "the third ring runs back inward");
});

test("bar colours are one table for the segments and the cores (batch 64)", () => {
  // The same hexes styles.css paints the segments with:
  // guardian #df784e / #f0d25a / #f04632, colossus #ad8aed /
  // #f082dc / #f59e4c / #fdf6ec.
  assert.deepEqual(BAR_COLORS.boss, [[.875, .471, .306], [.941, .824, .275], [.941, .275, .196]]);
  assert.deepEqual(BAR_COLORS.colossus, [[.678, .541, .929], [.941, .510, .863], [.961, .620, .298], [.992, .965, .925]]);
  for (let phase = 1; phase <= 3; phase++) {
    const fight = createBossFight(BOSS);
    fight.phase = phase;
    const core = posedGuardian(fight).find(part => part.glow && part.dimensions[0] === .46);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(core.color[c] - BAR_COLORS.boss[phase - 1][c]) < .01,
      `guardian bar ${phase} core channel ${c} wears the bar colour`);
  }
  for (let phase = 1; phase <= 4; phase++) {
    const fight = createBossFight(COLOSSUS);
    fight.phase = phase;
    const core = posedColossus(fight).find(part => part.target === 1);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(core.color[c] - BAR_COLORS.colossus[phase - 1][c]) < .01,
      `colossus bar ${phase} core channel ${c} wears the bar colour`);
    fight.state = "recovery";
    const exposed = posedColossus(fight).find(part => part.target === 1);
    assert.ok(exposed.color[0] + exposed.color[1] + exposed.color[2]
      > core.color[0] + core.color[1] + core.color[2], "the exposed core flushes brighter than its rest colour");
  }
});

test("a broken bar drops both bosses into a visible sink and kneel for the window (batch 64)", () => {
  const giant = createBossFight(COLOSSUS);
  const coreY = () => posedColossus(giant).find(part => part.target === 1).center[1];
  const giantRest = coreY();
  giant.phaseShift = 1; // mid-window: the sink is fully in
  assert.ok(giantRest - coreY() > .9, `the colossus sinks a full unit mid-window (got ${giantRest - coreY()})`);
  giant.phaseShift = .1; // nearly over: mostly risen again
  assert.ok(giantRest - coreY() < .3, "the colossus rises before the window ends");
  giant.phaseShift = 0;
  assert.ok(Math.abs(coreY() - giantRest) < .01, "the colossus is back at hover height when the window closes");

  const guard = createBossFight(BOSS);
  guard.elapsed = 2;
  const torsoY = () => posedGuardian(guard).find(part => part.dimensions[0] === 1.55).center[1];
  const guardRest = torsoY();
  guard.phaseShift = 1;
  assert.ok(guardRest - torsoY() > .4, `the guardian kneels mid-window (got ${guardRest - torsoY()})`);
  guard.phaseShift = 0;
  assert.ok(Math.abs(torsoY() - guardRest) < .01, "the guardian stands again when the window closes");
});
