// How another agent pays ADELANTO for an answer, over x402 on Celo mainnet. Pays in wARS (Permit2, the facilitator
// sponsors the permit, so the buyer needs no CELO) or in USD₮ (EIP-3009).
//   BUYER_KEY_FILE=path/to/key  node scripts/x402-buy.ts [url] [wars|usdt]
// Default url: the peso-rate endpoint on the public site. Prints the answer and the settlement transaction.
import { readFileSync } from "node:fs";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const NETWORK = "eip155:42220";
const WARS = getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D");
const USDT = getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e");
const url = process.argv[2] ?? "https://adelanto.space/x402/peso-rate";
const pay = (process.argv[3] ?? "wars") === "usdt" ? USDT : WARS;

const account = privateKeyToAccount(readFileSync(process.env.BUYER_KEY_FILE!, "utf8").trim() as Hex);
const client = new x402Client((_v, reqs) => reqs.find((r: any) => getAddress(r.asset) === pay) ?? reqs[0]);
client.setSpendControls({
  // caps per payment, in each asset's own base units: at most 20 wARS or US$0.02
  allowedAssets: [
    { network: NETWORK, asset: WARS, maxAmountPerPayment: (20n * 10n ** 18n).toString() },
    { network: NETWORK, asset: USDT, maxAmountPerPayment: "20000" },
  ],
});
client.register("eip155:*", new ExactEvmScheme(account, { rpcUrl: process.env.CELO_RPC_URL ?? "https://forno.celo.org" }));
const payFetch = wrapFetchWithPayment(fetch, client);

const res = await payFetch(url);
const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
console.log("status", res.status, "buyer", account.address);
console.log(JSON.stringify(await res.json().catch(() => null), null, 2));
if (header) console.log("settlement", JSON.stringify(decodePaymentResponseHeader(header)));
