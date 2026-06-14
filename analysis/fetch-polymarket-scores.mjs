/*  Exacte-score-kruischeck via Polymarket — de enige bron die de markt-kans
    op elke EXACTE uitslag direct geeft (echt ingelegd geld, géén Poisson-
    aanname). Per duel bestaat naast het 1X2-event een "<slug>-exact-score"-
    event met een markt per scoreregel + "Any Other Score".

    Doel: onafhankelijk toetsen of onze (Pinnacle-gekalibreerde) Poisson-
    scoreverdeling klopt — vangt het systematisch te lage of te hoge scores?
    LET OP: de exact-score-markten zijn DUN (typisch enkele duizenden $ per
    duel), dus dit is een KRUISCHECK, geen kalibratie-input — Pinnacle blijft
    leidend. De de-vig deelt door de som van alle Yes-kansen (incl. Any Other).

    Schrijft polymarket-scores.json en print model-vs-markt per duel + een
    vlag waar ze >3%-punt op de modus verschillen bij voldoende volume.

    Gebruik:  node analysis/fetch-polymarket-scores.mjs [ronde]  */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { MATCHES, EN } from "./data.mjs";
import { analyse } from "./engine.mjs";

const BASE = "https://gamma-api.polymarket.com";
const cal = JSON.parse(readFileSync(new URL("./calibrated.json", import.meta.url)));
const results = existsSync(new URL("./results.json", import.meta.url))
  ? JSON.parse(readFileSync(new URL("./results.json", import.meta.url))).results : {};
const rho = cal.rho;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); return r.ok ? r.json() : null; } catch { return null; } };

async function baseSlug(m) {
  const q = encodeURIComponent(`${EN[m.home].q} ${EN[m.away].q}`);
  const r = await get(`${BASE}/public-search?q=${q}&limit_per_type=8`);
  const hits = (r?.events ?? []).filter((e) =>
    /vs/i.test(e.title ?? "") && EN[m.home].re.test(e.title) && EN[m.away].re.test(e.title) && (e.slug ?? "").startsWith("fifwc"));
  hits.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  return hits[0]?.slug ?? null;
}

const roundArg = process.argv[2] ? parseInt(process.argv[2]) : null;
const targets = MATCHES.filter((m) => (!roundArg || m.round === roundArg) && !results[m.key]);
const outFile = new URL("./polymarket-scores.json", import.meta.url);
const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile)).markets : {};
const out = { fetchedAt: new Date().toISOString(), source: "polymarket gamma-api exact-score", markets: prev };

console.log("duel".padEnd(24) + "model modus  markt modus  P(onze pick) mod/mkt  vol     vlag");
let flags = 0, done = 0;
for (const m of targets) {
  const slug = await baseSlug(m);
  if (!slug) { continue; }
  const ev = await get(`${BASE}/events/slug/${slug}-exact-score`);
  if (!ev?.markets) { await sleep(150); continue; }
  let sum = 0, vol = 0, liq = 0; const grid = [];
  for (const mk of ev.markets) {
    if (mk.closed) { sum = 0; break; }
    const p = parseFloat(JSON.parse(mk.outcomePrices || '["0"]')[0]);
    sum += p; vol += parseFloat(mk.volume || 0); liq += parseFloat(mk.liquidity || 0);
    const t = (mk.groupItemTitle || "").match(/(\d+)\s*-\s*(\d+)/);
    if (t) grid.push([+t[1], +t[2], p]);
  }
  if (sum <= 0 || grid.length < 4) { await sleep(150); continue; }
  grid.forEach((g) => (g[2] = +(g[2] / sum).toFixed(4))); // de-vig
  grid.sort((a, b) => b[2] - a[2]);
  out.markets[m.key] = { scores: grid, volume: Math.round(vol), liquidity: Math.round(liq), title: ev.title };

  // vergelijk met model
  const L = cal.lambdas[m.key]; const A = analyse(L.lh, L.la, m.crowd, rho);
  let mm = { h: 0, a: 0, p: 0 };
  for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) if (A.M[h][a] > mm.p) mm = { h, a, p: A.M[h][a] };
  const mkMode = grid[0];
  const pick = A.evpick;
  const mkPick = grid.find((g) => g[0] === pick.h && g[1] === pick.a);
  const modePick = A.M[pick.h][pick.a];
  // vlag: andere modus én markt heeft noemenswaardig volume
  const flag = (mm.h !== mkMode[0] || mm.a !== mkMode[1]) && vol > 1500;
  if (flag) flags++;
  done++;
  console.log(
    `${m.home} v ${m.away}`.slice(0, 23).padEnd(24) +
    `${mm.h}-${mm.a} (${(mm.p * 100).toFixed(0)}%)`.padEnd(13) +
    `${mkMode[0]}-${mkMode[1]} (${(mkMode[2] * 100).toFixed(0)}%)`.padEnd(12) +
    `${(modePick * 100).toFixed(0)}% / ${mkPick ? (mkPick[2] * 100).toFixed(0) + "%" : "—"}`.padEnd(13) +
    `$${Math.round(vol)}`.padEnd(8) + (flag ? "⚠ andere modus" : "ok"));
  await sleep(180);
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`\n${done} duels gekruist, ${flags} met afwijkende modus (bij volume>$1500). polymarket-scores.json geschreven.`);
console.log(flags === 0
  ? "→ Markt bevestigt het model op de exacte score. Geen actie."
  : "→ Bekijk de gevlagde duels: markt en model verschillen van mening over de meest waarschijnlijke score.");
