import test from "node:test";
import assert from "node:assert/strict";
import { BEACON, DEFENSE_WAVES, DEFENSE_TOTAL_WAVES, ENEMIES, choosesBeacon, defenseWaveRoster, selectWaveSpawns, repairPlan, defenseCleared, defenseResult,
  findMeleeTarget, validateWaves, assertValidWaves, validateDifficulty, assertValidDifficulty, SURVIVAL_DIFFICULTY,
  validateEnemies, assertValidEnemies } from "./defense.mjs";
import { validateWaves as validateWavesDirect, assertValidWaves as assertValidWavesDirect } from "./waves.mjs";
import { validateDifficulty as validateDifficultyDirect, assertValidDifficulty as assertValidDifficultyDirect } from "./difficulty.mjs";
import { validateEnemies as validateEnemiesDirect, assertValidEnemies as assertValidEnemiesDirect } from "./enemies.mjs";
import { ENEMIES as ENEMIES_FROM_REGISTRY } from "./enemies.mjs";
import { DEFENSE_WAVES as WAVES_FROM_REGISTRY, BEACON as BEACON_FROM_REGISTRY } from "./waves.mjs";
import { scaledHp } from "./difficulty.mjs";
import { BLOCK } from "./progression.mjs";

test("defense re-exports the enemy registry from enemies.mjs unchanged", () => {
  assert.equal(ENEMIES, ENEMIES_FROM_REGISTRY);
  assert.deepEqual(Object.keys(ENEMIES), ["breaker", "spitter", "dasher", "juggernaut", "exploder"]);
  assert.deepEqual(ENEMIES, {
    breaker: { name: "破城者", hp: 155, speed: 1.13, reach: 1.44, damage: 14, strikeDelay: .70, cooldown: 1.55,
      width: 1.20, height: 1.13, armor: true, coat: [.28, .27, .26], skin: [.55, .55, .50], eyes: [.89, .40, .14],
      drops: [[BLOCK.STONE, 2], [BLOCK.LEAF, 1]] },
    spitter: { name: "投掷者", hp: 55, speed: 1.25, reach: 1.0, damage: 13, strikeDelay: .55, cooldown: 2.1,
      width: .85, height: .95, armor: false, attack: "ranged", range: 7.5, projectileSpeed: 6,
      coat: [.32, .42, .22], skin: [.62, .58, .34], eyes: [.45, .85, .30],
      drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 2], ["wheatSeed", 1]] },
    dasher: { name: "疾行者", hp: 35, speed: 2.74, reach: 1.1, damage: 6, strikeDelay: .15, cooldown: .9,
      width: .82, height: .82, armor: false, coat: [.30, .48, .22], skin: [.55, .62, .38], eyes: [.95, .85, .25],
      drops: [[BLOCK.LEAF, 2], ["wheatSeed", 1]] },
    juggernaut: { name: "重甲者", hp: 180, speed: .91, reach: 1.5, damage: 15, strikeDelay: .8, cooldown: 2.5,
      width: 1.45, height: 1.3, armor: true, coat: [.38, .20, .14], skin: [.52, .42, .36], eyes: [1, .45, .15],
      drops: [[BLOCK.STONE, 3]] },
    exploder: { name: "爆裂者", hp: 30, speed: 1.82, reach: 1.1, damage: 4, strikeDelay: .3, cooldown: 1.2,
      width: .9, height: .95, armor: false, fuseSeconds: 1, blastTrigger: 2, blastRadius: 2.5,
      blastDamage: 18, blastBeaconDamage: 10,
      coat: [.55, .30, .12], skin: [.66, .50, .30], eyes: [1, .75, .2],
      drops: [["emberCore", 1]] }
  });
  assert.ok(Object.isFrozen(ENEMIES));
});

test("the spitter is a ranged kind with its own numbers, and carries every wave roster as the base kind", () => {
  const { breaker, spitter, dasher, juggernaut, exploder } = ENEMIES;
  assert.equal(spitter.attack, "ranged");
  assert.ok([breaker, dasher, juggernaut, exploder].every(kind => spitter.range > kind.reach),
    "its throw range must clear every melee reach");
  assert.ok(spitter.projectileSpeed > 0);
  // Each core number sits apart from the other kinds: tougher than the
  // two fragile mechanism kinds but far under the two tanks, mid-pack
  // in speed, and a throw that hits harder than the fragile kinds but
  // softer than both tanks.
  assert.ok(exploder.hp < dasher.hp && dasher.hp < spitter.hp && spitter.hp < breaker.hp && breaker.hp < juggernaut.hp);
  assert.ok(juggernaut.speed < breaker.speed && breaker.speed < spitter.speed && spitter.speed < exploder.speed && exploder.speed < dasher.speed);
  assert.ok(dasher.damage < spitter.damage && spitter.damage < breaker.damage && breaker.damage < juggernaut.damage);
  assert.equal(spitter.armor, false);
  // Since the batch-88 deletion the spitter is the base kind: every
  // configured defense wave fields it, and every roster entry is a
  // registered kind.
  assert.ok(DEFENSE_WAVES.every(wave => wave.enemies.includes("spitter")));
  assert.ok(DEFENSE_WAVES.every(wave => wave.enemies.every(enemy => Boolean(ENEMIES[enemy]))));
});

