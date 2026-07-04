# WK Poule Model — ESPN WK Pool 2026

Model en strategie om de ESPN WK Pool 2026 te winnen, specifiek de subleague
**WQConcepts** (18 deelnemers). Per wedstrijd berekent het model de optimale
scorevoorspelling op basis van marktkansen, en houdt het rekening met de
poule-populariteit (voor de meesterzet) en je positie in het klassement.

## 📋 Wat moet ik voorspellen?

- ### 👉 **[Nu invullen — 8e finales (VOORSPELLINGEN.md)](./VOORSPELLINGEN.md)**

De in te vullen score per wedstrijd, op deadline-volgorde (★ = meesterzet, met
EV en 2e keuze per duel). De 16e finales zijn afgelopen ([ronde 4](./VOORSPELLINGEN-r4.md)).
De knock-out staat op live marktdata; **stuur de poule-populariteit per duel**
voor de meesterzet — zonder die data staat een pick op de **markt-EV** (geen ★).
Bonusvragen (eerste helft, beide scoren, O/U): `node analysis/ko-bonus.mjs 5`.
Machine-leesbaar: [`picks.json`](./picks.json) · interactief model: [`index.html`](./index.html).

## Doel

Niet de meeste *verwachte* punten halen, maar **eindigen als nummer 1 van 18**.
Dat is een ander spel: variantie en je afzetten tegen het peloton tellen mee.

## Spelregels (puntentelling)

Per groepswedstrijd voorspel je de exacte uitslag:

