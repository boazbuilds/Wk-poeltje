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

/*  Mengsel van scorematrices over de λ-onzekerheid (multiplicatieve
    lognormale ruis, Gauss-Hermite 5-punts per as). EV en exacte-score-
    kansen zijn lineair in de matrix, dus analyse op het mengsel geeft
    exact de verwachte evz over de onzekerheid — de "robuuste" keuze.  */
const GH5 = [
  { z: -2.8570, w: 0.011257 }, { z: -1.3556, w: 0.222076 }, { z: 0, w: 0.533333 },
  { z: 1.3556, w: 0.222076 }, { z: 2.8570, w: 0.011257 },
];
export function blendMatrix(lh, la, rho, sigma, k = 8) {
  const B = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
  for (const i of GH5) for (const j of GH5) {
    const M = scoreMatrix(lh * Math.exp(sigma * i.z), la * Math.exp(sigma * j.z), rho, k);
    const w = i.w * j.w;
    for (let h = 0; h <= k; h++) for (let a = 0; a <= k; a++) B[h][a] += w * M[h][a];
  }
  return B;
}

/* ---------- markt-exacte-score-mengsel (#4) ----------
   Polymarket heeft per duel een markt per EXACTE score (echt geld, géén
   Poisson-aanname). Waar dat genoeg volume heeft mengen we die direct in de
   scorematrix; bij te dun volume → puur het (Pinnacle-gekalibreerde) model. */

// Vertrouwensgewicht naar marktvolume: 0 onder $8k, lineair op naar max 0.5.
export const marketWeight = (vol) =>
  !vol || vol < 8000 ? 0 : Math.min(0.5, 0.5 * (vol - 8000) / 52000);

// Scorematrix uit een de-vigde markt-grid [[h,a,p],...]; de ontbrekende massa
// ("Any Other Score") wordt over de niet-gelijste cellen verdeeld naar rato
// van het model, zodat de matrix netjes op 1 sommeert.
export function marketScoreMatrix(grid, modelM, K = 8) {
  const M = Array.from({ length: K + 1 }, () => new Array(K + 1).fill(0));
  const listed = new Set();
  let listedMass = 0;
  for (const [h, a, p] of grid) if (h <= K && a <= K) { M[h][a] = p; listed.add(h * 100 + a); listedMass += p; }
  const rest = Math.max(0, 1 - listedMass);
  let modelRest = 0;
  for (let h = 0; h <= K; h++) for (let a = 0; a <= K; a++) if (!listed.has(h * 100 + a)) modelRest += modelM[h][a];
  for (let h = 0; h <= K; h++) for (let a = 0; a <= K; a++) if (!listed.has(h * 100 + a) && modelRest > 0) M[h][a] = rest * modelM[h][a] / modelRest;
  let s = 0; for (let h = 0; h <= K; h++) for (let a = 0; a <= K; a++) s += M[h][a];
  if (s > 0) for (let h = 0; h <= K; h++) for (let a = 0; a <= K; a++) M[h][a] /= s;
  return M;
}

// Meng model-matrix met de markt-exacte-score-matrix, gewogen naar volume.
// Retourneert { M, w } zodat de aanroeper kan tonen hoeveel markt meewoog.
export function blendWithMarket(modelM, mkt, K = 8) {
  if (!mkt?.scores || mkt.scores.length < 4) return { M: modelM, w: 0 };
  const w = marketWeight(mkt.volume);
  if (w <= 0) return { M: modelM, w: 0 };
  const mm = marketScoreMatrix(mkt.scores, modelM, K);
  const M = Array.from({ length: K + 1 }, () => new Array(K + 1).fill(0));
  for (let h = 0; h <= K; h++) for (let a = 0; a <= K; a++) M[h][a] = w * mm[h][a] + (1 - w) * modelM[h][a];
  return { M, w };
}

export function analyse(lh, la, crowd, rho) {
  return analyseM(scoreMatrix(lh, la, rho, 8), crowd);
}

