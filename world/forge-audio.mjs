// Each layer is [onset, duration, initial Hz, final Hz, amplitude, texture].
// Keeping the score in seconds lets the short mechanical accents overlap.
const score = {
  "forge-step": [[0,.17,100,42,.31,"drum"], [.026,.09,680,480,.08,"iron"]],
  "forge-armor": [[0,.16,910,730,.23,"iron"], [.014,.25,1450,1330,.10,"iron"]],
  "forge-vent": [[0,.44,1600,350,.30,"steam"], [.06,.28,380,88,.17,"drum"], [.31,.14,650,620,.11,"iron"]],
  "forge-ignite": [[0,.3,85,190,.24,"drum"], [.10,.35,370,1150,.23,"steam"], [.30,.17,560,650,.14,"iron"]],
  "forge-overload": [[0,.15,160,68,.29,"drum"], [.15,.15,185,76,.31,"drum"], [.3,.5,105,430,.23,"iron"]],
  "forge-impact": [[0,.27,148,42,.40,"drum"], [.008,.20,840,360,.16,"iron"], [.076,.24,1250,280,.16,"steam"]],
  "forge-collapse": [[0,.50,155,34,.42,"drum"], [.09,.30,680,280,.18,"iron"], [.27,.23,420,180,.16,"iron"], [.43,.53,1550,230,.20,"steam"], [.67,.59,220,219,.12,"bell"], [.84,.64,330,329,.10,"bell"]]
};

export function renderForgeCue(name, rate) {
  const layers = score[name];
  if (!layers) return null;
  const samples = new Float32Array(Math.ceil(rate * Math.max(...layers.map(([at, len]) => at + len))));
  let seed = 17;
  for (const [at, len, from, to, volume, texture] of layers) {
    let phase = 0, filtered = 0;
    const offset = Math.round(at * rate);
    const count = Math.min(samples.length - offset, Math.round(len * rate));
    for (let i = 0; i < count; i++) {
      const t = i / rate, progress = i / count;
      const hz = from * (to / from) ** progress;
      phase += 2 * Math.PI * hz / rate;
      let wave = Math.sin(phase);
      if (texture === "steam") {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        filtered += (seed / 2147483648 - 1 - filtered) * (1 - Math.exp(-2 * Math.PI * hz / rate));
        wave = 2 * filtered;
      } else if (texture === "iron") {
        wave = .55 * wave + .30 * Math.sin(phase * 2.71) + .15 * Math.sin(phase * 4.13);
      }
      const envelope = Math.min(1, t * 450, (count - 1 - i) / rate * 140) * Math.exp(-progress * 4);
      samples[offset + i] += volume * wave * envelope;
    }
  }
  return samples;
}