test("defense rosters layer the kind ramps over the rebuilt tables", () => {
  assert.deepEqual(defenseWaveRoster(0), ["spitter", "spitter"]);
  assert.deepEqual(defenseWaveRoster(1), ["spitter", "spitter", "spitter"]);
  assert.deepEqual(defenseWaveRoster(2), ["breaker", "spitter", "spitter", "dasher"]);
  assert.deepEqual(defenseWaveRoster(3), ["breaker", "spitter", "spitter", "spitter", "spitter", "dasher"]);
  assert.deepEqual(defenseWaveRoster(4), ["breaker", "breaker", "spitter", "spitter", "spitter", "dasher", "juggernaut"]);
  // Past the configured waves the final wave repeats with its ramps —
  // the shipped defense roster is the batch-88 skeleton on the
  // deletion's tables (batch 90).
  assert.deepEqual(defenseWaveRoster(5), [...DEFENSE_WAVES[4].enemies, "dasher", "juggernaut", "exploder"]);
  assert.deepEqual(defenseWaveRoster(9), [...DEFENSE_WAVES[4].enemies, "dasher", "juggernaut", "exploder"]);
  assert.deepEqual(defenseWaveRoster(-1), []);
  // The configured rosters are never mutated by the derivation.
  assert.deepEqual(DEFENSE_WAVES.map(wave => wave.enemies), [
    ["spitter", "spitter"], ["spitter", "spitter", "spitter"], ["breaker", "spitter", "spitter"],
    ["breaker", "spitter", "spitter", "spitter", "spitter"], ["breaker", "breaker", "spitter", "spitter", "spitter"]
  ]);
  assert.ok(DEFENSE_WAVES.every(wave => wave.enemies.every(enemy => Boolean(ENEMIES[enemy]))));
});

test("defense re-exports the wave and beacon registry from waves.mjs unchanged", () => {
  assert.equal(DEFENSE_WAVES, WAVES_FROM_REGISTRY);
  assert.equal(BEACON, BEACON_FROM_REGISTRY);
  assert.deepEqual(DEFENSE_WAVES, [
    { name: "前哨接触", enemies: ["spitter", "spitter"], seconds: 45 },
    { name: "交叉火力", enemies: ["spitter", "spitter", "spitter"], seconds: 49 },
    { name: "重型来袭", enemies: ["breaker", "spitter", "spitter"], seconds: 54 },
    { name: "两面夹击", enemies: ["breaker", "spitter", "spitter", "spitter", "spitter"], seconds: 58 },
    { name: "黎明前的攻势", enemies: ["breaker", "breaker", "spitter", "spitter", "spitter"], seconds: 64 }
  ]);
  assert.deepEqual(BEACON, { hp: 120, radius: .43, height: 1.93, repairRange: 3.1, repairCost: 3, repairedHp: 30 });
  assert.ok(Object.isFrozen(DEFENSE_WAVES));
  assert.ok(Object.isFrozen(BEACON));
});

test("five authored waves introduce pressure before the combined final wave", () => {
  assert.equal(DEFENSE_WAVES.length, 5);
  assert.deepEqual(DEFENSE_WAVES[0].enemies, ["spitter", "spitter"]);
  assert.equal(DEFENSE_WAVES[2].enemies[0], "breaker");
  assert.equal(DEFENSE_WAVES[4].enemies.filter(enemy => enemy === "breaker").length, 2);
  assert.ok(DEFENSE_WAVES.every(wave => wave.enemies.length <= 7 && wave.enemies.every(enemy => Boolean(ENEMIES[enemy]))));
  // Pressure grows by count: bodies never decrease wave over wave.
  assert.ok(DEFENSE_WAVES.every((wave, i) => i === 0 || wave.enemies.length >= DEFENSE_WAVES[i - 1].enemies.length));
  assert.ok(ENEMIES.breaker.armor && ENEMIES.breaker.strikeDelay > ENEMIES.spitter.strikeDelay);
});

