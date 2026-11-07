# Security

This page covers every contract ADELANTO runs: who can move money, what each external function can do, how prices
are protected, and what the tests and static analysis prove. The contracts have no proxies and no upgrade path.
A new version is a new deployment.

## Who can move money

| Money | Where it sits | Who can move it |
|---|---|---|
| Lenders' pesos (wARS) | `PesoPool` | Each lender withdraws their own, up to the free pesos in the pool. Borrowers receive pesos only by borrowing against collateral. |
| Borrowers' dollars (USDT) | `PesoPool` | The borrower, after repaying (all of it) or while the loan stays under 60% (part of it). A liquidator, only past the 80% line, and only collateral worth the pesos repaid plus 5%. |
| Reserve (10% of interest) | `PesoPool` | Covers bad debt first. The owner can send it to the fixed treasury address only after a public 48-hour wait. |
| A borrower's wallet | The borrower's wallet | The borrower. `LoanGuard` can pull from it only within the limits the borrower signed, only into that borrower's own loan. |
| An Ethereum loan | That person's `MorphoProxy` | Only orders that person signed. Money leaves only to that person's own address on Celo. |
| An x402 payment | The buyer's wallet, until settled | Only the facilitator, with the buyer's own EIP-3009 or Permit2 signature for that exact amount, to the agent wallet. The facilitator never holds it; ADELANTO's server never sees the buyer's key. |

There is no admin withdraw anywhere. The test `test_noPrivilegedTransfers` uses every owner and guardian power at
once and checks that no collateral and no lender pesos move.

## Roles

| Role | Can | Cannot |
|---|---|---|
| Owner (deployer key) | Lower caps at once; raise caps after 24 hours on chain; set the guardian; schedule a reserve move to the treasury (48 hours public); pause and unpause | Move collateral, lender pesos or borrower funds; change rates, lines or the price source; upgrade anything |
| Guardian | Pause and unpause new borrowing and new deposits | Pause repay, withdraw, add collateral or liquidation |
| Agent (`LoanGuard.agent`, fixed at deploy) | Add the borrower's USDT to their loan when it is at 70% or more; repay from the borrower's wallet to protect it; repay when pesos arrive (if the borrower turned that on) | Exceed the signed daily limits; dip below the borrower's peso buffer; act after the rule expires; act while the price module refuses; send money anywhere but the borrower's own loan; borrow, open loans or change limits |
| Anyone | Repay any loan; add collateral to any loan; liquidate past the 80% line; submit an order someone signed on Ethereum | Anything else |

## Off-chain pieces

- **The rule's words.** Only the hash is on chain. The site stores words only if their keccak256 equals the
  borrower's `ruleHash`, and the agent hashes them again before quoting them. Words cannot change limits: the
  limits are what the borrower signed.
- **The rule parser** runs on our server and only proposes limits. The borrower's wallet signs them after the
  read-back, and `LoanGuard` enforces what was signed, whatever the parser said. Its output is clamped to the
  loan's debt, guarantee and 180 days, and tested on 3,000 random rules.
- **x402.** The facilitator's API key stays on the server (read from a private file); a leaked key could spend our
  settlement credits, never move anyone's money. Buyers sign a payment for one exact amount to one address.

## Prices

`PriceModule` reads the Celo wARS/USDT Uniswap v3 pool (`0x5D8e…2391`, 1 bp fee).

- Borrowing and withdrawing collateral value dollars at **min(spot, 30-minute average)**, so a short spike never
  lends more pesos.
- Liquidation uses the **30-minute average only**, so a one-block push can't liquidate anyone
  (`test_liquidationIgnoresSpotSpike`).
