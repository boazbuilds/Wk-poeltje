/*  Genereert de definitieve voorspellingen als agent-leesbare bestanden in
    de repo-root: VOORSPELLINGEN.md (instructies + tabel) en picks.json
    (machine-leesbaar). Bedoeld voor een (browser-)agent die de ESPN-pagina
    invult.

    Beslisregel per duel (deterministisch, geen handwerk):
      aanbeveling = robuuste-EV-keuze (blendMatrix σ=0.10) als die ≥ 0.05 evz
      boven de huidige invulling ligt, anders de huidige invulling laten staan.
      Uitzonderingen staan expliciet in OVERRIDES (met reden).

    Gebruik:  node analysis/build-picks.mjs        (na fetch + calibrate)  */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { MATCHES, MY_BOOSTERS } from "./data.mjs";
import { analyseM, blendMatrix, blendWithMarket, popOf } from "./engine.mjs";

const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
const bv = JSON.parse(readFileSync(new URL("./bovada.json", import.meta.url)));
const pinFile = new URL("./pinnacle.json", import.meta.url);
const pin = existsSync(pinFile) ? JSON.parse(readFileSync(pinFile)) : { markets: {} };
const resFile = new URL("./results.json", import.meta.url);
const RESULTS = existsSync(resFile) ? JSON.parse(readFileSync(resFile)).results : {};
const scoresFile = new URL("./polymarket-scores.json", import.meta.url);
const SCORES = existsSync(scoresFile) ? JSON.parse(readFileSync(scoresFile)).markets : {};
const SIGMA = 0.10, THRESH = 0.05;
// Ronde is verplicht: dit script overschrijft VOORSPELLINGEN.md + picks.json,
// dus geen default (een bare run zou anders ronde 1 over een latere ronde schrijven).
const ROUND = parseInt(process.argv[2], 10);
if (!(ROUND >= 1 && ROUND <= 8)) {
  console.error("Gebruik: node analysis/build-picks.mjs <ronde 1..8>  (1-3 = groepsfase, 4 = 16e finales, 5 = 8e, 6 = kwart, 7 = halve, 8 = finale)");
  process.exit(1);
}
const ROUND_NAME = { 1: "Speelronde 1", 2: "Speelronde 2", 3: "Speelronde 3", 4: "16e finales", 5: "8e finales", 6: "Kwartfinale", 7: "Halve finale", 8: "Finale" };
const RN = ROUND_NAME[ROUND] || `Ronde ${ROUND}`;

// P(#1)-optimizer-voorkeuren waar de EV binnen de ruis gelijk is (±0.01).
const OVERRIDES = {
  "1|Iran|Nieuw-Zeeland": { pick: [2, 0], reden: "EV én P(#1)-optimizer kiezen beide 2-0★ (herijking 12 jun)" },
};

// Teamnamen exact zoals de ESPN-pagina ze toont.
const ESPN = { "VS": "Veren. Staten", "Bosnië-Herz.": "Bosnië-Herzeg." };
const espn = (n) => ESPN[n] ?? n;

const fmtDl = (ms) => new Date(ms).toLocaleString("nl-NL", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam",
});

const marketUsed = [];
const rows = MATCHES.filter((m) => m.round === ROUND).map((m) => {
  const L = cal.lambdas[m.key];
  const startRaw = bv.markets[m.key]?.start ?? pin.markets[m.key]?.start ?? null;
  const start = typeof startRaw === "string" ? Date.parse(startRaw) : startRaw;
  const locked = !!RESULTS[m.key] || (start && start < Date.now());
  // markt-exacte-score alleen voor nog-open duels meewegen (live/gesloten markten degenereren)
  const modelM = blendMatrix(L.lh, L.la, cal.rho, SIGMA);
  const { M, w } = locked ? { M: modelM, w: 0 } : blendWithMarket(modelM, SCORES[m.key]);
  if (w > 0) marketUsed.push(`${m.home}-${m.away} ${(w * 100).toFixed(0)}%`);
  const a = analyseM(M, m.crowd);
  // zonder bekende poule-populariteit kunnen we de meesterzet niet inschatten →
  // kies dan op pure EV (markt-modus) en toon geen ster; mét populariteit op
  // evz (incl. de +2-meesterzet).
  const popKnown = m.crowd.length > 0;
  const score = (s) => (popKnown ? s.evz : s.ev);
  const mine = a.stat(m.mine[0], m.mine[1]);
  let ev = null;
  for (let h = 0; h <= 6; h++) for (let a2 = 0; a2 <= 6; a2++) {
    const s = a.stat(h, a2);
    if (!ev || score(s) > score(ev)) ev = s;
  }

  let pick, reden;
  if (OVERRIDES[m.key]) {
    pick = OVERRIDES[m.key].pick; reden = OVERRIDES[m.key].reden;
  } else if (score(ev) - score(mine) >= THRESH) {
    pick = [ev.h, ev.a]; reden = `robuuste EV +${(score(ev) - score(mine)).toFixed(2)}`;
  } else {
    pick = [m.mine[0], m.mine[1]]; reden = "huidige invulling is (vrijwel) optimaal";
  }
  const st = a.stat(pick[0], pick[1]);

  // op één na beste keuze: hoogste score behalve de pick zelf
  let runnerUp = null;
  for (let h = 0; h <= 6; h++) for (let a2 = 0; a2 <= 6; a2++) {
    if (h === pick[0] && a2 === pick[1]) continue;
    const s = a.stat(h, a2);
    if (!runnerUp || score(s) > score(runnerUp)) runnerUp = s;
  }
  // fallback als de meesterzet vervalt (score drijft naar ≥10% populariteit):
  // de runner-up telt alleen als die zónder de meesterzet alsnog beter zou zijn.
  const fallback = popKnown && st.mz && runnerUp && runnerUp.evz > st.evz - 2 * st.mp
    ? [runnerUp.h, runnerUp.a, runnerUp.mz] : null;

  return {
    key: m.key, group: m.group, start, locked, uitslag: RESULTS[m.key] ?? null,
    espnHome: espn(m.home), espnAway: espn(m.away),
    huidig: m.mine, pick, ster: popKnown && st.mz, popKnown, reden,
    wijzigen: !locked && (pick[0] !== m.mine[0] || pick[1] !== m.mine[1]),
    fallback, evz: +score(st).toFixed(2), modelPct: +(st.mp * 100).toFixed(0),
    alt: [runnerUp.h, runnerUp.a], altEvz: +score(runnerUp).toFixed(2), altSter: popKnown && runnerUp.mz,
  };
}).sort((x, y) => (x.start ?? 0) - (y.start ?? 0));