test("target selection reflects the enemy role and available routes", () => {
  assert.equal(choosesBeacon("breaker", false, 9, true, false), false);
  assert.equal(choosesBeacon("breaker", true, 2, true, true), true);
  assert.equal(choosesBeacon("breaker", true, 2, true, false), false);
  assert.equal(choosesBeacon("spitter", true, 8, true, true), false);
  assert.equal(choosesBeacon("spitter", true, 8, false, true), true);
  // The exploder picks the beacon when the player is far and the
  // beacon is reachable; up close it always goes for the player.
  assert.equal(choosesBeacon("exploder", true, 8, true, true), true);
  assert.equal(choosesBeacon("exploder", true, 3, true, true), false);
  assert.equal(choosesBeacon("exploder", true, 8, true, false), false);
  // The juggernaut and the dasher hunt the player.
  assert.equal(choosesBeacon("juggernaut", true, 8, true, true), false);
  assert.equal(choosesBeacon("dasher", true, 8, true, true), false);
});

test("a wave spawns its whole roster, including in tight terrain", () => {
  const roster = ["breaker", "spitter", "spitter"];
  const candidates = [0, 1, 2].map(x => ({ x, z: 0, cell: x, side: x % 2 === 0 }));
  assert.deepEqual(selectWaveSpawns(roster, candidates.slice(0, 2), true), []);
  const complete = selectWaveSpawns(roster, candidates, true);
  assert.deepEqual(complete.map(spawn => spawn.kind), roster);
  assert.deepEqual(complete.map(spawn => spawn.cell), [0, 1, 2]);
});

test("repair requires material and cannot overheal", () => {
  assert.deepEqual(repairPlan(BEACON.hp, 5), { reason: "full" });
  assert.deepEqual(repairPlan(90, 2), { reason: "materials" });
  assert.deepEqual(repairPlan(106, 3), { cost: 3, restored: 14 });
  assert.deepEqual(repairPlan(40, 3), { cost: 3, restored: 30 });
});

test("only clearing wave eight wins, and all three failure cases end the run", () => {
  assert.equal(DEFENSE_TOTAL_WAVES, 8);
  assert.equal(defenseResult(4, 0, 80, 64, 0), "playing");
  assert.equal(defenseResult(5, 1, 80, 64, 3), "playing");
  assert.equal(defenseResult(5, 0, 80, 64, 0), "playing");
  assert.equal(defenseResult(7, 0, 80, 64, 0), "playing");
  assert.equal(defenseResult(8, 0, 80, 64, 0), "cleared");
  assert.equal(defenseResult(5, 2, 0, 64, 3), "beacon-destroyed");
  assert.equal(defenseResult(5, 2, 80, 0, 3), "player-down");
  assert.equal(defenseResult(5, 2, 80, 64, 0), "timeout");
});

test("waves six and eight repeat the final table with ramps, seven is the breather", () => {
  // Past the configured waves the final wave repeats; the ramps still
  // apply, so waves 6 and 8 carry the juggernaut and exploder while
  // wave 7 (the breather) carries neither.
  assert.deepEqual(defenseWaveRoster(5), [...DEFENSE_WAVES[4].enemies, "dasher", "juggernaut", "exploder"]);
  assert.deepEqual(defenseWaveRoster(6), [...DEFENSE_WAVES[4].enemies, "dasher"]);
  assert.deepEqual(defenseWaveRoster(7), [...DEFENSE_WAVES[4].enemies, "dasher", "juggernaut", "exploder"]);
  const roster = defenseWaveRoster(5);
  assert.equal(roster.filter(kind => kind === "spitter").length, 3);
  assert.equal(roster.filter(kind => kind === "breaker").length, 2);
});

test("melee targets visible body parts and respects terrain and beacon cover", () => {
  const zombie = { x: 0, y: 0, z: -2, kind: "breaker", angle: 0, walk: 0 };
  const direction = [0, 0, -1];
  const aim = (origin, limit = 7, beacon = null) => findMeleeTarget(origin, direction, limit, [zombie], beacon, 0);
  assert.equal(aim([0, 1.5, 0]).zombie, zombie);
  assert.equal(aim([.38, .95, 0]).zombie, zombie);
  assert.equal(aim([.38, 1.5, 0]), null);
  assert.equal(aim([0, 1.5, 0], 1.2), null);
  assert.equal(aim([0, 1.5, 0], 7, { x: 0, y: 0, z: -1, hp: 120 }), null);
});

test("a dying zombie is no longer a melee target", () => {
  const zombie = { x: 0, y: 0, z: -2, kind: "breaker", angle: 0, walk: 0, dying: .5 };
  const aim = findMeleeTarget([0, 1.5, 0], [0, 0, -1], 7, [zombie], null, 0);
  assert.equal(aim, null);
});

test("defense waves run on tighter timers than the original 65-92s", () => {
  assert.ok(DEFENSE_WAVES.every(wave => wave.seconds <= 64));
  assert.ok(DEFENSE_WAVES.reduce((total, wave) => total + wave.seconds, 0) <= 270);
});

