/*  Advies per ronde op basis van de gekalibreerde λ's (live markt waar
    beschikbaar). Toont per duel: jouw pick, de EV-keuze, meesterzet,
    en het verschil in verwachte punten.

    Gebruik:  node analysis/round-advice.mjs [ronde]   (default 1)  */

import { readFileSync } from "node:fs";
import { MATCHES, MY_BOOSTERS } from "./data.mjs";
import { analyse } from "./engine.mjs";

const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
const round = process.argv[2] ? parseInt(process.argv[2]) : 1;
const rho = cal.rho;

const rows = MATCHES.filter((m) => m.round === round).map((m) => {
  const L = cal.lambdas[m.key];
  const a = analyse(L.lh, L.la, m.crowd, rho);
  const mine = a.stat(m.mine[0], m.mine[1]);
  const ev = a.evpick;
  return { m, L, a, mine, ev,
    flip: Math.sign(ev.h - ev.a) !== Math.sign(m.mine[0] - m.mine[1]),
    delta: ev.evz - mine.evz };
});

const f = (x) => x.toFixed(2);
console.log(`RONDE ${round} — gekalibreerd ${cal.calibratedAt}  (ρ=${rho})\n`);
console.log("Gr | duel                              | src   | λ          | jij  | EV   | MZ | mod% | evz(EV) | evz(jij) | Δ     |");
for (const r of rows) {
  const name = `${r.m.home} v ${r.m.away}`.padEnd(33).slice(0, 33);
  const tag = r.delta < 0.005 ? "  =" : r.flip ? "FLIP" : "scor";
  console.log(
    `${r.m.group}  | ${name} | ${r.L.src.padEnd(5)} | ${f(r.L.lh)}/${f(r.L.la)}`.padEnd(60) +
    ` | ${r.m.mine[0]}-${r.m.mine[1]}  | ${r.ev.h}-${r.ev.a}  | ${r.ev.mz ? "★ " : "  "} | ${(r.ev.mp * 100).toFixed(0).padStart(3)}% | ${f(r.ev.evz).padStart(6)}  | ${f(r.mine.evz).padStart(6)}   | ${r.delta >= 0.005 ? "+" + f(r.delta) : "  =  "} ${tag === "FLIP" ? "⚠ FLIP" : ""}`
  );
}

const byEv = [...rows].sort((x, y) => y.ev.evz - x.ev.evz);
console.log(`\nBooster-ranking (EV-keuze, top 5):`);
byEv.slice(0, 5).forEach((r, i) =>
  console.log(`  ${i + 1}. ${r.m.home} v ${r.m.away} ${r.ev.h}-${r.ev.a}${r.ev.mz ? "★" : ""}  evz ${f(r.ev.evz)}  → ×2 = ${f(r.ev.evz * 2)}`));
const cur = MY_BOOSTERS[round];
if (cur) console.log(`  Huidige booster: ${cur.split("|").slice(1).join(" v ")}`);

const flips = rows.filter((r) => r.flip && r.delta >= 0.005);
const scores = rows.filter((r) => !r.flip && r.delta >= 0.005);
console.log(`\nSamenvatting: ${scores.length} score-aanpassingen (zelfde winnaar), ${flips.length} winnaar-flips, ${rows.length - flips.length - scores.length} al optimaal.`);
