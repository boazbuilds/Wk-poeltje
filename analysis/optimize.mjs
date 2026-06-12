/*  Optimaliseert de R1-picks en R1-booster direct op P(#1 van 18), niet op EV.

    - Start bij wat je nu hebt ingevuld (mine) en hill-climbt per duel over
      alle scores 0..5 plus de boosterplek; accepteert alleen verbeteringen
      boven de ruisdrempel.
    - λ-onzekerheid: per simulatie wordt een ruisvariant van de scorematrix
      gebruikt (multiplicatieve lognormale ruis op λ, σ instelbaar) zodat de
      optimizer niet overfit op flinterdunne EV-verschillen.
    - Veld: 17 tegenstanders uit de ESPN-populariteitsverdeling; met
      --sharps=k spelen k van hen de EV-strategie (markt-picks + EV-booster).
    - R2/R3 staan vast op je huidige invulling (die worden later herijkt).
    - Standaard geen winnaar-flips (de markt is daar knife-edge en modelrisico
      reëel); --allow-flips laat ze toe.

    Gebruik:  node analysis/optimize.mjs [N] [--sharps=k] [--noise=s] [--allow-flips]  */

import { readFileSync, existsSync } from "node:fs";
import { MATCHES, MY_BOOSTERS } from "./data.mjs";
import { scoreMatrix, pts, analyse, popOf } from "./engine.mjs";

const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
const resFile = new URL("./results.json", import.meta.url);
// gespeelde duels: uitslag staat vast (simulatie conditioneert erop) en
// picks/booster zijn er vergrendeld
const RESULTS = existsSync(resFile) ? JSON.parse(readFileSync(resFile)).results : {};
const rho = cal.rho;
const args = process.argv.slice(2);
const N = parseInt(args.find((a) => /^\d+$/.test(a)) ?? "30000");
const SHARPS = parseInt((args.find((a) => a.startsWith("--sharps=")) ?? "--sharps=0").split("=")[1]);
const SIGMA = parseFloat((args.find((a) => a.startsWith("--noise=")) ?? "--noise=0.10").split("=")[1]);
const ALLOW_FLIPS = args.includes("--allow-flips");
const OPP = 20, K = 8, NV = 40; // 21 deelnemers; NV = aantal ruisvarianten per duel

/* ---------- seeded rng ---------- */
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260611);
const randn = () => {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ---------- voorbereiding per duel ---------- */
const idxOf = (h, a) => h * (K + 1) + a;
const prep = MATCHES.map((m) => {
  const L = cal.lambdas[m.key];
  const a = analyse(L.lh, L.la, m.crowd, rho);

  // ruisvarianten: cumulatieve verdelingen om de echte uitslag te trekken
  const variants = [];
  for (let v = 0; v < NV; v++) {
    const lh = L.lh * Math.exp(SIGMA * randn()), la = L.la * Math.exp(SIGMA * randn());
    const M = scoreMatrix(lh, la, rho, K);
    const cum = new Float64Array(81);
    let c = 0, i = 0;
    for (let h = 0; h <= K; h++) for (let x = 0; x <= K; x++) { c += M[h][x]; cum[i++] = c; }
    variants.push(cum);
  }

  // veldverdeling (zoals pool-sim) + puntentabel per veld-entry
  const listed = m.crowd.map(([h, x, p]) => ({ h, a: x, p: p / 100, mz: p < 10 }));
  const restMass = Math.max(0, 1 - listed.reduce((s, e) => s + e.p, 0));
  const M0 = a.M;
  let restModel = 0;
  for (let h = 0; h <= 5; h++) for (let x = 0; x <= 5; x++)
    if (popOf(h, x, m.crowd) === null) restModel += M0[h][x];
  const field = [...listed];
  for (let h = 0; h <= 5; h++) for (let x = 0; x <= 5; x++)
    if (popOf(h, x, m.crowd) === null && restModel > 0)
      field.push({ h, a: x, p: (M0[h][x] / restModel) * restMass, mz: true });
  const fCum = new Float64Array(field.length);
  let fc = 0;
  field.forEach((e, i) => { fc += e.p; fCum[i] = fc; });
  const fPts = field.map((e) => {
    const t = new Int8Array(81);
    for (let h = 0; h <= K; h++) for (let x = 0; x <= K; x++) {
      let q = pts(e.h, e.a, h, x);
      if (e.mz && e.h === h && e.a === x) q += 2;
      t[idxOf(h, x)] = q;
    }
    return t;
  });

  // kandidaten voor de gebruiker (alle scores 0..5) + puntentabellen
  const cands = [];
  for (let h = 0; h <= 5; h++) for (let x = 0; x <= 5; x++) {
    const pop = popOf(h, x, m.crowd);
    const mz = pop === null || pop < 10;
    const t = new Int8Array(81);
    for (let y = 0; y <= K; y++) for (let z = 0; z <= K; z++) {
      let q = pts(h, x, y, z);
      if (mz && h === y && x === z) q += 2;
      t[idxOf(y, z)] = q;
    }
    cands.push({ h, a: x, mz, t, evz: a.stat(h, x).evz });
  }

  // EV-pick (voor sharps) en mijn pick
  const ev = a.evpick;
  return {
    m, round: m.round, variants, field, fCum, fPts, cands,
    evIdx: ev.h * 6 + ev.a, mineIdx: m.mine[0] * 6 + m.mine[1],
    boostW: Math.pow(m.crowd.length ? Math.max(...m.crowd.map((c) => c[2])) : 10, 2),
  };
});

const lockedAt = prep.map((p) => {
  const r = RESULTS[p.m.key];
  return r ? idxOf(r[0], r[1]) : -1;
});
const r1 = prep.map((p, i) => ({ p, i })).filter((x) => x.p.round === 1 && lockedAt[x.i] < 0).map((x) => x.i);
const r1locked = prep.map((p, i) => i).filter((i) => prep[i].round === 1 && lockedAt[i] >= 0);

// tegenstander-boostergewichten per ronde (cum-array + index-array, vooraf)
const oppBoostCum = {}, oppBoostIdx = {};
for (const r of [1, 2, 3]) {
  const ids = prep.map((p, i) => ({ i, w: p.round === r ? p.boostW : 0 })).filter((e) => e.w > 0);
  const tot = ids.reduce((s, e) => s + e.w, 0);
  oppBoostCum[r] = new Float64Array(ids.length);
  oppBoostIdx[r] = new Int8Array(ids.length);
  let c = 0;
  ids.forEach((e, k) => { c += e.w / tot; oppBoostCum[r][k] = c; oppBoostIdx[r][k] = e.i; });
}
// EV-booster per ronde (voor sharps)
const evBoost = {};
for (const r of [1, 2, 3]) {
  let best = -1, bv = -1;
  prep.forEach((p, i) => { if (p.round === r && p.cands[p.evIdx].evz > bv) { bv = p.cands[p.evIdx].evz; best = i; } });
  evBoost[r] = best;
}

const bsearch = (cum, u) => {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; cum[mid] < u ? (lo = mid + 1) : (hi = mid); }
  return lo;
};

