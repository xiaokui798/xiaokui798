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
  assert.deepEqual(Object.keys(ENEMIES), ["walker", "runner", "breaker", "spitter"]);
  assert.deepEqual(ENEMIES, {
    walker: { name: "游荡者", hp: 70, speed: 1.52, reach: 1.18, damage: 10, strikeDelay: .32, cooldown: 1.28,
      width: 1, height: 1, armor: false, coat: [.24, .31, .36], skin: [.54, .57, .40], eyes: [.96, .59, .21],
      drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 1]] },
    runner: { name: "突袭者", hp: 43, speed: 2.52, reach: 1.14, damage: 6, strikeDelay: .18, cooldown: .94,
      width: .8, height: .86, armor: false, coat: [.36, .26, .27], skin: [.58, .46, .40], eyes: [.91, .34, .20],
      drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 1], [BLOCK.WOOD, 1]] },
    breaker: { name: "破城者", hp: 155, speed: 1.13, reach: 1.44, damage: 14, strikeDelay: .70, cooldown: 1.55,
      width: 1.20, height: 1.13, armor: true, coat: [.28, .27, .26], skin: [.55, .55, .50], eyes: [.89, .40, .14],
      drops: [[BLOCK.STONE, 2], [BLOCK.LEAF, 1]] },
    spitter: { name: "投掷者", hp: 55, speed: 1.25, reach: 1.0, damage: 13, strikeDelay: .55, cooldown: 2.1,
      width: .85, height: .95, armor: false, attack: "ranged", range: 7.5, projectileSpeed: 6,
      coat: [.32, .42, .22], skin: [.62, .58, .34], eyes: [.45, .85, .30],
      drops: [[BLOCK.STONE, 1], [BLOCK.LEAF, 2]] }
  });
  assert.ok(Object.isFrozen(ENEMIES));
});

test("the spitter is a ranged kind with its own numbers, and stays out of every wave roster", () => {
  const { walker, runner, breaker, spitter } = ENEMIES;
  assert.equal(spitter.attack, "ranged");
  assert.ok(spitter.range > walker.reach && spitter.range > runner.reach && spitter.range > breaker.reach,
    "its throw range must clear every melee reach");
  assert.ok(spitter.projectileSpeed > 0);
  // Each core number sits apart from the three melee kinds: frailer than
  // the walker but tougher than the runner, slower than the walker but
  // faster than the breaker, harder-hitting than the walker but softer
  // than the breaker, and the slowest attacker of the four.
  assert.ok(runner.hp < spitter.hp && spitter.hp < walker.hp && walker.hp < breaker.hp);
  assert.ok(breaker.speed < spitter.speed && spitter.speed < walker.speed && walker.speed < runner.speed);
  assert.ok(runner.damage < walker.damage && walker.damage < spitter.damage && spitter.damage < breaker.damage);
  assert.ok(spitter.cooldown > walker.cooldown && spitter.cooldown > runner.cooldown && spitter.cooldown > breaker.cooldown);
  assert.equal(spitter.armor, false);
  // The configured rosters still list no spitter — defenseWaveRoster
  // adds spitters at spawn time, one from wave 4 and two from wave 6
  // on — and every roster entry is a registered kind.
  assert.ok(DEFENSE_WAVES.every(wave => wave.enemies.every(enemy => Boolean(ENEMIES[enemy]))));
  assert.ok(DEFENSE_WAVES.every(wave => !wave.enemies.includes("spitter")));
});

test("defense waves gain spitters as they ramp: one from wave 4, two from wave 6 on, and the configured rosters stay verbatim", () => {
  assert.deepEqual(defenseWaveRoster(0), ["walker", "runner"]);
  assert.deepEqual(defenseWaveRoster(1), ["runner", "runner", "walker"]);
  assert.deepEqual(defenseWaveRoster(2), ["breaker", "walker", "runner"]);
  assert.deepEqual(defenseWaveRoster(3), ["breaker", "runner", "runner", "walker", "walker", "spitter"]);
  assert.deepEqual(defenseWaveRoster(4), ["breaker", "breaker", "runner", "runner", "walker", "walker", "spitter"]);
  // Past the configured waves the final wave repeats with two spitters,
  // and the count stays two for later waves.
  assert.deepEqual(defenseWaveRoster(5), ["breaker", "breaker", "runner", "runner", "walker", "walker", "spitter", "spitter"]);
  assert.deepEqual(defenseWaveRoster(6), ["breaker", "breaker", "runner", "runner", "walker", "walker", "spitter", "spitter"]);
  assert.deepEqual(defenseWaveRoster(9), ["breaker", "breaker", "runner", "runner", "walker", "walker", "spitter", "spitter"]);
  assert.deepEqual(defenseWaveRoster(-1), []);
  // The configured rosters are never mutated by the derivation.
  assert.deepEqual(DEFENSE_WAVES.map(wave => wave.enemies), [
    ["walker", "runner"], ["runner", "runner", "walker"], ["breaker", "walker", "runner"],
    ["breaker", "runner", "runner", "walker", "walker"], ["breaker", "breaker", "runner", "runner", "walker", "walker"]
  ]);
  assert.ok(DEFENSE_WAVES.every(wave => !wave.enemies.includes("spitter")));
  assert.ok(DEFENSE_WAVES.every(wave => wave.enemies.every(enemy => Boolean(ENEMIES[enemy]))));
});

