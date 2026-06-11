# WK Poule Model — ESPN WK Pool 2026

Model en strategie om de ESPN WK Pool 2026 te winnen, specifiek de subleague
**WQConcepts** (18 deelnemers). Per wedstrijd berekent het model de optimale
scorevoorspelling op basis van marktkansen, en houdt het rekening met de
poule-populariteit (voor de meesterzet) en je positie in het klassement.

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

Een oranje ★ = meesterzet (< 10% in de poule). De booster-badge staat op de
wedstrijd met de hoogste verwachte punten van de ronde.

## De kern-edge

De poule **overschat structureel het aantal doelpunten bij favorieten**. De massa
zet op 4-0, 3-0, 2-1; de markt zegt steevast een tandje lager (2-0, 1-0, 1-1).
Die lagere score is *tegelijk* waarschijnlijker én onpopulair → bijna overal een
gratis meesterzet. Daar ligt de waarde, vooral bij duidelijke favorieten.

## Status & openstaande punten

- ✅ **Fixtures geverifieerd** tegen het officiële FIFA-schema: alle 12 groepen
  (A–L) kloppen. Ook de eerder onzekere duels Ecuador–Curaçao (R2, Kansas City)
  en Curaçao–Ivoorkust (R3, Philadelphia) zijn bevestigd, inclusief thuis/uit.
- ⚠️ **Ronde 3 opnieuw draaien** zodra de standen bekend zijn: gelijktijdige
  aftrap en al geplaatste ploegen die gas terugnemen zitten niet in het model.
- ⚠️ **Ronde 2** markten zijn dunner verhandeld en houden nog geen rekening met
  de stand — herijken zodra de eerste resultaten binnen zijn.
- ⏳ **Knock-out** toevoegen (met aanvullende vragen) zodra de plaatsing bekend is.

## Roadmap

- [ ] Booster-keuze en stand optimaliseren op **P(winst van de poule)** i.p.v.
      pure EV (Monte-Carlo-simulatie van het hele deelnemersveld).
- [ ] Ronde 2 & 3 herijken met de werkelijke standen.
- [ ] Knock-outrondes + aanvullende vragen modelleren.

## Bestanden

- `wk-poule-model.jsx` — React-artifact: het interactieve model per wedstrijd.
