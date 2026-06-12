/*  Monte-Carlo van de subleague (18 spelers) over de hele groepsfase.
    Doel: niet E[punten] maar P(jij wordt #1 van 18).

    Veld-model: 17 tegenstanders trekken hun voorspelling per duel uit de
    echte ESPN-populariteitsverdeling; restmassa (scores onder de 10%) wordt
    naar rato van de modelkans over de overige scores 0..5 verdeeld en telt
    als meesterzet. Tegenstander-boosters: per ronde één duel, gewogen naar
    hoe uitgesproken de massa daar is (top-pick-populariteit²).

    Strategieën voor jou:
      huidig   — jouw ingevulde picks + huidige boosters
      veilig   — EV-pick waar de winnaar gelijk blijft, anders jouw pick
      vol-ev   — overal de EV-pick
      spiegel  — overal de populairste massa-keuze (baseline)
    Boosters voor veilig/vol-ev/spiegel: duel met hoogste evz van de keuze.

    Gebruik:  node analysis/pool-sim.mjs [N]   (default 20000)  */

import { readFileSync } from "node:fs";
import { MATCHES, MY_BOOSTERS } from "./data.mjs";
import { scoreMatrix, pts, analyse } from "./engine.mjs";

const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
const rho = cal.rho;
const N = process.argv[2] ? parseInt(process.argv[2]) : 20000;
const OPP = 24; // subleague gegroeid naar 25 deelnemers (12 jun); NB: optimize.mjs conditioneert ook op de echte tussenstand, dit script niet

/* ---------- voorbereiding per duel ---------- */
const prep = MATCHES.map((m) => {
  const L = cal.lambdas[m.key];
  const a = analyse(L.lh, L.la, m.crowd, rho);
  const M = a.M, K = M.length - 1;

  // cumulatieve verdeling voor het trekken van de echte uitslag
  const outCum = [], outScore = [];
  let c = 0;
  for (let h = 0; h <= K; h++) for (let x = 0; x <= K; x++) { c += M[h][x]; outCum.push(c); outScore.push([h, x]); }

  // veld-verdeling: gelijste populaire scores + model-proportionele rest
  const listed = m.crowd.map(([h, x, p]) => ({ h, a: x, p: p / 100, mz: p < 10 }));
  const listedMass = listed.reduce((s, e) => s + e.p, 0);
  let restMass = Math.max(0, 1 - listedMass);
  const rest = [];
  let restModel = 0;
  for (let h = 0; h <= 5; h++) for (let x = 0; x <= 5; x++)
    if (!m.crowd.some((cr) => cr[0] === h && cr[1] === x)) restModel += M[h][x];
  for (let h = 0; h <= 5; h++) for (let x = 0; x <= 5; x++)
    if (!m.crowd.some((cr) => cr[0] === h && cr[1] === x) && restModel > 0)
      rest.push({ h, a: x, p: (M[h][x] / restModel) * restMass, mz: true });
  const field = [...listed, ...rest];
  const fCum = []; let fc = 0;
  for (const e of field) { fc += e.p; fCum.push(fc); }

  // strategie-picks van de gebruiker
  const evp = a.evpick;
  const mine = { h: m.mine[0], a: m.mine[1], mz: a.stat(m.mine[0], m.mine[1]).mz, evz: a.stat(m.mine[0], m.mine[1]).evz };
  const ev = { h: evp.h, a: evp.a, mz: evp.mz, evz: evp.evz };
  const sameWinner = Math.sign(ev.h - ev.a) === Math.sign(mine.h - mine.a);
  const mir = a.mirror;
  return {
    m, round: m.round, outCum, outScore, field, fCum,
    picks: {
      huidig: mine,
      veilig: sameWinner ? ev : mine,
      "vol-ev": ev,
      spiegel: { h: mir.h, a: mir.a, mz: mir.mz, evz: mir.evz },
    },
    boostWeight: Math.pow(m.crowd.length ? Math.max(...m.crowd.map((c) => c[2])) : 10, 2),
  };
});

/* ---------- boosters ---------- */
const STRATS = ["huidig", "veilig", "vol-ev", "spiegel"];
const userBoost = {};
for (const s of STRATS) {
  userBoost[s] = {};
  for (const r of [1, 2, 3]) {
    if (s === "huidig") {
      userBoost[s][r] = prep.findIndex((p) => p.m.key === MY_BOOSTERS[r]);
    } else {
      let best = -1, bv = -1;
      prep.forEach((p, i) => { if (p.round === r && p.picks[s].evz > bv) { bv = p.picks[s].evz; best = i; } });
      userBoost[s][r] = best;
    }
  }
}

