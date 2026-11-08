# Judges' guide: five minutes

Everything below runs on Celo mainnet with real wARS. Site: **https://adelanto-99-80-93-71.sslip.io** (Spanish
first; add `?lang=en` or use the switch at the top for English).

## 1. No wallet (1 minute)

Open the [home page](https://adelanto-99-80-93-71.sslip.io). Under the first screen, the agent's block shows whether it is running (when it last
checked the loans), a real rule signed on Celo in the borrower's own words, and the last things the agent did, each
with its transaction.

Open [loan #2](https://adelanto-99-80-93-71.sslip.io/prestamo/2). Its borrower (one of our wallets) wrote the rule *"Uso los pesos para el kiosco.
Cuando me entren pesos de ventas, pagá el préstamo con eso. Nunca vendas mis dólares."* When 300 and then 100 wARS
reached that wallet, the agent repaid the loan on its own, through `LoanGuard`, and its second action quotes the
rule word for word ([`0x1436a0e4…`](https://celoscan.io/tx/0x1436a0e4ebad5b111073ed1ee24fd4b2b3163095def49f08615b8df8201f356b), [`0xcd28659c…`](https://celoscan.io/tx/0xcd28659c76d26850c0179240f42efc5763586e499f2c03772685e4e7b0e2622a)).

Open [`/probar`](https://adelanto-99-80-93-71.sslip.io/probar). The first step links the newest closed loan the agent
acted on. Every loan page, [loan #1](https://adelanto-99-80-93-71.sslip.io/prestamo/1) included, shows the pesos borrowed, the dollars left
as guarantee, the rate, every transaction with a link to the explorer, and the state read from chain.

The same loan as JSON, read from chain on each request:

```sh
curl -s https://adelanto-99-80-93-71.sslip.io/api/loan/1
```

## 2. Transparency (1 minute)

Open [`/transparencia`](https://adelanto-99-80-93-71.sslip.io/transparencia): pool deposits, pesos lent, use, the
reserve, every contract address, and every loan split into ours, judges' and other people's. Our own wallets are
listed so nothing of ours is counted as a user.

## 3. Take a real loan (3 minutes)

You need about **US$ 1.25 in USDT on Celo**, in MiniPay or any Celo wallet.

**In MiniPay:** Settings → About → tap the version number until developer mode turns on → Developer settings →
Load test page → `https://adelanto-99-80-93-71.sslip.io/probar`. MiniPay pays the network cost in USDT.

**In a browser wallet** (MetaMask, Rabby, Valora): open the same address on Celo mainnet. You also need a little
CELO for gas.

Then:

1. On `/probar`, press **Pedir $ 1.000** (Borrow ARS 1,000). The wallet asks for one free signature (a USDT permit)
   and then one transaction. 997.50 wARS arrive in your wallet (1,000 minus the 0.25% fee); about US$ 1 of USDT is
   held as guarantee.
2. You land on your loan's page. Press **Cuidar mi préstamo** (Look after my loan). Under **Decíselo con tus
   palabras**, write or dictate a rule in Spanish, for example *"si me entran pesos pagá el préstamo, máximo 500
   por día, y nunca vendas mis dólares"*, and press the button. If an amount is missing, the page asks one question
   with buttons; otherwise it reads every number back (and says if it lowered one to fit your loan). Or pick a
   preset. Press **Firmar** (Sign): the wallet approves exactly a week of the daily limits to `LoanGuard` and sends
   one `setLimits` transaction with the keccak256 hash of your exact words. The page shows the words next to the
   hash on chain so anyone can check they match. **Quitarle el permiso al agente** takes it all back.
   To see the agent act, use a rule that repays when pesos arrive, then send a few wARS to your wallet from
   another one: within a few minutes the agent repays that much of your loan (inside your daily cap), and its
   message on the loan page quotes your rule.
3. Press **Pagar todo** (Repay all): one free signature (a wARS permit) and one transaction repay the loan, and your
   dollars come back in the same transaction. The loan pays out pesos minus the opening fee and owes pesos plus
   interest, so if your wallet holds only the borrowed pesos it is a few pesos short: the page then covers that gap
   with a few cents of your spare USD₮ (one approval and one swap-and-repay transaction through the pool) before the
   rest, and sends back any pesos beyond the debt.
4. Open [**Mi historial**](https://adelanto-99-80-93-71.sslip.io/historial) (in MiniPay it opens on your wallet; elsewhere press **Usar mi
   billetera** or paste an address). It reads your record from `CreditBook`: your step (0 to 3), what each step
   unlocks, how many on-time loans the next one needs, and your loans with what the agent did on them. A loan held
   less than 7 days is repaid on time but does not count towards a step, so this one shows on the record without
   moving you up. Under **Lo que te dijo el agente** are its messages to your wallet, and every Sunday at 20:00
   (Buenos Aires) the summary of your week.
5. Back on the closed loan's page, **Calificá al agente** (Rate the agent): tap 1 to 5 stars and sign one
   transaction. It writes ERC-8004 feedback to agent #10043 on Celo's ReputationRegistry with your loan page as the
   evidence. Only the loan's own wallet can rate it; our wallets never get the prompt, and the registry itself
   refuses ratings from the agent's owner. The home page and Transparencia then show the average, counting only
   ratings from wallets that closed a loan.

Every transaction the site builds carries the event's attribution tag.

## 4. Agents and code (optional)

```sh
curl -s https://adelanto-99-80-93-71.sslip.io/llms.txt            # what it is, contracts, how to check each claim
curl -s https://adelanto-99-80-93-71.sslip.io/api/public/rates    # rates, free pesos, pesos lent, from chain
curl -s https://adelanto-99-80-93-71.sslip.io/api/me/<address>    # a wallet's loans, credit record and rule
curl -s https://adelanto-99-80-93-71.sslip.io/x402                # what other agents can buy, and the prices
curl -si https://adelanto-99-80-93-71.sslip.io/x402/peso-rate | head -1   # HTTP 402: pay to read
curl -s https://adelanto-99-80-93-71.sslip.io/api/public/prices?hours=24  # the agent's once-a-minute price check
```

**MCP**: `https://adelanto-99-80-93-71.sslip.io/mcp` (Streamable HTTP, no key). Tools: `rates`, `price_history`,
`quote`, `credit_record`, `loan_status`, and `build_borrow` / `build_repay`, which return unsigned transactions
with our tag for your own wallet to sign.

Other agents pay ADELANTO over **x402**, settled by Celo's own facilitator into the agent wallet: 8 wARS (or
US$0.005 in USD₮) for the peso rate checked against Binance and dolarapi, 15 wARS (or US$0.01) for a firm borrow quote
or a wallet's credit record. The first two paid calls: [`0x8413548c…`](https://celoscan.io/tx/0x8413548ce9ed00b89f43a67a01885b9081eea1f0957e16a479c46a2fffebe335) (8 wARS) and [`0x7ade1408…`](https://celoscan.io/tx/0x7ade1408800fdd6700c94dae8ae1f05fbd734bbf775b484b12e34d4586e70344) (US$0.01). To buy one yourself
with a funded Celo key (a wARS payer needs no CELO; the facilitator sponsors the permit):

```sh
BUYER_KEY_FILE=path/to/key node scripts/x402-buy.ts https://adelanto-99-80-93-71.sslip.io/x402/peso-rate wars
```

The agent also **buys**: through [buy](https://usebuy.ai) it pays Chainstack's Celo node US$0.01 in USD₮ over x402 for
a second read of the chain before it moves money, and once a day for the pool's books. The first purchase:
[`0xb31f9ca9…`](https://celoscan.io/tx/0xb31f9ca9ce650470f04832fc83195e29d9cc70880057b941184a0d6d66761b40); each one is a
receipt in [`evidence/buy/purchases.json`](../evidence/buy/purchases.json) and the latest is on Transparencia.

The agent's identity is ERC-8004 #10043 in Celo's registry; its card is
[`agent/registration.json`](../agent/registration.json).

Repo:

```sh
git clone https://github.com/Jennycruzy/adelanto && cd adelanto
npm ci && npm test                          # 296 tests, offline (forge build first for the ABI check)
npm run verify                              # every loan, the counts and the tags, from Celo alone
npm run audit:attribution                   # re-checks the tag on every transaction of ours
cd contracts && forge test --no-match-path 'test/fork/*'   # Solidity tests without an RPC
```

## Where to look for each criterion

| Criterion | Look at |
|---|---|
| Works on mainnet with a real wFIAT token | Loan #1's page; [docs/verification.md](verification.md); [evidence/attribution-audit.json](../evidence/attribution-audit.json) |
| Real use of wFIAT and the Celo stack | wARS is the loan; MiniPay; ERC-8004 #10043; the tag on every transaction; x402 through Celo's facilitator, paid in wARS ([catalog](https://adelanto-99-80-93-71.sslip.io/x402)); buy, paying Chainstack's node for a second read; the MCP server; ratings in the ERC-8004 ReputationRegistry; the Uniswap price; Ripio's off-ramp on every open loan; Ripio's bridge in the [Ethereum round trip](verification.md#ethereum-round-trip) |
| The agent is autonomous and useful | [Loan #2](https://adelanto-99-80-93-71.sslip.io/prestamo/2): the agent repaid it on its own, quoting the rule; the home page's live block; [docs/agent.md](agent.md); the rule step on your own loan page |
| A real person can use it | Steps 3.1 to 3.4 above, in MiniPay, in Spanish, amounts in pesos, the rule in your own words or by voice |
| Impact for LatAm | The README's first lines and [docs/data.md](data.md): a bank charges 64.63%, the pool 22–36% |
