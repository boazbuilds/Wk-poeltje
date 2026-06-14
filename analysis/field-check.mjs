/*  Veld-scherpte-toets — beantwoordt datagedreven de vraag waar de hele
    strategie op draait: spelen de tegenstanders naief (uit de ESPN-
    populariteit) of zit er kunde in het veld?

    Werkwijze: simuleer een puur naief veld (zelfde model als pool-sim /
    optimize: populariteit + meesterzet-rest, +2 meesterzetbonus, één
    booster per speler) over ALLEEN de al gespeelde duels met hun ECHTE
    uitslagen. Vergelijk de gesimuleerde koploper-verdeling met de
    werkelijke koploper uit standings.json.

      - Zit de echte koploper binnen de naieve verdeling  -> veld is naief,
        speel EV (optimize --sharps=0). Variantie kost dan winkans.
      - Zit hij ver in de staart (kunde waarschijnlijk) -> escaleer variantie
        (optimize --sharps=k), want dan kun je een sterk, vooruitliggend veld
        niet met EV inhalen.

    Zo wordt de 'hoeveel sharps'-aanname een uitkomst van de data i.p.v. een
    handmatige gok. Draai dit bij elke herijking opnieuw.

    Gebruik:  node analysis/field-check.mjs [N]   (default 200000)  */

import { readFileSync, existsSync } from "node:fs";
import { MATCHES, MY_BOOSTERS } from "./data.mjs";
import { analyse, pts } from "./engine.mjs";

const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
const RESULTS = JSON.parse(readFileSync(new URL("./results.json", import.meta.url))).results;
const stFile = new URL("./standings.json", import.meta.url);
const STAND = existsSync(stFile) ? JSON.parse(readFileSync(stFile)) : null;
const rho = cal.rho;
const N = process.argv[2] ? parseInt(process.argv[2]) : 200000;

if (!Object.keys(RESULTS).length) {
  console.log("Nog geen gespeelde duels in results.json — niets te toetsen.");
  process.exit(0);
}

// rondes waarin al iets gespeeld is (booster kan binnen die ronde geplaatst zijn)
const playedRounds = new Set(MATCHES.filter((m) => RESULTS[m.key]).map((m) => m.round));
const roundMatches = MATCHES.filter((m) => playedRounds.has(m.round));
const played = roundMatches.filter((m) => RESULTS[m.key]);

// veldverdeling per gespeeld duel (populariteit + model-proportionele meesterzet-rest)
const prep = played.map((m) => {
  const L = cal.lambdas[m.key];
  const a = analyse(L.lh, L.la, m.crowd, rho), M = a.M;
  const listed = m.crowd.map(([h, x, p]) => ({ h, a: x, p: p / 100, mz: p < 10 }));
  const restMass = Math.max(0, 1 - listed.reduce((s, e) => s + e.p, 0));
  let restModel = 0;
  for (let h = 0; h <= 5; h++) for (let x = 0; x <= 5; x++)
    if (!m.crowd.some((c) => c[0] === h && c[1] === x)) restModel += M[h][x];
  const field = [...listed];
  for (let h = 0; h <= 5; h++) for (let x = 0; x <= 5; x++)
    if (!m.crowd.some((c) => c[0] === h && c[1] === x) && restModel > 0)
      field.push({ h, a: x, p: (M[h][x] / restModel) * restMass, mz: true });
  const cum = []; let c = 0; for (const e of field) { c += e.p; cum.push(c); }
  return { key: m.key, field, cum, act: RESULTS[m.key], evp: a.evpick };
});

// booster-gewichten over alle duels van de gespeelde ronde(s)
const allW = roundMatches.map((m) => ({ key: m.key, w: Math.pow(Math.max(...m.crowd.map((c) => c[2])), 2) }));
const totW = allW.reduce((s, e) => s + e.w, 0);
const draw = (cum, u) => { let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; cum[m] < u ? (lo = m + 1) : (hi = m); } return lo; };