// tegenstander-booster: cumulatieve gewichten per ronde
const oppBoostCum = {};
for (const r of [1, 2, 3]) {
  const idx = prep.map((p, i) => ({ i, w: p.round === r ? p.boostWeight : 0 }));
  const tot = idx.reduce((s, e) => s + e.w, 0);
  let c = 0;
  oppBoostCum[r] = idx.map((e) => { c += e.w / tot; return { i: e.i, c } });
}

const draw = (cum, u) => {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; cum[mid] < u ? (lo = mid + 1) : (hi = mid); }
  return lo;
};

/* ---------- simulatie ---------- */
const stats = Object.fromEntries(STRATS.map((s) => [s, { pts: 0, win: 0, winShared: 0, top3: 0, rank: 0 }]));
let oppTopSum = 0;

for (let sim = 0; sim < N; sim++) {
  // echte uitslagen
  const actual = prep.map((p) => p.outScore[draw(p.outCum, Math.random())]);

  // tegenstanders
  const oppTotals = new Array(OPP).fill(0);
  for (let o = 0; o < OPP; o++) {
    const boostAt = { 1: -1, 2: -1, 3: -1 };
    for (const r of [1, 2, 3]) {
      const u = Math.random();
      boostAt[r] = oppBoostCum[r].find((e) => e.c >= u).i;
    }
    let tot = 0;
    for (let i = 0; i < prep.length; i++) {
      const p = prep[i];
      const e = p.field[draw(p.fCum, Math.random())];
      let q = pts(e.h, e.a, actual[i][0], actual[i][1]);
      if (e.mz && e.h === actual[i][0] && e.a === actual[i][1]) q += 2;
      if (boostAt[p.round] === i) q *= 2;
      tot += q;
    }
    oppTotals[o] = tot;
  }
  const oppMax = Math.max(...oppTotals);
  oppTopSum += oppMax;

  // gebruiker per strategie (zelfde uitslagen, zelfde veld)
  for (const s of STRATS) {
    let tot = 0;
    for (let i = 0; i < prep.length; i++) {
      const pk = prep[i].picks[s];
      let q = pts(pk.h, pk.a, actual[i][0], actual[i][1]);
      if (pk.mz && pk.h === actual[i][0] && pk.a === actual[i][1]) q += 2;
      if (userBoost[s][prep[i].round] === i) q *= 2;
      tot += q;
    }
    const beat = oppTotals.filter((t) => t < tot).length;
    const tied = oppTotals.filter((t) => t === tot).length;
    stats[s].pts += tot;
    if (beat === OPP) stats[s].win++;
    if (beat + tied === OPP) stats[s].winShared++;
    if (beat >= OPP - 2) stats[s].top3++;
    stats[s].rank += OPP - beat + 1 - tied / 2;
  }
}

console.log(`Monte-Carlo poule-simulatie — ${N.toLocaleString()} runs, 18 spelers, hele groepsfase (72 duels)`);
console.log(`ρ=${rho} · λ: ${Object.values(cal.lambdas).filter((l) => l.src === "live").length} live / ${Object.values(cal.lambdas).filter((l) => l.src === "stale").length} stale`);
console.log(`Gem. beste tegenstander: ${(oppTopSum / N).toFixed(1)} pt · baseline P(win) = 1/18 = 5.6%\n`);
console.log("strategie | E[punten] | P(#1 alleen) | P(#1 incl. gedeeld) | P(top 3) | E[rang]");
for (const s of STRATS) {
  const st = stats[s];
  console.log(
    `${s.padEnd(9)} | ${(st.pts / N).toFixed(1).padStart(8)}  | ${((st.win / N) * 100).toFixed(1).padStart(7)}%     | ${((st.winShared / N) * 100).toFixed(1).padStart(7)}%            | ${((st.top3 / N) * 100).toFixed(1).padStart(6)}%  | ${(st.rank / N).toFixed(2).padStart(6)}`
  );
}
console.log("\nBoosters per strategie:");
for (const s of STRATS) {
  const b = [1, 2, 3].map((r) => { const p = prep[userBoost[s][r]]; const pk = p.picks[s]; return `R${r} ${p.m.home}-${p.m.away} ${pk.h}-${pk.a}`; });
  console.log(`  ${s.padEnd(9)}: ${b.join(" · ")}`);
}