test("defenseResult clears on wave eight or later, and failures outrank clearing", () => {
  assert.equal(defenseResult(7, 0, 80, 64, 0), "playing");
  assert.equal(defenseResult(8, 0, 80, 64, 0), "cleared");
  // The per-frame path now routes through defenseCleared (wave >=
  // TOTAL, alive count). The clear-wave gate in game.js (attack(), on
  // the last kill) still uses its own inline wave === TOTAL check until
  // the visual group closes 验收 1 and HQ clears the game.js wiring —
  // when it is wired, it calls defenseCleared(survival.wave, alive) and
  // the two paths can no longer drift apart: one predicate, one place
  // to change. Until then the divergence below is the honest record.
  assert.equal(defenseResult(9, 0, 80, 64, 0), "cleared");
  assert.equal(defenseResult(8, 0, 0, 64, 0), "beacon-destroyed");
  assert.equal(defenseResult(8, 0, 80, 0, 0), "player-down");
  assert.equal(defenseResult(8, 1, 80, 64, 0), "timeout");
  assert.equal(defenseResult(8, 0, 80, 64, 0), "cleared");
});

test("defense balance, computed from the config: what each wave deals vs what its kills buy", () => {
  // Per wave: [wave, kills, total HP (wave-scaled), damage of one hit
  // from every zombie, player healing its kills buy, beacon repair its
  // kills buy]. Healing and repair are priced from the wave's ACTUAL
  // drops (R2 drop table), not "1 stone + 1 leaf per kill": a dressing
  // is 2 leaves for 30 hp, so 15 hp per leaf, plus the +24 wave-clear
  // heal (the final wave ends the run, so it gets none); a beacon
  // repair is 3 stone for +30, so 10 hp per stone. Breakers pay 2
  // stone and spitters pay 2 leaves, so the later waves buy more than
  // the old 1-per-kill model said. The batch-88 deletion rebuilt the
  // rosters on those two kinds alone (healing 1128, repair 470 over
  // the run): the deleted walker's and runner's drops (1 stone +
  // 1 leaf, and 1 stone + 1 leaf + 1 wood) were retired with them,
  // not merged into the spitter — the spitter's own table (1 stone,
  // 2 leaves, a wheat seed) is unchanged, and stone, leaf and wood
  // all stay freely gatherable in the world. R8 durability is NOT a
  // column here: the bot fights with the default stone sword and no
  // armor, so it wears nothing — but a real player's stone is shared
  // with gear repairs (5 stone each), so their beacon-repair budget
  // is this table's number minus whatever they spend keeping their
  // gear alive.
  const stoneFor = kind => (ENEMIES[kind].drops ?? []).filter(([id]) => id === BLOCK.STONE)
    .reduce((sum, [, amount]) => sum + amount, 0);
  const leavesFor = kind => (ENEMIES[kind].drops ?? []).filter(([id]) => id === BLOCK.LEAF)
    .reduce((sum, [, amount]) => sum + amount, 0);
  const balance = Array.from({ length: DEFENSE_TOTAL_WAVES }, (_, i) => {
    const wave = i + 1, roster = defenseWaveRoster(i);
    const leaves = roster.reduce((sum, kind) => sum + leavesFor(kind), 0);
    const stone = roster.reduce((sum, kind) => sum + stoneFor(kind), 0);
    return [wave, roster.length,
      roster.reduce((sum, kind) => sum + scaledHp(ENEMIES[kind].hp, wave), 0),
      roster.reduce((sum, kind) => sum + ENEMIES[kind].damage, 0),
      leaves * 15 + (wave < DEFENSE_TOTAL_WAVES ? 24 : 0),
      stone * 10];
  });
  assert.deepEqual(balance, [
    [1, 2, 110, 26, 84, 20], [2, 3, 174, 39, 114, 30], [3, 4, 332, 46, 129, 40],
    [4, 6, 470, 72, 189, 60], [5, 7, 828, 88, 174, 100], [6, 8, 902, 92, 174, 100],
    [7, 6, 666, 73, 174, 70], [8, 8, 971, 92, 150, 100]
  ]);
  const total = column => balance.reduce((sum, row) => sum + row[column], 0);
  assert.equal(total(1), 44);
  assert.equal(total(2), 4453);
  assert.equal(total(3), 528);
  assert.equal(total(4), 1188);
  assert.equal(total(5), 520);
  // Wave 5, checked rather than quoted below: two hits from every
  // zombie in it deal 176, against 174 healing its kills buy and a
  // 100-hp player bar. Over the whole run two hits per zombie is
  // 1056 damage against 1188 healing — the totals favor healing,
  // because the roster's spitters pay 2 leaves each. The run is
  // still won by interrupting windups (a sword hit resets a
  // non-armored zombie's windup), dodging throws and intercepting
  // breakers, not by out-healing: from wave 4 on, a single wave's
  // two full rounds (144–184) exceed the player's whole bar, so no
  // amount of banked healing lets the player stand and take it.
  const wave5 = balance[4];
  assert.equal(wave5[3] * 2, 176);
  // Two full rounds of wave 5 deal 176 against 174 healing its
  // kills buy — the wave's damage still (just) beats its own
  // healing even though the spitter-heavy roster pays 2 leaves a
  // kill. And 176 is still 1.76 times the player's whole 100-hp
  // bar, with the leaves only dropping as the kills land, so
  // standing in the fire and out-healing it is not a line: every
  // wave from wave 4 on deals more than a full health bar in two
  // rounds.
  assert.ok(wave5[3] * 2 > 100);
  assert.ok(balance.slice(3).every(row => row[3] * 2 > 100));
  // The beacon's hard case is wave 5's focused fire: two breakers and
  // a spitter attack it at 2 × 14/1.55 + 13/2.1 ≈ 24.3 damage/s (the
  // other three spitters only make it worse), so an undefended beacon
  // dies in under 5s. The wave's kills buy 100 of its 120 hp back;
  // the rest has to come from stone banked in earlier waves (520 of
  // repair purchasing power over the run) — the repair race is
  // winnable on paper and lost only by ignoring it.
  const beaconDps = 2 * ENEMIES.breaker.damage / ENEMIES.breaker.cooldown
    + ENEMIES.spitter.damage / ENEMIES.spitter.cooldown;
  assert.ok(beaconDps > 20 && beaconDps < 30);
  assert.ok(BEACON.hp / beaconDps < 5);
  assert.equal(wave5[5], 100);
});

