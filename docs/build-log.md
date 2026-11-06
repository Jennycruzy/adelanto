# What we found building it

Things we learned on Celo and Ethereum mainnet while building ADELANTO, each with what we saw and what we did.
Written for the next team building with wFIAT, MiniPay and agents on Celo.

## MiniPay

| Found | How we know | What we did |
|---|---|---|
| MiniPay does **not** block contracts it does not list. | A test page in MiniPay on an iPhone sent a call to wARS and a call to the wARS/USDT Uniswap pool; both landed ([verification](verification.md#minipay)). | Built the app directly on our own contracts and wARS. |
| MiniPay sets `feeCurrency` itself and pays gas in USDT. | Both test transactions are type `0x7b` with the USDT adapter as `feeCurrency`, which the page did not set. | The site never sets a fee currency; MiniPay users need no CELO. |
| MiniPay signs EIP-712 v4 typed data for **chain 1** as well as 42220. | The test page's chain-1 signature recovered to the wallet. | One signature in MiniPay can authorize an order on Ethereum (`MorphoProxy`). |
| A receipt has no `feeCurrency`; the transaction does. | Our test page first showed `null` reading the receipt. | Read `feeCurrency` from `eth_getTransactionByHash`. |

## Attribution

| Found | How we know | What we did |
|---|---|---|
| The event's attribution code is issued when you enrol; it is not derived from the repository. | Our issued code (`celo_0e96c1ff3fa8`) differs from the hash of our repository name (`celo_803d1d28be6f`). | Sent nothing on mainnet until we had our code. |
| Untagged transactions never count, contract creations included. | Event rules. | `packages/chain` refuses to build a wallet client without a tag; the deploy script appends it to init code and checks every landed transaction. |
| The tag must survive every path: scripts, the agent, the site. | `npm run audit:attribution` reads back every transaction. | 24 of 24 tagged since the code; the site's wallet client tags every transaction it builds. |

## Tokens and bridges

| Found | How we know | What we did |
|---|---|---|
| Ethereum USDT's `approve` returns nothing. | A standard ERC-20 ABI reverted decoding the result. | A no-return ABI for USDT on Ethereum. |
| USDT on Celo supports EIP-2612 permits: domain `"Tether USD"`, version `"1"`, chain 42220. | Matches its `DOMAIN_SEPARATOR`; permits work on a mainnet fork. | Borrow in one free signature plus one transaction. |
| wARS on Celo supports permits too: domain `"Peso Argentino"`, version `"1"`. | Same check. | Repay in one free signature plus one transaction. |
| Ripio's bridge charges 15 wARS from Ethereum to Celo but **1,500 wARS** from Celo to Ethereum. | Our round trip ([verification](verification.md#ethereum-round-trip)). | The Ethereum route is only quoted where it saves more than its fixed costs (about US$ 135 for a one-month loan). |
| Bridge times: USDT0 Celo→Ethereum 53 s, Ethereum→Celo 199 s; Ripio Ethereum→Celo 171 s, Celo→Ethereum about 16 s. | Same round trip. | Used in the Ethereum quote and in the rate watch's moving cost. |
| The Celo wARS/USDT Uniswap v3 pool held 1,200 observations, enough for a 30-minute and a 2-hour average. | Read at deploy. | `PriceModule` uses them; the deploy script refuses a pool with fewer than 600. |

## RPC nodes and gas

| Found | How we know | What we did |
|---|---|---|
| Public RPC endpoints behind a load balancer can answer from an older block right after a write. | A read after our own transaction returned the state before it. | The agent reads each decision at one fixed block; the deploy script waits until every contract's code is visible before reading back. |
| A gas estimate taken right after a state change can come from a stale node. | `withdrawCollateral` on Morpho ran out of gas at 82k; it needed 111k. | Re-read state before each step; pad Ethereum gas by 1.5×. |
| viem caches the block number for a few seconds by default. | The indexer re-read the same block. | `cacheTime: 0` wherever the block number matters. |
| A function returning a struct must be declared as a tuple in a hand-written ABI, or viem returns `undefined` fields. | Caught by the fork rehearsal. | Every ABI in `packages/chain` is checked against the compiler's output by a test. |

## Testing on a fork

| Found | How we know | What we did |
|---|---|---|
| Anvil's well-known test keys have EIP-7702 delegation code on Celo mainnet, so a fork treats them as contracts. | Permits from those keys failed on the fork. | Fresh keys in every fork test; the site skips permits for wallets with code. |
| A transaction signed on a fork is valid on mainnet if its nonce is free. | By construction. | The rehearsal sets the agent's fork nonce to 1,000,000 before signing anything. |

## Upstream

| Found | Where | What we did |
|---|---|---|
| Celo's MCP server returned no stablecoin balances on Celo Sepolia (it queried mainnet addresses), and zero balances on mainnet (its decoder read Multicall3's raw bytes as a hex string). | `celo-org/celo-mcp` issue #46, and a second bug we found while fixing it | [celo-org/celo-mcp#49](https://github.com/celo-org/celo-mcp/pull/49): both fixed, 4 offline tests that fail on `main`, checked live against Blockscout on both networks. |