export function analyseM(M, crowd) {
  const K = 8, P = 6;
  const probs = outcome(M);
  let mode = { h: 0, a: 0, p: 0 };
  for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) if (M[h][a] > mode.p) mode = { h, a, p: M[h][a] };

  // meesterzet als KANS i.p.v. harde 10%-klif: een score net onder 10% is geen
  // zekere meesterzet (populariteit drijft en is een steekproef), dus we wegen
  // de +2 met P(eindpopulariteit < 10%). Smooth rond de drempel; niet-gelijste
  // scores zitten ruim onder de laagst getoonde → hoge maar geen zekere kans.
  const MZ_THRESH = 10, MZ_HALF = 2.5;
  const mzProb = (pop) => pop === null ? 0.85
    : Math.min(1, Math.max(0, (MZ_THRESH + MZ_HALF - pop) / (2 * MZ_HALF)));

  const stat = (h, a) => {
    const mp = h <= 5 && a <= 5 ? M[h][a] : 0;
    const pop = popOf(h, a, crowd);
    const mzp = mzProb(pop);
    const mz = mzp >= 0.5; // ster bij ≥50% meesterzet-kans (≈ populariteit ≤ 10%)
    let ev = 0;
    for (let x = 0; x <= K; x++) for (let y = 0; y <= K; y++) ev += M[x][y] * pts(h, a, x, y);
    return { h, a, mp, pop, mz, mzp, ev, evz: ev + mzp * 2 * mp };
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

/*  Joint-afwijking: 1X2 + O/U-totaallijn(en) + goal spread(s) tegelijk.
    Push-afhandeling bij gehele lijnen: P = P(>L) / (P(>L) + P(<L)).
    targets: {
      ml?:     {hw,d,aw},
      total?:  {line,pOver},          totals?:  [{line,pOver}, ...]   (hele ladder),
      spread?: {hcpHome,pHomeCover},  spreads?: [{hcpHome,pHomeCover}, ...]
    }  Een ladder weegt als gemiddelde over zijn punten (niet zwaarder dan 1 lijn).  */
export function marketError(M, t) {
  // cumulatieve hulpfuncties over de scorematrix
  const totalP = (L) => { // {gt, eq}
    let gt = 0, eq = 0;
    for (let h = 0; h < M.length; h++) for (let a = 0; a < M.length; a++) {
      const s = h + a; if (s > L) gt += M[h][a]; else if (s === L) eq += M[h][a];
    }
    return { gt, eq };
  };
  const spreadP = (H) => { // thuis covert als (h-a) > H
    let gt = 0, eq = 0;
    for (let h = 0; h < M.length; h++) for (let a = 0; a < M.length; a++) {
      const s = h - a; if (s > H) gt += M[h][a]; else if (s === H) eq += M[h][a];
    }
    return { gt, eq };
  };
  const teamTotalP = (L, side) => { // P(team 'side' scoort > L doelpunten)
    let gt = 0, eq = 0;
    for (let h = 0; h < M.length; h++) for (let a = 0; a < M.length; a++) {
      const s = side === "home" ? h : a; if (s > L) gt += M[h][a]; else if (s === L) eq += M[h][a];
    }
    return { gt, eq };
  };

  let e = 0;
  if (t.ml) {
    let hw = 0, d = 0, aw = 0;
    for (let h = 0; h < M.length; h++) for (let a = 0; a < M.length; a++)
      h > a ? (hw += M[h][a]) : h === a ? (d += M[h][a]) : (aw += M[h][a]);
    e += (hw - t.ml.hw) ** 2 + (d - t.ml.d) ** 2 + (aw - t.ml.aw) ** 2;
  }
  const totals = t.totals ?? (t.total ? [t.total] : []);
  if (totals.length) {
    let se = 0;
    for (const x of totals) { const { gt, eq } = totalP(x.line); se += (gt / Math.max(1e-9, 1 - eq) - x.pOver) ** 2; }
    e += se / totals.length;
  }
  const spreads = t.spreads ?? (t.spread ? [t.spread] : []);
  if (spreads.length) {
    let se = 0;
    for (const x of spreads) { const { gt, eq } = spreadP(-x.hcpHome); se += (gt / Math.max(1e-9, 1 - eq) - x.pHomeCover) ** 2; }
    e += 0.5 * se / spreads.length;
  }
  // team-totals: P(thuis>L) en P(uit>L) — pint de λ-splitsing direct vast
  if (t.teamTotals) {
    let se = 0, n = 0;
    for (const side of ["home", "away"]) {
      for (const x of (t.teamTotals[side] ?? [])) {
        const { gt, eq } = teamTotalP(x.line, side);
        se += (gt / Math.max(1e-9, 1 - eq) - x.pOver) ** 2; n++;
      }
    }
    if (n) e += se / n;
  }
  return e;
}

// Joint-inversie: vind (λh, λa) die alle marktsignalen samen het best past.
export function invertJoint(t, rho) {
  let best = { lh: 1, la: 1, e: Infinity };
  const scan = (lo1, hi1, lo2, hi2, step) => {
    for (let lh = lo1; lh <= hi1 + 1e-9; lh += step)
      for (let la = lo2; la <= hi2 + 1e-9; la += step) {
        const e = marketError(scoreMatrix(lh, la, rho), t);
        if (e < best.e) best = { lh, la, e };
      }
  };
  scan(0.05, 5.0, 0.05, 5.0, 0.1);
  scan(Math.max(0.02, best.lh - 0.1), best.lh + 0.1, Math.max(0.02, best.la - 0.1), best.la + 0.1, 0.02);
  scan(Math.max(0.01, best.lh - 0.02), best.lh + 0.02, Math.max(0.01, best.la - 0.02), best.la + 0.02, 0.005);
  return { lh: +best.lh.toFixed(3), la: +best.la.toFixed(3), err: best.e };
}

export function fitRhoJoint(targetsList, rhoGrid) {
  const grid = rhoGrid ?? Array.from({ length: 13 }, (_, i) => -0.16 + i * 0.02);
  const rows = grid.map((rho) => {
    let tot = 0;
    for (const t of targetsList) tot += invertJoint(t, rho).err;
    return { rho: +rho.toFixed(2), err: tot };
  });
  rows.sort((x, y) => x.err - y.err);
  return { rho: rows[0].rho, table: rows };
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
