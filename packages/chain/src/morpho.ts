// Read-only view of the Morpho Blue wARS/USDT market on Ethereum: the borrow rate its interest model gives right
// now and the wARS free to borrow. Read on chain, so no third-party API sits between us and the number.
import { createPublicClient, fallback, http, parseAbi, type PublicClient } from "viem";
import { mainnet } from "viem/chains";

export const MORPHO = {
  blue: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  warsUsdtMarket: "0x8e6271e428ee5b41c98a3765919e359f16b0c6261c85d84f9b9b8b5242ab9c9e",
} as const;

const blueAbi = parseAbi([
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
]);
const irmAbi = parseAbi([
  "function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)",
]);

export function ethPublicClient(env: NodeJS.ProcessEnv = process.env): PublicClient {
  const urls = [env.ETH_RPC_URL, env.ETH_RPC_URL_2].filter((u): u is string => Boolean(u));
  if (urls.length === 0) urls.push("https://ethereum-rpc.publicnode.com");
  const transport = urls.length === 1 ? http(urls[0]) : fallback(urls.map((u) => http(u)));
  return createPublicClient({ chain: mainnet, transport }) as unknown as PublicClient;
}

export async function morphoWarsMarket(eth: PublicClient) {
  const [p, m] = await Promise.all([
    eth.readContract({ address: MORPHO.blue, abi: blueAbi, functionName: "idToMarketParams", args: [MORPHO.warsUsdtMarket] }),
    eth.readContract({ address: MORPHO.blue, abi: blueAbi, functionName: "market", args: [MORPHO.warsUsdtMarket] }),
  ]);
  const params = { loanToken: p[0], collateralToken: p[1], oracle: p[2], irm: p[3], lltv: p[4] };
  const state = { totalSupplyAssets: m[0], totalSupplyShares: m[1], totalBorrowAssets: m[2], totalBorrowShares: m[3], lastUpdate: m[4], fee: m[5] };
  const ratePerSecond = await eth.readContract({ address: p[3], abi: irmAbi, functionName: "borrowRateView", args: [params, state] });
  return { ratePerSecond, freeWars: m[0] - m[2] };
}
