/*  Genereert de definitieve voorspellingen als agent-leesbare bestanden in
    de repo-root: VOORSPELLINGEN.md (instructies + tabel) en picks.json
    (machine-leesbaar). Bedoeld voor een (browser-)agent die de ESPN-pagina
    invult.

    Beslisregel per duel (deterministisch, geen handwerk):
      aanbeveling = robuuste-EV-keuze (blendMatrix σ=0.10) als die ≥ 0.05 evz
      boven de huidige invulling ligt, anders de huidige invulling laten staan.
      Uitzonderingen staan expliciet in OVERRIDES (met reden).

    Gebruik:  node analysis/build-picks.mjs        (na fetch + calibrate)  */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { MATCHES, MY_BOOSTERS } from "./data.mjs";
import { analyseM, blendMatrix, popOf } from "./engine.mjs";

const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
const bv = JSON.parse(readFileSync(new URL("./bovada.json", import.meta.url)));
const resFile = new URL("./results.json", import.meta.url);
const RESULTS = existsSync(resFile) ? JSON.parse(readFileSync(resFile)).results : {};
const SIGMA = 0.10, THRESH = 0.05;
const ROUND = process.argv[2] ? parseInt(process.argv[2]) : 1;

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

const rows = MATCHES.filter((m) => m.round === ROUND).map((m) => {
  const L = cal.lambdas[m.key];
  const M = blendMatrix(L.lh, L.la, cal.rho, SIGMA);
  const a = analyseM(M, m.crowd);
  const mine = a.stat(m.mine[0], m.mine[1]);
  const ev = a.evpick;

  let pick, reden;
  if (OVERRIDES[m.key]) {
    pick = OVERRIDES[m.key].pick; reden = OVERRIDES[m.key].reden;
  } else if (ev.evz - mine.evz >= THRESH) {
    pick = [ev.h, ev.a]; reden = `robuuste EV +${(ev.evz - mine.evz).toFixed(2)}`;
  } else {
    pick = [m.mine[0], m.mine[1]]; reden = "huidige invulling is (vrijwel) optimaal";
  }
  const st = a.stat(pick[0], pick[1]);

  // fallback als de meesterzet vervalt (score drijft naar ≥10% populariteit):
  // beste alternatief wanneer de gekozen score géén ster meer oplevert.
  let fallback = null;
  if (st.mz) {
    let alt = null;
    for (let h = 0; h <= 6; h++) for (let a2 = 0; a2 <= 6; a2++) {
      if (h === pick[0] && a2 === pick[1]) continue;
      const s = a.stat(h, a2);
      if (!alt || s.evz > alt.evz) alt = s;
    }
    if (alt && alt.evz > st.evz - 2 * st.mp) fallback = [alt.h, alt.a, alt.mz];
  }

  const startRaw = bv.markets[m.key]?.start ?? null;
  const start = typeof startRaw === "string" ? Date.parse(startRaw) : startRaw;
  const locked = !!RESULTS[m.key] || (start && start < Date.now());
  return {
    key: m.key, group: m.group, start, locked, uitslag: RESULTS[m.key] ?? null,
    espnHome: espn(m.home), espnAway: espn(m.away),
    huidig: m.mine, pick, ster: st.mz, reden,
    wijzigen: !locked && (pick[0] !== m.mine[0] || pick[1] !== m.mine[1]),
    fallback, evz: +st.evz.toFixed(2), modelPct: +(st.mp * 100).toFixed(0),
  };
}).sort((x, y) => (x.start ?? 0) - (y.start ?? 0));

const boosterKey = MY_BOOSTERS[ROUND];
const bm = MATCHES.find((m) => m.key === boosterKey);
const bmRow = rows.find((r) => r.key === boosterKey);
const boosterLocked = !!bmRow?.locked;
const boosterUitslag = bmRow?.uitslag ? `${bmRow.uitslag[0]}-${bmRow.uitslag[1]}` : null;
// beste nog-open booster-alternatief (hoogste evz × 2) als de boosterplek al vergrendeld is
const openBest = rows.filter((r) => !r.locked).sort((x, y) => y.evz - x.evz)[0];
const boosterNote = boosterLocked
  ? `Booster ronde ${ROUND} stond op **${espn(bm.home)}–${espn(bm.away)}** — die is al gespeeld${boosterUitslag ? ` (uitslag ${boosterUitslag})` : ""}, dus vergrendeld; niets meer te doen.`
  : `Booster ronde ${ROUND}: **laten staan op ${espn(bm.home)}–${espn(bm.away)}** (staat al goed; niets wijzigen).`;
const changes = rows.filter((r) => r.wijzigen);

