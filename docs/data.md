# The numbers and their sources

Every number ADELANTO shows a user or a judge comes from this page, with its source and the date we read it.

## Rates

| Fact | Value | Source, date read |
|---|---|---|
| Personal loan rate, Argentine banks | 64.63% a year (TNA) | BCRA interest rate series, 2 Nov 2026 |
| Overdraft rate | 25.47% a year | BCRA, 2 Nov 2026 |
| BADLAR (large deposits at private banks) | 22.3% a year | BCRA, 2 Nov 2026 |
| Inflation | 1.9% a month, 33.4% a year to September 2026 | INDEC, via BCRA, 2 Nov 2026 |
| Morpho wARS/USDT market on Ethereum | 0.30% a year to borrow, 77% maximum loan-to-value | Morpho API, 5 Nov 2026 |

## Dollar prices, 5 Nov 2026 (selling rate, pesos per dollar)

| Oficial | Blue | MEP | CCL | Cripto | Tarjeta |
|---|---|---|---|---|---|
| 1,570 | 1,560 | 1,588.6 | 1,680.4 | 1,667.14 | 2,041 |

Source: dolarapi.com. Paying by card in instalments costs the "tarjeta" rate, 22% more pesos per dollar than the
crypto dollar the same day.

## ADELANTO's own numbers

| | Value | Where it is set |
|---|---|---|
| Borrow rate | 22% a year at 0% use, 36% at 80% use, 156% at 100% use | `PesoPool.BASE_RATE_BPS`, `KINK_RATE_BPS`, `TOP_RATE_BPS` |
| Lender rate | borrow rate × use × 90% (10% to the reserve); about 25.9% at 80% use | `PesoPool` |
| Opening fee | 0.25% of the pesos borrowed | `PesoPool` |
| First loan | up to 60% of the dollars' value, at most 1,000,000 pesos | `PesoPool` tiers |
| After 1 / 3 / 6 on-time loans | up to 62% / 64% / 65%; rate −1 / −2 / −3 points; up to 2M / 3M / 5M pesos | `PesoPool` tiers, `CreditBook` |
| Lines | agent protects at 70%; a part can be sold past 80%; a gentle sale stops at 78% | `PesoPool`, `GentleKeeper` |
| Late | +5 points after the term, wholly to the reserve; marked late after 7 more days; never force-closed | `PesoPool` |

Live values: [`/api/public/rates`](https://adelanto-99-80-93-71.sslip.io/api/public/rates), read from chain on each
request.

## The example in the README

Lucía (an example, not a customer) borrows 400,000 pesos for 30 days.

- Bank at 64.63%: 400,000 × 0.6463 × 30 / 365 ≈ **21,250 pesos**.
- ADELANTO at 22%: 400,000 × 0.22 × 30 / 365 ≈ **7,230 pesos**; at 36% ≈ **11,840 pesos**; plus the 0.25% fee,
  **1,000 pesos**. Interest compounds per second on chain, which adds well under 1% to these figures over 30 days.
- Dollars locked: 400,000 pesos at 60% of the dollars' value, at about 1,657 pesos per dollar (the pool's price on
  6 Nov), is about US$ 402; we write "about US$ 405" to leave room for the price moving between quote and borrow.

## How the pool's price tracks the market

`PriceModule` reads pesos per dollar from the Celo wARS/USDT Uniswap v3 pool. We logged it once a minute next to
Binance's USDT/ARS and dolarapi's crypto dollar: [`evidence/price-watch.csv`](../evidence/price-watch.csv).

From 5 Nov 22:00 to 6 Nov 11:53 UTC (824 readings), the pool's 30-minute average differed from Binance by a median
of **0.51%**, 0.68% at the 95th percentile and **0.74% at most**. The agent pauses new borrowing only past 1.5%
against both outside sources for 3 minutes; in this window it never came close.

Since 6 Nov 10:17 UTC the agent itself takes this reading every minute (its price check) and keeps it. Its
3,127 readings to 8 Nov 14:27 UTC: the pool's 30-minute average was a median **0.47%** from Binance (0.67% at the
95th percentile, 1.20% at most) and a median **0.09%** from dolarapi (0.53% at most). Never once was it past 1.5%
from both. The home page draws the last 24 hours of these readings, and anyone can fetch them:
[`/api/public/prices?hours=24`](https://adelanto-99-80-93-71.sslip.io/api/public/prices?hours=24) (up to 168 hours).

## wARS on chain (4 Nov 2026)

| Chain | Supply |
|---|---|
| Celo | 326 million wARS (about US$ 196,000) |
| Ethereum | 12.26 billion wARS (about US$ 7.4 million) |

Read from each token's `totalSupply()`.