// sharp/EV-benchmark op de echte uitslagen (met optimale booster)
let sharp = 0, sharpBoost = 0;
for (const p of prep) {
  let q = pts(p.evp.h, p.evp.a, p.act[0], p.act[1]);
  if (p.evp.mz && p.evp.h === p.act[0] && p.evp.a === p.act[1]) q += 2;
  sharp += q; if (q > sharpBoost) sharpBoost = q;
}

// aantal tegenstanders en echte topscores uit de stand
const OPP = STAND ? STAND.tegenstanders.filter((t) => !t.inactief).length : 24;
const realPts = STAND ? STAND.tegenstanders.filter((t) => !t.inactief).map((t) => t.p).sort((a, b) => b - a) : [];
const realLeader = realPts[0] ?? null;

// Monte-Carlo: naief veld, verdeling van de koploper (max van OPP spelers)
let sumPlayer = 0; const maxes = new Int16Array(N);
for (let s = 0; s < N; s++) {
  let mx = -1;
  for (let o = 0; o < OPP; o++) {
    let u = Math.random() * totW, acc = 0, bIdx = null;
    for (const e of allW) { acc += e.w; if (acc >= u) { bIdx = e.key; break; } }
    let tot = 0;
    for (const p of prep) {
      const e = p.field[draw(p.cum, Math.random())];
      let q = pts(e.h, e.a, p.act[0], p.act[1]);
      if (e.mz && e.h === p.act[0] && e.a === p.act[1]) q += 2;
      if (bIdx === p.key) q *= 2;
      tot += q;
    }
    sumPlayer += tot;
    if (tot > mx) mx = tot;
  }
  maxes[s] = mx;
}
maxes.sort();
const pct = (q) => maxes[Math.floor(q * N)];
const pAtLeast = (x) => { let c = 0; for (let i = 0; i < N; i++) if (maxes[i] >= x) c++; return c / N; };
const naiveBeatsLeader = realLeader != null ? pAtLeast(realLeader) : null; // P(naief veld >= echte koploper)

console.log(`VELD-SCHERPTE-TOETS — ${played.length} gespeelde duels, ${OPP} actieve tegenstanders, N=${N.toLocaleString()}\n`);
console.log(`Sharp/EV-benchmark op de echte uitslagen: ${sharp} pt (+${sharpBoost} met optimale booster = ${sharp + sharpBoost})`);
console.log(`Naief veld — gemiddelde speler: ${(sumPlayer / (N * OPP)).toFixed(1)} pt`);
console.log(`Naief veld — KOPLOPER (max van ${OPP}):  p50=${pct(0.5)}  p90=${pct(0.9)}  p95=${pct(0.95)}  p99=${pct(0.99)}\n`);

if (realLeader != null) {
  const p = naiveBeatsLeader;
  console.log(`Echte koploper: ${realLeader} pt  →  kans dat een naief veld dat haalt: ${(p * 100).toFixed(1)}%`);
  // datagedreven advies voor optimize --sharps
  let verdict, sharps;
  if (p > 0.30) { verdict = "VELD IS NAIEF — geen aanwijzing voor kunde. Speel EV."; sharps = 0; }
  else if (p > 0.10) { verdict = "Grotendeels geluk, lichte verdenking. Houd EV-koers, blijf monitoren."; sharps = 0; }
  else if (p > 0.02) { verdict = "Koploper in de staart — mogelijk enkele scherpe spelers. Test variantie."; sharps = Math.round(OPP * 0.15); }
  else { verdict = "Koploper zeer onwaarschijnlijk bij naief veld — sterk veld. Escaleer variantie."; sharps = Math.round(OPP * 0.30); }
  console.log(`\nADVIES: ${verdict}`);
  console.log(`        → node analysis/optimize.mjs 40000 --sharps=${sharps}`);
}
