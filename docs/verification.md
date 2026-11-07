# Verification: every transaction and how to check it

Everything here can be checked on a public explorer with no account. The addresses and hashes come from
[`deployments/celo.json`](../deployments/celo.json) and our logs, generated, not typed.

## Attribution

Every transaction from our wallets and contracts since the event issued our code carries the ERC-8021 suffix
`celo_0e96c1ff3fa8`, contract creations included. [`evidence/attribution-audit.json`](../evidence/attribution-audit.json)
lists each one with its input data read back from chain: **44 transactions, 36 tagged, 8 sent before the code was
issued, 0 untagged after it**. Re-run it:

```sh
npm run audit:attribution
```

To check one by hand, open a transaction on Blockscout and look at the end of its input data: it ends with
`63656c6f5f306539366331666633666138` (`celo_0e96c1ff3fa8` in ASCII), a length byte, a schema byte and the ERC-8021
marker, `8021` repeated.

## Contracts

All five are verified with an exact match on [Sourcify](https://sourcify.dev/) and on Blockscout. Each contract's
constructor arguments and links are read back after deploy (`scripts/deploy-celo.ts`): the pool's price module,
credit book, guardian, treasury, owner and asset; the credit book's pool; the guard's and `GentleKeeper`'s agent and
pool. The deploy stops if any read-back differs.

## Deployment

| Step | Address | Transaction | Gas |
|---|---|---|---|
| PriceModule | [`0xBC6aa0BC458E01A7A32955DC106F9775569A6355`](https://celoscan.io/address/0xBC6aa0BC458E01A7A32955DC106F9775569A6355) | [`0xb61c2b6d…`](https://celoscan.io/tx/0xb61c2b6d8b09bf95550fdd947778bc8b03939eb9c662cd148dbc59b5c0130678) | 2,188,255 |
| CreditBook | [`0x7dF4182c3a7D7b25aE2D79a801D9502B2568fee1`](https://celoscan.io/address/0x7dF4182c3a7D7b25aE2D79a801D9502B2568fee1) | [`0x4d6f7349…`](https://celoscan.io/tx/0x4d6f734947024707c03486d6afb006079cecda3ead83cdb696304924c72e297a) | 569,871 |
| PesoPool | [`0xCfeafCDd06d3a0E3Bf1596F8Afa1caC1Dc19ed60`](https://celoscan.io/address/0xCfeafCDd06d3a0E3Bf1596F8Afa1caC1Dc19ed60) | [`0xc78058d8…`](https://celoscan.io/tx/0xc78058d8c4623ef4b2457f1f260f2589e090e820153b20c794503d7b9ee0a1b7) | 4,828,582 |
| CreditBook.bindPool | — | [`0xec8b973a…`](https://celoscan.io/tx/0xec8b973a358cb99b122af80a3024a5b3b1245dc8a3e1cdea4a46f0885b910307) | 45,672 |
| LoanGuard | [`0x26c9f3D79f3C835ee74c95A94a701e93f24bEbD3`](https://celoscan.io/address/0x26c9f3D79f3C835ee74c95A94a701e93f24bEbD3) | [`0xe091e0c9…`](https://celoscan.io/tx/0xe091e0c93d6e7eb1c8d72ef8a8a2f328845002e2247c7fa4fd25dd867e07cf0b) | 1,222,684 |
| GentleKeeper | [`0xcd98B9669708F0d193c975B0900169890d6Dd0fE`](https://celoscan.io/address/0xcd98B9669708F0d193c975B0900169890d6Dd0fE) | [`0xa697e3fa…`](https://celoscan.io/tx/0xa697e3fa3b145ed4f0c7fc90071d5562703b16d27f4217520ff3cf7e9b4e9582) | 811,913 |

## Agent identity

| Step | Transaction |
|---|---|
| ERC-8004 registration, agent #10043 | [`0xf0bbf26a…`](https://celoscan.io/tx/0xf0bbf26a35801ff47b3e343078cb3d97ef964166f83b458b8104bee88b533795) |

## Pool seed and loan #1

All from the agent wallet, which is ours and labelled ours on the transparency page.

| Time (UTC, 6 Nov) | Step | Transaction | Gas |
|---|---|---|---|
| 08:11:29 | approve CELO for the swap | [`0x82764e6f…`](https://celoscan.io/tx/0x82764e6fbc9cc3feb5d078cb5886fa1a6f20c9aa9cb80c9084e0e7995e69fc06) | 52,180 |
| 08:11:31 | swap 26.93 CELO to 3,053 wARS (Uniswap) | [`0xd05491bd…`](https://celoscan.io/tx/0xd05491bd5378374d48a4375981d3e1284f127c296b54cc8504aad54c79c2a16e) | 221,670 |
| 08:11:33 | approve USDT for the swap | [`0xa3c7c736…`](https://celoscan.io/tx/0xa3c7c73638d3f6d2ff87f28900fe8d9590e05bac18dffb7a87d65f0659417f6d) | 53,953 |
| 08:11:35 | swap 1.55 USDT to 2,565 wARS (Uniswap) | [`0x345c7fd0…`](https://celoscan.io/tx/0x345c7fd0425fae0377d31f69226080f2e2568a473ff24276d5bb72c7e8ad183b) | 128,144 |
| 08:11:37 | approve wARS to the pool | [`0xd86894a5…`](https://celoscan.io/tx/0xd86894a5de588c9bce2b3fc2d82a558d628dabf638a15bda576f782606f37845) | 51,981 |
| 08:11:41 | lend 3,052.25 wARS into the pool | [`0xd27c7912…`](https://celoscan.io/tx/0xd27c79121bb11b8ec32cb492c849d37fa2744adad1544f113061cc25de466c2a) | 180,881 |
| 08:12:01 | approve wARS to the pool | [`0xd1bd95d8…`](https://celoscan.io/tx/0xd1bd95d88421f62094b690acb914ac342b4e536e05e812ee994a552f36e185f2) | 51,981 |
| 08:12:04 | lend 2,564.61 wARS into the pool | [`0x49046ee4…`](https://celoscan.io/tx/0x49046ee489059c942f38df26b58249b5c20582f6cc943084e85e4dde734f5621) | 107,931 |
| 08:13:07 | approve USDT to the pool | [`0xe10d1806…`](https://celoscan.io/tx/0xe10d18064c046bedbdb88e779d65076b4215b2bee6bc27912d53fc59febf6e7e) | 53,953 |
| 08:13:09 | **borrow 1,000 wARS against 1.3 USDT, 7 days** (loan #1, 25.11% a year, fee 2.5 wARS) | [`0xbb9cb944…`](https://celoscan.io/tx/0xbb9cb9444206e661b855364ebf94ccb6760f8beb692282a33faa80a1eb4c62c5) | 441,788 |
| 08:13:12 | add 0.2 USDT | [`0xd182023e…`](https://celoscan.io/tx/0xd182023e86eca482b3b8c2a4481ed957974c23003503ff814beed8c4bff0b6f6) | 74,867 |
| 08:13:15 | take back 0.2 USDT | [`0x365bb44f…`](https://celoscan.io/tx/0x365bb44f2d915916854f7c2ba2940f91fe84c891e0ac2c9158e5fb46b06c212f) | 185,267 |
| 08:13:17 | approve wARS to the pool | [`0x9f47b322…`](https://celoscan.io/tx/0x9f47b32253b1653a66a37582f76ad98dc1a4a1b63b897fe11370299e848d5ef6) | 51,957 |
| 08:13:19 | **repay 500 wARS in pesos** | [`0x470ffd10…`](https://celoscan.io/tx/0x470ffd10673083bfc9a8df0801da0a0a4356ac91a4b02888bb95a0ff143aaa3b) | 161,167 |
| 08:14:07 | approve USDT to the pool | [`0xbbe21d4b…`](https://celoscan.io/tx/0xbbe21d4b09969561f54932e22c8f0c0f1653f95c241916e3fcec7da04a7330c5) | 36,853 |
| 08:14:51 | **repay the rest with 0.31 USDT in one transaction (`repayWithSwap`), loan closed, dollars returned** | [`0xc2843c39…`](https://celoscan.io/tx/0xc2843c39f8f9444e44427370cfee8c820e6b6410ed81d5b671948f0baf06536c) | 244,040 |
| 08:14:53 | **lender withdraws 100 wARS** | [`0x9cc2e069…`](https://celoscan.io/tx/0x9cc2e069c6015bfec97457b4813aed8dc75a3b3b1a3deede1f074c68dda38116) | 116,453 |

## Ethereum round trip

Real money, from the agent wallet on 5 Nov: 3.5 USDT to Ethereum, 3,000 wARS borrowed on Morpho, pesos to Celo through Ripio's bridge, then all of it back. It ran before the event issued our attribution code, so it carries no tag; its six Celo transactions and the two swaps that funded the wallet are the 8 the audit lists as sent before the code. Nothing since is untagged.

| Time (UTC, 5 Nov) | Chain | Step | Transaction |
|---|---|---|---|
| 18:51:10 | Celo | approve USDT to USDT0 | [`0xd46bb8f5…`](https://celoscan.io/tx/0xd46bb8f5672376bcb83e6e7e20adaeb5dbebaf7a39ddb384f408d1e4c2705709) |
| 18:51:25 | Celo | **send 3.5 USDT to Ethereum (USDT0)** | [`0x2eae1286…`](https://celoscan.io/tx/0x2eae128645748ee3f3aff0d7d927534bfa1eb6cccbe37dc2b41e26a3384772b1) |
| 18:53:04 | Ethereum | approve USDT to Morpho | [`0x392dac1c…`](https://etherscan.io/tx/0x392dac1c06b1d8e8e58d12538bfe45d18095e289a5ec8839a0b2b4f4698c687d) |
| 18:53:38 | Ethereum | **put 3.499 USDT on Morpho** | [`0x74c9eb1d…`](https://etherscan.io/tx/0x74c9eb1ddd585a405228173db97dde6d03b843a3aecde9817343b5b59056d5cc) |
| 18:53:51 | Ethereum | **borrow 3,000 wARS on Morpho** | [`0x32e03e2a…`](https://etherscan.io/tx/0x32e03e2af5aaf27db2b9db4cdf0ce0bb84c073b75ed0a52a12358043d5cc0165) |
| 18:54:17 | Ethereum | approve wARS to Ripio's bridge | [`0x11d8f12d…`](https://etherscan.io/tx/0x11d8f12d64bd69b0cddc182a9392e4dee0b75f4a12b4cc98ba0e3124dc5c849a) |
| 18:54:26 | Ethereum | **send 3,000 wARS to Celo (Ripio, fee 15 wARS)** | [`0x88df1ef3…`](https://etherscan.io/tx/0x88df1ef3069e8abdcbe1ee421996677f1a38223eebbd988b410aa47d2bda463f) |
| 21:35:16 | Celo | approve CELO for the swap (Relay) | [`0xa5d2385a…`](https://celoscan.io/tx/0xa5d2385aaa70194be873e9375c8ea1a807b923fbcdc3ce562c91058128cb3fc7) |
| 21:35:18 | Celo | buy 1,530 wARS for the return fee (Relay) | [`0xdc5b9ed6…`](https://celoscan.io/tx/0xdc5b9ed6fbef44af7c4b8477c7e7f5ed6146fd473f604e8745b337963775dd0a) |
| 21:35:24 | Celo | approve wARS to Ripio's bridge | [`0x39da3170…`](https://celoscan.io/tx/0x39da31702823237bbe165dc7a91e070dc320a12e4ae1873cfcbf81829c69490b) |
| 21:35:29 | Celo | **send the wARS back to Ethereum (Ripio, fee 1,500 wARS)** | [`0x27b30a86…`](https://celoscan.io/tx/0x27b30a86e5e757f0cc219142185bee1aa69dffe8fc56036e42d21d7360effbbb) |
| 21:36:52 | Ethereum | approve wARS to Morpho | [`0xb7378216…`](https://etherscan.io/tx/0xb7378216f20b9b53ca5705c3c520661c5798f197cc25114cb3df30ec8b31d032) |
| 21:37:28 | Ethereum | **repay the Morpho loan in full** | [`0xb7f7afe9…`](https://etherscan.io/tx/0xb7f7afe9a8ca26af2c26cd1ed48f868a96c3684af96b325ce33d6eb21f9d15fa) |
| 21:38:01 | Ethereum | **take the 3.499 USDT back** | [`0xca774ba7…`](https://etherscan.io/tx/0xca774ba709e74f05d9f41dafcd22945672cc8e5b2cf4dc31bdc45b57ab984ee2) |
| 21:38:26 | Ethereum | approve USDT to USDT0 | [`0x8d3eb81a…`](https://etherscan.io/tx/0x8d3eb81abdd789ef28f653433b876f3ca3d62322a54ca302709c10a3e3851331) |
| 21:38:39 | Ethereum | **send the USDT home to Celo (USDT0)** | [`0x68b29607…`](https://etherscan.io/tx/0x68b29607e347de3f7949b90f0084763c105a6d662cbded845b7fe881746e82f2) |


## The agent on mainnet

Loan #2, on 7 Nov, to show the agent acting on its own on a real loan. The borrower is our deployer wallet
(`0xF689…89BE`) and the "sales" come from the agent wallet; both are labelled ours. All tagged.

| Time (UTC) | Step | Transaction |
|---|---|---|
| 10:58 | agent wallet funds the guardian with 1 CELO for price pauses | [`0x100abbea…`](https://celoscan.io/tx/0x100abbea8a48d8cbcb06ee922bd6af09ea09aaad326644e00e22c801d3eb54f2) |
| 12:04 | 1.4 USDT to the borrower for the guarantee | [`0x9952b6bf…`](https://celoscan.io/tx/0x9952b6bf1579b4db2a8e1dfa6ceae202d179055f026d11839a1a84b1916bd65a) |
| 12:04 | borrower approves 1.3 USDT to the pool | [`0xd8fbc4e0…`](https://celoscan.io/tx/0xd8fbc4e0d86d168dc72767d909ced73063313b67d1b1a9aa8e82649ec35d978f) |
| 12:04 | **borrow 1,000 wARS against 1.3 USDT, 7 days** (loan #2, 25.17% a year) | [`0x6f343a7d…`](https://celoscan.io/tx/0x6f343a7da5b928a8a369053f5ee7317ad7ccaa970f47ca196e09998d1ea00206) |
| 12:04 | borrower approves 2,000 wARS to `LoanGuard` (a week of the daily cap, at most twice the debt) | [`0xca7aa231…`](https://celoscan.io/tx/0xca7aa23150943d97a2afc8f0f418827dcf256cd810eae705fd1d7722ddc74d96) |
| 12:04 | borrower approves 0.1 USDT to `LoanGuard` | [`0x19ce1461…`](https://celoscan.io/tx/0x19ce146145444227fe15e46f023a4e11b4cc805abc950143c47ac11096a0b36c) |
| 12:04 | **the rule, `setLimits`**: auto-repay on, up to 1,000 wARS a day, protect with pesos first; `ruleHash` `0x83aa0426…` = keccak256 of the words | [`0x78cb39dd…`](https://celoscan.io/tx/0x78cb39dd3e37b5f1c61a41ec97ab072d6d5202a2e550b667d9b0d8f3fc62d3c7) |
| 12:07 | a 300 wARS sale reaches the borrower | [`0xbfdf74ea…`](https://celoscan.io/tx/0xbfdf74ea21d1dfd6327529a616f2322c3a1ca46f21882431d898e8cd1ee926c3) |
| 12:14 | **the agent repays 300 wARS on its own** | [`0x1436a0e4…`](https://celoscan.io/tx/0x1436a0e4ebad5b111073ed1ee24fd4b2b3163095def49f08615b8df8201f356b) |
| 12:26 | a 100 wARS sale reaches the borrower | [`0xe1f9079e…`](https://celoscan.io/tx/0xe1f9079eb53772dcf6f4a49400e9db22ac736bd1108b92a833930a468d127726) |
| 12:28 | **the agent repays 100 wARS, quoting the rule** | [`0xcd28659c…`](https://celoscan.io/tx/0xcd28659c76d26850c0179240f42efc5763586e499f2c03772685e4e7b0e2622a) |

The words are *"Uso los pesos para el kiosco. Cuando me entren pesos de ventas, pagá el préstamo con eso. Nunca
vendas mis dólares."* Check the hash: `cast keccak "<the words>"` equals `LoanGuard.ruleHashOf(0xF689…89BE)`.

## x402 settlements

Paid by our deployer wallet to the agent wallet through Celo's facilitator, which submits the settlement from its
own wallet (so these are not in the attribution audit, which covers our wallets; ADELANTO's code is declared in
every 402 through the builder-code extension).

| Time (UTC, 7 Nov) | Bought | Paid | Transaction |
|---|---|---|---|
| 13:52 | `/x402/peso-rate` | 8 wARS (Permit2) | [`0x8413548c…`](https://celoscan.io/tx/0x8413548ce9ed00b89f43a67a01885b9081eea1f0957e16a479c46a2fffebe335) |
| 13:52 | `/x402/credit/0xF689…89BE` | US$0.01 in USD₮ (EIP-3009) | [`0x7ade1408…`](https://celoscan.io/tx/0x7ade1408800fdd6700c94dae8ae1f05fbd734bbf775b484b12e34d4586e70344) |

## Read a loan from chain

```sh
curl -s https://adelanto-99-80-93-71.sslip.io/api/loan/1
cast call 0xCfeafCDd06d3a0E3Bf1596F8Afa1caC1Dc19ed60 "debtOf(uint256)(uint256)" 1 --rpc-url https://forno.celo.org
```

A loan's full history is the pool's events for that loan id (`Borrowed`, `CollateralAdded`, `CollateralWithdrawn`,
`Repaid`, `Liquidated`); the loan page links its transactions.

## MiniPay

On 5 Nov 2026 at 17:24 UTC, on an iPhone (iOS 18.7) in MiniPay, a test page asked for four signatures and sent two
transactions. All four signatures (EIP-712 v4 for chain 42220 and for chain 1, v3, and `personal_sign`) recovered to
the wallet. Both transactions landed as Celo fee-currency transactions (type `0x7b`) with `feeCurrency` set by
MiniPay to the USDT adapter:

| Call | Transaction |
|---|---|
| wARS `approve(0x…dEaD, 0)`, a token MiniPay does not list | [`0x91a0c3af…`](https://celoscan.io/tx/0x91a0c3afd4577ba6fcf880bdd8dde2b69f9d209c4e1df5dc45903286cb7db9e8) |
| The wARS/USDT Uniswap v3 pool, a contract on no list | [`0x370cb109…`](https://celoscan.io/tx/0x370cb1091c2198b9b0bc05438576d18dd7732e84d7cfa3c98e6300de540df51c) |
