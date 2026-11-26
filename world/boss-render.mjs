// Boss rendering split out of game.js (batch 55, split piece 4).
// Everything here is presentation: each function takes the frame's
// facts (the boss, the camera, the particle/decal lists) and turns
// them into vertices in its own mesh — or, for drawBossSection, into
// the shared actor mesh through the caller's pen. Nothing here
// advances the fight: advanceBoss, strikeBoss, insideHazard and the
// phase state machine stay in boss.mjs / game.js, and the events
// that spawn particles and decals (a slam landing, a phase change)
// still fire from game.js into lists it owns; this module only
// draws those lists.
//
// The GL helpers (createActorMesh / uploadActorMesh / appendModel)
// and the gl context itself are game.js's renderer core, injected
// once. The meshes below are created lazily exactly as before;
// resetMeshes mirrors the context-restore reset game.js performs
// for the meshes it still owns (the particle and glow meshes were
// never part of that reset and still are not).

import { FACES as faces, seeded } from "./terrain.mjs";
import { BOSS, COLOSSUS, BOSS_ATTACKS, GUARDIAN_WAVES, bossParts, forgeStageParts, insideHazard } from "./boss.mjs";

export function createBossRender({ gl, createActorMesh, uploadActorMesh, appendModel }) {
  let bossParticleMesh, flameMesh, colossusGlowMesh, forgeFloorMesh, forgeStageMesh, forgeAtmosphereMesh, guardianFlameMesh;
  // The release afterimage is pure presentation state: the pose a
  // windup left behind, kept dim for 0.12s after the strike.
  let bossAfterimage = null, prevBossState = null;

  function resetMeshes() {
    flameMesh = guardianFlameMesh = forgeAtmosphereMesh = forgeFloorMesh = forgeStageMesh = undefined;
  }

  function resetAfterimage() {
    bossAfterimage = null;
  }

  function drawBossBursts(particles) {
    if (!particles.length) return;
    bossParticleMesh ??= createActorMesh(256);
    const { vertices } = bossParticleMesh;
    let used = 0;
    for (const p of particles) {
      if (used + 288 > vertices.length) break;
      const fade = 1 - 0.55 * (p.age / p.life);
      for (const { d, v, light } of faces) {
        for (const corner of v) {
          vertices[used++] = p.x + (corner[0] - 0.5) * p.size;
          vertices[used++] = p.y + (corner[1] - 0.5) * p.size;
          vertices[used++] = p.z + (corner[2] - 0.5) * p.size;
          vertices[used++] = p.color[0] * light * fade;
          vertices[used++] = p.color[1] * light * fade;
          vertices[used++] = p.color[2] * light * fade;
          vertices[used++] = d[0];
          vertices[used++] = d[1];
          vertices[used++] = d[2];
          vertices[used++] = 0;
          vertices[used++] = 7 / 12;
          vertices[used++] = 0.5;
        }
      }
    }
    uploadActorMesh(bossParticleMesh, used);
  }

  function drawDragonFire({ boss, yaw, pitch }) {
    if (!boss?.dragons.length) return;
    flameMesh ??= createActorMesh(1024);
    let used = 0;
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const upX = -rightZ * Math.sin(pitch), upZ = rightX * Math.sin(pitch), upY = Math.cos(pitch);
    function glow(x, y, z, size, r, g, b) {
      for (const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        flameMesh.vertices.set([x + size*(rightX*u + upX*v), y + size*upY*v,
          z + size*(rightZ*u + upZ*v), r,g,b,u,v,0,-8,0,0], used);
        used += 12;
      }
    }
    for (const d of boss.dragons) {
      if (!d.trail.length) continue;
      const s = d.headingS ?? d.s, c = d.headingC ?? d.c;
      for (let i = 0; i < d.trail.length; i++) {
        const p = d.trail[i], taper = 1 - i/32;
        const flicker = Math.sin(22*boss.elapsed + i*.75 + d.lane);
        const radius = (.18 + .32*taper) * (1 + .12*flicker);
        glow(p.x,p.y,p.z,radius*1.85,.44*taper,.042*taper,.005);
        glow(p.x,p.y,p.z,radius,.8*taper,.32*taper,.032*taper);
        const loft = (1-taper) * (1.1 + .45*flicker);
        glow(p.x + c*.22*flicker,p.y + loft,p.z - s*.22*flicker,
          radius*.46,.9*taper,.18*taper,.01);
      }
      for (const side of [-1,1]) for (let j=0; j<9; j++) {
        const f=j/8, lateral=side*(.16+.41*f);
        glow(d.x + c*lateral - s*f*.48,d.y+.14+.52*f,d.z-s*lateral-c*f*.48,
          .17-.09*f,1,.54,.12);
        if (j>3) glow(d.x+c*lateral-s*f*.72,d.y+.12+.37*f,d.z-s*lateral-c*f*.72,.08,1,.34,.06);
      }
      glow(d.x,d.y,d.z,.53,1,.65,.18);
      glow(d.x+s*.36,d.y-.06,d.z+c*.36,.31,1,.82,.38);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    uploadActorMesh(flameMesh, used);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  // The colossus rides on four thruster glows under its feet
  // (batch 49); they breathe with the same 3s hover cycle that
  // moves the body, so the lift reads as thrust, not floating.
  function drawColossusThrusters({ boss, yaw, pitch }) {
    if (!boss || boss.profile !== COLOSSUS || boss.hp <= 0) return;
    colossusGlowMesh ??= createActorMesh(64);
    let used = 0;
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const upX = -rightZ * Math.sin(pitch), upZ = rightX * Math.sin(pitch), upY = Math.cos(pitch);
    const s = Math.sin(boss.angle), c = Math.cos(boss.angle);
    const quad = (x, y, z, size, r, g, b) => {
      if (used + 48 > colossusGlowMesh.vertices.length) return;
      const h = size / 2;
      const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
      for (const [ox, oy] of corners) {
        colossusGlowMesh.vertices[used++] = x + rightX * ox + upX * oy;
        colossusGlowMesh.vertices[used++] = y + upY * oy;
        colossusGlowMesh.vertices[used++] = z + rightZ * ox + upZ * oy;
        colossusGlowMesh.vertices[used++] = r; colossusGlowMesh.vertices[used++] = g; colossusGlowMesh.vertices[used++] = b;
        colossusGlowMesh.vertices[used++] = 0; colossusGlowMesh.vertices[used++] = 0; colossusGlowMesh.vertices[used++] = 1;
        colossusGlowMesh.vertices[used++] = -10;
        colossusGlowMesh.vertices[used++] = 0; colossusGlowMesh.vertices[used++] = 0;
      }
    };
    for (let i = 0; i < 4; i++) {
      const ox = (i % 2 ? .85 : -.85), oz = (i < 2 ? .55 : -.55);
      const stretch = .5 + .5 * Math.sin(boss.elapsed * (2 * Math.PI / 3) + i * 1.7);
      quad(boss.x + ox * c + oz * s, boss.y + .14, boss.z - ox * s + oz * c,
        .26 + .14 * stretch, .42 * .8, .50 * .8, 1 * .8);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    uploadActorMesh(colossusGlowMesh, used);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  // A fixed field of broken molten seams replaces the chessboard feeling of
  // the old arena floor.  The shader animates flow inside each seam, while the
  // uneven segments keep them from reading as a set of decorative circles.
  function drawForgeFloor(boss) {
    if (boss?.profile !== BOSS || !boss.hp) return;
    forgeFloorMesh ??= createActorMesh(260);
    const { vertices } = forgeFloorMesh;
    const { x: cx, z: cz, floor } = boss.profile.arena;
    let used = 0;
    const quad = (a, b, c, d) => {
      if (used + 48 > vertices.length) return;
      for (const [x, z] of [a, b, c, d]) {
        vertices.set([x, floor + .036, z, 1, .07, .006, 0, 1, 0, -11, 0, 0], used);
        used += 12;
      }
    };
    const seam = (x1, z1, x2, z2, width) => {
      const dx = x2 - x1, dz = z2 - z1, length = Math.hypot(dx, dz) || 1;
      const nx = -dz / length * width, nz = dx / length * width;
      quad([x1 + nx, z1 + nz], [x1 - nx, z1 - nz], [x2 - nx, z2 - nz], [x2 + nx, z2 + nz]);
    };
    // Twelve jagged branches spread out from the furnace plate.  Each branch
    // is deliberately broken into mismatched lengths and offsets.
    for (let branch = 0; branch < 12; branch++) {
      const angle = branch / 12 * Math.PI * 2 + .19 * Math.sin(branch * 4.2);
      let x = cx + Math.sin(angle) * (1.8 + (branch % 3) * .12);
      let z = cz + Math.cos(angle) * (1.8 + (branch % 3) * .12);
      for (let segment = 0; segment < 4; segment++) {
        const step = 1.03 + ((branch * 7 + segment * 5) % 4) * .22;
        const wobble = Math.sin(branch * 3.1 + segment * 2.4) * .21;
        const nx = x + Math.sin(angle + wobble) * step;
        const nz = z + Math.cos(angle + wobble) * step;
        seam(x, z, nx, nz, .045 + ((branch + segment) % 3) * .023);
        x = nx + Math.cos(angle) * .12;
        z = nz - Math.sin(angle) * .12;
      }
    }
    // The central grate has irregular cuts rather than a clean target-like
    // ring.  It anchors the boss visually without obscuring dodge space.
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * Math.PI * 2, b = a + (.15 + (i % 3) * .012);
      const r = 3.32 + Math.sin(i * 4.3) * .14;
      const r2 = r + .20 + (i % 4) * .026;
      quad([cx + Math.sin(a) * r, cz + Math.cos(a) * r], [cx + Math.sin(a) * r2, cz + Math.cos(a) * r2],
        [cx + Math.sin(b) * r2, cz + Math.cos(b) * r2], [cx + Math.sin(b) * r, cz + Math.cos(b) * r]);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    uploadActorMesh(forgeFloorMesh, used);
  }

  function drawForgeStage(boss) {
    if (boss?.profile !== BOSS || !boss.hp) return;
    forgeStageMesh ??= createActorMesh(860);
    const used = appendModel(forgeStageMesh.vertices, 0, forgeStageParts(boss));
    uploadActorMesh(forgeStageMesh, used);
  }

  // This is the arena's always-on stage layer: drifting slag, breathing vent
  // plumes, and hot air around the perimeter.  It makes the room feel like a
  // functioning furnace even during the beats between attacks.
  function drawForgeAtmosphere({ boss, yaw, pitch }) {
    if (boss?.profile !== BOSS || !boss.hp) return;
    forgeAtmosphereMesh ??= createActorMesh(720);
    let used = 0;
    const { x: cx, z: cz, floor, radius } = boss.profile.arena;
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const upX = -rightZ * Math.sin(pitch), upZ = rightX * Math.sin(pitch), upY = Math.cos(pitch);
    const hot = boss.phase === 1 ? [1, .13, .012] : boss.phase === 2 ? [1, .28, .018] : [1, .49, .05];
    const glow = (x, y, z, size, r, g, b) => {
      if (used + 48 > forgeAtmosphereMesh.vertices.length) return;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        forgeAtmosphereMesh.vertices.set([x + size * (rightX * u + upX * v), y + size * upY * v,
          z + size * (rightZ * u + upZ * v), r, g, b, u, v, 0, -8, 0, 0], used);
        used += 12;
      }
    };
    // Sparse rising embers are anchored in 3D; their speed and height vary so
    // they read as depth rather than a 2D particle overlay.
    for (let i = 0; i < 76; i++) {
      const seed = seeded(i + 71, boss.phase * 19 + 3);
      const angle = i * 2.39996 + seed * 5.7;
      const ring = 2.4 + (i % 11) * .83;
      const cycle = (boss.elapsed * (.22 + (i % 5) * .045) + seed) % 1;
      const sway = Math.sin(boss.elapsed * (1.5 + seed) + i * 1.9) * .23;
      glow(cx + Math.cos(angle) * ring + sway, floor + .18 + cycle * (1.9 + (i % 4) * .34),
        cz + Math.sin(angle) * ring + Math.cos(boss.elapsed + i) * .14,
        .018 + (i % 4) * .010, hot[0] * (.12 + cycle * .18), hot[1] * (.16 + cycle * .23), hot[2] * (.2 + cycle * .3));
    }
    // Six vents around the wall leave broad, slow columns of heat that frame
    // the fight without masking the player or the dodge telegraphs.
    for (let vent = 0; vent < 6; vent++) {
      const angle = vent / 6 * Math.PI * 2 + .25;
      const vx = cx + Math.sin(angle) * (radius - 1.35), vz = cz + Math.cos(angle) * (radius - 1.35);
      for (let layer = 0; layer < 7; layer++) {
        const t = layer / 6;
        const flutter = Math.sin(boss.elapsed * 3.7 + vent * 2.2 + layer) * (.11 + t * .19);
        const intensity = (.18 + (1 - t) * .18) * (boss.state === "attack" ? 1.35 : 1);
        glow(vx + flutter, floor + .25 + t * 2.9, vz - flutter * .5, .17 + t * .24,
          hot[0] * intensity, hot[1] * intensity, hot[2] * intensity);
      }
    }
    if (boss.state === "attack" && boss.attack?.kind === "shock") {
      const action = boss.attack;
      for (let i = 0; i < 48; i++) {
        const a = i / 48 * Math.PI * 2;
        const r = action.radius + Math.sin(i * 2.7 + boss.elapsed * 14) * .17;
        glow(action.x + Math.sin(a) * r, floor + .11 + (i % 3) * .055, action.z + Math.cos(a) * r,
          .052 + (i % 4) * .016, .95, .10 + (i % 3) * .04, .01);
      }
    }
    if ((boss.state === "windup" || boss.state === "attack") && boss.attack?.kind === "sweep") {
      const action = boss.attack, plan = BOSS_ATTACKS.sweep;
      const windup = boss.state === "windup" ? 1 - boss.time / action.windup : 1;
      const reach = plan.reach * (.28 + windup * .72);
      for (let i = 0; i < 36; i++) {
        const angle = action.angle - plan.arc + 2 * plan.arc * i / 35;
        const r = reach * (.72 + (i % 4) * .08);
        glow(action.x + Math.sin(angle) * r, floor + .18 + (i % 3) * .075, action.z + Math.cos(angle) * r,
          .052 + (i % 3) * .019, 1, .16 + windup * .18, .01);
      }
    }
    if (boss.state === "windup" && boss.attack?.marks) {
      for (const mark of boss.attack.marks) for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 + boss.elapsed * 2.4;
        const r = .45 + (i % 3) * .26;
        glow(mark.x + Math.sin(a) * r, floor + .16 + (i % 4) * .16, mark.z + Math.cos(a) * r,
          .045 + (i % 2) * .02, 1, .16, .01);
      }
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    uploadActorMesh(forgeAtmosphereMesh, used);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  // The guardian deliberately uses soft, additive billboards instead of more
  // voxel geometry.  Its silhouette can remain readable against the arena,
  // while heat, cinders, and pressure now move continuously through a move.
  function drawGuardianFire({ boss, yaw, pitch }) {
    if (boss?.profile !== BOSS || !boss.hp) return;
    const active = boss.state === "windup" || boss.state === "attack";
    const vulnerable = boss.state === "recovery";
    const shifting = boss.phaseShift > 0;
    const energized = active || vulnerable || shifting || boss.hurt > 0;
    if (!energized) return;
    guardianFlameMesh ??= createActorMesh(420);
    let used = 0;
    const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
    const upX = -rightZ * Math.sin(pitch), upZ = rightX * Math.sin(pitch), upY = Math.cos(pitch);
    const phase = boss.phase;
    const action = boss.attack;
    const windup = boss.state === "windup" && action ? 1 - boss.time / action.windup : 0;
    const release = boss.state === "attack" && action
      ? 1 - boss.time / BOSS_ATTACKS[action.kind].duration : 0;
    const charge = shifting ? .82 + .18 * Math.sin(boss.elapsed * 22) ** 2
      : boss.state === "attack" ? 1 - release * .86 : Math.min(1, windup * 1.12);
    const cool = vulnerable ? [0.22, 1, .84] : phase === 1 ? [1, .24, .035]
      : phase === 2 ? [1, .39, .045] : [1, .58, .10];
    const glow = (x, y, z, size, alpha = 1, lift = 0) => {
      if (used + 48 > guardianFlameMesh.vertices.length) return;
      const r = cool[0] * alpha, g = cool[1] * alpha, b = cool[2] * alpha;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        guardianFlameMesh.vertices.set([x + size * (rightX * u + upX * v), y + lift + size * upY * v,
          z + size * (rightZ * u + upZ * v), r, g, b, u, v, 0, -9, 0, 0], used);
        used += 12;
      }
    };
    const emberCount = vulnerable ? 17 : 10 + phase * 4;
    for (let i = 0; i < emberCount; i++) {
      const seed = i * 2.39996 + phase * .83;
      const drift = boss.elapsed * (1.8 + (i % 3) * .23) + seed;
      const radius = .27 + (i % 5) * .095 + charge * .48;
      const rise = (i / emberCount) * (1.35 + charge * .82);
      const orbit = drift + Math.sin(drift * .71) * .32;
      const pulse = .66 + .34 * Math.sin(drift * 3.7 + i);
      glow(boss.x + Math.cos(orbit) * radius, boss.y + .84 + rise,
        boss.z + Math.sin(orbit) * radius, (.045 + (i % 4) * .011) * pulse * (1 + charge), .44 + .56 * charge, rise * .06);
    }
    // A two-part plume sells a furnace instead of a flat emissive rectangle.
    const plume = .22 + charge * .18 + (vulnerable ? .10 : 0);
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const wobble = Math.sin(boss.elapsed * 9 + i * 1.7) * (.08 + t * .07);
      glow(boss.x + wobble, boss.y + 1.55 + t * (1.15 + charge), boss.z + Math.cos(boss.elapsed * 7 + i) * .08,
        plume * (1 - t * .56), (1 - t * .48) * (.48 + charge * .52), t * .12);
    }
    if (shifting) {
      // A quick ignition halo makes the new furnace configuration legible
      // before it starts using that wave's attacks.
      for (let i = 0; i < 24; i++) {
        const angle = i / 24 * Math.PI * 2 + boss.elapsed * 4;
        const radius = .7 + (1 - boss.phaseShift / 1.2) * 1.45;
        glow(boss.x + Math.sin(angle) * radius, boss.y + 1.55 + (i % 3) * .16,
          boss.z + Math.cos(angle) * radius, .065 + (i % 4) * .018, .86, .08);
      }
    }
    if (action?.kind === "flare" && active) {
      // Each marked landing gets its own shell. The trail samples earlier
      // positions on the same arc and converges on the actual damage point.
      for (const [index, mark] of action.marks.entries()) {
        const side = index === 0 ? -1 : 1;
        const ox = boss.x + side * 1.16 * Math.cos(boss.angle);
        const oz = boss.z - side * 1.16 * Math.sin(boss.angle);
        if (boss.state === "windup") {
          for (let i = 0; i < 16; i++) {
            const t = windup - i * .012;
            if (t < 0) break;
            const y = (1 - t) * 3.24 + 15 * t * (1 - t);
            const size = 1 - i / 16;
            glow(ox + (mark.x - ox) * t, boss.y + .12 + y, oz + (mark.z - oz) * t,
              .08 + .31 * size, size);
          }
        } else {
          for (let i = 0; i < 18; i++) {
            const angle = i * 2.39996;
            const radius = release * (1 + i % 4 * .35);
            glow(mark.x + Math.sin(angle) * radius, boss.y + .12 + release * (1 - release) * (3 + i % 3),
              mark.z + Math.cos(angle) * radius, .07 + .14 * (1 - release), 1 - release);
          }
        }
      }
    }
    if (action?.kind === "nova" && boss.state === "attack") {
      for (const [index, wave] of action.waves.entries()) {
        if (wave.radius === null) continue;
        for (let i = 0; i < 40; i++) {
          const angle = (i + index * .5) * Math.PI / 20;
          const height = .13 + .21 * Math.sin(i * 4.1 + action.elapsed * 9) ** 2;
          glow(action.x + Math.sin(angle) * wave.radius, boss.y + height,
            action.z + Math.cos(angle) * wave.radius, index ? .17 : .11, .86);
        }
      }
    }
    if (boss.state === "attack" && action?.kind === "shock") {
      // Slag leaves the striking face in a low ballistic fan. Sample the
      // contact point in the locked attack frame so sparks stay on the floor.
      const age = release * BOSS_ATTACKS.shock.duration;
      const sin = Math.sin(action.angle), cos = Math.cos(action.angle);
      const contactX = action.x - 1.91 * cos + 2.36 * sin;
      const contactZ = action.z + 1.91 * sin + 2.36 * cos;
      for (let shard = 0; shard < 30; shard++) {
        const bearing = shard * 2.39996;
        const speed = 1.4 + (shard % 7) * .48;
        const lift = age * (2.8 + (shard % 5) * .58 - 7.6 * age);
        if (lift < 0) continue;
        const travel = speed * age;
        glow(contactX + travel * Math.sin(bearing), boss.y + .12 + lift,
          contactZ + travel * Math.cos(bearing), .045 + (shard % 3) * .017, 1 - release);
      }
      // Tiny vertical tongues on the advancing shock front make it feel like
      // it is tearing through the floor instead of being a painted ring.
      const start = action.radius - .36, end = action.radius + .28;
      for (let i = 0; i < 24; i++) {
        const angle = i / 24 * Math.PI * 2 + boss.elapsed * .35;
        const radius = start + (end - start) * ((i % 3) / 2);
        glow(action.x + Math.sin(angle) * radius, boss.y + .16, action.z + Math.cos(angle) * radius,
          .07 + (i % 2) * .024, .68, .08 + (i % 4) * .035);
      }
    }
    if (boss.state === "attack" && action?.kind === "ram") {
      const s = Math.sin(action.angle), c = Math.cos(action.angle);
      for (let i = 0; i < 18; i++) {
        const distance = Math.max(0, action.travelled - i * .22);
        const side = Math.sin(i * 2.4 + boss.elapsed * 18) * (.22 + i * .012);
        glow(action.x + s * distance + c * side, boss.y + .35 + (i % 4) * .12,
          action.z + c * distance - s * side, .10 + (18 - i) * .004, .58, i * .025);
      }
      // Dust puffs kicked up along the path (batch 49): a fat, dim
      // puff roughly every step of the charge.
      for (let i = 0; i < 10; i++) {
        const distance = Math.max(0, action.travelled - i * .8);
        glow(action.x + s * distance, boss.y + .20, action.z + c * distance, .34, .16);
      }
    }
    // Sweep sparks (batch 49): once the white arc band has passed,
    // the sector rim sheds a row of sparks for 0.3s into recovery.
    if (action?.kind === "sweep" && (boss.state === "attack"
      || (boss.state === "recovery" && boss.time > GUARDIAN_WAVES[boss.phase - 1].recovery - .3))) {
      const plan = BOSS_ATTACKS.sweep;
      for (let i = 0; i < 14; i++) {
        const a = action.angle - plan.arc + (i / 13) * plan.arc * 2;
        glow(boss.x + Math.sin(a) * plan.reach * .92, boss.y + .32, boss.z + Math.cos(a) * plan.reach * .92, .06, .8);
      }
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    uploadActorMesh(guardianFlameMesh, used);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  // The boss's share of the shared actor pass: posed model (or
  // the part-built fallback), the release afterimage, the ground
  // telegraphs and the decals strikes leave behind. It writes into
  // the caller's pen — the same vertex array and cursor the zombie
  // and beacon sections use — so the actor mesh's contents and
  // order are exactly what the fused pass produced. frame.box is
  // the caller's part writer (it advances the same pen).
  function drawBossSection(pen, frame) {
    const { boss, bossModel, player, finished, covered, decals, box } = frame;
    function groundArc(action, inner, outer, span, y, color) {
      const start = action.angle - span / 2;
      const pieces = Math.ceil(64 * span / (2 * Math.PI));
      if (pen.used + pieces * 48 > pen.vertices.length) return;
      function vertex(angle, radius) {
        pen.vertices.set([action.x + Math.sin(angle) * radius, y, action.z + Math.cos(angle) * radius,
          ...color, 0, 1, 0, 0, 0, 0], pen.used);
        pen.used += 12;
      }
      for (let i = 0; i < pieces; i++) {
        const a = start + span * i / pieces, b = start + span * (i + 1) / pieces;
        vertex(a, inner);
        vertex(b, inner);
        vertex(b, outer);
        vertex(a, outer);
      }
    }
    function groundStrip(action, left, right, length, y, color) {
      if (pen.used + 48 > pen.vertices.length) return;
      const s = Math.sin(action.angle), c = Math.cos(action.angle);
      for (const [side, forward] of [[left, 0], [right, 0], [right, length], [left, length]]) {
        pen.vertices.set([action.x + c * side + s * forward, y, action.z - s * side + c * forward,
          ...color, 0, 1, 0, 0, 0, 0], pen.used);
        pen.used += 12;
      }
    }
    // A vertical light pillar (batch 48): an 8-sided open prism over
    // a landing mark, readable at eye level — no looking down for
    // the ring. Half-brightness rim colour stands in for translucency
    // in this opaque mesh.
    function groundPillar(x, z, radius, height, y, color) {
      if (pen.used + 8 * 48 > pen.vertices.length) return;
      function vertex(angle, top) {
        pen.vertices.set([x + Math.sin(angle) * radius, y + (top ? height : 0), z + Math.cos(angle) * radius,
          ...color, 0, 1, 0, 0, 0, 0], pen.used);
        pen.used += 12;
      }
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * 2 * Math.PI, b = (i + 1) / 8 * 2 * Math.PI;
        vertex(a, 0);
        vertex(b, 0);
        vertex(b, 1);
        vertex(a, 1);
      }
    }
      const s = Math.sin(boss.angle), c = Math.cos(boss.angle);
      // Release afterimage (batch 49): when a windup lets go, the
      // pose it left keeps a dim ghost for 0.12s behind the strike.
      if (bossModel && prevBossState === "windup" && boss.state === "attack" && !bossAfterimage) {
        bossAfterimage = { parts: bossModel.map(part => ({ ...part, color: part.color.map(v => v * .38) })), until: boss.elapsed + .12 };
      }
      if (bossAfterimage) {
        if (boss.elapsed < bossAfterimage.until) pen.used = appendModel(pen.vertices, pen.used, bossAfterimage.parts, 0);
        else bossAfterimage = null;
      }
      prevBossState = boss.state;
      if (bossModel) pen.used = appendModel(pen.vertices, pen.used, bossModel, boss.hurt);
      else bossParts(boss, (...part) => box(boss, s, c, ...part));
      if (boss.attack && (boss.state === "windup" || boss.state === "attack")) {
        const action = boss.attack, plan = BOSS_ATTACKS[action.kind];
        const striking = boss.state === "attack";
        const cold = boss.profile === COLOSSUS;
        // Batch 48 telegraph paint, three layers on every shape: a
        // black underlay wider than the rim (so the shape separates
        // from the arena's own decoration), a brightened fill that
        // grows with the windup, and a rim that pulses faster as the
        // release nears — flashing white in the last quarter second,
        // solid white while the player stands inside the hazard.
        // The rim always draws the final shape from the first frame;
        // the fill growing to meet it is the clock.
        const progress = striking ? 1 : 1 - boss.time / action.windup;
        const comboProgress = action.comboTotal
          ? Math.min(1, Math.max(0, (boss.elapsed - action.comboStart) / action.comboTotal)) : null;
        const baseEdge = cold ? [1, .45, .64] : [.99, .29, .12];
        const fill = cold ? [.55, .26, .50] : [.62, .22, .13];
        const heat = striking ? (cold ? [.75, .28, .57] : [.93, .33, .10]) : fill;
        const under = [.015, .015, .02];
        const underlay = .3;
        let edge = striking ? (cold ? [1, .75, .87] : [1, .61, .20]) : baseEdge;
        if (!striking) {
          if (boss.time <= .25) edge = Math.sin(boss.elapsed * 40) > 0 ? [1, 1, 1] : baseEdge;
          else {
            const pulse = .75 + .25 * Math.sin(boss.elapsed * (2 + 6 * progress) * 2 * Math.PI);
            edge = baseEdge.map(v => v * pulse);
          }
        }
        if (!finished && insideHazard(boss, { ...player, covered })) edge = [1, 1, 1];
        const full = 2 * Math.PI;
        const y = boss.y + .025;
        function telegraphStrip(stripAction, left, right, length, fillColor, rimColor) {
          groundStrip(stripAction, left - underlay, right + underlay, length + underlay, y - .012, under);
          const grown = Math.max(.05, length * progress);
          const segments = Math.max(1, Math.round(grown));
          for (let i = 0; i < segments; i++) {
            const from = grown * i / segments, to = grown * (i + 1) / segments;
            const seg = { ...stripAction, x: stripAction.x + Math.sin(stripAction.angle) * from, z: stripAction.z + Math.cos(stripAction.angle) * from };
            groundStrip(seg, left, right, to - from, y, i % 2 ? fillColor.map(v => v * .7) : fillColor);
          }
          groundStrip(stripAction, left, left + .13, length, y + .017, rimColor);
          groundStrip(stripAction, right - .13, right, length, y + .017, rimColor);
          // Chevrons scroll outward along both edges: the way out
          // of a strip is sideways, drawn on the strip itself.
          const phase = (boss.elapsed * 2.4) % 1.2;
          for (let d = phase; d < length; d += 1.2) {
            for (const sideSign of [-1, 1]) {
              const edgeCoord = sideSign < 0 ? left : right;
              const base = { ...stripAction,
                x: stripAction.x + Math.sin(stripAction.angle) * d + Math.cos(stripAction.angle) * edgeCoord,
                z: stripAction.z + Math.cos(stripAction.angle) * d - Math.sin(stripAction.angle) * edgeCoord,
                angle: stripAction.angle + sideSign * Math.PI / 2 };
              groundStrip(base, -.13, .13, .45, y + .02, rimColor);
            }
          }
        }
        function telegraphCircle(circle, radius, fillColor, rimColor) {
          groundArc(circle, 0, radius + underlay, full, y - .012, under);
          groundArc(circle, 0, Math.max(.05, radius * progress), full, y, fillColor);
          groundArc(circle, radius - .16, radius, full, y + .017, rimColor);
        }
        // Four tabs circling inside a landing mark, pointing the
        // way out of the circle.
        function escapeTabs(cx, cz, radius, rimColor) {
          for (let i = 0; i < 4; i++) {
            const a = boss.elapsed * 1.5 + i * Math.PI / 2;
            const tab = { x: cx + Math.sin(a) * radius * .6, z: cz + Math.cos(a) * radius * .6, angle: a };
            groundStrip(tab, -.16, .16, .5, y + .02, rimColor);
          }
        }
        // A shrinking ring at the player's own feet: its radius is
        // the gap between an incoming wavefront and the player
        // (clamped to 6), and it turns white in the last 0.35s
        // before the wave arrives — jump when it does.
        function countdownRing(center, radii, speed) {
          const distance = Math.hypot(player.x - center.x, player.z - center.z);
          for (const radius of radii) {
            const gap = distance - radius;
            if (gap < -.6 || gap > 6.6) continue;
            const ring = Math.max(.12, Math.min(6, gap));
            const at = { x: player.x, z: player.z, angle: 0 };
            groundArc(at, ring - .10, ring + .10, full, y + .03, gap / speed < .35 ? [1, 1, 1] : edge);
          }
        }
        if (action.kind === "prism") {
          const rim = striking ? [1, .88, .57] : edge;
          const prismFill = striking ? [1, .53, .23] : fill;
          for (const track of plan.tracks) {
            telegraphStrip(action, track - plan.width, track + plan.width, plan.reach, prismFill, rim);
            if (striking) groundStrip(action, track - .25, track + .25, plan.reach, y + .17, rim);
          }
        } else if (action.kind === "nova") {
          if (!striking) {
            groundArc(action, 0, 2.52 + underlay, full, y - .012, under);
            groundArc(action, 0, 2.52 * progress, full, y, heat);
            groundArc(action, 1.48, 1.93, full, y + .01, heat);
            groundArc(action, 2.34, 2.52, full, y + .017, edge);
          } else {
            for (const wave of action.waves) {
              if (wave.radius === null) continue;
              groundArc(action, wave.radius - .52, wave.radius + .52, full, y, heat);
              groundArc(action, wave.radius + .34, wave.radius + .52, full, y + .017, edge);
            }
            countdownRing(action, action.waves.filter(wave => wave.radius !== null).map(wave => wave.radius),
              (plan.reach - 1.72) / (plan.duration - .82));
          }
        } else if (action.kind === "ram") {
          telegraphStrip(action, -plan.width, plan.width, action.length, heat, edge);
          if (boss.phase === 3 && action.leg !== 2) {
            // The return line (batch 61): dashed and dim from the
            // moment the first leg launches, running back from
            // its stop point; when the second leg winds up, its
            // own solid strip above replaces the preview.
            const back = { x: action.x + Math.sin(action.angle) * action.length,
              z: action.z + Math.cos(action.angle) * action.length, angle: action.angle + Math.PI };
            const dim = edge.map(v => v * .45);
            for (let d = .3; d + .55 <= action.length; d += 1.1) {
              const dash = { ...back, x: back.x + Math.sin(back.angle) * d, z: back.z + Math.cos(back.angle) * d };
              groundStrip(dash, -plan.width, plan.width, .55, y + .005, dim);
            }
          }
        } else if (action.marks) {
          for (const mark of action.marks) {
            const circle = { ...mark, angle: 0 };
            telegraphCircle(circle, plan.reach, heat, edge);
            groundPillar(mark.x, mark.z, plan.reach * .92, 9, y, edge.map(v => v * .5));
            escapeTabs(mark.x, mark.z, plan.reach, edge);
          }
        } else if (action.kind === "rift") {
          telegraphStrip(action, -action.width, action.width, plan.reach, heat, edge);
          if (striking) groundStrip(action, -.26, .26, plan.reach, y + .017, edge);
        } else if (action.kind === "shock") {
          if (!striking) {
            groundArc(action, 0, 2.20 + underlay, full, y - .012, under);
            groundArc(action, 0, 2.20 * (comboProgress ?? progress), full, y, heat);
            groundArc(action, 2.05, 2.20, full, y + .017, edge);
          } else {
            const radius = action.radius;
            groundArc(action, Math.max(0, radius - .45), radius + .45, full, y, heat);
            groundArc(action, radius + .26, radius + .44, full, y + .017, edge);
            countdownRing(action, [radius], (plan.reach - 1.35) / plan.duration);
          }
        } else {
          const isSweep = action.kind === "sweep";
          if (isSweep) {
            const span = plan.arc * 2 * (striking ? 1 : Math.max(.12, progress));
            groundArc(action, 0, plan.reach + underlay, plan.arc * 2, y - .012, under);
            groundArc(action, 0, plan.reach * (.28 + .72 * progress), span, y, heat);
            groundArc(action, plan.reach - .17, plan.reach, plan.arc * 2, y + .017, edge);
            // Three radial arrows point out of the sector: the
            // short way out is sideways, drawn on the ground.
            if (progress > .3) for (const off of [-plan.arc / 2, 0, plan.arc / 2]) {
              const a = action.angle + off;
              const arrow = { x: action.x + Math.sin(a) * plan.reach * .34, z: action.z + Math.cos(a) * plan.reach * .34, angle: a };
              groundStrip(arrow, -.15, .15, plan.reach * .58, y + .02, edge.map(v => v * (.4 + .6 * progress)));
            }
            // The strike itself sweeps a white arc band across the
            // sector, leading edge to trailing edge (batch 49).
            if (striking) {
              const sweepCenter = action.angle - plan.arc + 2 * plan.arc * (1 - boss.time / plan.duration);
              groundArc({ ...action, angle: sweepCenter }, plan.reach * .55, plan.reach * .55 + .5, .5, y + .05, [1, 1, 1]);
            }
            // The declared follow-up (batch 61): the combo shock's
            // disc charges at the guardian's feet from the sweep's
            // first frame, on the combo clock, so the second stage
            // is lit before the first one lands (design §3 rule 5).
            if (action.next && comboProgress !== null) {
              groundArc(action, 0, 2.20 + underlay, full, y - .012, under);
              groundArc(action, 0, Math.max(.05, 2.20 * comboProgress), full, y, heat);
              groundArc(action, 2.05, 2.20, full, y + .017, edge);
            }
          } else {
            const circle = { ...action, angle: 0 };
            telegraphCircle(circle, plan.reach, heat, edge);
            if (action.kind === "meteor") {
              groundPillar(action.x, action.z, plan.reach * .92, 9, y, edge.map(v => v * .5));
              escapeTabs(action.x, action.z, plan.reach, edge);
              const altitude = striking ? .08 : .16 + 8.5 * (boss.time / action.windup) ** 1.6;
              const crystal = { x: action.x, y: y + altitude, z: action.z, hurt: 0 };
              const angle = boss.elapsed * 3;
              const sin = Math.sin(angle), cos = Math.cos(angle);
              box(crystal, sin, cos, -.60, .20, -.60, 1.20, .84, 1.20, ...edge);
              box(crystal, sin, cos, -.32, 0, -.32, .64, 1.38, .64, ...heat);
            }
            if (action.kind === "repel" && !striking) {
              // The shortest windup in the game gets its first
              // ripple early: a ring that reaches full size a beat
              // before the blast, buying reading time. Numbers stay.
              const early = Math.min(1, progress * 1.3);
              groundArc(circle, Math.max(0, plan.reach * early - .14), plan.reach * early, full, y + .02, edge);
            }
          }
        }
      }
      // Ground decals (batch 49): the marks strikes leave behind —
      // crack rings, scorch, the rift's tear, the phase ring. They
      // fade by sinking toward black, which the dark floors read
      // as disappearing.
      for (const decal of decals) {
        const fade = Math.max(0, 1 - decal.age / decal.ttl);
        const dy = boss.y + .028;
        const at = { x: decal.x, z: decal.z, angle: 0 };
        if (decal.kind === "cracks") {
          const dark = [.06 * fade, .05 * fade, .05 * fade];
          groundArc(at, decal.radius * .50, decal.radius * .58, Math.PI * 2, dy, dark);
          groundArc(at, decal.radius * .92, decal.radius, Math.PI * 2, dy, dark);
        } else if (decal.kind === "scorch") {
          groundArc(at, 0, decal.radius, Math.PI * 2, dy, [.02 * fade, .015 * fade, .02 * fade]);
        } else if (decal.kind === "rift") {
          const grown = decal.length * Math.min(1, decal.age / .15);
          groundStrip({ ...at, angle: decal.angle }, -decal.width, decal.width, grown, dy,
            [.03 * fade, .02 * fade, .045 * fade]);
        } else if (decal.kind === "phasering") {
          const r = decal.radius * Math.min(1, decal.age / .8);
          groundArc(at, Math.max(0, r - .3), r, Math.PI * 2, dy, decal.color.map(v => v * fade));
        }
      }
  }

  return { resetMeshes, resetAfterimage, drawBossBursts, drawDragonFire, drawColossusThrusters,
    drawForgeFloor, drawForgeStage, drawForgeAtmosphere, drawGuardianFire, drawBossSection };
}
