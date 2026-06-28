/*  Knock-out bonusvragen: schat de kans op de gangbare bonusvragen per duel uit
    de gekalibreerde λ's. De poule stelt per knock-outduel 1-2 bonusvragen (+2
    elk), zoals "Scoort ploeg X in de 1e helft?", "Scoren beide ploegen?",
    "Meer/minder dan 2,5 goals?". Kies het antwoord met de hoogste kans (>50%).

    1e-helft-aanname: ~45% van de goals valt voor rust (HALF), de rest erna.
    Beide-scoren en >2,5 komen exact uit de scorematrix; de 1e-helft-vragen uit
    een Poisson-splitsing van de λ's.

    Gebruik:  node analysis/ko-bonus.mjs [ronde]   (default 4 = 16e finales)  */

import { readFileSync } from "node:fs";
import { MATCHES } from "./data.mjs";
import { scoreMatrix } from "./engine.mjs";

const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
const round = process.argv[2] ? parseInt(process.argv[2]) : 4;
const HALF = 0.45;
const p0 = (l) => Math.exp(-l); // P(0 goals) bij Poisson(l)
const pct = (x) => (x * 100).toFixed(0).padStart(3) + "%";
const ans = (p) => (p >= 0.5 ? "JA " : "NEE") + ` (${pct(p)})`;

console.log(`Bonusvragen-kansen — ronde ${round}  (λ uit calibrated.json, 1e helft ≈ ${HALF})\n`);
console.log("duel".padEnd(31) + "λ thuis/uit | thuis 1eH | uit 1eH | beide scoren | >2,5 goals | goal in 1eH");
for (const m of MATCHES.filter((x) => x.round === round)) {
  const L = cal.lambdas[m.key];
  if (!L) continue;
  const M = scoreMatrix(L.lh, L.la, cal.rho, 8);
  const pHome1H = 1 - p0(L.lh * HALF);
  const pAway1H = 1 - p0(L.la * HALF);
  let pBoth = 0, pOver = 0;
  for (let h = 0; h < M.length; h++) for (let a = 0; a < M.length; a++) {
    if (h >= 1 && a >= 1) pBoth += M[h][a];
    if (h + a >= 3) pOver += M[h][a];
  }
  const pGoal1H = 1 - p0((L.lh + L.la) * HALF);
  console.log(
    `${(m.home + " v " + m.away).slice(0, 30).padEnd(31)}${(L.lh.toFixed(2) + "/" + L.la.toFixed(2)).padEnd(12)}| ${ans(pHome1H)} | ${ans(pAway1H)} | ${ans(pBoth)}   | ${ans(pOver)}  | ${ans(pGoal1H)}`
  );
}
console.log(`\nLeesregel: per bonusvraag (+2) het antwoord met >50% kiezen. "thuis/uit 1eH" = scoort die ploeg vóór rust.`);