test("defense re-exports the wave and beacon registry from waves.mjs unchanged", () => {
  assert.equal(DEFENSE_WAVES, WAVES_FROM_REGISTRY);
  assert.equal(BEACON, BEACON_FROM_REGISTRY);
  assert.deepEqual(DEFENSE_WAVES, [
    { name: "前哨接触", enemies: ["walker", "runner"], seconds: 45 },
    { name: "快速突袭", enemies: ["runner", "runner", "walker"], seconds: 49 },
    { name: "重型来袭", enemies: ["breaker", "walker", "runner"], seconds: 54 },
    { name: "两面夹击", enemies: ["breaker", "runner", "runner", "walker", "walker"], seconds: 58 },
    { name: "黎明前的攻势", enemies: ["breaker", "breaker", "runner", "runner", "walker", "walker"], seconds: 64 }
  ]);
  assert.deepEqual(BEACON, { hp: 120, radius: .43, height: 1.93, repairRange: 3.1, repairCost: 3, repairedHp: 30 });
  assert.ok(Object.isFrozen(DEFENSE_WAVES));
  assert.ok(Object.isFrozen(BEACON));
});

test("five authored waves introduce pressure before the combined final wave", () => {
  assert.equal(DEFENSE_WAVES.length, 5);
  assert.deepEqual(DEFENSE_WAVES[0].enemies, ["walker", "runner"]);
  assert.equal(DEFENSE_WAVES[2].enemies[0], "breaker");
  assert.equal(DEFENSE_WAVES[4].enemies.filter(enemy => enemy === "breaker").length, 2);
  assert.ok(DEFENSE_WAVES.every(wave => wave.enemies.length <= 7 && wave.enemies.every(enemy => Boolean(ENEMIES[enemy]))));
  assert.ok(ENEMIES.runner.speed > ENEMIES.walker.speed);
  assert.ok(ENEMIES.breaker.armor && ENEMIES.breaker.strikeDelay > ENEMIES.walker.strikeDelay);
});

test("target selection reflects the enemy role and available routes", () => {
  assert.equal(choosesBeacon("breaker", false, 9, true, false), false);
  assert.equal(choosesBeacon("breaker", true, 2, true, true), true);
  assert.equal(choosesBeacon("breaker", true, 2, true, false), false);
  assert.equal(choosesBeacon("runner", true, 3, true, true), false);
  assert.equal(choosesBeacon("runner", true, 8, true, true), true);
  assert.equal(choosesBeacon("runner", true, 8, true, false), false);
  assert.equal(choosesBeacon("walker", true, 8, true, true), false);
  assert.equal(choosesBeacon("walker", true, 8, false, true), true);
});

