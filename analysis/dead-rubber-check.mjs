/*  Dode-wedstrijd-check voor ronde 3.

    Berekent de groepsstanden uit results.json en flagt per ronde-3-duel of
    een ploeg al GEKWALIFICEERD is (top-2 gegarandeerd → rotatie/gas-terug, en
    de markt is daar traag) of juist UITGESCHAKELD voor top-2. Dode duels zijn
    de plek waar gelijkspel ineens de slimme én contraire keuze wordt; de tool
    print kant-en-klare overrides.json-regels om de lambda's bij te sturen.

    De clinch/uitschakel-regels zijn BEWUST conservatief (sufficient, geen
    valse positieven): liever een duel niet als dood markeren dan ten onrechte
    wel. Best-3 (8 van de 12 nummers 3 gaan door in 2026) maakt definitieve
    uitschakeling onzeker — daarom alleen "top-2 uitgesloten", met die kanttekening.

    Gebruik:  node analysis/dead-rubber-check.mjs        (na elke ronde)  */

import { readFileSync, existsSync } from "node:fs";
import { MATCHES } from "./data.mjs";

const resFile = new URL("./results.json", import.meta.url);
const RES = existsSync(resFile) ? JSON.parse(readFileSync(resFile)).results : {};

const GROUP_GAMES = 3; // elke ploeg speelt 3 groepsduels

// groep -> teams
const groups = {};
for (const m of MATCHES) (groups[m.group] ??= new Set()).add(m.home), groups[m.group].add(m.away);

// standen uit gespeelde duels
const S = {};
const ensure = (t) => (S[t] ??= { p: 0, gf: 0, ga: 0, pl: 0 });
for (const m of MATCHES) {
  const r = RES[m.key];
  if (!r) continue;
  const [h, a] = r, H = ensure(m.home), A = ensure(m.away);
  H.gf += h; H.ga += a; A.gf += a; A.ga += h; H.pl++; A.pl++;
  if (h > a) H.p += 3; else if (h < a) A.p += 3; else (H.p++, A.p++);
}
const team = (t) => { const s = ensure(t); return { ...s, gd: s.gf - s.ga, rem: GROUP_GAMES - s.pl, max: s.p + 3 * (GROUP_GAMES - s.pl) }; };

// per ploeg: status binnen de groep
function status(t, grp) {
  const x = team(t), others = [...grp].filter((o) => o !== t).map(team);
  const canBeAbove = others.filter((o) => o.max > x.p).length;      // bovenste grens rivaal > onderste grens X
  const surelyAbove = others.filter((o) => o.p > x.max).length;     // onderste grens rivaal > bovenste grens X
  if (canBeAbove <= 1) return "GEKWALIFICEERD";                     // hooguit 1 ploeg kan boven X → top-2 zeker
  if (surelyAbove >= 2) return "TOP2-UIT";                          // ≥2 ploegen zeker boven X (best-3 evt. nog)
  return "LIVE";
}

const f = (n) => (n >= 0 ? "+" + n : "" + n);
console.log("=== Groepsstanden (uit results.json) ===\n");
for (const g of Object.keys(groups).sort()) {
  const rows = [...groups[g]].map((t) => ({ t, ...team(t), st: status(t, groups[g]) }))
    .sort((a, b) => b.p - a.p || b.gd - a.gd || b.gf - a.gf);
  console.log(`Groep ${g}:`);
  for (const r of rows) console.log(`  ${r.t.padEnd(16)} ${r.pl} gespeeld  ${r.p} pnt  (ds ${f(r.gd)})  max ${r.max}  ${r.st === "LIVE" ? "" : r.st}`);
  console.log("");
}

// ronde-3-duels classificeren + override-suggesties
const r3 = MATCHES.filter((m) => m.round === 3);
const allPlayed = MATCHES.filter((m) => m.round <= 2).every((m) => RES[m.key]);
console.log(`=== Ronde-3 dode-wedstrijd-check ${allPlayed ? "" : "(⚠ ronde 1/2 nog niet compleet — voorlopig)"} ===\n`);

const suggestions = {};
for (const m of r3) {
  const sh = status(m.home, groups[m.group]), sa = status(m.away, groups[m.group]);
  const tag = (s) => (s === "GEKWALIFICEERD" ? "✓door" : s === "TOP2-UIT" ? "✗top2" : "live");
  let verdict = "LIVE — speel normaal", note = null;
  if (sh === "GEKWALIFICEERD" && sa === "GEKWALIFICEERD") {
    verdict = "DOOD — beide door: rotatie + gelijkspel waarschijnlijk"; note = "beide geplaatst, rust spelers / laag tempo";
  } else if (sh === "GEKWALIFICEERD" || sa === "GEKWALIFICEERD") {
    const who = sh === "GEKWALIFICEERD" ? m.home : m.away;
    verdict = `HALF — ${who} is door en kan roteren`; note = `${who} geplaatst, mogelijke rotatie`;
  } else if (sh === "TOP2-UIT" && sa === "TOP2-UIT") {
    verdict = "LAAG BELANG — beide top-2 uitgesloten (best-3 evt. nog)"; note = "beide top-2 uit; check best-3-motivatie";
  }
  console.log(`Gr ${m.group} | ${m.home} v ${m.away}  [${tag(sh)} / ${tag(sa)}]  → ${verdict}`);
  if (note) suggestions[m.key] = { note, lambdaMult: [1.0, 1.0] };
}

if (Object.keys(suggestions).length) {
  console.log(`\n=== Override-template (plak in analysis/overrides.json onder "overrides", multipliers aanpassen na opstellingscheck) ===`);
  console.log(JSON.stringify(suggestions, null, 2));
} else {
  console.log(`\nGeen dode duels gedetecteerd — geen overrides nodig.`);
}
