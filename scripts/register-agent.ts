// Registers the agent's ERC-8004 identity on Celo from the agent wallet, tagged like every other transaction,
// and writes the new agent id into agent/registration.json. Refuses if the wallet already owns an identity.
// Env: ATTRIBUTION_TAG, AGENT_KEY_FILE, CELO_RPC_URL (optional).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAbi, parseEventLogs } from "viem";
import { CELO, attributionCode, carriesCode, celoPublicClient, celoWalletClient } from "../packages/chain/src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cardPath = join(root, "agent", "registration.json");
const AGENT_URI = "https://raw.githubusercontent.com/Jennycruzy/adelanto/main/agent/registration.json";
const abi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const key = process.env.AGENT_KEY_FILE;
if (!key) throw new Error("AGENT_KEY_FILE is required");
const code = attributionCode();
const pub = celoPublicClient();
const wallet = celoWalletClient(key, code);
const me = wallet.account.address;

const owned = await pub.readContract({ address: CELO.identityRegistry, abi, functionName: "balanceOf", args: [me] });
if (owned > 0n) throw new Error(`${me} already owns ${owned} identity; not registering twice`);

const res = await fetch(AGENT_URI);
if (!res.ok) throw new Error(`agent card not reachable at ${AGENT_URI}: ${res.status}`);
await res.json();

const hash = await wallet.writeContract({ address: CELO.identityRegistry, abi, functionName: "register", args: [AGENT_URI] });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`register reverted: ${hash}`);
const tx = await pub.getTransaction({ hash });
if (!carriesCode(tx.input, code)) throw new Error(`register landed without the attribution tag: ${hash}`);
const minted = parseEventLogs({ abi, logs: receipt.logs, eventName: "Transfer" }).find((l) => l.args.to === me);
if (!minted) throw new Error("no identity minted to the agent wallet");
const agentId = minted.args.tokenId;

const card = JSON.parse(readFileSync(cardPath, "utf8"));
card.registrations = [{ agentId: Number(agentId), agentRegistry: `eip155:${CELO.chainId}:${CELO.identityRegistry}` }];
writeFileSync(cardPath, JSON.stringify(card, null, 2) + "\n");
console.log(JSON.stringify({ agentId: agentId.toString(), tx: hash, block: receipt.blockNumber.toString(), uri: AGENT_URI, tagged: true }));