const boosterKey = MY_BOOSTERS[ROUND];
const bm = boosterKey ? MATCHES.find((m) => m.key === boosterKey) : null;
const bmRow = bm ? rows.find((r) => r.key === boosterKey) : null;
const boosterLocked = !!bmRow?.locked;
const boosterUitslag = bmRow?.uitslag ? `${bmRow.uitslag[0]}-${bmRow.uitslag[1]}` : null;
// beste nog-open booster-alternatief (hoogste evz × 2)
const openBest = rows.filter((r) => !r.locked).sort((x, y) => y.evz - x.evz)[0];
const boosterNote = !bm
  ? `Booster ${RN}: nog niet ingesteld${openBest ? ` — hoogste EV-duel is **${openBest.espnHome}–${openBest.espnAway} ${openBest.pick[0]}-${openBest.pick[1]}${openBest.ster ? "★" : ""}** (evz ${openBest.evz} → ×2 ≈ ${(openBest.evz * 2).toFixed(1)})` : ""}.`
  : boosterLocked
  ? `Booster ${RN} stond op **${espn(bm.home)}–${espn(bm.away)}** — die is al gespeeld${boosterUitslag ? ` (uitslag ${boosterUitslag})` : ""}, dus vergrendeld; niets meer te doen.`
  : `Booster ${RN}: **laten staan op ${espn(bm.home)}–${espn(bm.away)}** (staat al goed; niets wijzigen).`;
const changes = rows.filter((r) => r.wijzigen);
const popPending = rows.filter((r) => !r.popKnown && !r.locked).length;

/* ---------- picks.json (+ ronde-specifieke kopie) ---------- */
const picksStr = JSON.stringify({
  generatedAt: new Date().toISOString(),
  ronde: ROUND,
  booster: bm ? { wedstrijd: `${espn(bm.home)} vs ${espn(bm.away)}`, vergrendeld: boosterLocked, actie: boosterLocked ? `al gespeeld${boosterUitslag ? ` (${boosterUitslag})` : ""} — vergrendeld, niets te doen` : "laten staan (staat al goed)" } : { wedstrijd: null, actie: "nog niet ingesteld voor deze ronde" },
  instructie: "Vul per wedstrijd thuis- en uitscore in. Sla wedstrijden die al begonnen zijn over. Controleer bij sterren (meesterzet) de populariteit; bij ≥10% de fallback gebruiken.",
  wedstrijden: rows.map((r) => ({
    wedstrijd: `${r.espnHome} vs ${r.espnAway}`,
    deadline_nl: r.start ? fmtDl(r.start) : null,
    vergrendeld: r.locked,
    uitslag: r.uitslag ? `${r.uitslag[0]}-${r.uitslag[1]}` : null,
    thuis: r.pick[0], uit: r.pick[1],
    ev: r.evz, tweede_keuze: `${r.alt[0]}-${r.alt[1]}`, tweede_keuze_ev: r.altEvz, tweede_keuze_meesterzet: r.altSter,
    wijzigen: r.wijzigen, huidige_invulling: `${r.huidig[0]}-${r.huidig[1]}`,
    meesterzet: r.ster, populariteit_bekend: r.popKnown,
    fallback_bij_10pct: r.fallback ? `${r.fallback[0]}-${r.fallback[1]}` : null,
  })),
}, null, 1);
writeFileSync(new URL("../picks.json", import.meta.url), picksStr);
writeFileSync(new URL(`../picks-r${ROUND}.json`, import.meta.url), picksStr);