/* ---------- simulatie van uitslagen en veld ---------- */
console.log(`Simuleren: N=${N.toLocaleString()}, sharps=${SHARPS}, λ-ruis σ=${SIGMA}, flips ${ALLOW_FLIPS ? "toegestaan" : "geblokkeerd"} ...`);
const actuals = new Int8Array(N * 72);
const oppMax = new Int16Array(N);
const oppMaxCnt = new Int8Array(N);

for (let s = 0; s < N; s++) {
  const v = s % NV;
  for (let i = 0; i < 72; i++)
    actuals[s * 72 + i] = lockedAt[i] >= 0 ? lockedAt[i] : bsearch(prep[i].variants[v], rng());

  let mx = -1, cnt = 0;
  for (let o = 0; o < OPP; o++) {
    let tot = 0;
    if (o < SHARPS) {
      for (let i = 0; i < 72; i++) {
        const p = prep[i];
        let q = p.cands[p.evIdx].t[actuals[s * 72 + i]];
        if (evBoost[p.round] === i) q *= 2;
        tot += q;
      }
    } else {
      const b1 = oppBoostIdx[1][bsearch(oppBoostCum[1], rng())];
      const b2 = oppBoostIdx[2][bsearch(oppBoostCum[2], rng())];
      const b3 = oppBoostIdx[3][bsearch(oppBoostCum[3], rng())];
      for (let i = 0; i < 72; i++) {
        const p = prep[i];
        const e = bsearch(p.fCum, rng() * p.fCum[p.fCum.length - 1]);
        let q = p.fPts[e][actuals[s * 72 + i]];
        if (i === b1 || i === b2 || i === b3) q *= 2;
        tot += q;
      }
    }
    if (tot > mx) { mx = tot; cnt = 1; } else if (tot === mx) cnt++;
  }
  oppMax[s] = mx; oppMaxCnt[s] = cnt;
}

/* ---------- gebruiker: state + evaluatie ---------- */
const myBoostIdx = {};
for (const r of [1, 2, 3]) myBoostIdx[r] = prep.findIndex((p) => p.m.key === MY_BOOSTERS[r]);

const state = { picks: prep.map((p) => p.mineIdx), boost1: myBoostIdx[1] };
const basePts = new Int8Array(N * 72); // ongebooste punten per duel
const fixed = new Int16Array(N);       // R2+R3-totaal incl. R2/R3-boosters

function rebuild() {
  for (let s = 0; s < N; s++) {
    let fx = 0;
    for (let i = 0; i < 72; i++) {
      const q = prep[i].cands[state.picks[i]].t[actuals[s * 72 + i]];
      basePts[s * 72 + i] = q;
      if (prep[i].round !== 1) fx += (i === myBoostIdx[2] || i === myBoostIdx[3]) ? 2 * q : q;
    }
    fixed[s] = fx;
  }
}
rebuild();

