import { readFileSync } from "node:fs";
import { fromDataSuffix, toDataSuffix, withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, fallback, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

/** Celo tokens and pools the app reads and writes. */
export const CELO = {
  chainId: 42220,
  wars: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D",
  usdt: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  usdtFeeAdapter: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
  uniswapWarsUsdt: "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391",
  identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
} as const;

const CODE_PATTERN = /^[a-z0-9_]{1,32}$/;

/**
 * Reads the attribution code from ATTRIBUTION_TAG. Throws when it is missing or malformed, so nothing that
 * sends a transaction can start without it.
 */
export function attributionCode(env: NodeJS.ProcessEnv = process.env): string {
  const code = env.ATTRIBUTION_TAG?.trim();
  if (!code) throw new Error("ATTRIBUTION_TAG is not set: refusing to build a wallet that sends untagged transactions");
  if (!CODE_PATTERN.test(code)) throw new Error(`ATTRIBUTION_TAG "${code}" is not a valid ERC-8021 code`);
  toDataSuffix(code); // same validation the wire encoder applies
  return code;
}

/** The suffix every transaction we send ends with. */
export function attributionSuffix(code: string): Hex {
  return toDataSuffix(code) as Hex;
}

/** True when the calldata (or init code) ends with a tag that carries this code. */
export function carriesCode(data: Hex, code: string): boolean {
  const decoded = fromDataSuffix(data);
  return decoded !== null && decoded.codes.includes(code);
}

export function celoTransport(env: NodeJS.ProcessEnv = process.env) {
  const urls = [env.CELO_RPC_URL, env.CELO_RPC_URL_2].filter((u): u is string => Boolean(u));
  // forno is load-balanced across nodes at different heights; publicnode answers consistently, forno is the fallback
  if (urls.length === 0) urls.push("https://celo-rpc.publicnode.com", "https://forno.celo.org");
  return urls.length === 1 ? http(urls[0]) : fallback(urls.map((u) => http(u)));
}

export function celoPublicClient(env: NodeJS.ProcessEnv = process.env): PublicClient {
  return createPublicClient({ chain: celo, transport: celoTransport(env) }) as unknown as PublicClient;
}

/** Keys are read from files (mode 600), never from environment values. */
export function accountFromKeyFile(path: string) {
  const key = readFileSync(path, "utf8").trim() as Hex;
  return privateKeyToAccount(key);
}

/**
 * The only way the app builds a Celo wallet client: every sendTransaction and writeContract it makes carries
 * the attribution tag, including contract creation sent through sendTransaction.
 */
export function celoWalletClient(keyFile: string, code: string = attributionCode(), env: NodeJS.ProcessEnv = process.env) {
  const account = accountFromKeyFile(keyFile);
  return createWalletClient({ account, chain: celo, transport: celoTransport(env) }).extend(withAttribution(code));
}
export * from "./contracts.ts";
export * from "./sender.ts";
export * from "./morpho.ts";