| Onderdeel | Punten |
|---|---|
| Juiste uitslag (winst/gelijk/verlies, na 90 of 120 min; penalty's = gelijk) | **+3** |
| Exact aantal goals thuisploeg | **+1** |
| Exact aantal goals uitploeg | **+1** |
| Juist doelsaldo | **+1** |
| **Meesterzet**: exacte score die < 10% van alle ESPN-spelers koos | **+2** |

Een volledig juiste score levert dus **6** punten op (3 + 1 + 1 + 1), of **8** met
de meesterzet erbij.

- **2× booster**: één per ronde. Verdubbelt *alle* punten van die ene wedstrijd.
  Aan te passen tot de aftrap van die wedstrijd.
- **Structuur**: 104 wedstrijden, 8 rondes — 3 groepsrondes + 5 knock-outrondes
  (1/16, 1/8, kwart, halve, troostfinale + finale). Vanaf de knock-out komen er
  aanvullende vragen bij (eerste doelpuntmaker, ruststand, enz.), elk 2–5 punten.
- Knock-outduels worden pas zichtbaar zodra de geplaatste ploegen bekend zijn.

## Hoe het model werkt (v6)

1. **Verwachte goals (λ)** per ploeg, geijkt op marktkansen — 68 van de 72
   groepsduels op Polymarket (echt ingelegd geld, marge eruit gehaald, daarna
   teruggerekend naar λ). De 4 duels zonder markt (Canada–Bosnië,
   Zwitserland–Bosnië, Bosnië–Qatar, Marokko–Haïti) draaien op een xG-model.
2. **Poisson-scorematrix** uit (λ_thuis, λ_uit) → kans op elke exacte score en op
   winst/gelijk/verlies. Engine gebruikt zuivere Poisson (`RHO = 0`, geen actieve
   Dixon-Coles-correctie).
3. **Verwachte punten (EV)** van elke mogelijke voorspelling, inclusief de
   meesterzet +2 wanneer die score onpopulair is (`evz = ev + 2·P(score)`).

### Drie standen (klassementspositie)

| Stand | Strategie |
|---|---|
| **Neutraal** | Speel de EV-keuze; gratis meesterzet wordt meegepakt. (Iedereen op nul → start hier.) |
| **Voorsprong** | Spiegel de massa; lage variantie houdt je voorsprong vast. |
| **Achterstand** | Hoge variantie; onpopulaire maar kansrijke scores die de massa mist. |

**Wanneer schakelen naar hoge variantie?** Niet op gevoel — op data. `field-check.mjs`
toetst of een vooruitliggende koploper te verklaren is door geluk bij een naief veld
(dan: blijf EV, variantie kost winkans) of dat er kunde in het veld zit (dan: escaleer
variantie via `optimize --sharps=k`). De toets simuleert een puur naief veld over de
echte uitslagen en vergelijkt de koploper-verdeling met de werkelijke stand. Zo wordt
de 'sharps'-aanname een uitkomst van de data i.p.v. een handmatige gok.

Een oranje ★ = meesterzet (< 10% in de poule). De booster-badge staat op de
wedstrijd met de hoogste verwachte punten van de ronde.

## De kern-edge

De poule **overschat structureel het aantal doelpunten bij favorieten**. De massa
zet op 4-0, 3-0, 2-1; de markt zegt steevast een tandje lager (2-0, 1-0, 1-1).
Die lagere score is *tegelijk* waarschijnlijker én onpopulair → bijna overal een
gratis meesterzet. Daar ligt de waarde, vooral bij duidelijke favorieten.

## Openen in de browser

`index.html` is een zelfstandig bestand: downloaden en dubbelklikken is genoeg
(internet nodig voor de React-CDN; werkt op desktop én telefoon). Het bevat de
volledige model-UI met de meest recente live-geijkte λ's voor alle 72 duels.

Opnieuw genereren na een herijking:

```bash
node analysis/build-html.mjs
```

## Analysepijplijn (`analysis/`)

Naast de artifact is er een Node-pijplijn die de voorspellingen ververst en de
strategie doorrekent (geen dependencies, Node ≥ 18):

```bash
node analysis/fetch-pinnacle.mjs       # scherpste book: 1X2 + totals/spread-ladders
node analysis/fetch-bovada.mjs         # 1X2 + totals + spread
node analysis/fetch-polymarket.mjs 1   # echt geld (1X2) → market.json
node analysis/fetch-polymarket-scores.mjs 1  # exacte-score-kruischeck (echt geld, geen Poisson)
node analysis/calibrate.mjs            # joint-fit 3 bronnen + overrides → calibrated.json
node analysis/round-advice.mjs 1       # adviestabel per ronde (robuuste EV)
node analysis/field-check.mjs          # veld-scherpte: naief vs kunde → kies --sharps
node analysis/optimize.mjs 30000       # hill-climb op P(#1)
node analysis/build-picks.mjs 2        # VOORSPELLINGEN.md + picks.json (ronde verplicht: 1|2|3)
node analysis/build-html.mjs           # index.html
```

Eén regel om alles te verversen voor een ronde (geef de ronde mee aan build-picks):
`node analysis/fetch-pinnacle.mjs && node analysis/fetch-bovada.mjs && node analysis/fetch-polymarket.mjs && node analysis/calibrate.mjs && node analysis/build-picks.mjs 2 && node analysis/build-html.mjs`

### Ronde 3 herijken (na de laatste ronde-2-wedstrijd)

Dode duels (een geplaatste ploeg roteert, of beide ploegen zijn gebaat bij een
gelijkspel) verhogen de gelijkspelkans, en de markt is daar traag. Gelijkspel is
bovendien zwaar onderkozen door de poule → een juist gelijkspel is vaak én de
toto (+3) die het veld misloopt én een meesterzet (+2). Stappenplan zodra ronde 2
compleet is:

1. Vul `analysis/results.json` volledig (álle ronde 1 + ronde 2-uitslagen) — de
   dode-wedstrijd-check leidt de groepsstanden hieruit af.
2. Verse markt + kalibratie:
   `node analysis/fetch-pinnacle.mjs && node analysis/fetch-bovada.mjs && node analysis/fetch-polymarket.mjs && node analysis/calibrate.mjs`
3. `node analysis/dead-rubber-check.mjs` — groepsstanden + flags per ronde-3-duel
   (GEKWALIFICEERD = rotatie/gelijkspel-risico, TOP2-UIT = top-2 uitgesloten).
   Print kant-en-klare `overrides.json`-regels.
4. Check opstellingen (~1u vóór aftrap) + kwalificatiescenario, zet de multipliers
   in `analysis/overrides.json` en draai `calibrate` opnieuw.
5. `node analysis/build-picks.mjs 3 && node analysis/build-html.mjs`.

- `engine.mjs` — zelfde wiskunde als de artifact + marktinversie (joint:
  1X2 + totals + spreads → λ), globale ρ-fit en `blendMatrix`: een
  Gauss-Hermite-mengsel van scorematrices over de λ-onzekerheid (σ=0.10).
  `round-advice` adviseert op dit mengsel — de robuuste EV-keuze, zodat
  knife-edge duels een eenduidig datagedreven antwoord krijgen.
- `field-check.mjs` — **veld-scherpte-toets**: simuleert een puur naief veld
  (populariteit + meesterzet + booster) over de al gespeelde duels met hun echte
  uitslagen en vergelijkt de koploper-verdeling met `standings.json`. Geeft een
  datagedreven `--sharps`-advies: zit de echte koploper binnen de naieve verdeling →
  speel EV; zit hij ver in de staart → escaleer variantie. Maakt de strategie-
  keuze tussen EV en hoge variantie objectief i.p.v. een gok.
- `fetch-polymarket.mjs` — haalt per duel de drie binaire markten op
  (thuiswinst/uitwinst/gelijkspel) en normaliseert de marge eruit.
- `fetch-polymarket-scores.mjs` — **onafhankelijke exacte-score-kruischeck**:
  Polymarket heeft per duel een `<slug>-exact-score`-event met een markt per
  scoreregel — de enige bron die de markt-kans op elke EXACTE uitslag direct
  geeft, zonder Poisson-aanname. De-vigt de grid en vergelijkt met ons model;
  vlagt duels waar de markt-modus afwijkt bij voldoende volume. Toetsing 14 jun:
  markt bevestigt het model (11/15 zelfde modus, rest marginaal) en zit gemiddeld
  iets *lager* (2,36 vs 2,64 goals) — dus niet te laag. Markten zijn dun (kruis-
  check, geen kalibratie-input); bij de knock-out (meer volume) wordt dit
  signaal betrouwbaarder en kan het meegewogen worden.
- `fetch-pinnacle.mjs` — **scherpste bron**: Pinnacle-sluitingslijnen via de
  publieke guest-API. Per duel de moneyline, de volledige totals-ladder (9
  lijnen), de spread-ladder én de **team-totals** (per-team over/under) — die
  laatste pinnen λ_thuis en λ_uit apart vast, scherper dan combined total +
  spread, vooral bij mismatches. (Pinnacle biedt géén correct-score-markt; een
  directe exacte-score-bron zoals Betfair is in deze omgeving geblokkeerd, dus
  de exacte-score-kansen blijven Poisson/Dixon-Coles uit de gefitte λ's.)
- `fetch-bovada.mjs` — 1X2 + O/U-hoofdlijn + goal spread (één coupon-call).
- `fetch-polymarket.mjs` — echt ingelegd geld (1X2).
- `overrides.json` — handmatige correcties per duel (lambdaMult / total+
  supremacy / directe λ), toegepast ná de marktinversie. Bedoeld voor
  ronde-3 'dode' duels waar een geplaatste ploeg roteert en de markt traag is.
- `calibrate.mjs` — **joint-kalibratie over drie bronnen**: per duel worden
  (λh, λa) gefit op 1X2 (Pinnacle dubbel gewicht + Polymarket + Bovada),
  de totals-ladders én de spreads tegelijk; daarna worden overrides toegepast.
  ρ op dezelfde doelfunctie. Kerninzicht: 1X2-only inversie overschat de
  totalen (longshot-bias in de gelijkspel-prijs); de echte O/U-ladders
  corrigeren dat omlaag → lage scores (1-0, 2-0, 0-0) worden nóg
  waarschijnlijker en de meesterzet-edge dus groter.
- `pool-sim.mjs` — simuleert de subleague: 17 tegenstanders trekken picks uit
  de echte ESPN-populariteitsverdeling, boosters gewogen naar massa-voorkeur.
  Vergelijkt strategieën (huidig / veilig / vol-EV / spiegel) op P(#1).
  NB: de absolute winstkansen nemen aan dat de markt-λ's de waarheid zijn —
  lees vooral de rángorde en de orde van grootte van de kloof.
- `optimize.mjs` — hill-climbt de R1-picks en R1-booster **direct op P(#1 van
  18)** in plaats van EV. Met λ-ruis (σ=0.10) tegen overfitten, vaste seed,
  en `--sharps=k` om k tegenstanders de EV-strategie te laten spelen
  (robuustheidstest tegen marktslimme concurrenten). Winnaar-flips standaard
  geblokkeerd (`--allow-flips` om toe te staan).

### Optimizer-inzichten (11 juni 2026)

- De P(#1)-optimizer bevestigt de EV-tweaks onafhankelijk en promoveert twee
  "ruis"-zetten (Canada 2-0★, Mexico 3-0★): meesterzet-differentiatie is voor
  poulewinst nét meer waard dan voor pure punten.
- Met 2–4 marktslimme tegenstanders zakt P(#1) van ±62% naar ±29% (nog steeds
  5× baseline). De kern-zeven tweaks overleven elk veldscenario; extra
  differentiatie-picks (Iran 2-1★, Oezbekistan 1-2★, Qatar 1-3★) lonen alleen
  als er echt sharps in de subleague zitten.
- Meesterzet-drift: elke aanbevolen pick leunt op zijn ★ (<10% populariteit).
  Marges zijn klein (−0.05 à −0.10 evz zonder ster) en het publiek drijft
  historisch richting hoge scores, dus risico laag — maar check de
  percentages in de ESPN-app vlak vóór elke deadline; fallbacks staan in de
  sessienotities/het advies.

### Kalibratie-inzichten (11 juni 2026)

- ρ = −0.08 past het best (typische voetbalwaarde; verhoogt 0-0/1-1 licht).
  Fit is vrijwel perfect: model reproduceert alle 24 markt-1X2's exact.
- De oude export stond bij vier close calls aan de **verkeerde kant**
  (Ghana-Panama, Haïti-Schotland, Zuid-Korea-Tsjechië, Ivoorkust-Ecuador);
  de live markt koos overal de kant van de oorspronkelijk ingevulde picks.
  Les: vlak voor de deadline altijd vers fetchen, exports verouderen snel.
- Duitsland-Curaçao bleek veel sterker geprijsd dan de export (λ 2.83 → 3.92):
  markt-totaallijn 4.5 met negen Duitse zeges op rij en de sterkste elf gepland.

## Status & openstaande punten

- ✅ **Fixtures geverifieerd** tegen het officiële FIFA-schema: alle 12 groepen
  (A–L) kloppen. Ook de eerder onzekere duels Ecuador–Curaçao (R2, Kansas City)
  en Curaçao–Ivoorkust (R3, Philadelphia) zijn bevestigd, inclusief thuis/uit.
- ✅ **Ronde 1 live herijkt** (11 juni): alle 24 duels op verse Polymarket-data,
  ρ gefit, totaal-ankers voor Duitsland en Spanje. Artifact bijgewerkt (v7).
- ✅ **Monte-Carlo poule-simulator** gebouwd: P(#1 van 18) per strategie.
- ⚠️ **Ronde 2 herijken vlak voor de eerste R2-deadline** (18 juni): markten
  zijn nu nog dun en houden geen rekening met de stand. Eén commando.
- ⚠️ **Ronde 3 opnieuw draaien** zodra de standen bekend zijn: gelijktijdige
  aftrap en al geplaatste ploegen die gas terugnemen zitten niet in het model.
- ⏳ **Knock-out** toevoegen (met aanvullende vragen) zodra de plaatsing bekend is.

## Roadmap

- [x] Booster-keuze en stand doorrekenen op **P(winst van de poule)** i.p.v.
      pure EV (Monte-Carlo-simulatie van het 18-koppige veld).
- [x] Ronde 1 herijken op live marktdata.
- [ ] Ronde 2 & 3 herijken met de werkelijke standen (na speelronde 1).
- [ ] Knock-outrondes + aanvullende vragen modelleren.
- [ ] Veld-model verfijnen zodra de eerste echte scores van de 17 concurrenten
      zichtbaar zijn (dan kan de positie-stand Voorsprong/Achterstand erin).

## Bestanden

- `wk-poule-model.jsx` — React-artifact: het interactieve model per wedstrijd.
- `analysis/` — Node-pijplijn: fetch → kalibratie → advies → simulatie.
