# Security policy

ADELANTO's contracts hold real money on Celo mainnet. If you find a way to move funds that should not move, to
block repayment or withdrawal, or to make the agent act outside a borrower's signed limits, please report it
privately through GitHub: **Security → Report a vulnerability** on this repository. Please do not open a public
issue for it.

Include the contract or file, the steps, and the impact you expect. We reply within 48 hours.

How the contracts protect money, every role and every external function: [docs/security.md](docs/security.md).
How the agent is bounded and how it sends: [docs/agent.md](docs/agent.md).

## Scope

| In scope | Address |
|---|---|
| `PesoPool` | `0xCfeafCDd06d3a0E3Bf1596F8Afa1caC1Dc19ed60` |
| `LoanGuard` | `0x26c9f3D79f3C835ee74c95A94a701e93f24bEbD3` |
| `CreditBook` | `0x7dF4182c3a7D7b25aE2D79a801D9502B2568fee1` |
| `PriceModule` | `0xBC6aa0BC458E01A7A32955DC106F9775569A6355` |
| `GentleKeeper` | `0xcd98B9669708F0d193c975B0900169890d6Dd0fE` |
| The agent (`apps/agent`, `packages/*`) and the site (`apps/web`) | — |

wARS (Ripio), USDT, Uniswap, Morpho and the bridges are outside our control; report issues in them to their owners.
