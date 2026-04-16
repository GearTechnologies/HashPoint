import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

export const hashkeyTestnet = defineChain({
  id: 133,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL || "https://testnet.hsk.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "HashKey Explorer",
      url: "https://testnet.hashkeyscan.io",
    },
  },
  testnet: true,
});

// WalletConnect project ID — register a free one at https://cloud.walletconnect.com
// Without a real projectId, WalletConnect wallets are disabled; injected wallets (MetaMask) still work.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000";

export const wagmiConfig = getDefaultConfig({
  appName: "HashPoint",
  projectId,
  chains: [hashkeyTestnet],
  ssr: true,
});
