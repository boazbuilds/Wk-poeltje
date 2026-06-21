/*  Backtest: meet de EV+meesterzet-strategie tegen het veld op de AL GESPEELDE
    duels (results.json). Vergelijkt drie strategieën op werkelijk behaalde punten:
      - model   : de EV-keuze van het model (argmax evz)
      - veld    : de meest populaire score in de poule (kudde)
      - invuld  : jouw daadwerkelijke invulling (data.mjs 'mine')
    en toont kalibratie: toto-trefkans, exacte-score-trefkans, en voorspeld vs.
    werkelijk aantal goals (de "zit het model te laag op goals?"-check).

    LET OP: voor gespeelde duels staan de λ's in calibrated.json op 'stale'
    (de oude data.mjs-export, want de markt is na aftrap weg). Dit is een
    redelijke pre-toernooi-prior, geen scherpe sluitingslijn — lees de
    uitkomst als richting, niet als exacte maat. Archiveer picks vóór aftrap
    (build-picks schrijft analysis/archive/) voor een zuivere toekomst-backtest.

    Gebruik:  node analysis/backtest.mjs  */

import { readFileSync, existsSync } from "node:fs";
import { MATCHES } from "./data.mjs";
import { analyseM, blendMatrix, pts, popOf } from "./engine.mjs";

const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
const resFile = new URL("./results.json", import.meta.url);
const RES = existsSync(resFile) ? JSON.parse(readFileSync(resFile)).results : {};
const rho = cal.rho, SIGMA = 0.10;

// werkelijke punten van een pick tegen een uitslag, inclusief meesterzet (+2 als
// de pick exact is én < 10% populariteit in de poule).
const realPts = (pick, act, crowd) => {
  let p = pts(pick[0], pick[1], act[0], act[1]);
  const pop = popOf(pick[0], pick[1], crowd);
  if (pick[0] === act[0] && pick[1] === act[1] && (pop === null || pop < 10)) p += 2;
  return p;
};

const played = MATCHES.filter((m) => RES[m.key]);
let tModel = 0, tVeld = 0, tMine = 0, tPerfect = 0;
let totoHit = 0, exactHit = 0, mzElig = 0, mzHit = 0, mzPts = 0;
let predGoals = 0, actGoals = 0;
const perRound = {};

console.log(`Backtest over ${played.length} gespeelde duels (λ gespeeld = stale prior)\n`);
console.log("duel".padEnd(30) + "uitslag | model      veld       invuld");
for (const m of played) {
  const L = cal.lambdas[m.key];
  const a = analyseM(blendMatrix(L.lh, L.la, rho, SIGMA), m.crowd);
  const act = RES[m.key];
  const model = [a.evpick.h, a.evpick.a];
  const veld = m.crowd.length ? m.crowd.reduce((b, c) => (c[2] > b[2] ? c : b)).slice(0, 2) : model;
  const mine = m.mine;

  const pM = realPts(model, act, m.crowd), pV = realPts(veld, act, m.crowd), pMine = realPts(mine, act, m.crowd);
  const pPerf = realPts(act, act, m.crowd); // exact = 6 (+2 als die score zelf <10%)
  tModel += pM; tVeld += pV; tMine += pMine; tPerfect += pPerf;

  // kalibratie
  if (Math.sign(model[0] - model[1]) === Math.sign(act[0] - act[1])) totoHit++;
  if (model[0] === act[0] && model[1] === act[1]) exactHit++;
  if (a.evpick.mz) { mzElig++; if (model[0] === act[0] && model[1] === act[1]) { mzHit++; mzPts += 2; } }
  predGoals += L.lh + L.la; actGoals += act[0] + act[1];

  (perRound[m.round] ??= { model: 0, veld: 0, mine: 0, n: 0 });
  perRound[m.round].model += pM; perRound[m.round].veld += pV; perRound[m.round].mine += pMine; perRound[m.round].n++;

  const f = (pk, p) => `${pk[0]}-${pk[1]}(${p})`.padEnd(11);
  console.log(`${(m.home + " v " + m.away).slice(0, 29).padEnd(30)}${act[0]}-${act[1]}     | ${f(model, pM)}${f(veld, pV)}${f(mine, pMine)}`);
}

const n = played.length, avg = (x) => (x / n).toFixed(2);
console.log(`\n=== Totaal (${n} duels) ===`);
console.log(`  model (EV+meesterzet) : ${tModel}  (${avg(tModel)}/duel)`);
console.log(`  veld  (kudde-modus)   : ${tVeld}  (${avg(tVeld)}/duel)`);
console.log(`  jouw invulling        : ${tMine}  (${avg(tMine)}/duel)`);
console.log(`  perfect (plafond)     : ${tPerfect}  (${avg(tPerfect)}/duel)`);
console.log(`  → model vs veld: ${tModel - tVeld >= 0 ? "+" : ""}${tModel - tVeld} pnt over ${n} duels`);
console.log(`\nPer ronde (model / veld / invuld):`);
for (const r of Object.keys(perRound).sort()) { const x = perRound[r]; console.log(`  R${r} (${x.n}): ${x.model} / ${x.veld} / ${x.mine}`); }

console.log(`\n=== Kalibratie (model-pick) ===`);
console.log(`  toto raak       : ${totoHit}/${n} (${(100 * totoHit / n).toFixed(0)}%)`);
console.log(`  exacte score    : ${exactHit}/${n} (${(100 * exactHit / n).toFixed(0)}%)`);
console.log(`  meesterzet      : ${mzHit}/${mzElig} raak van de ★-picks → +${mzPts} bonuspunten`);
console.log(`  goals voorspeld : ${avg(predGoals)}/duel   werkelijk: ${avg(actGoals)}/duel   (${actGoals > predGoals ? "model te LAAG" : "model te hoog"} op goals)`);