/* ---------- picks.json ---------- */
writeFileSync(new URL("../picks.json", import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  ronde: ROUND,
  booster: { wedstrijd: `${espn(bm.home)} vs ${espn(bm.away)}`, vergrendeld: boosterLocked, actie: boosterLocked ? `al gespeeld${boosterUitslag ? ` (${boosterUitslag})` : ""} — vergrendeld, niets te doen` : "laten staan (staat al goed)" },
  instructie: "Vul per wedstrijd thuis- en uitscore in. Sla wedstrijden die al begonnen zijn over. Controleer bij sterren (meesterzet) de populariteit; bij ≥10% de fallback gebruiken.",
  wedstrijden: rows.map((r) => ({
    wedstrijd: `${r.espnHome} vs ${r.espnAway}`,
    deadline_nl: r.start ? fmtDl(r.start) : null,
    vergrendeld: r.locked,
    uitslag: r.uitslag ? `${r.uitslag[0]}-${r.uitslag[1]}` : null,
    thuis: r.pick[0], uit: r.pick[1],
    wijzigen: r.wijzigen, huidige_invulling: `${r.huidig[0]}-${r.huidig[1]}`,
    meesterzet: r.ster,
    fallback_bij_10pct: r.fallback ? `${r.fallback[0]}-${r.fallback[1]}` : null,
  })),
}, null, 1));

/* ---------- VOORSPELLINGEN.md ---------- */
const md = `# Voorspellingen — Speelronde ${ROUND} (definitief)

Gegenereerd: ${new Date().toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" })} ·
bron: joint-kalibratie op live Polymarket + Bovada (1X2, O/U-totals, goal spreads), robuuste EV (σ=0.10).
Machine-leesbaar: [\`picks.json\`](./picks.json)

## Instructies voor het invullen (ESPN WK Pool)

1. Alleen **speelronde ${ROUND}** invullen${ROUND < 3 ? " — latere rondes worden vlak voor hun deadlines opnieuw geijkt" : ""}.
2. Vul per wedstrijd exact de score uit de tabel in (thuis–uit).
3. **Wedstrijden die al begonnen zijn, zijn vergrendeld — overslaan.**
4. ${boosterNote}
5. ★ = meesterzet (score < 10% populariteit). Check vlak voor de deadline de
   "Populaire voorspellingen" op de ESPN-pagina: staat de aanbevolen score daar
   op **10% of meer**, gebruik dan de fallback-kolom.
6. Na het invullen verifiëren dat alle ${rows.length} wedstrijden de juiste waarde tonen.

## Te wijzigen (${changes.length} wedstrijden)

| Deadline (NL) | Wedstrijd | Van | **Naar** | ★ | Fallback bij ≥10% |
|---|---|---|---|---|---|
${changes.map((r) => `| ${r.start ? fmtDl(r.start) : "?"} | ${r.espnHome} – ${r.espnAway} | ${r.huidig[0]}-${r.huidig[1]} | **${r.pick[0]}-${r.pick[1]}** | ${r.ster ? "★" : ""} | ${r.fallback ? r.fallback[0] + "-" + r.fallback[1] : "—"} |`).join("\n")}

## Volledige lijst (controle, op deadline-volgorde)

| Deadline (NL) | Wedstrijd | Voorspelling | ★ | Actie |
|---|---|---|---|---|
${rows.map((r) => `| ${r.start ? fmtDl(r.start) : "?"} | ${r.espnHome} – ${r.espnAway} | **${r.pick[0]}-${r.pick[1]}** | ${r.ster ? "★" : ""} | ${r.locked ? "VERGRENDELD" + (r.uitslag ? ` (uitslag ${r.uitslag[0]}-${r.uitslag[1]})` : "") : r.wijzigen ? "WIJZIGEN (staat nu " + r.huidig[0] + "-" + r.huidig[1] + ")" : "laten staan"} |`).join("\n")}

*${boosterNote}*${boosterLocked && openBest ? `\n\n> Mocht je tóch nog een ongebruikte ronde-${ROUND}-booster hebben: het hoogste open duel is **${openBest.espnHome}–${openBest.espnAway} ${openBest.pick[0]}-${openBest.pick[1]}${openBest.ster ? "★" : ""}** (evz ${openBest.evz} → ×2 ≈ ${(openBest.evz * 2).toFixed(1)}).` : ""}
`;
writeFileSync(new URL("../VOORSPELLINGEN.md", import.meta.url), md);
console.log(`VOORSPELLINGEN.md + picks.json geschreven: ${rows.length} duels, ${changes.length} wijzigingen, booster ${bm.home}-${bm.away}.`);
for (const r of changes) console.log(`  ${r.espnHome}-${r.espnAway}: ${r.huidig[0]}-${r.huidig[1]} → ${r.pick[0]}-${r.pick[1]}${r.ster ? "★" : ""} (${r.reden})`);
