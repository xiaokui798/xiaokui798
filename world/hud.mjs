// HUD write-out layer split out of game.js (batch 53, split piece 2).
//
// game.js still decides WHAT the HUD says — the callout sentence
// choice is intertwined with combat state (hazards, cover, phase
// theatre), so it stays there. What lives here is the DOM side of
// that bargain: given the elements once (injected by game.js, which
// queried them) and a plain view object per frame, this module
// writes text, widths, hidden flags and classes, and owns the
// transient message line and its timer. It imports nothing from
// game.js and holds no game state.
//
// The factory also reserves the seat for the craft-complete toast
// (Kui's feedback 3: item icon + name + green check): showToast is
// declared now so the export surface has its home, and stays a
// no-op until that batch gives it behaviour.
//
// The timer pair is injected for the same reason the elements are:
// game.js's window is its initGame parameter, not a global, so the
// message line's clock arrives from the caller.

export function createHud(elements, timers) {
  const { setTimeout, clearTimeout } = timers;
  const { hud, bossHud, bossName, bossHealth, bossHealthValue, bossHealthGhost,
    bossCallout, bossWarning, bossPhaseBanner, bossSkills, bossSkillHeal,
    bossSkillDragons, waveStatus, coordinates, message, buffLines } = elements;

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  // The transient message line: shows the text, clears itself after
  // 1.7s, and a newer message restarts the clock.
  let noticeTimer;
  function showMessage(text) {
    clearTimeout(noticeTimer);
    message.textContent = text;
    noticeTimer = setTimeout(() => message.textContent = "", 1700);
  }

  function setBossVisible(visible) {
    bossHud.hidden = !visible;
  }

  // One frame of boss HUD. The view is fully decided by the caller:
  //   name          boss-name text, or null to leave it (the colossus
  //                 name is set once at fight start, not per frame)
  //   healthMax / health / ghostHp   bar numbers (ghost is the white
  //                 trailing segment's current value)
  //   statusText    the shared right-top line for this boss
  //   skillsHidden  false only for the colossus
  //   healReadyAt / dragonsReadyAt / elapsed   skill-chip clocks;
  //                 a chip reads 就绪 once elapsed passes its mark,
  //                 otherwise 还剩 N 秒 (ceiling)
  //   callout       the chosen sentence for this frame
  //   warningOn     mirror the callout in the big central warning
  //   vulnerable / danger   class toggles (boss hud; danger also
  //                 lights the whole HUD root's red edge flash)
  //   phase         1..3, drives the health bar's phase-colour frame
  //   bannerVisible / bannerText   the phase-change big print
  function updateBossHud(view) {
    if (bossHealth.max !== view.healthMax) bossHealth.max = view.healthMax;
    if (bossHealth.value !== view.health) bossHealth.value = view.health;
    setText(bossHealthValue, `${view.health} / ${view.healthMax}`);
    const ghostWidth = `${Math.round(view.ghostHp / view.healthMax * 1000) / 10}%`;
    if (bossHealthGhost.style.width !== ghostWidth) bossHealthGhost.style.width = ghostWidth;
    if (view.name !== null) setText(bossName, view.name);
    setText(waveStatus, view.statusText);
    bossSkills.hidden = view.skillsHidden;
    if (!view.skillsHidden) {
      const chip = ready => ready > view.elapsed ? `还剩 ${Math.ceil(ready - view.elapsed)} 秒` : "就绪";
      setText(bossSkillHeal, `[1] 回血 · ${chip(view.healReadyAt)}`);
      setText(bossSkillDragons, `[4] 五龙冲击 · ${chip(view.dragonsReadyAt)}`);
    }
    setText(bossCallout, view.callout);
    // The big central warning mirrors the callout for as long as the
    // attack is telegraphed or landing — the moment the player most
    // needs it — and clears with the recovery.
    bossWarning.hidden = !view.warningOn;
    if (view.warningOn) setText(bossWarning, `⚠ ${view.callout}`);
    bossHud.classList.toggle("vulnerable", view.vulnerable);
    bossHud.classList.toggle("in-danger", view.danger);
    hud.classList.toggle("in-danger", view.danger);
    bossHud.classList.toggle("phase-1", view.phase === 1);
    bossHud.classList.toggle("phase-2", view.phase === 2);
    bossHud.classList.toggle("phase-3", view.phase === 3);
    bossPhaseBanner.hidden = !view.bannerVisible;
    if (view.bannerVisible) setText(bossPhaseBanner, view.bannerText);
  }

  // The no-boss cleanup: the red flash and both boss alerts go dark.
  function clearBossAlerts() {
    hud.classList.toggle("in-danger", false);
    bossWarning.hidden = true;
    bossPhaseBanner.hidden = true;
  }

  // The shared right-top status line (survival / defense branches;
  // the boss branch writes it through updateBossHud).
  function setWaveStatus(text) {
    setText(waveStatus, text);
  }

  // The debug coordinates: hidden while a boss is up (the arena
  // name beside them stays), text always refreshed.
  function updateCoordinates(text, hidden) {
    coordinates.hidden = hidden;
    setText(coordinates, text);
  }

  // One food-buff line (R5): buff is { label, pct, remaining } or
  // null. Whole seconds remaining, ceiling, so a live buff never
  // reads 0; the line hides the frame the buff expires.
  function updateBuffLine(kind, buff) {
    const line = buffLines[kind];
    line.hidden = !buff;
    if (buff) setText(line, `${buff.label} +${buff.pct}% · 还剩 ${Math.ceil(buff.remaining)} 秒`);
  }

  // Reserved seat for the craft-complete toast (icon + item name +
  // "制作完成" + green check). No behaviour yet — the batch that
  // builds the icon set gives it its DOM and its timing.
  function showToast() {}

  return { showMessage, setBossVisible, updateBossHud, clearBossAlerts,
    setWaveStatus, updateCoordinates, updateBuffLine, showToast };
}
