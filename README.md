# ADELANTO

**Pesos now, without selling your dollars. An agent keeps the loan safe.**
*Pesos ya, sin vender tus dólares. Un agente cuida tu préstamo.*

> An Argentine bank charges **64.63% a year** for a personal loan ([BCRA, 2 Nov 2026](docs/data.md#rates)). ADELANTO
> lends Ripio's peso stablecoin **wARS** on Celo against **USDT** at **22% a year when the pool is idle, 36% at 80%
> use**, inside MiniPay. You keep your dollars. A rule you sign once lets an agent protect the loan, and a contract
> holds the agent to it.

Live on Celo mainnet: **[adelanto-99-80-93-71.sslip.io](https://adelanto-99-80-93-71.sslip.io)** ·
[Try it in five minutes](https://adelanto-99-80-93-71.sslip.io/probar) ·
[Transparency](https://adelanto-99-80-93-71.sslip.io/transparencia) ·
[llms.txt](https://adelanto-99-80-93-71.sslip.io/llms.txt) · ERC-8004 agent **#10043** ·
[Judges' guide](docs/judges.md)

## Check it yourself

Every link is a real Celo mainnet transaction. Every transaction our wallets send since the event code was issued carries the
attribution tag `celo_0e96c1ff3fa8` ([audit: 24 of 24 tagged, 0 untagged](evidence/attribution-audit.json)).

| What happened | When (UTC) | Check it |
|---|---|---|
| **A real peso loan, opened and closed.** 1,000 wARS borrowed against 1.3 USDT for 7 days at 25.11% a year (fee 2.5 wARS), collateral added and taken back, half repaid in pesos, the rest repaid **with dollars in one transaction** (the pool swaps on Uniswap), dollars returned. | 6 Nov 08:13–08:14 | [borrow](https://celoscan.io/tx/0xbb9cb9444206e661b855364ebf94ccb6760f8beb692282a33faa80a1eb4c62c5) · [add](https://celoscan.io/tx/0xd182023e86eca482b3b8c2a4481ed957974c23003503ff814beed8c4bff0b6f6) · [take back](https://celoscan.io/tx/0x365bb44f2d915916854f7c2ba2940f91fe84c891e0ac2c9158e5fb46b06c212f) · [repay in pesos](https://celoscan.io/tx/0x470ffd10673083bfc9a8df0801da0a0a4356ac91a4b02888bb95a0ff143aaa3b) · [repay with dollars, closes it](https://celoscan.io/tx/0xc2843c39f8f9444e44427370cfee8c820e6b6410ed81d5b671948f0baf06536c) |
| **A lender's pesos in and out.** 5,616.86 wARS deposited into the pool; 100 wARS withdrawn. | 6 Nov 08:11–08:14 | [deposit](https://celoscan.io/tx/0xd27c79121bb11b8ec32cb492c849d37fa2744adad1544f113061cc25de466c2a) · [deposit 2](https://celoscan.io/tx/0x49046ee489059c942f38df26b58249b5c20582f6cc943084e85e4dde734f5621) · [withdraw](https://celoscan.io/tx/0x9cc2e069c6015bfec97457b4813aed8dc75a3b3b1a3deede1f074c68dda38116) |
| **Five contracts, verified, tagged from the first byte.** The attribution tag is on the deploy transactions themselves. | 6 Nov 07:40, 10:42 | [PesoPool](https://celoscan.io/tx/0xc78058d8c4623ef4b2457f1f260f2589e090e820153b20c794503d7b9ee0a1b7) · [LoanGuard](https://celoscan.io/tx/0xe091e0c93d6e7eb1c8d72ef8a8a2f328845002e2247c7fa4fd25dd867e07cf0b) · [CreditBook](https://celoscan.io/tx/0x4d6f734947024707c03486d6afb006079cecda3ead83cdb696304924c72e297a) · [PriceModule](https://celoscan.io/tx/0xb61c2b6d8b09bf95550fdd947778bc8b03939eb9c662cd148dbc59b5c0130678) · [GentleKeeper](https://celoscan.io/tx/0xa697e3fa3b145ed4f0c7fc90071d5562703b16d27f4217520ff3cf7e9b4e9582) |
| **An agent with an on-chain identity.** ADELANTO is agent #10043 in Celo's ERC-8004 registry; its card lists the site, the contracts and the agent wallet. | 6 Nov 08:15 | [registration](https://celoscan.io/tx/0xf0bbf26a35801ff47b3e343078cb3d97ef964166f83b458b8104bee88b533795) · [card](agent/registration.json) |
| **The agent repaid a loan on its own, quoting the borrower's rule.** Loan #2's rule, in the borrower's words: *"Cuando me entren pesos de ventas, pagá el préstamo con eso. Nunca vendas mis dólares."* When 300 wARS from a sale reached the borrower's wallet, the agent repaid 300 wARS through `LoanGuard`; a second sale of 100 wARS was repaid the same way, and the agent's log quotes the rule word for word. | 7 Nov 12:14, 12:28 | [repay 300](https://celoscan.io/tx/0x1436a0e4ebad5b111073ed1ee24fd4b2b3163095def49f08615b8df8201f356b) · [repay 100](https://celoscan.io/tx/0xcd28659c76d26850c0179240f42efc5763586e499f2c03772685e4e7b0e2622a) |
| **Other agents pay ADELANTO over x402.** A buyer paid 8 wARS for the peso rate and US$0.01 in USD₮ for a wallet's credit record, settled by Celo's x402 facilitator straight into the agent wallet. The facilitator sends these settlements from its own wallet; ADELANTO declares its attribution code in every 402 through the builder-code extension. | 7 Nov 13:52 | [8 wARS](https://celoscan.io/tx/0x8413548ce9ed00b89f43a67a01885b9081eea1f0957e16a479c46a2fffebe335) · [US$0.01](https://celoscan.io/tx/0x7ade1408800fdd6700c94dae8ae1f05fbd734bbf775b484b12e34d4586e70344) · [catalog](https://adelanto-99-80-93-71.sslip.io/x402) |
| **Works inside MiniPay.** On a real iPhone, MiniPay signed EIP-712 typed data on chain 42220, paid gas in USDT on its own, and sent to contracts that are on no wallet's list (wARS and the wARS/USDT Uniswap pool). | 5 Nov 17:24 | [wARS call](https://celoscan.io/tx/0x91a0c3afd4577ba6fcf880bdd8dde2b69f9d209c4e1df5dc45903286cb7db9e8) · [Uniswap pool call](https://celoscan.io/tx/0x370cb1091c2198b9b0bc05438576d18dd7732e84d7cfa3c98e6300de540df51c) |
| **Bigger loans: Morpho on Ethereum, round trip with real money.** USDT bridged to Ethereum, 3,000 wARS borrowed on Morpho's wARS/USDT market (0.30% a year that day), pesos bridged to Celo through Ripio, then repaid and the dollars brought home. | 5 Nov 18:51–21:38 | [borrow on Morpho](https://etherscan.io/tx/0x32e03e2af5aaf27db2b9db4cdf0ce0bb84c073b75ed0a52a12358043d5cc0165) · [pesos to Celo](https://etherscan.io/tx/0x88df1ef3069e8abdcbe1ee421996677f1a38223eebbd988b410aa47d2bda463f) · [repay](https://etherscan.io/tx/0xb7f7afe9a8ca26af2c26cd1ed48f868a96c3684af96b325ce33d6eb21f9d15fa) · [dollars home](https://etherscan.io/tx/0x68b29607e347de3f7949b90f0084763c105a6d662cbded845b7fe881746e82f2) · [every step](docs/verification.md#ethereum-round-trip) |

All of these came from our own wallets, and the [transparency page](https://adelanto-99-80-93-71.sslip.io/transparencia)
labels them that way. Real users are counted there separately, by the event's rule.

From a terminal, no wallet:

```sh
curl -s https://adelanto-99-80-93-71.sslip.io/api/public/rates   # live rates and pool, read from chain
curl -s https://adelanto-99-80-93-71.sslip.io/api/loan/1         # the loan above, from chain
curl -s https://adelanto-99-80-93-71.sslip.io/llms.txt           # every contract and how to check each claim
curl -s https://adelanto-99-80-93-71.sslip.io/x402               # paid answers for agents (x402), free list
BUYER_KEY_FILE=key node scripts/x402-buy.ts                      # pay 8 wARS for the peso rate
```

## What ADELANTO does

Argentines save in dollars because the peso loses about a third of its value a year (INDEC: 33.4% to September
2026). When they need pesos for rent, stock for a shop or a medical bill, they have three bad choices: sell
dollars and lose them for good, borrow from a bank at 64.63% a year, or pay in card instalments at the card dollar
rate (2,041 pesos per dollar against 1,667 for the crypto dollar on 5 Nov, 22% more). [Sources](docs/data.md).

ADELANTO is the fourth choice:

1. **Borrow pesos against your dollars.** Lock USDT in MiniPay; get wARS in the same minute, in three taps (a
   gas-free permit signature, then one transaction). Ripio's app turns wARS into pesos in a bank account.
2. **Pay much less than the bank.** The rate moves with how much of the pool is lent: 22% a year when idle, 36%
   at 80% use, plus a 0.25% opening fee. Every quote shows the bank's rate next to ours, in pesos.
3. **Keep your dollars.** What you owe is in pesos. If the peso keeps falling, your debt shrinks in dollars while
   your dollars stay dollars.
4. **Let the agent look after it.** Sign one rule ("never let my loan reach risk; use up to US$ 20 more a week").
   The agent adds your own dollars or repays with your own pesos before the loan gets near a sale, repays when
   pesos arrive, and quotes your rule in every action it takes. The `LoanGuard` contract enforces the limits, not
   our server.
5. **Lend pesos and earn.** Anyone with wARS can lend into the pool and withdraw any time there are free pesos.
   At 80% use lenders earn about 25.9% a year, above the banks' BADLAR deposit rate (22.3%).
6. **Build a credit record you own.** Every loan repaid on time is written on Celo by `CreditBook`. After one,
   three and six on-time loans, the rate drops by one to three points and the limit rises. Any app or agent can
   read it.

### An example: Lucía

*Lucía is an example, not a customer.* She owns a kiosk in Caballito, keeps US$ 1,000 in USDT in MiniPay, and
needs 400,000 pesos for stock this month.

| | Bank personal loan | ADELANTO (pool at 22–36% a year) |
|---|---|---|
| Interest for 30 days on 400,000 pesos | about 21,250 pesos (64.63% a year) | about 7,230–11,840 pesos, plus a 1,000-peso fee |
| Her dollars | untouched | about US$ 405 locked, returned when she repays |
| If the loan nears the risk line | — | the agent adds her dollars or repays with her pesos, inside her rule |

The first loan can borrow up to 60% of the dollars' value in pesos, at most 1,000,000 pesos. How much the pool
can lend today is on the [home page](https://adelanto-99-80-93-71.sslip.io) and in
[`/api/public/rates`](https://adelanto-99-80-93-71.sslip.io/api/public/rates).

### Ways in

| For | How |
|---|---|
| **MiniPay users** (main) | Open the site in MiniPay. Spanish first, amounts in pesos, gas paid in USDT by MiniPay, no words like "collateral" on screen. |
| **Any Celo wallet** | The same site in a browser with MetaMask, Valora or Rabby. |
| **Lenders** | [`/prestar`](https://adelanto-99-80-93-71.sslip.io/prestar): deposit wARS, see the rate, withdraw. |
| **Judges** | [`/probar`](https://adelanto-99-80-93-71.sslip.io/probar): a real 1,000-peso loan against about US$ 1, then repay it. [Guide](docs/judges.md). |
| **Agents and scripts** | [`llms.txt`](https://adelanto-99-80-93-71.sslip.io/llms.txt), `/api/public/rates`, `/api/loan/:id`, `/api/me/:address`, and the contracts directly. |

## What the agent does on its own

The agent is one Node service with its own wallet (`0xB93A…B2d1`, ERC-8004 #10043). It reads every loan from the
chain at the safe head, checks block-hash continuity, and decides every 60 seconds.

| Job | When | What it does | What binds it |
|---|---|---|---|
| **Protect** | A loan reaches 70% of its dollars' value | Adds the borrower's USDT, or repays with the borrower's wARS, in the order they chose, back to 60% | The borrower's signed daily limits and peso buffer, checked by `LoanGuard` on chain |
| **Repay when pesos arrive** | wARS lands in the borrower's wallet after the loan opened | Repays up to the amount that arrived, minus the buffer | Auto-repay must be on in the rule; daily limit; only pesos that arrived after the loan opened count |
| **Sell gently, only if it must** | A loan crosses 80% and protection could not help | Sells the smallest slice that brings it to 78%, computed on chain by `GentleKeeper` | Pool rules: the 30-minute price, the 50% cap, a 5% bonus. On a 1,000 USDT loan the borrower loses about US$ 5.80 instead of US$ 19 under a standard liquidation back to 70% |
| **Stop on bad prices** | The pool's price differs from Binance **and** dolarapi by more than 1.5% for 3 minutes | Pauses new borrowing; resumes after 10 minutes in line | Needs two outside sources; the guardian cannot pause repay, withdraw or liquidation |
| **Rate watch** | Morpho on Ethereum would save more than twice its moving cost | Tells the borrower, with the saving in pesos | Moves no money |
| **Keep people told** | Risk, due in 3 days, due, late, the pool running low on free pesos | One Spanish sentence per change, with hysteresis so it never nags | — |

Every action records its trigger, the inputs (price, health, limits), the decision, the transaction and one
sentence in Spanish: *"Tu regla: «…». Agregué US$ 3 porque tu préstamo llegó al 71%."*

**What it can never do**, enforced by `LoanGuard` and proven by tests: send money anywhere but the borrower's own
loan, borrow or open a loan for anyone, change limits, act after the rule expires, or act while the price module
refuses.

**How it sends**: every transaction is tagged, simulated, signed and written to its database *before* it is
broadcast. After a crash it re-sends the same signed bytes, so an action can land at most once; a transaction stuck
for 10 minutes is replaced at its nonce by a tagged empty transfer. One OS-level lock per wallet means two copies
can never act at once (tested with two processes). The agent starts in watch mode, which reads, decides and logs
without sending; `AGENT_MODE=live` turns sending on. Details: [docs/agent.md](docs/agent.md).

**Reviewed three times.** An outside review found 14 issues in round 1 (6 high); all were fixed. A fresh reviewer
checked rounds 2 and 3; round 3 found no high issue and cleared `GentleKeeper` for mainnet. Its one medium (the
process lock) is fixed and has a two-process test.

## How each LatAm criterion is met

| Criterion | What we show |
|---|---|
| **Works on mainnet with a real wFIAT token** | The loan is wARS itself: lend, borrow, add, take back, repay in pesos, repay with dollars and withdraw, all on Celo mainnet, all tagged ([audit](evidence/attribution-audit.json)). |
| **Real use of wFIAT and the Celo stack** | wARS is what is borrowed and lent; MiniPay with USDT gas; ERC-8004 identity #10043; ERC-8021 attribution on every transaction; Ripio's bridge between Celo and Ethereum; the Celo wARS/USDT Uniswap v3 pool as the price; USDT and wARS EIP-2612 permits. |
| **The agent is autonomous and useful** | Six jobs above, each bound by limits the borrower signed and the contract enforces; it saves the borrower money at the bank's expense and saves them from a full liquidation. |
| **A real person can use it** | Spanish first, pesos everywhere, three taps to a first loan in MiniPay, no crypto words on screen, a US$ 1 loan to try. |
| **Impact for LatAm** | Credit in pesos for people who save in dollars, the gap between a 64.63% bank loan and selling your savings. Lenders earn above BADLAR. The credit record belongs to the borrower. |

## Contracts (Celo mainnet, chain 42220)

All verified on Sourcify (exact match) and Blockscout. No proxies, no upgrade path, no admin withdraw.

| Contract | Address | Job |
|---|---|---|
| `PesoPool` | [`0xCfeafCDd06d3a0E3Bf1596F8Afa1caC1Dc19ed60`](https://celoscan.io/address/0xCfeafCDd06d3a0E3Bf1596F8Afa1caC1Dc19ed60) | Lenders' wARS (ERC-4626 shares) and loans against USDT: rates, caps, liquidation, reserve |
| `LoanGuard` | [`0x26c9f3D79f3C835ee74c95A94a701e93f24bEbD3`](https://celoscan.io/address/0x26c9f3D79f3C835ee74c95A94a701e93f24bEbD3) | Each borrower's signed limits and rule hash; the only way the agent touches a loan |
| `CreditBook` | [`0x7dF4182c3a7D7b25aE2D79a801D9502B2568fee1`](https://celoscan.io/address/0x7dF4182c3a7D7b25aE2D79a801D9502B2568fee1) | Public credit record per wallet, written only by the pool |
| `PriceModule` | [`0xBC6aa0BC458E01A7A32955DC106F9775569A6355`](https://celoscan.io/address/0xBC6aa0BC458E01A7A32955DC106F9775569A6355) | Pesos per dollar from the wARS/USDT Uniswap v3 pool: spot, 30-minute and 2-hour averages, depth and staleness checks |
| `GentleKeeper` | [`0xcd98B9669708F0d193c975B0900169890d6Dd0fE`](https://celoscan.io/address/0xcd98B9669708F0d193c975B0900169890d6Dd0fE) | Computes the smallest liquidation back to 78% at the moment it runs |
| Agent wallet | [`0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1`](https://celoscan.io/address/0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1) | ERC-8004 #10043, the agent's only key |

On Ethereum, `MorphoProxy` and `MorphoProxyFactory` give each borrower a proxy that runs only orders they signed
(EIP-712) and sends money only to their own Celo address; they are tested against a mainnet fork of Morpho.

## Rates and risks, in plain words

- **Rates.** Borrow 22% a year when the pool is idle, rising to 36% at 80% use, then steeply to 156% at 100% use
  so lenders can always get out. Lenders get the interest minus a 10% reserve. Opening fee 0.25%. After the term,
  +5 points until repaid; no loan is ever closed for being late.
- **When there is risk.** The loan is in pesos and the guarantee in dollars, so a **falling peso makes the loan
  safer**. Risk comes when the peso strengthens. At 70% the agent protects; at 80% a part can be sold. Every loan
  page shows the dollar price at which each line is hit.
- **Prices.** Borrowing uses the lower of the spot and the 30-minute average, so a spike never lends more.
  Liquidation uses only the 30-minute average, so a one-block push cannot liquidate anyone. Total borrowing is
  capped at 65% of the pesos it takes to move the pool's price 2% ([cost table](docs/security.md#what-it-costs-to-push-the-price)).
- **If Ripio froze wARS.** After 24 hours frozen, each borrower can take their dollars back down to the 70% line;
  the rest stays as the lenders' claim until wARS moves again ([details](docs/security.md#if-ripio-freezes-wars)).
- **Bad debt.** The reserve pays first; any loss beyond it is shared by lenders and shown on the transparency page.
  Lenders read this before they deposit.

## What we found building it

Things we learned on mainnet that others building here may need. Full list: [docs/build-log.md](docs/build-log.md).

- **MiniPay does not block unlisted contracts.** Both test transactions to contracts on no list landed, and MiniPay
  set `feeCurrency` to the USDT adapter on its own.
- **MiniPay signs EIP-712 v4 for chain 1 as well as 42220**, so one signature can authorize an Ethereum order.
- **The attribution code is issued at enrolment**, not derived from the repo; untagged transactions never count,
  so we sent nothing until we had it, and tagged the deploy transactions too.
- **Ethereum USDT's `approve` returns nothing**; a standard ERC-20 ABI reverts on it.
- **Public RPC nodes behind a load balancer lag**: a read right after a write can come from an older block, and
  gas estimates from a stale state ran out of gas. We read at one fixed block per decision and pad Ethereum gas.
- **Anvil's well-known test keys have EIP-7702 code on Celo mainnet**, so permit tests on a fork need fresh keys.
- **Fixed upstream:** Celo's MCP server returned no stablecoin balances on Sepolia and zero balances on mainnet.
  Our fix with tests is [celo-org/celo-mcp#49](https://github.com/celo-org/celo-mcp/pull/49).

# For developers

## Layout

```
contracts/          Solidity 0.8.28, Foundry: PesoPool, PriceModule, LoanGuard, CreditBook, GentleKeeper,
                    ethereum/MorphoProxy(+Factory); unit, fork and invariant tests
packages/chain      Tagged viem clients (refuse to start without the attribution tag), ABIs checked against the
                    compiler, TaggedSender (tag, simulate, sign, record, broadcast)
packages/core       Loan health, guard decisions, quotes, rate watch, Spanish and English sentences
packages/price      Binance and dolarapi readers; the pause/resume verdict
apps/agent          The agent: indexer, decisions, sender, notices, SQLite state, OS locks
apps/web            Hono server-rendered site (Spanish/English), wallet client with permits, public API
scripts/            Tagged Celo deploy, ERC-8004 registration, attribution audit
deployments/        Every deployed address with its tagged transaction
evidence/           Attribution audit output
agent/              ERC-8004 agent card
```

## Run and verify

Node 24 and Foundry.

```sh
npm ci
npm test                                   # 137 TypeScript tests, offline
cd contracts && forge test                 # 227 Solidity tests; fork tests need CELO_RPC_URL and ETH_RPC_URL
npm run audit:attribution                  # re-checks the tag on every transaction from our wallets and contracts
```

The agent, read-only against mainnet:

```sh
ATTRIBUTION_TAG=celo_0e96c1ff3fa8 AGENT_KEY_FILE=<any key file> AGENT_MODE=watch npm run agent
```

The full agent rehearsal on a Celo mainnet fork (protect, auto-repay, crash and resume, stuck transaction,
gentle liquidation; every transaction tagged; the agent's fork nonce is set to 1,000,000 so nothing signed there
is valid on mainnet):

```sh
anvil --fork-url $CELO_RPC_URL --port 8548 &
FORK_RPC=http://127.0.0.1:8548 AGENT_KEY_FILE=... ATTRIBUTION_TAG=celo_0e96c1ff3fa8 node apps/agent/test/fork-rehearsal.ts
```

## Tests

| Suite | Count | What it covers |
|---|---|---|
| Solidity unit | 25 `LoanGuard`, 38 `PesoPool`, 22 `PriceModule`, plus `CreditBook`, `GentleKeeper`, `TickPrice` | Every external function, every role, each thing the agent can never do |
| Solidity fork | Celo, Ethereum, `GentleKeeper` | The deployed tokens, the real Uniswap pool, Morpho, permits |
| Invariants | 6 properties, 10,000 runs | Lenders' pesos and borrowers' dollars always add up; no privileged transfer |
| TypeScript | 137 | ABIs vs the compiler, health maths (10,000 random loans), guard decisions, credit ledger, price verdict, quotes, notices, the two-process lock |
| Fork rehearsal | 8 tagged transactions | The agent end to end against the deployed contracts |

Static analysis (slither) findings and our answers are in [docs/security.md](docs/security.md#static-analysis-slither-0104).

## Docs

- [docs/judges.md](docs/judges.md): the five-minute path
- [docs/how-it-works.md](docs/how-it-works.md): the life of one loan, rates, limits, prices, liquidation
- [docs/agent.md](docs/agent.md): the agent's jobs, limits, sending and reviews
- [docs/security.md](docs/security.md): who can move money, every external function, prices, tests
- [docs/verification.md](docs/verification.md): every transaction and how to check it
- [docs/data.md](docs/data.md): the numbers and their sources
- [docs/build-log.md](docs/build-log.md): what we found building it

## License

[MIT](LICENSE)
