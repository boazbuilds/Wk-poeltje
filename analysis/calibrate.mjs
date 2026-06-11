/*  Joint-kalibratie: per duel worden (λ_thuis, λ_uit) gefit op ALLE
    beschikbare marktsignalen tegelijk:
      - 1X2  : gemiddelde van Polymarket (echt geld) en Bovada (de-vig)
      - Total: O/U-lijn + prijzen (pint het verwachte aantal goals vast)
      - Spread: goal handicap (pint de supremacy vast)
    De globale Dixon-Coles ρ wordt op dezelfde joint-doelfunctie gefit.

    Vereist: market.json (fetch-polymarket) en bovada.json (fetch-bovada).
    Gebruik:  node analysis/calibrate.mjs        → schrijft calibrated.json  */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { MATCHES } from "./data.mjs";
import { invertJoint, fitRhoJoint, scoreMatrix, marketError, outcome } from "./engine.mjs";

const pm = JSON.parse(readFileSync(new URL("./market.json", import.meta.url)));
const bvPath = new URL("./bovada.json", import.meta.url);
const bv = existsSync(bvPath) ? JSON.parse(readFileSync(bvPath)) : { markets: {} };

// targets per duel samenstellen
const targets = {};
for (const m of MATCHES) {
  const p = pm.markets[m.key], b = bv.markets[m.key];
  const t = {};
  if (p && b?.ml) t.ml = { hw: (p.hw + b.ml.hw) / 2, d: (p.d + b.ml.d) / 2, aw: (p.aw + b.ml.aw) / 2 };
  else if (p) t.ml = { hw: p.hw, d: p.d, aw: p.aw };
  else if (b?.ml) t.ml = b.ml;
  if (b?.total) t.total = b.total;
  if (b?.spread) t.spread = b.spread;
  if (t.ml || t.total) targets[m.key] = t;
}
const tl = Object.values(targets);
console.log(`Joint-kalibratie over ${tl.length} duels ` +
  `(1X2 ${tl.filter((t) => t.ml).length}, totals ${tl.filter((t) => t.total).length}, spreads ${tl.filter((t) => t.spread).length})\n`);

// 1) ρ fitten op de joint-doelfunctie
const { rho, table } = fitRhoJoint(tl);
console.log("ρ-fit (joint, lager = beter):");
for (const r of table.slice(0, 5)) console.log(`  ρ=${r.rho.toFixed(2).padStart(5)}  err=${(r.err * 1e4).toFixed(2)}e-4`);
console.log(`→ gekozen ρ = ${rho}\n`);

// 2) λ's per duel
const lambdas = {};
console.log("duel".padEnd(34) + "λ oud".padEnd(13) + "λ nieuw".padEnd(13) + "totaal(lijn)  1X2-fit model|markt");
for (const m of MATCHES) {
  const t = targets[m.key];
  if (t) {
    const { lh, la } = invertJoint(t, rho);
    const o = outcome(scoreMatrix(lh, la, rho));
    lambdas[m.key] = { lh, la, src: t.total ? (t.ml ? "joint" : "bovada") : "1x2", totalLine: t.total?.line ?? null };
    const drift = Math.abs(lh - m.lh) + Math.abs(la - m.la);
    const mlTxt = t.ml ? `1 ${(o.hw * 100).toFixed(0)}|${(t.ml.hw * 100).toFixed(0)} X ${(o.d * 100).toFixed(0)}|${(t.ml.d * 100).toFixed(0)} 2 ${(o.aw * 100).toFixed(0)}|${(t.ml.aw * 100).toFixed(0)}` : "—";
    console.log(
      m.key.padEnd(34) +
      `${m.lh.toFixed(2)}/${m.la.toFixed(2)}`.padEnd(13) +
      `${lh.toFixed(2)}/${la.toFixed(2)}`.padEnd(13) +
      `${(lh + la).toFixed(2)} (${t.total ? t.total.line : "—"})`.padEnd(14) + mlTxt +
      (drift > 0.5 ? "  ← grote shift" : "")
    );
  } else {
    lambdas[m.key] = { lh: m.lh, la: m.la, src: "stale", totalLine: null };
  }
}

writeFileSync(new URL("./calibrated.json", import.meta.url),
  JSON.stringify({ calibratedAt: new Date().toISOString(), rho, lambdas }, null, 1));
const counts = {};
for (const l of Object.values(lambdas)) counts[l.src] = (counts[l.src] ?? 0) + 1;
console.log(`\ncalibrated.json geschreven (ρ=${rho}, bronnen: ${JSON.stringify(counts)}).`);
