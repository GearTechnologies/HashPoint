import * as dotenv from "dotenv";
import path from "path";
// In local dev the .env lives at the workspace root; in production (Render)
// env vars are injected directly so this is a no-op when the file is absent.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import http from "http";
import { ethers } from "ethers";
import { RelayService } from "./relay/RelayService";
import { EventIndexer } from "./indexer/EventIndexer";
import { createApi } from "./api/router";
import { Pool } from "pg";

const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.HASHKEY_MAINNET_RPC || "https://mainnet.hsk.xyz";
const RELAY_PRIVATE_KEY = process.env.RELAY_WALLET_PRIVATE_KEY || "";
const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "").trim();
const DB_URL = process.env.DATABASE_URL || "";

// Minimal ABI for the relay
const ESCROW_ABI = [
  "function settleBatch((address merchant, address customer, address token, uint256 amount, uint256 sessionId, bytes32 nonce, uint256 expiry, bytes32 merchantRef, uint256 chainId)[] intents, bytes[] sigs, bytes32[][] merkleProofs) external payable",
  "event PaymentSettled(address indexed merchant, address indexed customer, address token, uint256 amount, bytes32 merchantRef, uint256 sessionId, bytes32 nonce)",
  "event BatchSettled(address indexed merchant, uint256 count, uint256 totalAmount, address token)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  if (!RELAY_PRIVATE_KEY) {
    console.warn("RELAY_WALLET_PRIVATE_KEY not set — relay will not submit transactions");
  }

  const relaySigner = RELAY_PRIVATE_KEY
    ? new ethers.Wallet(RELAY_PRIVATE_KEY, provider)
    : ethers.Wallet.createRandom().connect(provider);

  const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);

  const relayService = new RelayService(provider, relaySigner, escrowContract);

  // Start periodic batch submission every 30s
  setInterval(() => {
    relayService.submitQueued().catch(console.error);
  }, 30_000);

  const app = createApi(relayService);

  // Optionally start the indexer
  if (DB_URL) {
    const db = new Pool({ connectionString: DB_URL });
    const indexer = new EventIndexer(provider, escrowContract, db);
    await indexer.initDb();
    const fromBlock = process.env.INDEXER_FROM_BLOCK
      ? parseInt(process.env.INDEXER_FROM_BLOCK, 10)
      : await provider.getBlockNumber();
    indexer.syncHistorical(fromBlock).catch((err) =>
      console.warn("Historical sync failed (non-fatal):", err.shortMessage ?? err.message)
    );
    indexer.start();
  }

  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`HashPoint relay server running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
