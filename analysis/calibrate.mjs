/*  Kalibratie: fit één globale Dixon-Coles ρ op alle live markten en reken
    per duel de markt-1X2 terug naar (λ_thuis, λ_uit) onder die ρ.
    Duels zonder live markt behouden hun oude λ uit data.mjs (src: "stale").

    Gebruik:  node analysis/calibrate.mjs        → schrijft calibrated.json  */

import { readFileSync, writeFileSync } from "node:fs";
import { MATCHES } from "./data.mjs";
import { invert1X2, fitRho, scoreMatrix, outcome } from "./engine.mjs";

const market = JSON.parse(readFileSync(new URL("./market.json", import.meta.url)));
const live = Object.entries(market.markets).map(([key, v]) => ({ key, ...v }));

/*  Totaal-ankers voor extreme favorieten (>85% winstkans): daar is de
    1X2-inversie slecht bepaald (de gelijkspel-prijs is een longshot en
    pint het totaal niet vast). Het verwachte totaal komt dan uit de
    bookmaker O/U-lijn:  Duitsland-Curaçao O/U 4.5, Under favoriet → ±4.4;
    Spanje-Kaapverdië O/U 3.5, Under -125 → ±3.5  (bronnen: zie README).  */
const ANCHORS = {
  "1|Duitsland|Curaçao": 4.4,
  "1|Spanje|Kaapverdië": 3.5,
};

// Inversie met vastgepind totaal: scan alleen de supremacy (beide richtingen).
function invertAnchored(hw, aw, T, rho) {
  let best = { lh: T / 2, la: T / 2, e: Infinity };
  for (let S = -(T - 0.02); S <= T - 0.02; S += 0.005) {
    const lh = (T + S) / 2, la = (T - S) / 2;
    const o = outcome(scoreMatrix(lh, la, rho));
    const e = (o.hw - hw) ** 2 + (o.aw - aw) ** 2;
    if (e < best.e) best = { lh: +lh.toFixed(3), la: +la.toFixed(3), e };
  }
  return best;
}

/*  Veiligheidsklep: bij favorieten >85% zonder expliciet anker is het totaal
    uit 1X2 alleen niet identificeerbaar (de inversie schiet dan omhoog).
    Geen enkel WK-duel prijst boven ±4.5 totaal, dus cap op 4.6.  */
const TOTAL_CAP = 4.6;

console.log(`Markten: ${live.length} live (opgehaald ${market.fetchedAt})\n`);

// 1) Globale ρ fitten
const { rho, table } = fitRho(live);
console.log("ρ-fit (lager = beter):");
for (const r of table.slice(0, 5)) console.log(`  ρ=${r.rho.toFixed(2).padStart(5)}  err=${(r.err * 1e4).toFixed(2)}e-4`);
console.log(`→ gekozen ρ = ${rho}\n`);

// 2) λ's terugrekenen per duel
const lambdas = {};
console.log("duel".padEnd(36) + "λ oud".padEnd(14) + "λ nieuw".padEnd(14) + "fit-1X2 (model vs markt)");
for (const m of MATCHES) {
  const mk = market.markets[m.key];
  if (mk) {
    let inv = ANCHORS[m.key]
      ? invertAnchored(mk.hw, mk.aw, ANCHORS[m.key], rho)
      : invert1X2(mk.hw, mk.d, mk.aw, rho);
    if (!ANCHORS[m.key] && Math.max(mk.hw, mk.aw) > 0.85 && inv.lh + inv.la > TOTAL_CAP)
      inv = invertAnchored(mk.hw, mk.aw, TOTAL_CAP, rho);
    const { lh, la } = inv;
    const o = outcome(scoreMatrix(lh, la, rho));
    lambdas[m.key] = { lh, la, src: "live", volume: mk.volume };
    const drift = Math.abs(lh - m.lh) + Math.abs(la - m.la);
    console.log(
      m.key.padEnd(36) +
      `${m.lh.toFixed(2)}/${m.la.toFixed(2)}`.padEnd(14) +
      `${lh.toFixed(2)}/${la.toFixed(2)}`.padEnd(14) +
      `1 ${(o.hw * 100).toFixed(0)}|${(mk.hw * 100).toFixed(0)}  X ${(o.d * 100).toFixed(0)}|${(mk.d * 100).toFixed(0)}  2 ${(o.aw * 100).toFixed(0)}|${(mk.aw * 100).toFixed(0)}` +
      (drift > 0.5 ? "   ← grote shift" : "")
    );
  } else if (!process.argv.includes("--live-only")) {
    lambdas[m.key] = { lh: m.lh, la: m.la, src: "stale" };
  } else {
    lambdas[m.key] = { lh: m.lh, la: m.la, src: "stale" };
  }
}

writeFileSync(new URL("./calibrated.json", import.meta.url),
  JSON.stringify({ calibratedAt: new Date().toISOString(), rho, lambdas }, null, 1));
console.log(`\ncalibrated.json geschreven (ρ=${rho}, ${live.length} live, ${MATCHES.length - live.length} stale).`);