test("defenseCleared is the single victory predicate, and defenseResult routes through it", () => {
  assert.equal(defenseCleared(7, 0), false);
  assert.equal(defenseCleared(8, 0), true);
  assert.equal(defenseCleared(9, 0), true);
  assert.equal(defenseCleared(8, 1), false);
  assert.equal(defenseCleared(8, 2), false);
  assert.equal(defenseCleared(0, 0), false);
  assert.equal(defenseCleared(8, -1), false);
  // defenseResult and defenseCleared cannot drift: sweep every wave and
  // alive count with the beacon and player alive and time left, and the
  // two must agree on cleared vs playing. The failure branches are
  // checked separately above; they outrank clearing either way.
  for (let wave = 0; wave <= 10; wave++) {
    for (let alive = 0; alive <= 2; alive++) {
      assert.equal(defenseResult(wave, alive, 80, 64, 10),
        defenseCleared(wave, alive) ? "cleared" : "playing",
        `wave ${wave}, alive ${alive}`);
    }
  }
});

test("validateWaves accepts the shipped waves and beacon, and defense re-exports the validators", () => {
  assert.deepEqual(validateWaves(), { valid: true, errors: [] });
  assert.deepEqual(validateWaves(DEFENSE_WAVES, BEACON), { valid: true, errors: [] });
  assert.equal(assertValidWaves(), true);
  // The validators come through defense.mjs the way the registries do.
  assert.equal(validateWaves, validateWavesDirect);
  assert.equal(assertValidWaves, assertValidWavesDirect);
  assert.equal(validateDifficulty, validateDifficultyDirect);
  assert.equal(assertValidDifficulty, assertValidDifficultyDirect);
});

test("validateWaves rejects an unregistered enemy, a non-positive timer and a non-positive beacon hp", () => {
  assert.deepEqual(validateWaves([{ name: "坏波", enemies: ["spitter", "zombie"], seconds: 45 }]),
    { valid: false, errors: ["第 1 波：敌人“zombie”未注册"] });
  assert.deepEqual(validateWaves([{ name: "坏波", enemies: ["spitter"], seconds: 0 }]),
    { valid: false, errors: ["第 1 波：秒数不是正数"] });
  assert.deepEqual(validateWaves([{ name: "坏波", enemies: ["spitter"], seconds: -5 }]),
    { valid: false, errors: ["第 1 波：秒数不是正数"] });
  assert.deepEqual(validateWaves([{ name: "坏波", enemies: ["spitter"], seconds: "45" }]),
    { valid: false, errors: ["第 1 波：秒数不是正数"] });
  assert.deepEqual(validateWaves(DEFENSE_WAVES, { ...BEACON, hp: 0 }),
    { valid: false, errors: ["信标血量不是正数"] });
  assert.deepEqual(validateWaves(DEFENSE_WAVES, { ...BEACON, hp: -10 }),
    { valid: false, errors: ["信标血量不是正数"] });
  // Every problem is reported at once, not just the first.
  assert.deepEqual(
    validateWaves([{ name: "坏波", enemies: ["zombie"], seconds: 0 }], { ...BEACON, hp: 0 }),
    { valid: false, errors: ["第 1 波：敌人“zombie”未注册", "第 1 波：秒数不是正数", "信标血量不是正数"] });
  assert.throws(() => assertValidWaves([{ name: "坏波", enemies: ["zombie"], seconds: 45 }]),
    /波次配置校验失败：第 1 波：敌人“zombie”未注册/);
  assert.deepEqual(validateWaves(null), { valid: false, errors: ["波次配置不是数组"] });
  assert.deepEqual(validateWaves([]), { valid: false, errors: ["波次配置为空"] });
  assert.deepEqual(validateWaves([null]), { valid: false, errors: ["第 1 波不是对象"] });
  assert.deepEqual(validateWaves([{ name: "空波", enemies: [], seconds: 45 }]),
    { valid: false, errors: ["第 1 波没有敌人"] });
  assert.deepEqual(validateWaves([{ name: "坏波", seconds: 45 }]),
    { valid: false, errors: ["第 1 波没有敌人名单"] });
  assert.deepEqual(validateWaves(DEFENSE_WAVES, null),
    { valid: false, errors: ["信标配置不是对象"] });
});

