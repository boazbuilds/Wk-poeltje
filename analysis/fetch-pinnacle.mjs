/*  Haalt Pinnacle-sluitingslijnen op (scherpste book ter wereld) via de
    publieke guest-API: per duel de moneyline (1X2), de volledige totals-
    ladder en de spread-ladder voor de hele wedstrijd (period 0).
    Amerikaanse odds → de-vigde kansen. Schrijft pinnacle.json.

    Gebruik:  node analysis/fetch-pinnacle.mjs  */

import { writeFileSync } from "node:fs";
import { MATCHES, EN } from "./data.mjs";

const KEY = "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R"; // publieke guest-key
const H = { "x-api-key": KEY, "User-Agent": "Mozilla/5.0" };
const LEAGUE = 2686; // FIFA - World Cup

const get = async (url) => {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Pinnacle ${r.status} @ ${url}`);
  return r.json();
};
// Amerikaanse odds → impliciete kans
const aProb = (a) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
const devig2 = (over, under) => { const o = aProb(over), u = aProb(under); return o / (o + u); };

const matchups = await get(`https://guest.api.arcadia.pinnacle.com/0.1/leagues/${LEAGUE}/matchups`);
const games = matchups.filter((m) => m.type === "matchup" && !m.parent && (m.participants ?? []).length === 2);
const markets = await get(`https://guest.api.arcadia.pinnacle.com/0.1/leagues/${LEAGUE}/markets/straight`);
const byMatch = new Map();
for (const mk of markets) {
  if (mk.period !== 0) continue; // alleen volledige wedstrijd
  if (!byMatch.has(mk.matchupId)) byMatch.set(mk.matchupId, []);
  byMatch.get(mk.matchupId).push(mk);
}

const out = { fetchedAt: new Date().toISOString(), source: "pinnacle guest-api", markets: {} };
const missing = [];

for (const m of MATCHES) {
  const g = games.find((x) => {
    const home = x.participants.find((p) => p.alignment === "home")?.name ?? x.participants[0].name;
    const away = x.participants.find((p) => p.alignment === "away")?.name ?? x.participants[1].name;
    return EN[m.home].re.test(home) && EN[m.away].re.test(away);
  });
  if (!g) { missing.push(m.key); continue; }
  const mks = byMatch.get(g.id) ?? [];
  const rec = { start: g.startTime };

  const ml = mks.find((x) => x.type === "moneyline");
  if (ml) {
    const px = Object.fromEntries(ml.prices.map((p) => [p.designation, aProb(p.price)]));
    if (px.home && px.away && px.draw != null) {
      const s = px.home + px.draw + px.away;
      rec.ml = { hw: px.home / s, d: px.draw / s, aw: px.away / s };
    }
  }
  // totals-ladder → de-vigde P(over) per lijn, plus de meest gebalanceerde lijn
  const totals = mks.filter((x) => x.type === "total" && x.prices?.length === 2)
    .map((x) => {
      const o = x.prices.find((p) => p.designation === "over"), u = x.prices.find((p) => p.designation === "under");
      return { line: o.points, pOver: devig2(o.price, u.price) };
    }).sort((a, b) => a.line - b.line);
  if (totals.length) {
    rec.totals = totals;
    rec.total = totals.reduce((best, t) => Math.abs(t.pOver - 0.5) < Math.abs(best.pOver - 0.5) ? t : best);
  }
  // spread-ladder → meest gebalanceerde handicap
  const spreads = mks.filter((x) => x.type === "spread" && x.prices?.length === 2)
    .map((x) => {
      const h = x.prices.find((p) => p.designation === "home"), a = x.prices.find((p) => p.designation === "away");
      return { hcpHome: h.points, pHomeCover: devig2(h.price, a.price) };
    });
  if (spreads.length) rec.spread = spreads.reduce((best, s) => Math.abs(s.pHomeCover - 0.5) < Math.abs(best.pHomeCover - 0.5) ? s : best);

  out.markets[m.key] = rec;
  console.log(`✓ ${m.key.padEnd(34)} 1X2 ${rec.ml ? "✓" : "—"}  totaal ${rec.total ? rec.total.line : "—"} (P> ${rec.total ? (rec.total.pOver * 100).toFixed(0) + "%" : "—"})  spread ${rec.spread ? rec.spread.hcpHome : "—"}  [${totals.length} totals]`);
}

writeFileSync(new URL("./pinnacle.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`\n${Object.keys(out.markets).length} duels op Pinnacle, ${missing.length} ontbreken.${missing.length ? " " + missing.join(", ") : ""}`);