test("a wave spawns its whole roster, including in tight terrain", () => {
  const roster = ["breaker", "runner", "walker"];
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

test("wave six repeats the final wave with two spitters", () => {
  const roster = defenseWaveRoster(5);
  assert.equal(roster.filter(kind => kind === "spitter").length, 2);
  assert.deepEqual(roster.filter(kind => kind !== "spitter"), DEFENSE_WAVES[4].enemies);
});

test("melee targets visible body parts and respects terrain and beacon cover", () => {
  const zombie = { x: 0, y: 0, z: -2, kind: "walker", angle: 0, walk: 0 };
  const direction = [0, 0, -1];
  const aim = (origin, limit = 7, beacon = null) => findMeleeTarget(origin, direction, limit, [zombie], beacon, 0);
  assert.equal(aim([0, 1.5, 0]).zombie, zombie);
  assert.equal(aim([.38, .95, 0]).zombie, zombie);
  assert.equal(aim([.38, 1.5, 0]), null);
  assert.equal(aim([0, 1.5, 0], 1.2), null);
  assert.equal(aim([0, 1.5, 0], 7, { x: 0, y: 0, z: -1, hp: 120 }), null);
});

test("a dying zombie is no longer a melee target", () => {
  const zombie = { x: 0, y: 0, z: -2, kind: "walker", angle: 0, walk: 0, dying: .5 };
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
  // the old 1-per-kill model said (healing 963 vs 843, repair 550 vs
  // 450 over the run). R8 durability is NOT a column here: the bot
  // fights with the default stone sword and no armor, so it wears
  // nothing — but a real player's stone is shared with gear repairs
  // (5 stone each; a stone sword loses ~45 of its 100 durability to
  // the run's 45 kills), so their beacon-repair budget is this table's
  // number minus whatever they spend keeping their gear alive.
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
    [1, 2, 113, 16, 54, 20], [2, 3, 164, 22, 69, 30], [3, 3, 295, 30, 69, 40],
    [4, 6, 501, 59, 129, 70], [5, 7, 710, 73, 144, 90], [6, 8, 810, 86, 174, 100],
    [7, 8, 842, 86, 174, 100], [8, 8, 872, 86, 150, 100]
  ]);
  const total = column => balance.reduce((sum, row) => sum + row[column], 0);
  assert.equal(total(1), 45);
  assert.equal(total(2), 4307);
  assert.equal(total(3), 458);
  assert.equal(total(4), 963);
  assert.equal(total(5), 550);
  // Wave 5, the queue's example, checked rather than quoted: if every
  // zombie lands two hits it deals 146, against 144 healing that wave
  // can buy — and 146 is one and a half times the player's 100 hp, so
  // two full rounds cannot be tanked. Over the whole run two hits per
  // zombie is 916 damage against 963 healing — the totals now favor
  // healing, because the R9 damage cuts made the run's damage lower
  // than its leaf income. The run is still won by interrupting windups
  // (a sword hit resets a non-armored zombie's windup) and intercepting
  // breakers, not by out-healing: from wave 4 on, a single wave's two
  // full rounds (118–172) exceed the player's whole 100-hp bar, so no
  // amount of banked healing lets the player stand and take it.
  const wave5 = balance[4];
  assert.equal(wave5[3] * 2, 146);
  assert.ok(wave5[3] * 2 > wave5[4]);
  assert.ok(wave5[3] * 2 > 100);
  assert.ok(balance.slice(3).every(row => row[3] * 2 > 100));
  // The beacon's hard case is wave 5's focused fire: two breakers and a
  // spitter attack it at 2 × 14/1.55 + 13/2.1 ≈ 24.3 damage/s, so an
  // undefended beacon dies in under 5s — and that wave's kills can
  // repair at most 90 of its 120 hp.
  const beaconDps = 2 * ENEMIES.breaker.damage / ENEMIES.breaker.cooldown
    + ENEMIES.spitter.damage / ENEMIES.spitter.cooldown;
  assert.ok(beaconDps > 20 && beaconDps < 30);
  assert.ok(BEACON.hp / beaconDps < 5);
  assert.ok(wave5[5] < BEACON.hp);
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
  assert.deepEqual(validateWaves([{ name: "坏波", enemies: ["walker", "zombie"], seconds: 45 }]),
    { valid: false, errors: ["第 1 波：敌人“zombie”未注册"] });
  assert.deepEqual(validateWaves([{ name: "坏波", enemies: ["walker"], seconds: 0 }]),
    { valid: false, errors: ["第 1 波：秒数不是正数"] });
  assert.deepEqual(validateWaves([{ name: "坏波", enemies: ["walker"], seconds: -5 }]),
    { valid: false, errors: ["第 1 波：秒数不是正数"] });
  assert.deepEqual(validateWaves([{ name: "坏波", enemies: ["walker"], seconds: "45" }]),
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
    mixIns: [{ kind: "walker", fromWave: 1, period: 1, offset: 0 }] }), { valid: true, errors: [] });
  assert.deepEqual(validateDifficulty({ hpPerWave: 1, maxZombies: 1,
    mixIns: [{ kind: "walker", fromWave: 1, period: 2, offset: 1 }] }), { valid: true, errors: [] });
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
    mixIns: [{ kind: "walker", fromWave: 0, period: 3, offset: 2 }] }),
    { valid: false, errors: ["mixIns[0]：fromWave 必须是正整数（现在是 0）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY,
    mixIns: [{ kind: "walker", fromWave: 5, period: 0, offset: 0 }] }),
    { valid: false, errors: ["mixIns[0]：period 必须是正整数（现在是 0）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY,
    mixIns: [{ kind: "walker", fromWave: 5, period: 3, offset: 3 }] }),
    { valid: false, errors: ["mixIns[0]：offset 必须在 0 到 period 之间（现在是 3，period 是 3）"] });
  assert.deepEqual(validateDifficulty({ ...SURVIVAL_DIFFICULTY,
    mixIns: [{ kind: "walker", fromWave: 5, period: 3, offset: -1 }] }),
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
  assert.deepEqual(validateEnemies({ ...ENEMIES, walker: { ...ENEMIES.walker, attack: "melee" } }),
    { valid: true, errors: [] });
});

