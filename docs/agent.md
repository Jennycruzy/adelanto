# The agent

One Node service (`apps/agent`) with one wallet on Celo:
[`0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1`](https://celoscan.io/address/0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1),
ERC-8004 agent **#10043** ([registration](https://celoscan.io/tx/0xf0bbf26a35801ff47b3e343078cb3d97ef964166f83b458b8104bee88b533795),
[card](../agent/registration.json)). It runs around the clock under systemd on our server, in live mode on Celo mainnet. The home page shows when it
last checked the loans and what it did last.

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
| **Notices** | Health changes (risk, can be sold), due in 3 days, due, late, the pool running low on free pesos | One sentence in Spanish or English, shown on the wallet's [Mi historial](https://adelanto-99-80-93-71.sslip.io/historial), in `/api/me/:address` and in Telegram | 2-point hysteresis and a 6-hour cooldown per loan, so it never nags |
| **Weekly summary** | Sundays at 20:00 in Buenos Aires | For each person who borrowed, repaid, lent or has a loan open: what they borrowed and repaid, what the agent did under their rule, what they owe now and when it is due, what their pool share is worth and earned, their credit step. One for the pool on [Transparencia](https://adelanto-99-80-93-71.sslip.io/transparencia) | Debts, pool shares, steps and pool totals are read from chain at one block; the week's flows come from the indexed chain events; every number in the text must come from those facts or nothing is written (`apps/agent/src/weekly.ts`) |

## What it has done on mainnet

| When (UTC, 7 Nov) | What | Transaction |
|---|---|---|
| 12:14 | 300 wARS from a sale reached loan #2's borrower; the agent repaid 300 wARS of the loan through `LoanGuard`. *"Te entraron $ 300; pagué $ 300 de tu préstamo."* | [`0x1436a0e4…`](https://celoscan.io/tx/0x1436a0e4ebad5b111073ed1ee24fd4b2b3163095def49f08615b8df8201f356b) |
| 12:28 | 100 more wARS arrived; the agent repaid 100. *"Tu regla: «Uso los pesos para el kiosco. Cuando me entren pesos de ventas, pagá el préstamo con eso. Nunca vendas mis dólares.». Te entraron $ 100; pagué $ 100 de tu préstamo."* | [`0xcd28659c…`](https://celoscan.io/tx/0xcd28659c76d26850c0179240f42efc5763586e499f2c03772685e4e7b0e2622a) |

The agent acted on its own each time; the transparency page labels every wallet involved. Protecting at 70% and the gentle sale past 80% need the peso to strengthen about 17%
against today's price, so they are proven on a mainnet fork (below) rather than waited for.

**Protect always comes first**, even past 80%: the agent sells only when the borrower's own dollars or pesos could
not save the loan.

### "Pesos that arrive" exactly

The repay-on-arrival credit is rebuilt from the chain, not from memory: every wARS transfer into and out of the
borrower's wallet after the loan opened and after the latest `LimitsSet`, in block and log order. Money spent from
the wallet lowers the credit first. Borrowed pesos never count as arrivals. A new rule resets the credit. A test
suite (`apps/agent/test/ledger.test.ts`) covers each case.

## The borrower's words

Each rule's limits are on chain; its words are not. The site stores the words only if their keccak256 equals the
`ruleHash` the borrower signed with `setLimits` (`apps/web/src/rules.ts`). The agent reads them from the site's
database (`WEB_DB_PATH`, read-only) and quotes them only after hashing them again and matching the hash on chain, so
no one can put words in a borrower's mouth. A rule set before its words were saved is still enforced; the agent
just describes what it did without the quote.

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
and rewinds if not. Celo's `safe` tag can stall for days while the chain moves (we saw it 335,519 blocks, about 3.9
days, behind the tip), so the head the indexer uses is the newer of the safe head and the tip minus 60 blocks
(about a minute); a reorg past that is caught by the parent-hash check, which rewinds (`indexHead`, tested in
`apps/agent/test/indexhead.test.ts`).

**Watch and live.** `AGENT_MODE=watch` (the default) indexes, decides and logs every decision with its reason, and
sends nothing, not even a resumed transaction. `AGENT_MODE=live` turns sending on; the deployed agent runs live,
with the guardian key loaded for price pauses. At startup in live mode it checks that `GentleKeeper.agent()` is
this wallet and stops if not.

## Other agents can use it: MCP

`https://adelanto-99-80-93-71.sslip.io/mcp` is an MCP server (Streamable HTTP, no session, no key). Tools:
`rates`, `price_history`, `quote`, `credit_record`, `loan_status`, and two builders, `build_borrow` and
`build_repay`, that return unsigned transactions for the caller's own wallet: only to `PesoPool` or the two
tokens, exact approvals, each with our attribution suffix. The server holds no keys; nothing moves until that
wallet signs. On a mainnet fork, an MCP client borrowed 1,000 pesos and repaid all of it with only those
transactions, including the case where the wallet holds just the borrowed pesos and the gap is swapped from its
USDT (`apps/web/src/mcp.ts`). Any MCP client that speaks Streamable HTTP can connect to that URL.

## In Telegram: @adelanto_ar_bot

On Mi historial, **Avisarme por Telegram** asks the wallet for a free EIP-712 signature (no transaction); the server
checks it and opens the bot with a one-time code, so a chat can only follow a wallet its owner signed for. From
then on the bot sends every notice the agent writes for that wallet, in the chat's language: a repayment under the
rule, three days before the due date, risk rising, and the Sunday summary. It answers "cuánto debo", the rate and
quotes ("cotizar 5000 30"), and reads a rule written in words against the open loan, replying with the read-back
and a button that opens the site with the words filled in, to sign in the wallet. The bot never moves money.
Chats linked to our own wallets also get the watchdog's alerts (`apps/web/src/telegram.ts`).

## What it buys: a second opinion on the chain, through buy

Before the agent moves anyone's money (protect, repay from pesos that arrived, a gentle sale, a pause), it asks a
node we do not run to read the same loan and the same price at the same block: Chainstack's Celo RPC, bought per
batch through [buy](https://usebuy.ai) (`chainstack.celo`, US$0.01 for up to 2,000 calls), paid over x402 from the
agent wallet in USD₮. If the two disagree, it sends nothing that tick. Before the Sunday summaries it does the same
for every balance, debt, step and pool total they quote, and a disagreement holds the summaries for an hour. One
payment can never exceed the catalogue price and the agent spends at most US$0.05 a day; past that, or if buy is
down, it acts on our RPC alone and says so in its log. Once a day it also buys the pool's books (free pesos, debt,
deposits, the rate) at one block and shows the comparison and the payment on Transparencia; the first one matched at
block 82261759, paid in [`0xb31f9ca9…`](https://celoscan.io/tx/0xb31f9ca9ce650470f04832fc83195e29d9cc70880057b941184a0d6d66761b40)
(`apps/agent/src/poolcheck.ts`). Every purchase is a receipt with the action and wallets it
served and its settlement transaction: [`evidence/buy/purchases.json`](../evidence/buy/purchases.json)
(`apps/agent/src/buy.ts`).

## Its reputation: ERC-8004 feedback from closed loans

When a loan closes, its page asks that loan's wallet to rate the agent from 1 to 5 stars: one tagged transaction to
Celo's ReputationRegistry (`giveFeedback` for agent #10043, tag `closed-loan`, the loan id, the public loan page as
evidence). The page never asks our own wallets, and the registry refuses ratings from the agent's owner. The site
reads every rating from chain and counts one only if its wallet borrowed that loan and the loan is closed; the
average appears on the home page and on Transparencia (`apps/web/client/feedback.ts`). Checked on
a mainnet fork by clicking a star in a browser: the feedback landed tagged, the page and the average updated, and a
rating from the agent wallet reverted with "Self-feedback not allowed".

## It also earns: x402

Other agents pay the agent wallet for three answers over x402, through Celo's facilitator: the peso rate checked
against two outside sources, a firm borrow quote, and a wallet's credit record, in wARS or USD₮
([details](how-it-works.md#11-other-agents-pay-for-answers-x402)). The agent's ERC-8004 card declares
`x402Support` and lists the catalog.

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
| `WEB_DB_PATH` | The site's database, read-only, for the borrowers' rule words (default `~/adelanto-data/web.sqlite`) |
| `OURS_ADDRESSES`, `JUDGE_ADDRESSES` | Wallets labelled ours or judges' on the transparency page |
