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

const load = (name) => { const u = new URL(`./${name}`, import.meta.url); return existsSync(u) ? JSON.parse(readFileSync(u)) : { markets: {} }; };
const pm = load("market.json");      // Polymarket: echt geld, 1X2
const bv = load("bovada.json");      // Bovada: 1X2 + totals + spread
const pin = load("pinnacle.json");   // Pinnacle: scherpste, volledige ladders
const ovrFile = load("overrides.json"); // overrides.json heeft .overrides ipv .markets
const OVR = ovrFile.overrides ?? {};

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
// targets per duel samenstellen — Pinnacle weegt het zwaarst (telt dubbel in de 1X2-blend)
const targets = {};
for (const m of MATCHES) {
  const p = pm.markets[m.key], b = bv.markets[m.key], k = pin.markets[m.key];
  const t = {};
  const mls = [];
  if (k?.ml) { mls.push(k.ml); mls.push(k.ml); } // Pinnacle dubbel gewicht
  if (p) mls.push({ hw: p.hw, d: p.d, aw: p.aw });
  if (b?.ml) mls.push(b.ml);
  if (mls.length) t.ml = { hw: avg(mls.map((x) => x.hw)), d: avg(mls.map((x) => x.d)), aw: avg(mls.map((x) => x.aw)) };
  // totals: Pinnacle-ladder (scherpst) + Bovada-hoofdlijn als die er is
  const totals = [];
  if (k?.totals) totals.push(...k.totals);
  if (b?.total) totals.push(b.total);
  if (totals.length) t.totals = totals;
  // spreads: Pinnacle + Bovada hoofd-handicap
  const spreads = [];
  if (k?.spread) spreads.push(k.spread);
  if (b?.spread) spreads.push(b.spread);
  if (spreads.length) t.spreads = spreads;
  // team-totals: Pinnacle per-team ladders (pinnen λ_thuis/λ_uit apart)
  if (k?.teamTotals && (k.teamTotals.home?.length || k.teamTotals.away?.length)) t.teamTotals = k.teamTotals;
  if (t.ml || t.totals) targets[m.key] = t;
}
const tl = Object.values(targets);
const nSrc = (key) => ["pm", "bv", "pin"].filter((s) => ({ pm, bv, pin }[s].markets[key])).length;
console.log(`Joint-kalibratie over ${tl.length} duels · bronnen: Polymarket ${Object.keys(pm.markets).length}, Bovada ${Object.keys(bv.markets).length}, Pinnacle ${Object.keys(pin.markets).length}` +
  `\n(1X2 ${tl.filter((t) => t.ml).length}, totals ${tl.filter((t) => t.totals).length}, spreads ${tl.filter((t) => t.spreads).length}, team-totals ${tl.filter((t) => t.teamTotals).length}, overrides ${Object.keys(OVR).length})\n`);

// 1) ρ fitten op de joint-doelfunctie
const { rho, table } = fitRhoJoint(tl);
console.log("ρ-fit (joint, lager = beter):");
for (const r of table.slice(0, 5)) console.log(`  ρ=${r.rho.toFixed(2).padStart(5)}  err=${(r.err * 1e4).toFixed(2)}e-4`);
console.log(`→ gekozen ρ = ${rho}\n`);

// override toepassen op een (lh,la)
function applyOverride(lh, la, o) {
  if (o.lambda) return { lh: o.lambda[0], la: o.lambda[1] };
  if (o.total != null && o.supremacy != null) return { lh: (o.total + o.supremacy) / 2, la: (o.total - o.supremacy) / 2 };
  if (o.lambdaMult) return { lh: lh * o.lambdaMult[0], la: la * o.lambdaMult[1] };
  return { lh, la };
}

// 2) λ's per duel
const lambdas = {};
console.log("duel".padEnd(34) + "λ oud".padEnd(13) + "λ nieuw".padEnd(13) + "totaal  src");
for (const m of MATCHES) {
  const t = targets[m.key];
  let lh, la, src;
  if (t) {
    ({ lh, la } = invertJoint(t, rho));
    src = `joint·${nSrc(m.key)}br`;
  } else {
    lh = m.lh; la = m.la; src = "stale";
  }
  if (OVR[m.key]) {
    ({ lh, la } = applyOverride(lh, la, OVR[m.key]));
    lh = +lh.toFixed(3); la = +la.toFixed(3);
    src += "+override";
  }
  lambdas[m.key] = { lh, la, src, totalLine: t?.totals ? t.totals[0]?.line ?? null : null };
  const drift = Math.abs(lh - m.lh) + Math.abs(la - m.la);
  console.log(
    m.key.padEnd(34) +
    `${m.lh.toFixed(2)}/${m.la.toFixed(2)}`.padEnd(13) +
    `${lh.toFixed(2)}/${la.toFixed(2)}`.padEnd(13) +
    `${(lh + la).toFixed(2)}`.padEnd(8) + src +
    (OVR[m.key] ? `  ⚙ ${OVR[m.key].note ?? ""}` : drift > 0.5 ? "  ← shift" : "")
  );
}

writeFileSync(new URL("./calibrated.json", import.meta.url),
  JSON.stringify({ calibratedAt: new Date().toISOString(), rho, lambdas }, null, 1));
const counts = {};
for (const l of Object.values(lambdas)) counts[l.src] = (counts[l.src] ?? 0) + 1;
console.log(`\ncalibrated.json geschreven (ρ=${rho}, bronnen: ${JSON.stringify(counts)}).`);
