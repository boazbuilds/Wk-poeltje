/*  Genereert index.html: een zelfstandig, dubbelklikbaar bestand met de
    volledige model-UI (React via CDN, geen build nodig) en de meest
    actuele gekalibreerde λ's voor alle 72 duels.

    Gebruik:  node analysis/build-html.mjs        → schrijft ../index.html  */

import { readFileSync, writeFileSync } from "node:fs";
import { MATCHES } from "./data.mjs";

const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
let src = readFileSync(new URL("../wk-poule-model.jsx", import.meta.url), "utf8");

// 1) RAW-blok vervangen door gekalibreerde λ's (mine/crowd blijven uit de poule)
const rows = [];
let lastRound = 0;
for (const m of MATCHES) {
  if (m.round !== lastRound) {
    rows.push(`  // Ronde ${m.round} — λ live geijkt (Polymarket)`);
    lastRound = m.round;
  }
  const L = cal.lambdas[m.key];
  rows.push(`  [${m.round},${JSON.stringify(m.group)},${JSON.stringify(m.home)},${JSON.stringify(m.away)},${L.lh.toFixed(2)},${L.la.toFixed(2)},${JSON.stringify(m.mine)},${JSON.stringify(m.crowd)}],`);
}
src = src.replace(/const RAW = \[[\s\S]*?\n\];/, `const RAW = [\n${rows.join("\n")}\n];`);

// 2) ρ uit de kalibratie
src = src.replace(/const RHO = [^;]+;.*/,
  `const RHO = ${cal.rho}; // Dixon-Coles ρ, gefit op alle 72 live Polymarket-markten`);

// 3) kop- en voetteksten actualiseren
const stamp = new Date(cal.calibratedAt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Amsterdam" });
src = src.replace(/ESPN WK Pool · model v\d+[^<]*/, `ESPN WK Pool · model v10 · 3 scherpe bronnen (Pinnacle+Polymarket+Bovada) · ${stamp} `);
src = src.replace(/Ronde 1 staat volledig op live marktkansen[\s\S]*?op Neutraal\./,
  `Alle 72 groepsduels staan op een joint-kalibratie van drie live marktbronnen (gekalibreerd ${stamp}): Pinnacle (scherpste book, dubbel gewicht, volledige totals- en spread-ladders), Polymarket (echt ingelegd geld) en Bovada. Per duel worden de 1X2, de O/U-totaallijnen (verwacht aantal goals) en de goal spreads (supremacy) tegelijk gefit; ρ=${cal.rho} op dezelfde doelfunctie. Populariteit en je eigen voorspelling komen rechtstreeks uit de poule, dus meesterzet en massa-keuze zijn exact. Ronde 2 en 3 worden vlak voor hun deadlines opnieuw geijkt; ronde-3 'dode' duels kun je bijsturen via analysis/overrides.json. Iedereen staat op nul, dus speel ronde 1 op Neutraal.`);

// 4) JSX → browser-script (React via CDN-globals, geen imports/exports)
src = src.replace(/import React[^\n]*\n/, "const { useMemo, useState } = React;\n");
src = src.replace(/export default function App/, "function App");
src += `\nReactDOM.createRoot(document.getElementById("root")).render(<App />);\n`;

const html = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WK Poule Model · live geijkt ${stamp}</title>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>
  body { margin: 0; }
  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  input, button { font: inherit; }
</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel" data-presets="react">
${src}
</script>
</body>
</html>
`;

writeFileSync(new URL("../index.html", import.meta.url), html);
console.log(`index.html geschreven (${(html.length / 1024).toFixed(0)} kB, λ's van ${stamp}, ρ=${cal.rho}).`);
