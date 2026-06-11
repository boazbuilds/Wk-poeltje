/*  Gedeelde reken-engine — identiek aan de logica in wk-poule-model.jsx,
    plus marktinversie: van 1X2-kansen terug naar (λ_thuis, λ_uit) en een
    globale Dixon-Coles ρ die op de echte markten wordt gefit (consistentie-
    fix: de artifact draaide zuivere Poisson op λ's die via DC waren afgeleid). */

export function poissonPmf(l, k) {
  const o = [Math.exp(-l)];
  for (let i = 1; i <= k; i++) o.push((o[i - 1] * l) / i);
  return o;
}

export function scoreMatrix(lh, la, rho, k = 8) {
  const ph = poissonPmf(lh, k), pa = poissonPmf(la, k), M = [];
  let s = 0;
  for (let h = 0; h <= k; h++) {
    M[h] = [];
    for (let a = 0; a <= k; a++) {
      let v = ph[h] * pa[a];
      if (h === 0 && a === 0) v *= 1 - lh * la * rho;
      else if (h === 0 && a === 1) v *= 1 + lh * rho;
      else if (h === 1 && a === 0) v *= 1 + la * rho;
      else if (h === 1 && a === 1) v *= 1 - rho;
      if (v < 0) v = 0;
      M[h][a] = v; s += v;
    }
  }
  for (let h = 0; h <= k; h++) for (let a = 0; a <= k; a++) M[h][a] /= s;
  return M;
}

export function outcome(M) {
  let hw = 0, d = 0, aw = 0;
  for (let h = 0; h < M.length; h++) for (let a = 0; a < M.length; a++)
    h > a ? (hw += M[h][a]) : h === a ? (d += M[h][a]) : (aw += M[h][a]);
  return { hw, d, aw };
}

export function pts(ph, pa, h, a) {
  let p = 0;
  if (Math.sign(ph - pa) === Math.sign(h - a)) p += 3;
  if (ph === h) p += 1;
  if (pa === a) p += 1;
  if (ph - pa === h - a) p += 1;
  return p;
}

export const popOf = (h, a, crowd) => {
  for (const c of crowd) if (c[0] === h && c[1] === a) return c[2];
  return null; // niet in de populaire lijst => onder 10%
};

export function analyse(lh, la, crowd, rho) {
  const K = 8, P = 6;
  const M = scoreMatrix(lh, la, rho, K);
  const probs = outcome(M);
  let mode = { h: 0, a: 0, p: 0 };
  for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) if (M[h][a] > mode.p) mode = { h, a, p: M[h][a] };

  const stat = (h, a) => {
    const mp = h <= 5 && a <= 5 ? M[h][a] : 0;
    const pop = popOf(h, a, crowd);
    const mz = pop === null || pop < 10;
    let ev = 0;
    for (let x = 0; x <= K; x++) for (let y = 0; y <= K; y++) ev += M[x][y] * pts(h, a, x, y);
    return { h, a, mp, pop, mz, ev, evz: ev + (mz ? 2 * mp : 0) };
  };

  let evpick = null, chase = null;
  for (let h = 0; h <= P; h++) for (let a = 0; a <= P; a++) {
    const s = stat(h, a);
    if (!evpick || s.evz > evpick.evz) evpick = s;
    if ((s.pop === null || s.pop <= 12) && (!chase || s.evz > chase.evz)) chase = s;
  }
  let top = crowd.length ? crowd.reduce((b, c) => (c[2] > b[2] ? c : b)) : [mode.h, mode.a, 0];
  const mirror = stat(top[0], top[1]);
  return { M, probs, mode, evpick, chase, mirror, stat };
}

/* ---------- marktinversie ---------- */

// Kwadratische afwijking tussen model-1X2 en markt-1X2 voor gegeven λ's.
function err1X2(lh, la, rho, hw, d, aw) {
  const o = outcome(scoreMatrix(lh, la, rho));
  return (o.hw - hw) ** 2 + (o.d - d) ** 2 + (o.aw - aw) ** 2;
}

// Vind (λh, λa) die de markt-1X2 het best reproduceert onder gegeven ρ.
// Grof raster, daarna twee verfijningsstappen rond het minimum.
export function invert1X2(hw, d, aw, rho) {
  let best = { lh: 1, la: 1, e: Infinity };
  const scan = (lo1, hi1, lo2, hi2, step) => {
    for (let lh = lo1; lh <= hi1 + 1e-9; lh += step)
      for (let la = lo2; la <= hi2 + 1e-9; la += step) {
        const e = err1X2(lh, la, rho, hw, d, aw);
        if (e < best.e) best = { lh, la, e };
      }
  };
  scan(0.05, 5.0, 0.05, 5.0, 0.1);
  scan(Math.max(0.02, best.lh - 0.1), best.lh + 0.1, Math.max(0.02, best.la - 0.1), best.la + 0.1, 0.02);
  scan(Math.max(0.01, best.lh - 0.02), best.lh + 0.02, Math.max(0.01, best.la - 0.02), best.la + 0.02, 0.005);
  return { lh: +best.lh.toFixed(3), la: +best.la.toFixed(3), err: best.e };
}

// Fit één globale ρ over alle beschikbare markten: de ρ waaronder de
// best passende λ's de markt-1X2 in totaal het dichtst benaderen.
export function fitRho(markets, rhoGrid) {
  const grid = rhoGrid ?? Array.from({ length: 21 }, (_, i) => -0.2 + i * 0.02);
  const rows = grid.map((rho) => {
    let tot = 0;
    for (const m of markets) tot += invert1X2(m.hw, m.d, m.aw, rho).err;
    return { rho: +rho.toFixed(2), err: tot };
  });
  rows.sort((x, y) => x.err - y.err);
  return { rho: rows[0].rho, table: rows };
}
