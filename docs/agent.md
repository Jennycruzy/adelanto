# The agent

One Node service (`apps/agent`) with one wallet on Celo:
[`0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1`](https://celoscan.io/address/0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1),
ERC-8004 agent **#10043** ([registration](https://celoscan.io/tx/0xf0bbf26a35801ff47b3e343078cb3d97ef964166f83b458b8104bee88b533795),
[card](../agent/registration.json)). It runs around the clock under systemd on our server.

## What it decides

Every 60 seconds it reads every open loan at one block and runs these jobs in order. The rules are plain
functions in `packages/core` (`guard.ts`, `health.ts`, `ratewatch.ts`), tested without a network.

| Job | Trigger | Action | Limits |
|---|---|---|---|
| **Protect** | Loan at 70% or more of its dollars' value | Add the borrower's USDT or repay with the borrower's wARS, in the order they chose (the other way if the first can move nothing), back to 60% | Daily USDT and wARS limits, the peso buffer, the rule's expiry; all checked again by `LoanGuard` on chain |
| **Repay when pesos arrive** | wARS reaches the borrower's wallet after the loan opened | Repay up to what arrived, minus the buffer | Only if the rule turns it on; daily limit; spending from the wallet lowers the credit first |
| **Sell gently** | Past 80%, and protection did not land | `GentleKeeper.liquidate(loanId)`: the smallest repayment that brings the loan to 78%, computed on chain at that block | Pool rules: 30-minute price, half the debt at most, 5% bonus |
| **Stop on bad prices** | The pool's 30-minute price differs by more than 1.5% from Binance **and** dolarapi for 3 minutes | The guardian pauses new borrowing; it resumes its own pause after 10 minutes with at least 2 sources within 1% | Needs 2 outside sources; cannot pause repay, withdraw or liquidation; only lifts a pause it made |
| **Rate watch** | Morpho on Ethereum would save more than twice its moving cost over the rest of the term | A notice with the saving in pesos | Moves no money |
| **Notices** | Health changes (risk, can be sold), due in 3 days, due, late, the pool running low on free pesos | One sentence in Spanish or English | 2-point hysteresis and a 6-hour cooldown per loan, so it never nags |

**Protect always comes first**, even past 80%: the agent sells only when the borrower's own dollars or pesos could
not save the loan.

### "Pesos that arrive" exactly

The repay-on-arrival credit is rebuilt from the chain, not from memory: every wARS transfer into and out of the
borrower's wallet after the loan opened and after the latest `LimitsSet`, in block and log order. Money spent from
the wallet lowers the credit first. Borrowed pesos never count as arrivals. A new rule resets the credit. A test
suite (`apps/agent/test/ledger.test.ts`) covers each case.

## What it can never do

`LoanGuard` is the agent's only way to touch a loan, and it enforces, on chain:

- money moves only from the borrower's wallet into that borrower's own loan;
- no more than the signed daily limits, never below the borrower's peso buffer;
- nothing after the rule's expiry, and nothing while the price module refuses;
- no borrowing, no opening loans, no changing limits.

Each is a test in `contracts/test/unit/LoanGuard.t.sol` (25 tests).

## How it sends

`packages/chain/src/sender.ts`, `TaggedSender`:

1. **Tag**: the ERC-8021 attribution suffix `celo_0e96c1ff3fa8` is appended to the calldata. The client refuses to
   start without a tag.
2. **Simulate** at the latest block; a revert stops here.
3. **Sign** with an explicit nonce.
4. **Record** the signed bytes in SQLite, unique per (wallet, nonce), *before* broadcast.
5. **Broadcast** and wait for the receipt.

After a crash it re-broadcasts the same signed bytes, so an action can land at most once. A transaction stuck for
10 minutes is replaced at its nonce by a tagged empty self-transfer at a higher fee, and the next tick decides
again from fresh state. If a different transaction used the nonce, the record follows whichever one landed; a
landed action is never recorded as failed.

**One agent per wallet.** Each database and each wallet has an OS-level exclusive lock held for the life of the
process (`apps/agent/src/db.ts`). A second copy is refused, which `apps/agent/test/lock.test.ts` proves with two
real processes.

**Reorgs.** The indexer follows the chain's safe head, checks that each block's parent hash matches what it stored,
and rewinds if not.

**Watch and live.** `AGENT_MODE=watch` (the default) indexes, decides and logs every decision with its reason, and
sends nothing, not even a resumed transaction. `AGENT_MODE=live` turns sending on. At startup in live mode it
checks that `GentleKeeper.agent()` is this wallet and stops if not.

## What every action leaves behind

For each decision: the trigger, the inputs (price, health, limits, the block), the decision, the transaction hash
and one sentence, for example:

> Tu regla: «Cuidá mi préstamo con hasta US$ 10 por semana». Agregué US$ 3 porque tu préstamo llegó al 71%.

The loan page shows this log.

## Rehearsal on a mainnet fork

`apps/agent/test/fork-rehearsal.ts` runs the real agent against the deployed contracts on a fork of Celo mainnet.
A test borrower takes a real loan; fork time moves until interest pushes it past 70% and then 80%. The agent must:

- protect it (70.7% → 60.0%),
- repay pesos that arrive, once (800 wARS),
- resume a signed-but-unsent transaction after a simulated crash, exactly once,
- replace a transaction stuck at its nonce,
- protect first past 80%, then liquidate gently only when protection cannot help,
- tag every transaction (8 of 8).

Before anything is signed, the agent wallet's nonce on the fork is set to 1,000,000, so nothing signed there can ever
be valid on mainnet. Anvil's well-known keys have EIP-7702 code on Celo mainnet, so the rehearsal uses fresh keys.

## Reviews

The contracts and the agent were each reviewed by an outside reviewer reading the code cold, then re-checked after
the fixes.

| Round | Scope | Found | Result |
|---|---|---|---|
| Contracts | All Celo and Ethereum contracts | 1 high, 6 medium (2 conditional), 2 low | All fixed except one kept by design: taking back extra dollars waits while the price module refuses, like borrowing does |
| Agent 1 | Indexer, decisions, sender, price, notices | 6 high, 6 medium, 2 low | All 14 fixed: watch mode never sends; arrivals rebuilt from chain; reorg checks; gentle liquidation moved on chain (`GentleKeeper`); pause ownership from events; nonce and process guards; 3-minute, 2-source price rule; calmer notices |
| Agent 2 | The round-1 fixes and `GentleKeeper` | 0 high, 5 medium | All fixed: protect before any sale, 78% target, live outflows in the arrival credit, credit reset on each rule, stuck transactions replaced |
| Agent 3 | The round-2 fixes | 0 high, 1 medium, 1 low | Both fixed: the process lock (with a two-process test) and the landed-action record; `GentleKeeper`'s margin made provable; cleared for mainnet |

## Configuration

| Variable | Meaning |
|---|---|
| `ATTRIBUTION_TAG` | The event's attribution code; the agent refuses to start without it, or if it differs from the deployment's |
| `AGENT_KEY_FILE` | The agent wallet's key file |
| `GUARDIAN_KEY_FILE` | The guardian's key file (for price pauses); optional |
| `AGENT_MODE` | `watch` (default) or `live` |
| `CELO_RPC_URL`, `CELO_RPC_URL_2` | RPC endpoints; a public node and Forno are the defaults |
| `TICK_SECONDS` | Decision interval, default 60 |
| `DB_PATH` | SQLite database (default under `~/adelanto-data`) |
| `OURS_ADDRESSES`, `JUDGE_ADDRESSES` | Wallets labelled ours or judges' on the transparency page |