test("validateEnemies rejects non-positive hp, speed, damage and cooldown", () => {
  assert.deepEqual(validateEnemies({ ...ENEMIES, walker: { ...ENEMIES.walker, hp: 0 } }),
    { valid: false, errors: ["敌人“walker”：hp 不是正数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, runner: { ...ENEMIES.runner, speed: -1 } }),
    { valid: false, errors: ["敌人“runner”：speed 不是正数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, breaker: { ...ENEMIES.breaker, damage: "22" } }),
    { valid: false, errors: ["敌人“breaker”：damage 不是正数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: { ...ENEMIES.spitter, cooldown: 0 } }),
    { valid: false, errors: ["敌人“spitter”：cooldown 不是正数"] });
  const { hp, ...noHp } = ENEMIES.walker;
  assert.deepEqual(validateEnemies({ ...ENEMIES, walker: noHp }),
    { valid: false, errors: ["敌人“walker”：hp 不是正数"] });
});

test("validateEnemies rejects a bad attack word and a ranged kind without its throw numbers", () => {
  assert.deepEqual(validateEnemies({ ...ENEMIES, runner: { ...ENEMIES.runner, attack: "flying" } }),
    { valid: false, errors: ["敌人“runner”：attack 必须是 melee 或 ranged（现在是 flying）"] });
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
    walker: { ...ENEMIES.walker, hp: 0, attack: "flying" },
    runner: { ...ENEMIES.runner, damage: 0 }
  }), { valid: false, errors: ["敌人“walker”：hp 不是正数",
    "敌人“walker”：attack 必须是 melee 或 ranged（现在是 flying）", "敌人“runner”：damage 不是正数"] });
  assert.throws(() => assertValidEnemies({ ...ENEMIES, walker: { ...ENEMIES.walker, hp: 0 } }),
    /敌人配置校验失败：敌人“walker”：hp 不是正数/);
  assert.deepEqual(validateEnemies(null), { valid: false, errors: ["敌人配置不是对象"] });
  assert.deepEqual(validateEnemies({}), { valid: false, errors: ["敌人配置为空"] });
  assert.deepEqual(validateEnemies({ walker: null }), { valid: false, errors: ["敌人“walker”不是对象"] });
});

test("validateEnemies rejects a missing or bad drop table", () => {
  const { drops, ...noDrops } = ENEMIES.walker;
  assert.deepEqual(validateEnemies({ ...ENEMIES, walker: noDrops }),
    { valid: false, errors: ["敌人“walker”：没有掉落表"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, walker: { ...ENEMIES.walker, drops: "stone" } }),
    { valid: false, errors: ["敌人“walker”：掉落表不是数组"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, runner: { ...ENEMIES.runner, drops: [[BLOCK.STONE, 1], ["dragonScale", 1]] } }),
    { valid: false, errors: ["敌人“runner”：掉落[1]：材料“dragonScale”未注册"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, breaker: { ...ENEMIES.breaker, drops: [[BLOCK.STONE, 0]] } }),
    { valid: false, errors: ["敌人“breaker”：掉落[0]：数量不是正整数"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: { ...ENEMIES.spitter, drops: [[BLOCK.AIR, 1]] } }),
    { valid: false, errors: ["敌人“spitter”：掉落[0]：材料“0”未注册"] });
  assert.deepEqual(validateEnemies({ ...ENEMIES, spitter: { ...ENEMIES.spitter, drops: [[BLOCK.STONE]] } }),
    { valid: false, errors: ["敌人“spitter”：掉落[0]不是 [材料, 数量]"] });
  // A rare material id is a valid drop.
  assert.deepEqual(validateEnemies({ ...ENEMIES, walker: { ...ENEMIES.walker, drops: [["emberCore", 1]] } }),
    { valid: true, errors: [] });
  // Every problem in one entry is reported at once.
  assert.deepEqual(validateEnemies({ ...ENEMIES, walker: { ...ENEMIES.walker, drops: [["dragonScale", 0]] } }),
    { valid: false, errors: ["敌人“walker”：掉落[0]：材料“dragonScale”未注册", "敌人“walker”：掉落[0]：数量不是正整数"] });
  assert.throws(() => assertValidEnemies({ ...ENEMIES, walker: noDrops }),
    /敌人配置校验失败：敌人“walker”：没有掉落表/);
});