function evaluate() {
  let win = 0, winSh = 0, ptsSum = 0;
  for (let s = 0; s < N; s++) {
    let tot = fixed[s];
    for (const i of r1) tot += i === state.boost1 ? 2 * basePts[s * 72 + i] : basePts[s * 72 + i];
    for (const i of r1locked) tot += i === state.boost1 ? 2 * basePts[s * 72 + i] : basePts[s * 72 + i];
    ptsSum += tot;
    if (tot > oppMax[s]) win++;
    if (tot >= oppMax[s]) winSh++;
  }
  return { win, winSh, ev: ptsSum / N };
}

const start = evaluate();

/* ---------- hill-climb over R1-picks en R1-booster ---------- */
const sgn = (i, c) => Math.sign(prep[i].cands[c].h - prep[i].cands[c].a);
const THRESH = Math.max(10, Math.round(N * 0.0004));
const moves = [];

const rest = new Int16Array(N);
for (let pass = 0; pass < 12; pass++) {
  let best = null;
  // pick-wissels: rest-totaal (alles behalve duel i) één keer, dan O(N) per kandidaat
  for (const i of r1) {
    const cur = state.picks[i], dbl = i === state.boost1 ? 2 : 1;
    for (let s = 0; s < N; s++) {
      let tot = fixed[s];
      for (const j of r1) if (j !== i) tot += j === state.boost1 ? 2 * basePts[s * 72 + j] : basePts[s * 72 + j];
      for (const j of r1locked) tot += j === state.boost1 ? 2 * basePts[s * 72 + j] : basePts[s * 72 + j];
      rest[s] = tot;
    }
    for (let c = 0; c < prep[i].cands.length; c++) {
      if (c === cur) continue;
      if (!ALLOW_FLIPS && sgn(i, c) !== sgn(i, prep[i].mineIdx)) continue;
      let win = 0;
      const t = prep[i].cands[c].t;
      for (let s = 0; s < N; s++)
        if (rest[s] + dbl * t[actuals[s * 72 + i]] > oppMax[s]) win++;
      if (!best || win > best.win) best = { type: "pick", i, c, win };
    }
  }
  // booster-wissels: som-R1 één keer, dan O(N) per plek
  for (let s = 0; s < N; s++) {
    let tot = fixed[s];
    for (const j of r1) tot += basePts[s * 72 + j];
    for (const j of r1locked) tot += basePts[s * 72 + j];
    rest[s] = tot;
  }
  for (const i of r1) {
    if (i === state.boost1) continue;
    let win = 0;
    for (let s = 0; s < N; s++)
      if (rest[s] + basePts[s * 72 + i] > oppMax[s]) win++;
    if (!best || win > best.win) best = { type: "boost", i, win };
  }

  const cur = evaluate();
  if (!best || best.win - cur.win < THRESH) break;
  if (best.type === "pick") {
    const p = prep[best.i], c = p.cands[best.c];
    moves.push(`${p.m.home}-${p.m.away}: ${p.cands[state.picks[best.i]].h}-${p.cands[state.picks[best.i]].a} → ${c.h}-${c.a}${c.mz ? "★" : ""}  (P(#1) ${((cur.win / N) * 100).toFixed(1)}% → ${((best.win / N) * 100).toFixed(1)}%)`);
    state.picks[best.i] = best.c;
    rebuild();
  } else {
    const p = prep[best.i];
    moves.push(`booster → ${p.m.home}-${p.m.away}  (P(#1) ${((cur.win / N) * 100).toFixed(1)}% → ${((best.win / N) * 100).toFixed(1)}%)`);
    state.boost1 = best.i;
  }
}

const end = evaluate();
const pc = (x) => ((x / N) * 100).toFixed(1) + "%";
console.log(`\nStart (huidige invulling):  E[pt] ${start.ev.toFixed(1)}  P(#1) ${pc(start.win)}  P(#1 incl. gedeeld) ${pc(start.winSh)}`);
console.log(`Na optimalisatie:           E[pt] ${end.ev.toFixed(1)}  P(#1) ${pc(end.win)}  P(#1 incl. gedeeld) ${pc(end.winSh)}\n`);
console.log("Zetten (in volgorde van toegevoegde winstkans):");
moves.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
console.log(`\nEind-booster R1: ${prep[state.boost1].m.home}-${prep[state.boost1].m.away}`);
console.log("\nEindpicks R1 (alleen afwijkingen t.o.v. huidige invulling):");
for (const i of r1) {
  if (state.picks[i] !== prep[i].mineIdx) {
    const c = prep[i].cands[state.picks[i]], o = prep[i].cands[prep[i].mineIdx];
    console.log(`  ${prep[i].m.home}-${prep[i].m.away}: ${o.h}-${o.a} → ${c.h}-${c.a}${c.mz ? "★" : ""}`);
  }
}