- **Depth** is the wARS it would take to move the price 2% through the pool's in-range liquidity, at the lower of the
  liquidity right now and its 30-minute harmonic average (from Uniswap's seconds-per-liquidity record). Tokens parked
  out of range, or liquidity added for one block, count for nothing (`test_depthIgnoresTokenBalance`,
  `test_depthUsesLowerOfNowAndAverage`). On 6 Nov 2026 the real pool's depth was about 27.8M wARS.
- New borrowing and collateral withdrawal stop (repay and liquidation don't) when: depth is under 10M wARS; spot and
  the 30-minute average are more than 2% apart; or the pool has been quiet for 2 hours and spot is more than 1% from
  the 2-hour average. Taking collateral out raises a loan's ratio just like borrowing, so it waits for a clean price;
  repaying in full always returns all collateral.
- The module refuses to deploy against a pool that keeps fewer than 600 price observations (the real pool keeps
  1,200), so the 30-minute average can't be crowded out of the record.
- Off chain, the agent compares the 30-minute average with Binance USDTARS and the dolarapi crypto rate every 60
  seconds, and the guardian pauses new borrowing if they disagree by more than 1.5% for 3 minutes.

### What it costs to push the price

Read from the pool on 5 Nov 2026: liquidity `68,599,257,441,741,245,973`, tick −350,441.

| Attack | Cost | Most it could gain |
|---|---|---|
| Push pesos-per-dollar 2% up to borrow 2% more | Selling about **27.8M wARS (~US$16,600)** into the range for one push. Arbitrage pulls the price back every block, so holding the 30-minute average 2% off means paying that spread again and again for 30 minutes. A bigger spot move trips the 2% spot-vs-average check and stops borrowing. | 2% more pesos on what the caps allow: 20M wARS (~US$12,000) × 2% ≈ **US$240**, and the loans are still backed at 60% |
| Push pesos-per-dollar down to liquidate | The same push, held for 30 minutes, against the same arbitrage | A 5% bonus on the part liquidated, and only on loans already near 80% |

The caps are set so that the cost is always far above the gain. Caps can only rise after a 24-hour public wait,
and the depth cap ties total borrowing to 65% of the depth (about 18M wARS today).

## Interest and rounding

- Debt rounds up and shares round down. The pool tracks its own `cash`, so pesos sent to the pool by mistake
  change nothing (`test_donationDoesNotChangeSharePrice`).
- The share token uses 6 virtual decimals, which blocks the first-depositor inflation trick
  (`test_firstDepositorInflationBlocked`).
- Each credit step has its own interest index. Indices only grow (`invariant_indexMonotonic`).
- Late loans pay 5 extra points from the due date, added when the loan is next touched. The late extra goes wholly
  to the reserve, so adding it never changes the share price and nobody can deposit just before an overdue loan is
  touched to take a cut of what it owed earlier (`test_lateExtraNeverMovesSharePrice`).

## If Ripio freezes wARS

wARS has `pause()` and per-address blocking. `probeFreeze()` treats wARS as frozen when the token reports itself
paused, reports the pool as blocked while its blocklist is on, or refuses a zero transfer from the pool, and records
when that was first seen. After 24 hours of that, `emergencyReleaseCollateral` lets each borrower take back collateral
down to the 70% line at the 30-minute average. The rest stays as the lenders' claim, and the loan stays open until
wARS moves again. Because it stays under the 80% liquidation line with room for the 5% bonus, nobody, the borrower
included, can liquidate it at the lenders' expense the moment wARS moves (`test_selfLiquidationAfterReleaseIsNotPossible`).
Tested with a token that reverts and with one that only reports its flags (`PesoPoolFreezeTest`).

## External functions, one by one

### PesoPool

| Function | Who | Checks | Moves |
|---|---|---|---|
| `deposit`, `mint` | Anyone (not while paused) | Accrues first; ERC-4626 maths | wARS in from caller; shares to receiver |
| `withdraw`, `redeem` | Share holder or approved | Accrues first; limited to free cash | wARS out to receiver only for the holder's own shares |
| `borrow`, `borrowWithPermit` | Anyone (not while paused) | Term 7/30/60/90; ≥ 1,000 wARS; per-step loan limit; LTV at min(spot, 30-min); three caps; free cash; the borrower's rate ceiling; price module must not refuse | USDT in from caller; wARS out to caller (minus 0.25% fee to treasury) |
| `addCollateral` | Anyone | Loan open; amount > 0 | USDT in from caller to that loan |
| `repay`, `repayWithPermit` | Anyone | Loan open; takes at most the debt | wARS in from caller; full repayment returns collateral to the borrower |
| `repayWithSwap` | Anyone | Loan open; minimum pesos out; swap callback only from the fixed pool during this call | USDT from caller into the pool's own Uniswap pool; extra pesos back to caller |
| `withdrawCollateral` | Borrower | Loan stays ≤ 60% at min(spot, 30-min); price must not be refused | USDT to the borrower |
| `liquidate` | Anyone | Debt > 80% at the 30-min average; at most half (all under 10,000 wARS); seize ≤ collateral | wARS in from liquidator; USDT to liquidator worth repaid + 5% |
| `probeFreeze` | Anyone | — | Nothing |
| `emergencyReleaseCollateral` | Borrower | wARS stuck for 24 h | USDT above the 70% line to the borrower |
| `accrue` | Anyone | — | Nothing |
| `pause`, `unpause` | Guardian or owner | — | Nothing |
| `setGuardian`, `lowerCaps`, `scheduleCaps`, `executeCaps`, `transferOwnership` | Owner | Raises wait 24 h; lowers only lower | Nothing |
| `acceptOwnership` | Pending owner | — | Nothing |
| `scheduleReserveMove`, `cancelReserveMove`, `executeReserveMove` | Owner | 48 h wait; capped at reserve and cash | Reserve wARS to the fixed treasury |
| `uniswapV3SwapCallback` | The fixed pool, during `repayWithSwap` only | Caller and in-swap flag | USDT from the repayer to the pool |

### LoanGuard

| Function | Who | Checks | Moves |
|---|---|---|---|
| `setLimits`, `revoke` | Borrower, for themselves | Expiry in the future and ≤ 180 days | Nothing |
| `protectWithTopUp` | Agent | Limits set and unexpired; price not refused; loan at ≥ 70%; daily USDT limit | Borrower's USDT → borrower's loan |
| `protectWithRepay` | Agent | Same, plus daily wARS limit and the buffer left in the wallet | Borrower's wARS → borrower's loan; any excess straight back |
| `autoRepay` | Agent | Auto-repay on; daily wARS limit; buffer | Same |

The guard holds no funds between calls (`testFuzz_guardLimits` checks its balances are always zero).

### MorphoProxy (Ethereum)

| Function | Who | Checks | Moves |
|---|---|---|---|
| `execute` | Anyone with an order signed by the owner | EIP-712 signature by the owner; borrower field = owner; nonce unused; deadline; market must be wARS loan / USDT collateral; rate ceiling checked on the rate the borrow itself leaves; the order must do what it says (all collateral supplied, the amount repaid, the loan cleared on exit) or it reverts and its nonce stays unused | Supply, borrow, repay or exit on Morpho; pesos only to the owner on Celo (Ripio Bridge); dollars only to the owner on Celo (USDT0) |
| `exit` | Owner | Same market check | Repays from the proxy's pesos, withdraws collateral, sends everything home |
| `sendPesosHome`, `sendDollarsHome` | Owner | — | Balances to the owner on Celo only |

### MorphoProxyFactory

| Function | Who | Moves |
|---|---|---|
| `deploy(owner)` | Anyone | Nothing; deploys the owner's proxy at the address `proxyOf(owner)` predicted |

### CreditBook

| Function | Who | Moves |
|---|---|---|
| `bindPool` | Deployer, once | Nothing |
| `recordOpen`, `recordRepayment`, `recordClosed`, `recordLiquidation` | The bound pool only | Nothing |

A loan that was ever liquidated closes without counting as an on-time repayment
(`test_fullLiquidationDoesNotRaiseTier`, `test_repayAfterPartialLiquidationDoesNotRaiseTier`).

A credit step only counts a loan that was held at least 7 days and opened after the last loan that counted, so
steps take real weeks to earn and can't be bought by opening and closing loans in one go
(`test_instantRepayDoesNotCount`, `test_parallelLoansCountOnce`).

## Tests

- **Unit and fuzz:** every function and branch above, with fuzzed borrow, repay, liquidation and guard maths.
- **Invariants** (random sequences of every pool action, price moves and time jumps; 10,000 runs, depth 40):
  shares backed by assets; collateral accounted loan by loan and never sent to anyone else; caps held at every
  borrow; interest index never falls; per-tier debt matches the loans; closed loans owe nothing.
- **Fork tests on Celo mainnet state:** real wARS, USDT and the Uniswap pool; tick maths matches the pool; borrow,
  repay, real-swap repayment, freeze probe, guard on real tokens.
- **Fork tests on Ethereum mainnet state:** real Morpho market `0x8e62…9c9e`, Ripio Bridge and USDT0; the proxy
  address is known before deploy; open sends pesos to the owner on Celo; close brings dollars home; replay, wrong
  signer, wrong borrower, wrong market, expired order and rate ceiling are all refused; strangers cannot exit; an
  order sent before its money arrives reverts and can be sent again later; a borrow that would push the rate past
  the ceiling is refused.

Run them with `forge test` in `contracts/`; set `CELO_RPC_URL` and `ETH_RPC_URL` for the fork tests.

## Static analysis (slither 0.10.4)

High and medium results, each reviewed:

| Result | Where | Why it is safe |
|---|---|---|
| arbitrary-send-erc20 | `LoanGuard.protectWithTopUp`, `_repayFromWallet` | The `from` is always the loan's own borrower, who approved the guard and signed the limits; only the agent can call; money goes only into that borrower's loan. Proven by `testFuzz_guardLimits` and `testFuzz_agentCannotTouchStrangers`. |
| reentrancy-no-eth | `PesoPool.repayWithSwap` | State is written after the swap because the swap's output decides the repayment. The function is `nonReentrant`, the pool is a fixed immutable address, and the callback only pays inside this call. |
| unused-return | Morpho, Uniswap and USDT0 calls | Values are read back from state where they matter (positions, balances). |
| divide-before-multiply | `TickPrice`, `_accruedView` | `TickPrice` is Uniswap's own fixed-point method; the accrual rate is computed in one step with 18 decimals. |
| incorrect-equality | Zero and full-repayment checks | Exact comparisons on values the contract computes itself. |

Low results (timestamps, zero-address checks on immutable deploy arguments, benign event ordering) are expected
for this design.
