# How it works: the life of one loan

ADELANTO is a pool of pesos (Ripio's wARS) on Celo. Lenders put pesos in; borrowers take pesos out against
dollars (USDT) they leave as a guarantee; an agent looks after each loan inside limits the borrower signs. All
the rules are in five contracts with no upgrade path ([addresses](../README.md#contracts-celo-mainnet-chain-42220)).

## Who controls what

| Account | Holds | Can |
|---|---|---|
| Borrower's wallet | Their USDT and wARS | Borrow, repay, add or take back dollars, set or revoke the agent's limits |
| `PesoPool` | Lenders' wARS, borrowers' USDT, the reserve | Only what its functions allow; no admin withdraw |
| Agent wallet `0xB93A…B2d1` | Gas and a small wARS float for gentle liquidations | Act on a loan only through `LoanGuard`, within that borrower's signed limits |
| Guardian | Nothing | Pause and resume new borrowing and deposits; never repay, withdraw or liquidation |
| Owner | Nothing | Lower caps at once, raise them after 24 hours, move the reserve to the treasury after 48 hours public; nothing else ([roles](security.md#roles)) |

## 1. A lender deposits

`PesoPool` is an ERC-4626 vault. A lender deposits wARS and gets pool shares. Interest paid by borrowers raises the
value of every share; 10% of it goes to the reserve. The lender withdraws any time the pool has free pesos.

The rate lenders earn is the borrow rate × the share of the pool that is lent × 90%. At 80% use that is about 25.9%
a year, above the banks' BADLAR deposit rate of 22.3%.

## 2. A borrower gets a quote

The quote needs no wallet. For a number of pesos and a term (7, 30, 60 or 90 days) it shows:

- the pesos received (after the 0.25% opening fee),
- the dollars to leave (the first loan can borrow up to 60% of their value; the site suggests 50%),
- the yearly rate now and the pesos owed at the end of the term,
- the bank's rate (64.63%, BCRA) for the same loan,
- the dollar price at which the loan reaches 70% (the agent acts) and 80% (part can be sold).

The rate depends on how much of the pool is lent: 22% a year when idle, rising in a straight line to 36% at 80%
use, then steeply to 156% at 100% use, so lenders can always get their pesos back. The borrower sets a maximum
rate when borrowing, and the transaction reverts if the rate moved above it.

## 3. The borrower borrows

In MiniPay this is one free signature (an EIP-2612 permit for the USDT) and one transaction
(`borrowWithPermit`). Wallets without permit support approve the exact USDT amount first, then call `borrow`.

The pool values the dollars at the **lower** of the pool's spot price and its 30-minute average, so a short spike
never lends more pesos. If the price module refuses (thin liquidity, spot far from the average, or a stale price),
borrowing waits; repaying never does.

## 4. The borrower sets the agent's limits (optional)

On the loan page, **Cuidar mi préstamo**. The borrower picks a preset or writes their limits:

- protect the loan by adding dollars, repaying with pesos, or both, and in which order,
- up to how many dollars a day and how many pesos a day,
- how many pesos must always stay in the wallet,
- whether to repay automatically when pesos arrive,
- until when.

The site reads the rule back in plain Spanish with every number. The wallet approves exactly a week of the daily
limits to `LoanGuard` and sends `setLimits(limits, ruleHash)`, where `ruleHash` is the keccak256 hash of the words.
The site stores the words only if they hash to what is on chain, and shows them next to the hash. Revoking is one
transaction plus setting the approvals back to zero.

## 5. The agent watches

Every 60 seconds the agent reads each open loan at one block and decides ([docs/agent.md](agent.md)):

- **At 70%** it protects the loan back to 60%, using the borrower's own dollars or pesos as their rule says.
- **When pesos arrive** in the borrower's wallet after the loan opened, it repays up to that amount, minus the buffer.
- **Past 80%**, only if protection could not help, it sells the smallest part that brings the loan to 78%.
- **If prices disagree** with Binance and dolarapi by more than 1.5% for 3 minutes, it pauses new borrowing.

Each action quotes the borrower's rule and is shown on the loan page.

## 6. The borrower repays

Any time, any amount:

- **In pesos:** one free signature (a wARS permit) and `repayWithPermit`, or approve and `repay`.
- **In dollars:** `repayWithSwap` sells the borrower's USDT on the Celo wARS/USDT Uniswap v3 pool and repays in the
  same transaction, with a minimum-pesos limit.

When the debt reaches zero the dollars come back in the same transaction. While the loan stays under 60% the
borrower can also take part of the dollars back.

After the term the rate rises by 5 points until repaid (the extra goes wholly to the reserve). After 7 more days
the credit record marks the loan late. A loan is never closed for being late; only the price can trigger a sale.

## 7. If the price moves against the loan

The loan is in pesos and the guarantee in dollars, so **a falling peso makes the loan safer**. Risk comes when the
peso strengthens against the dollar.

- At **70%** the agent protects the loan, if the borrower set limits.
- Past **80%**, measured with the 30-minute average price (a one-block push cannot do it), anyone can repay part of
  the debt and receive dollars worth the pesos repaid plus 5%: up to half the debt, or all of it under 10,000 pesos.
- The agent goes first, through `GentleKeeper`, which computes on chain, at the moment it runs, the smallest
  repayment that brings the loan back to 78%. On a 1,000 USDT loan the borrower loses about US$ 5.80 of bonus
  instead of about US$ 19 for a standard liquidation back to 70%.
- If the dollars cannot cover the debt, the reserve pays first; beyond it, the loss is shared by lenders and shown
  on the transparency page.

## 8. The credit record

`CreditBook` keeps, per wallet: loans opened, repaid on time, repaid late, liquidated, pesos borrowed and repaid,
first and last loan. Only `PesoPool` writes it. Anyone can read it.

A repayment counts toward the next step only if the loan was held at least 7 days and opened after the last loan
that counted, so steps cannot be bought with instant or parallel loans.

| | First loan | After 1 on time | After 3 | After 6 |
|---|---|---|---|---|
| Borrow up to | 60% | 62% | 64% | 65% |
| Rate | — | −1 point | −2 points | −3 points |
| Pesos per loan | 1,000,000 | 2,000,000 | 3,000,000 | 5,000,000 |

## 9. Pool limits

Total pesos lent is capped at the lowest of: 70% of deposits, 20,000,000 wARS, and 65% of the pesos it would take
to move the Uniswap price by 2% (measured from in-range liquidity now and its 30-minute average). Caps can be lowered
at once and raised only after 24 hours on chain, and every change is an event on the transparency page.

## 10. If Ripio froze wARS

Ripio can pause wARS or block an address. If wARS has been frozen for 24 hours (the token reports it, or a zero
transfer from the pool reverts), each borrower can take their dollars back down to the 70% line. The rest stays as
the lenders' claim until wARS moves again, and stays under the 80% line so no one can liquidate it at lenders'
expense. Tested with a mock wARS that reverts and one that only reports flags.

## Bigger loans: Morpho on Ethereum

Morpho's wARS/USDT market on Ethereum lent at 0.30% a year on 5 Nov. A round trip costs about US$ 3–3.5 in fixed
network and bridge fees, so it pays for itself above roughly US$ 135 on a one-month loan; below that the Celo pool
is cheaper. We ran the round trip with real money ([every step](verification.md#ethereum-round-trip)):
USDT to Ethereum through USDT0, borrow on Morpho, pesos to Celo through Ripio's bridge, then back.

`MorphoProxyFactory` and `MorphoProxy` give each borrower their own proxy on Ethereum. It runs only orders the
borrower signed (EIP-712; MiniPay signs these for chain 1) and sends money only to that borrower's own address. Both
are tested against a mainnet fork of Morpho. The agent's rate watch compares Morpho's on-chain rate with the pool's
every minute and tells the borrower when moving would save more than twice its cost.