test("validateDifficulty accepts the shipped table, including the range edges", () => {
  assert.deepEqual(validateDifficulty(), { valid: true, errors: [] });
  assert.deepEqual(validateDifficulty(SURVIVAL_DIFFICULTY), { valid: true, errors: [] });
  assert.equal(assertValidDifficulty(), true);
  // hpPerWave 0 and 1 are both in range, fromWave 1 is the first wave,
  // and offset 0 / period - 1 are the first and last slots.
  assert.deepEqual(validateDifficulty({ hpPerWave: 0, maxZombies: 1,
    mixIns: [{ kind: "spitter", fromWave: 1, period: 1, offset: 0 }] }), { valid: true, errors: [] });
  assert.deepEqual(validateDifficulty({ hpPerWave: 1, maxZombies: 1,
    mixIns: [{ kind: "spitter", fromWave: 1, period: 2, offset: 1 }] }), { valid: true, errors: [] });
});

test("validateDifficulty rejects a bad growth rate, a bad cap and bad mix-in rules", () => {
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY, hpPerWave: 1.5 }),
    { valid: false, errors: ["hpPerWave 必须在 0 到 1 之间（现在是 1.5）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY, hpPerWave: -0.1 }),
    { valid: false, errors: ["hpPerWave 必须在 0 到 1 之间（现在是 -0.1）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY, hpPerWave: "0.05" }),
    { valid: false, errors: ["hpPerWave 必须在 0 到 1 之间（现在是 0.05）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY, maxZombies: 0 }),
    { valid: false, errors: ["maxZombies 必须是正整数（现在是 0）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY, maxZombies: 2.5 }),
    { valid: false, errors: ["maxZombies 必须是正整数（现在是 2.5）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY,
    mixIns: [{ kind: "zombie", fromWave: 5, period: 3, offset: 2 }] }),
    { valid: false, errors: ["mixIns[0]：敌人“zombie”未注册"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY,
    mixIns: [{ kind: "spitter", fromWave: 0, period: 3, offset: 2 }] }),
    { valid: false, errors: ["mixIns[0]：fromWave 必须是正整数（现在是 0）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY,
    mixIns: [{ kind: "spitter", fromWave: 5, period: 0, offset: 0 }] }),
    { valid: false, errors: ["mixIns[0]：period 必须是正整数（现在是 0）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY,
    mixIns: [{ kind: "spitter", fromWave: 5, period: 3, offset: 3 }] }),
    { valid: false, errors: ["mixIns[0]：offset 必须在 0 到 period 之间（现在是 3，period 是 3）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY,
    mixIns: [{ kind: "spitter", fromWave: 5, period: 3, offset: -1 }] }),
    { valid: false, errors: ["mixIns[0]：offset 必须在 0 到 period 之间（现在是 -1，period 是 3）"] });
  // Every problem is reported at once, not just the first.
  assert.deepEqual(validateDifficulty({ hpPerWave: 2, maxZombies: 0,
    mixIns: [{ kind: "ghost", fromWave: 0, period: 0, offset: 9 }] }),
    { valid: false, errors: ["hpPerWave 必须在 0 到 1 之间（现在是 2）",
      "maxZombies 必须是正整数（现在是 0）", "mixIns[0]：fromWave 必须是正整数（现在是 0）",
      "mixIns[0]：period 必须是正整数（现在是 0）", "mixIns[0]：敌人“ghost”未注册"] });
  assert.throws(() => assertValidDifficulty({ ...SURVIVAL_DIFFICULTY, hpPerWave: 2 }),
    /难度配置校验失败：hpPerWave 必须在 0 到 1 之间（现在是 2）/);
  assert.deepEqual(validateDifficulty(null), { valid: false, errors: ["难度配置不是对象"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY, mixIns: "nope" }),
    { valid: false, errors: ["mixIns 不是数组"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY, mixIns: [null] }),
    { valid: false, errors: ["mixIns[0]不是对象"] });
});

test("validateEnemies accepts the shipped registry, and defense re-exports the validators", () => {
  assert.deepEqual(validateEnemies(), { valid: true, errors: [] });
  assert.deepEqual(validateEnemies(ENEMIES), { valid: true, errors: [] });
  assert.equal(assertValidEnemies(), true);
  // The validators come through defense.mjs the way the registry does.
  assert.equal(validateEnemies, validateEnemiesDirect);
  assert.equal(assertValidEnemies, assertValidEnemiesDirect);
  // An explicit attack: "melee" is valid too — the field is only
  // required to be absent or one of the two words.
  assert.deepEqual(validateEnemies({ ...ENEMIES, dasher: { ...ENEMIES.dasher, attack: "melee" } }),
    { valid: true, errors: [] });
});

test("validateEnemies rejects non-positive hp, speed, damage and cooldown", () => {
  assert.deepEqual(validateEnemies({ ...ENEMIES, dasher: { ...ENEMIES.dasher, hp: 0 } }),
    { valid: false, errors: ["敌人“dasher”：hp 不是正数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, exploder: { ...ENEMIES.exploder, speed: -1 } }),
    { valid: false, errors: ["敌人“exploder”：speed 不是正数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, breaker: { ...ENEMIES.breaker, damage: "22" } }),
    { valid: false, errors: ["敌人“breaker”：damage 不是正数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: { ...ENEMIES.spitter, cooldown: 0 } }),
    { valid: false, errors: ["敌人“spitter”：cooldown 不是正数"] });
  const { hp, ...noHp } = ENEMIES.dasher;
  assert.deepEqual(validateEnemies({ ...ENEMIES, dasher: noHp }),
    { valid: false, errors: ["敌人“dasher”：hp 不是正数"] });
});

test("validateEnemies rejects a bad attack word and a ranged kind without its throw numbers", () => {
  assert.deepEqual(validateEnemies({ ...ENEMIES, dasher: { ...ENEMIES.dasher, attack: "flying" } }),
    { valid: false, errors: ["敌人“dasher”：attack 必须是 melee 或 ranged（现在是 flying）"] });
  const { range, ...noRange } = ENEMIES.spitter;
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: noRange }),
    { valid: false, errors: ["敌人“spitter”：range 不是正数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: { ...ENEMIES.spitter, projectileSpeed: 0 } }),
    { valid: false, errors: ["敌人“spitter”：projectileSpeed 不是正数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: { ...ENEMIES.spitter, range: -2 } }),
    { valid: false, errors: ["敌人“spitter”：range 不是正数"] });
  // A melee kind needs no throw numbers: the absence is the default.
  const { attack, range: _range, projectileSpeed: _speed, ...meleeSpitter } = ENEMIES.spitter;
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: meleeSpitter }), { valid: true, errors: [] });
  // Every problem is reported at once, not just the first.
  assert.deepEqual(validateEnemies({
    dasher: { ...ENEMIES.dasher, hp: 0, attack: "flying" },
    exploder: { ...ENEMIES.exploder, damage: 0 }
  }), { valid: false, errors: ["敌人“dasher”：hp 不是正数",
    "敌人“dasher”：attack 必须是 melee 或 ranged（现在是 flying）", "敌人“exploder”：damage 不是正数"] });
  assert.throws(() => assertValidEnemies({ ...ENEMIES, dasher: { ...ENEMIES.dasher, hp: 0 } }),
    /敌人配置校验失败：敌人“dasher”：hp 不是正数/);
  assert.deepEqual(validateEnemies(null), { valid: false, errors: ["敌人配置不是对象"] });
  assert.deepEqual(validateEnemies({}), { valid: false, errors: ["敌人配置为空"] });
  assert.deepEqual(validateEnemies({ dasher: null }), { valid: false, errors: ["敌人“dasher”不是对象"] });
});

test("validateEnemies rejects a missing or bad drop table", () => {
  const { drops, ...noDrops } = ENEMIES.dasher;
  assert.deepEqual(validateEnemies({ ...ENEMIES, dasher: noDrops }),
    { valid: false, errors: ["敌人“dasher”：没有掉落表"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, dasher: { ...ENEMIES.dasher, drops: "stone" } }),
    { valid: false, errors: ["敌人“dasher”：掉落表不是数组"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, juggernaut: { ...ENEMIES.juggernaut, drops: [[BLOCK.STONE, 1], ["dragonScale", 1]] } }),
    { valid: false, errors: ["敌人“juggernaut”：掉落[1]：材料“dragonScale”未注册"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, breaker: { ...ENEMIES.breaker, drops: [[BLOCK.STONE, 0]] } }),
    { valid: false, errors: ["敌人“breaker”：掉落[0]：数量不是正整数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: { ...ENEMIES.spitter, drops: [[BLOCK.AIR, 1]] } }),
    { valid: false, errors: ["敌人“spitter”：掉落[0]：材料“0”未注册"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: { ...ENEMIES.spitter, drops: [[BLOCK.STONE]] } }),
    { valid: false, errors: ["敌人“spitter”：掉落[0]不是 [材料, 数量]"] });
  // A rare material id is a valid drop.
  assert.deepEqual(validateEnemies({ ...ENEMIES, dasher: { ...ENEMIES.dasher, drops: [["emberCore", 1]] } }),
    { valid: true, errors: [] });
  // Every problem in one entry is reported at once.
  assert.deepEqual(validateEnemies({ ...ENEMIES, dasher: { ...ENEMIES.dasher, drops: [["dragonScale", 0]] } }),
    { valid: false, errors: ["敌人“dasher”：掉落[0]：材料“dragonScale”未注册", "敌人“dasher”：掉落[0]：数量不是正整数"] });
  assert.throws(() => assertValidEnemies({ ...ENEMIES, dasher: noDrops }),
    /敌人配置校验失败：敌人“dasher”：没有掉落表/);
});

test("the batch-88 kinds sit in their design bands", () => {
  // The bands were set against the deleted walker (speed 1.52, hp 70)
  // at 1.8x / 0.6x / 1.2x; with the walker gone they are pinned as the
  // absolute numbers the tuning landed on.
  // Dasher: the fastest kind in the registry, low health, low damage,
  // a smaller body than the base kind.
  assert.ok(ENEMIES.dasher.speed > 2.7 && Object.values(ENEMIES).every(kind => kind === ENEMIES.dasher || kind.speed < ENEMIES.dasher.speed));
  assert.ok(ENEMIES.dasher.hp <= 40 && ENEMIES.dasher.hp < ENEMIES.spitter.hp && ENEMIES.dasher.damage < ENEMIES.spitter.damage);
  assert.ok(ENEMIES.dasher.width < ENEMIES.spitter.width && ENEMIES.dasher.height < ENEMIES.spitter.height);
  // Juggernaut: the slowest kind, the biggest body and health pool
  // outside the bosses, the hardest melee hit of any regular kind.
  assert.ok(ENEMIES.juggernaut.speed < 1 && Object.values(ENEMIES).every(kind => kind === ENEMIES.juggernaut || kind.speed > ENEMIES.juggernaut.speed));
  assert.ok(ENEMIES.juggernaut.hp >= 170 && ENEMIES.juggernaut.hp > ENEMIES.breaker.hp && ENEMIES.juggernaut.width > ENEMIES.breaker.width);
  assert.ok(Object.values(ENEMIES).every(kind => kind === ENEMIES.juggernaut || kind.damage <= ENEMIES.juggernaut.damage));
  // Exploder: quick, fragile, and its threat is the blast: a 1s fuse,
  // a trigger inside the blast radius, and a beacon number tuned
  // separately from the player number.
  assert.ok(ENEMIES.exploder.speed > 1.8 && ENEMIES.exploder.speed < 1.85);
  assert.equal(ENEMIES.exploder.fuseSeconds, 1);
  assert.ok(ENEMIES.exploder.blastTrigger < ENEMIES.exploder.blastRadius);
  assert.equal(ENEMIES.exploder.blastDamage, 18);
  assert.equal(ENEMIES.exploder.blastBeaconDamage, 10);
});

test("a blast kind missing any of its numbers fails validation", () => {
  for (const field of ["fuseSeconds", "blastTrigger", "blastRadius", "blastDamage", "blastBeaconDamage"]) {
    const broken = { ...ENEMIES, exploder: { ...ENEMIES.exploder, [field]: undefined } };
    assert.equal(validateEnemies(broken).valid, false, `missing ${field} must fail`);
    assert.equal(validateEnemiesDirect(broken).valid, false);
  }
  assert.equal(validateEnemies().valid, true);
});

test("a lit exploder grows a flashing core part; an unlit one does not", async () => {
  const { zombieParts } = await import("./defense.mjs");
  const count = zombie => {
    let parts = 0;
    zombieParts(zombie, ENEMIES[zombie.kind], () => parts++);
    return parts;
  };
  const base = { x: 0, y: 0, z: 0, kind: "exploder", angle: 0, walk: 0, windup: 0, cooldown: 1 };
  assert.equal(count({ ...base, fuse: .5 }), count(base) + 1);
  assert.equal(count({ kind: "breaker", x: 0, y: 0, z: 0, angle: 0, walk: 0, windup: 0, cooldown: 1, fuse: undefined }),
    count({ kind: "breaker", x: 0, y: 0, z: 0, angle: 0, walk: 0, windup: 0, cooldown: 1 }));
});
