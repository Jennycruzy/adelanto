# Judges' guide: five minutes

Everything below runs on Celo mainnet with real wARS. Site: **https://adelanto-99-80-93-71.sslip.io** (Spanish
first; add `?lang=en` or use the switch at the top for English).

## 1. No wallet (1 minute)

Open [`/probar`](https://adelanto-99-80-93-71.sslip.io/probar). The first step links a real closed loan
([loan #1](https://adelanto-99-80-93-71.sslip.io/prestamo/1)). Its page shows the pesos borrowed, the dollars left
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
2. You land on your loan's page. Press **Cuidar mi préstamo** (Look after my loan): pick a preset or write your
   limits, read the rule back in plain words, and press **Firmar** (Sign). The wallet approves exactly a week of
   the daily limits to `LoanGuard` and sends one `setLimits` transaction with the hash of the rule's words. The page
   shows the words next to the hash on chain so anyone can check they match. **Quitarle el permiso al agente**
   takes it all back.
3. Press **Pagar todo** (Repay all): one free signature (a wARS permit) and one transaction repay the loan, and your
   dollars come back in the same transaction.

Every transaction the site builds carries the event's attribution tag.

## 4. Agents and code (optional)

```sh
curl -s https://adelanto-99-80-93-71.sslip.io/llms.txt            # what it is, contracts, how to check each claim
curl -s https://adelanto-99-80-93-71.sslip.io/api/public/rates    # rates, free pesos, pesos lent, from chain
curl -s https://adelanto-99-80-93-71.sslip.io/api/me/<address>    # a wallet's loans, credit record and rule
```

The agent's identity is ERC-8004 #10043 in Celo's registry; its card is
[`agent/registration.json`](../agent/registration.json).

Repo:

```sh
git clone https://github.com/Jennycruzy/adelanto && cd adelanto
npm ci && npm test                          # 137 tests, offline
npm run audit:attribution                   # re-checks the tag on every transaction of ours
cd contracts && forge test --no-match-path 'test/fork/*'   # Solidity tests without an RPC
```

## Where to look for each criterion

| Criterion | Look at |
|---|---|
| Works on mainnet with a real wFIAT token | Loan #1's page; [docs/verification.md](verification.md); [evidence/attribution-audit.json](../evidence/attribution-audit.json) |
| Real use of wFIAT and the Celo stack | wARS is the loan; MiniPay; ERC-8004 #10043; the tag on every transaction; the Uniswap price; Ripio's bridge in the [Ethereum round trip](verification.md#ethereum-round-trip) |
| The agent is autonomous and useful | [docs/agent.md](agent.md); the rule step on your own loan page |
| A real person can use it | Steps 3.1 to 3.3 above, in MiniPay, in Spanish, amounts in pesos |
| Impact for LatAm | The README's first lines and [docs/data.md](data.md): a bank charges 64.63%, the pool 22–36% |