/* ---------- archief (momentopname vóór aftrap, voor zuivere backtest later) ---------- */
mkdirSync(new URL("./archive/", import.meta.url), { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
writeFileSync(new URL(`./archive/r${ROUND}-${stamp}.json`, import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(), ronde: ROUND, rho: cal.rho,
  picks: rows.map((r) => ({ key: r.key, pick: r.pick, ster: r.ster, evz: r.evz, locked: r.locked, lambda: cal.lambdas[r.key] })),
}, null, 1));

/* ---------- VOORSPELLINGEN.md ---------- */
const md = `# Voorspellingen — ${RN} (definitief)

Gegenereerd: ${new Date().toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" })} ·
bron: joint-kalibratie op live Polymarket + Bovada (1X2, O/U-totals, goal spreads), robuuste EV (σ=0.10).
Machine-leesbaar: [\`picks.json\`](./picks.json)

## Instructies voor het invullen (ESPN WK Pool)

1. Alleen **${RN}** invullen${ROUND < 3 ? " — latere rondes worden vlak voor hun deadlines opnieuw geijkt" : ""}.
2. Vul per wedstrijd exact de score uit de tabel in (thuis–uit).
3. **Wedstrijden die al begonnen zijn, zijn vergrendeld — overslaan.**
4. ${boosterNote}
5. ★ = meesterzet (score < 10% populariteit). Check vlak voor de deadline de
   "Populaire voorspellingen" op de ESPN-pagina: staat de aanbevolen score daar
   op **10% of meer**, gebruik dan de fallback-kolom.
6. Na het invullen verifiëren dat alle ${rows.length} wedstrijden de juiste waarde tonen.${popPending ? `\n\n> ⚠️ Voor **${popPending} duels** is de poule-populariteit nog onbekend → die picks staan op de **markt-EV** (geen meesterzet/★ meegerekend). Stuur de "Populaire voorspellingen" per duel; dan reken ik de meesterzet + EV erbij.` : ""}

## Te wijzigen (${changes.length} wedstrijden)

| Deadline (NL) | Wedstrijd | Van | **Naar** | ★ | Fallback bij ≥10% |
|---|---|---|---|---|---|
${changes.map((r) => `| ${r.start ? fmtDl(r.start) : "?"} | ${r.espnHome} – ${r.espnAway} | ${r.huidig[0]}-${r.huidig[1]} | **${r.pick[0]}-${r.pick[1]}** | ${r.ster ? "★" : ""} | ${r.fallback ? r.fallback[0] + "-" + r.fallback[1] : "—"} |`).join("\n")}

## Volledige lijst (controle, op deadline-volgorde)

| Deadline (NL) | Wedstrijd | Voorspelling | ★ | EV | 2e keuze (EV) | Actie |
|---|---|---|---|---|---|---|
${rows.map((r) => `| ${r.start ? fmtDl(r.start) : "?"} | ${r.espnHome} – ${r.espnAway} | **${r.pick[0]}-${r.pick[1]}** | ${r.ster ? "★" : ""} | ${r.evz.toFixed(2)} | ${r.alt[0]}-${r.alt[1]}${r.altSter ? "★" : ""} (${r.altEvz.toFixed(2)}) | ${r.locked ? "VERGRENDELD" + (r.uitslag ? ` (uitslag ${r.uitslag[0]}-${r.uitslag[1]})` : "") : r.wijzigen ? "WIJZIGEN (staat nu " + r.huidig[0] + "-" + r.huidig[1] + ")" : "laten staan"} |`).join("\n")}

*${boosterNote}*${boosterLocked && openBest ? `\n\n> Mocht je tóch nog een ongebruikte ronde-${ROUND}-booster hebben: het hoogste open duel is **${openBest.espnHome}–${openBest.espnAway} ${openBest.pick[0]}-${openBest.pick[1]}${openBest.ster ? "★" : ""}** (evz ${openBest.evz} → ×2 ≈ ${(openBest.evz * 2).toFixed(1)}).` : ""}
`;
writeFileSync(new URL("../VOORSPELLINGEN.md", import.meta.url), md);
writeFileSync(new URL(`../VOORSPELLINGEN-r${ROUND}.md`, import.meta.url), md);
console.log(`${RN}: VOORSPELLINGEN.md + picks.json geschreven — ${rows.length} duels, ${changes.length} wijzigingen, booster ${bm ? bm.home + "-" + bm.away : "n.v.t."}.`);
for (const r of changes) console.log(`  ${r.espnHome}-${r.espnAway}: ${r.huidig[0]}-${r.huidig[1]} → ${r.pick[0]}-${r.pick[1]}${r.ster ? "★" : ""} (${r.reden})`);
if (marketUsed.length) console.log(`Markt-exacte-score meegewogen (#4): ${marketUsed.join(", ")}`);
