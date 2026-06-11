/*  Haalt live 1X2-kansen op van Polymarket (gamma-api) voor alle groepsduels.
    Per duel: zoek het event, lees de drie binaire markten (thuiswinst /
    uitwinst / gelijkspel), normaliseer de Yes-prijzen (marge eruit) en
    schrijf alles naar analysis/market.json.

    Gebruik:  node analysis/fetch-polymarket.mjs [ronde]   (default: alle)  */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { MATCHES, EN } from "./data.mjs";

const BASE = "https://gamma-api.polymarket.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.json();
    } catch { /* retry */ }
    await sleep(1500 * (i + 1));
  }
  return null;
}

async function findEvent(m) {
  const q = encodeURIComponent(`${EN[m.home].q} ${EN[m.away].q}`);
  const res = await getJson(`${BASE}/public-search?q=${q}&limit_per_type=8`);
  const evs = res?.events ?? [];
  // WK-events heten "X vs. Y"; beide teams moeten in de titel staan.
  const hits = evs.filter((e) =>
    /vs/i.test(e.title ?? "") && EN[m.home].re.test(e.title) && EN[m.away].re.test(e.title) &&
    (e.slug ?? "").startsWith("fifwc"));
  if (!hits.length) return null;
  // Bij meerdere hits (zou niet moeten in de groepsfase): vroegste endDate.
  hits.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  return hits[0];
}

function extract(m, event) {
  let ph = null, pa = null, pd = null, vol = 0;
  for (const mk of event.markets ?? []) {
    const q = mk.question ?? "";
    const yes = parseFloat(JSON.parse(mk.outcomePrices ?? '["0"]')[0]);
    vol += parseFloat(mk.volume ?? 0);
    if (/draw/i.test(q)) pd = yes;
    else if (/win/i.test(q) && EN[m.home].re.test(q)) ph = yes;
    else if (/win/i.test(q) && EN[m.away].re.test(q)) pa = yes;
  }
  if (ph == null || pa == null || pd == null) return null;
  const s = ph + pd + pa;
  if (s < 0.9 || s > 1.15) return null; // kapotte of illiquide markt
  return {
    hw: ph / s, d: pd / s, aw: pa / s,
    raw: { ph, pd, pa }, volume: Math.round(vol),
    title: event.title, endDate: event.endDate,
  };
}

const roundArg = process.argv[2] ? parseInt(process.argv[2]) : null;
const targets = MATCHES.filter((m) => !roundArg || m.round === roundArg);
const outFile = new URL("./market.json", import.meta.url);
// merge met bestaande data zodat per-ronde fetches elkaar niet wissen
const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile)).markets : {};
const out = { fetchedAt: new Date().toISOString(), source: "polymarket gamma-api", markets: prev };
const missing = [];

for (const m of targets) {
  const ev = await findEvent(m);
  let data = null;
  if (ev) {
    const full = ev.markets?.length ? ev : await getJson(`${BASE}/events/${ev.id}`);
    if (full) data = extract(m, full);
  }
  if (data) {
    out.markets[m.key] = data;
    console.log(`✓ ${m.key.padEnd(36)} 1 ${(data.hw * 100).toFixed(1)}%  X ${(data.d * 100).toFixed(1)}%  2 ${(data.aw * 100).toFixed(1)}%  ($${data.volume.toLocaleString()})`);
  } else {
    missing.push(m.key);
    console.log(`✗ ${m.key.padEnd(36)} geen bruikbare markt`);
  }
  await sleep(250);
}

writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`\n${Object.keys(out.markets).length} markten opgehaald, ${missing.length} ontbreken.`);
if (missing.length) console.log("Ontbrekend:", missing.join(", "));
