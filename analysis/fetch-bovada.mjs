/*  Haalt per duel drie marktsignalen op bij Bovada (één coupon-call):
      - 3-Way Moneyline (1X2)
      - Total (O/U-lijn + prijzen)  → pint het verwachte aantal goals vast
      - Goal Spread (handicap)      → pint de supremacy vast
    Alles ge-de-vigd en weggeschreven naar bovada.json.

    Gebruik:  node analysis/fetch-bovada.mjs  */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { MATCHES, EN } from "./data.mjs";

const COUPON = "https://www.bovada.lv/services/sports/event/coupon/events/A/description/soccer/fifa-world-cup?marketFilterId=def&preMatchOnly=true&lang=en";
const res = await fetch(COUPON, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }, signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error(`Bovada ${res.status}`);
const groups = await res.json();
const events = groups.flatMap((g) => g.events ?? []);
console.log(`Bovada: ${events.length} events in de coupon.`);

const devig2 = (a, b) => { const x = 1 / a, y = 1 / b; return x / (x + y); };

const outFile = new URL("./bovada.json", import.meta.url);
// merge met vorige run: gespeelde duels verdwijnen uit de coupon maar we
// bewaren hun starttijd (voor vergrendel-detectie); verse lijnen overschrijven
const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile)).markets : {};
const out = { fetchedAt: new Date().toISOString(), source: "bovada coupon", markets: prev };
const missing = [];

for (const m of MATCHES) {
  const ev = events.find((e) => EN[m.home].re.test(e.description) && EN[m.away].re.test(e.description));
  if (!ev) { missing.push(m.key); continue; }
  const markets = (ev.displayGroups ?? []).flatMap((d) => d.markets ?? [])
    .filter((mk) => mk.period?.description === "Regulation Time");
  const rec = { title: ev.description, start: ev.startTime };

  const ml = markets.find((mk) => mk.description === "3-Way Moneyline");
  if (ml) {
    let ph, pd, pa;
    for (const o of ml.outcomes ?? []) {
      const p = 1 / parseFloat(o.price.decimal);
      if (/draw/i.test(o.description)) pd = p;
      else if (EN[m.home].re.test(o.description)) ph = p;
      else if (EN[m.away].re.test(o.description)) pa = p;
    }
    if (ph && pd && pa) {
      const s = ph + pd + pa;
      rec.ml = { hw: ph / s, d: pd / s, aw: pa / s, overround: +(s - 1).toFixed(4) };
    }
  }
  const tot = markets.find((mk) => mk.description === "Total");
  if (tot) {
    const over = tot.outcomes?.find((o) => /over/i.test(o.description));
    const under = tot.outcomes?.find((o) => /under/i.test(o.description));
    if (over && under) rec.total = {
      line: parseFloat(over.price.handicap),
      pOver: devig2(parseFloat(over.price.decimal), parseFloat(under.price.decimal)),
    };
  }
  const sp = markets.find((mk) => mk.description === "Goal Spread");
  if (sp) {
    const home = sp.outcomes?.find((o) => EN[m.home].re.test(o.description));
    const away = sp.outcomes?.find((o) => EN[m.away].re.test(o.description));
    if (home && away) rec.spread = {
      hcpHome: parseFloat(home.price.handicap),
      pHomeCover: devig2(parseFloat(home.price.decimal), parseFloat(away.price.decimal)),
    };
  }
  out.markets[m.key] = rec;
  console.log(`✓ ${m.key.padEnd(34)} 1X2 ${rec.ml ? "✓" : "—"}  totaal ${rec.total ? rec.total.line : "—"} (P> ${rec.total ? (rec.total.pOver * 100).toFixed(0) + "%" : "—"})  spread ${rec.spread ? rec.spread.hcpHome : "—"}`);
}

writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`\n${Object.keys(out.markets).length} duels, ${missing.length} ontbreken.${missing.length ? " Ontbrekend: " + missing.join(", ") : ""}`);
