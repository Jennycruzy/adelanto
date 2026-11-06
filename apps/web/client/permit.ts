// The EIP-2612 permit message the wallet signs. Shared by the browser code and the fork test, so the test checks
// exactly what users sign. Token domains read on Celo mainnet: USDT "Tether USD" v1, wARS "Peso Argentino" v1.
import type { Address } from "viem";

export const PERMIT_DOMAINS = {
  usdt: { name: "Tether USD", version: "1" },
  wars: { name: "Peso Argentino", version: "1" },
} as const;

export function permitTypedData(token: Address, name: string, owner: Address, spender: Address, value: bigint, nonce: bigint, deadline: bigint) {
  return {
    domain: { name, version: "1", chainId: 42220, verifyingContract: token },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit" as const,
    message: { owner, spender, value: value.toString(), nonce: nonce.toString(), deadline: deadline.toString() },
  };
}
