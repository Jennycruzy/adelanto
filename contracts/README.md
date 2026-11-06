# ADELANTO contracts

Pesos against dollars on Celo, with a cheaper route through Morpho on Ethereum for bigger loans.

| Contract | Chain | Job |
|---|---|---|
| `PesoPool` | Celo | Lenders' wARS (ERC-4626 `aPESO` shares) and loans against USDT: interest by use, credit steps, caps, liquidation, reserve, freeze exit |
| `PriceModule` | Celo | Pesos per dollar from the wARS/USDT Uniswap v3 pool: spot, 30-minute and 2-hour averages; stops new borrowing when the price can't be trusted |
| `LoanGuard` | Celo | The limits a borrower signs from a rule in their own words; the only way the agent can act on a loan |
| `CreditBook` | Celo | A credit record per address, written only by the pool, readable by anyone |
| `MorphoProxyFactory`, `MorphoProxy` | Ethereum | One proxy per person (address known before it exists) that runs only orders that person signed and sends money only to that person on Celo |

## Rules in numbers

| | |
|---|---|
| Borrow rate | 22% a year at zero use, 36% at 80% use, rising steeply above; −1 point per credit step (up to −3) |
| Lenders earn | Borrow rate × use × 90% (10% builds the reserve) |
| Opening fee | 0.25% of the pesos borrowed |
| Terms | 7, 30, 60 or 90 days; +5 points after the due date; late after 7 more days |
| Borrow up to | 60% of the collateral (62%, 64%, 65% after 1, 3, 6 on-time repayments) |
| At risk / liquidation | 70% / 80% at the 30-minute average |
| Liquidation | Up to half the debt (all of it under 10,000 wARS), collateral worth the pesos repaid + 5% |
| Minimum loan | 1,000 wARS |

## Build and test

```sh
forge build
forge test                       # unit, fuzz and invariant tests
CELO_RPC_URL=https://forno.celo.org \
ETH_RPC_URL=https://ethereum-rpc.publicnode.com \
forge test --match-path 'test/fork/*'   # against Celo and Ethereum mainnet state
```

Every external function, who can call it and what it can move: [`../docs/security.md`](../docs/security.md).

## Deploy

Celo contracts are deployed by `scripts/deploy-celo.ts`, not by `forge script`: every Celo transaction, contract
creation included, carries the ERC-8021 attribution tag, and the script stops if a landed transaction does not.
Each step is written to `deployments/celo.json` as it lands, so a rerun continues instead of sending twice.

```sh
npm install
(cd contracts && forge build)
ATTRIBUTION_TAG=<code> DEPLOYER_KEY_FILE=<path> GUARDIAN_ADDRESS=<addr> AGENT_ADDRESS=<addr> \
TREASURY_ADDRESS=<addr> npm run deploy:celo
```

Rehearse against a local fork first: `anvil --fork-url https://forno.celo.org --port 8547`, then the same
command with `CELO_RPC_URL=http://127.0.0.1:8547 DEPLOY_NETWORK=celo-fork`.
