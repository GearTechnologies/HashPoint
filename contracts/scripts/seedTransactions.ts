/**
 * seedTransactions.ts
 * Creates on-chain seed payment transactions on HashKey testnet using the deployer wallet.
 * Run: cd contracts && npx hardhat run scripts/seedTransactions.ts --network hashkeyTestnet
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MerkleTree = require("merkletreejs").MerkleTree;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const keccak256 = require("keccak256");

dotenv.config({ path: path.join(__dirname, "../../.env") });

// ─── Contract addresses ────────────────────────────────────────────────────────
const ESCROW          = "0x21ab93a1494b1B0E3eafdB24E3703F12F8AfeC20";
const NONCE_REGISTRY  = "0xC5a2A6Dfc78DAcB4AAF474124Cb7f56360F23430";
const USDC            = "0x0a468e2506ff15a74c8D094CC09e48561969Aa12";
const USDT            = "0xCD84e9DCf43bB8b30C8c04cdD6f361781774cC15";
const CHAIN_ID        = 133;
const RPC_URL         = "https://testnet.hsk.xyz";

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const NONCE_REGISTRY_ABI = [
  "function openSession(bytes32 nonceRoot, uint256 durationSeconds, uint256 maxPayments) external returns (uint256)",
  "function currentSessionId(address) view returns (uint256)",
];

const ERC20_ABI = [
  "function faucet() external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function faucetClaimed(address) view returns (uint256)",
  "function FAUCET_LIMIT() view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const ESCROW_ABI = [
  "function settlePayment((address merchant,address customer,address token,uint256 amount,uint256 sessionId,bytes32 nonce,uint256 expiry,bytes32 merchantRef,uint256 chainId) intent, bytes sig, bytes32[] merkleProof) external payable",
];

// ─── EIP-712 types ────────────────────────────────────────────────────────────
const PAYMENT_INTENT_TYPES = {
  PaymentIntent: [
    { name: "merchant",     type: "address"  },
    { name: "customer",     type: "address"  },
    { name: "token",        type: "address"  },
    { name: "amount",       type: "uint256"  },
    { name: "sessionId",    type: "uint256"  },
    { name: "nonce",        type: "bytes32"  },
    { name: "expiry",       type: "uint256"  },
    { name: "merchantRef",  type: "bytes32"  },
    { name: "chainId",      type: "uint256"  },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a sorted-pair Merkle tree compatible with NonceRegistry._verifyMerkleProof */
function buildMerkleTree(nonces: string[]) {
  const leaves = nonces.map((n) => keccak256(Buffer.from(n.slice(2), "hex")));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = "0x" + tree.getRoot().toString("hex") as `0x${string}`;
  const getProof = (nonce: string): string[] => {
    const leaf = keccak256(Buffer.from(nonce.slice(2), "hex"));
    return tree.getHexProof(leaf);
  };
  return { root, getProof };
}

async function claimFaucet(contract: ethers.Contract, label: string, walletAddress: string) {
  try {
    const claimed = await contract.faucetClaimed(walletAddress);
    const limit   = await contract.FAUCET_LIMIT();
    if (claimed >= limit) {
      console.log(`  ${label}: faucet limit already reached, skipping`);
      return;
    }
  } catch { /* ignore read errors */ }
  const tx = await contract.faucet();
  await tx.wait();
  console.log(`  ${label}: faucet claimed`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY not set in .env");

  const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: CHAIN_ID, name: "hashkeyTestnet" });
  const wallet   = new ethers.Wallet(privateKey, provider);
  const deployer = wallet.address;
  console.log("Deployer:", deployer);

  const nativeBal = await provider.getBalance(deployer);
  console.log("HSK balance:", ethers.formatEther(nativeBal), "HSK");

  // ── 1. Faucet USDC and USDT ─────────────────────────────────────────────────
  console.log("\n1. Claiming test tokens from faucets...");
  const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet);
  const usdt = new ethers.Contract(USDT, ERC20_ABI, wallet);
  await claimFaucet(usdc, "USDC", deployer);
  await claimFaucet(usdt, "USDT", deployer);

  const usdcBal = await usdc.balanceOf(deployer);
  const usdtBal = await usdt.balanceOf(deployer);
  console.log(`  USDC balance: ${Number(usdcBal) / 1e6} USDC`);
  console.log(`  USDT balance: ${Number(usdtBal) / 1e6} USDT`);

  // ── 2. Approve escrow ───────────────────────────────────────────────────────
  console.log("\n2. Approving escrow for USDC and USDT...");
  const appUSDC = await usdc.approve(ESCROW, ethers.MaxUint256);
  await appUSDC.wait();
  console.log("  USDC approved");
  const appUSDT = await usdt.approve(ESCROW, ethers.MaxUint256);
  await appUSDT.wait();
  console.log("  USDT approved");

  // ── 3. Prepare nonces and open session ─────────────────────────────────────
  console.log("\n3. Preparing offline session nonces...");
  const NONCE_COUNT = 6;
  const nonces: string[] = Array.from({ length: NONCE_COUNT }, () =>
    ethers.hexlify(ethers.randomBytes(32))
  );
  const { root: nonceRoot, getProof } = buildMerkleTree(nonces);
  console.log("  Nonce root:", nonceRoot);

  const nonceReg  = new ethers.Contract(NONCE_REGISTRY, NONCE_REGISTRY_ABI, wallet);
  const sessionTx = await nonceReg.openSession(nonceRoot, 7200 /* 2 hours */, NONCE_COUNT);
  await sessionTx.wait();
  const sessionId = await nonceReg.currentSessionId(deployer);
  console.log("  Session ID:", sessionId.toString());

  // ── 4. Sign and settle payment intents ─────────────────────────────────────
  console.log("\n4. Creating and settling seed payments...");

  const escrow = new ethers.Contract(ESCROW, ESCROW_ABI, wallet);
  const domain = {
    name:              "HashPoint",
    version:           "1",
    chainId:           CHAIN_ID,
    verifyingContract: ESCROW,
  };

  const settle = async (
    label:   string,
    token:   string,
    amount:  bigint,
    nonce:   string,
    ref:     string,
    value:   bigint = 0n
  ) => {
    const expiry = Math.floor(Date.now() / 1000) + 7200;
    const intent = {
      merchant:    deployer,
      customer:    deployer,
      token,
      amount,
      sessionId,
      nonce,
      expiry,
      merchantRef: ethers.encodeBytes32String(ref),
      chainId:     CHAIN_ID,
    };

    // Sign using ethers wallet (no ENS because we use JsonRpcProvider with explicit network)
    const sig = await wallet.signTypedData(domain, PAYMENT_INTENT_TYPES, {
      ...intent,
      amount:    intent.amount.toString(),
      sessionId: intent.sessionId.toString(),
    });

    const proof = getProof(nonce);
    const tx = await escrow.settlePayment(intent, sig, proof, { value });
    const receipt = await tx.wait();
    console.log(`  ✓ ${label} — tx: ${receipt.hash}`);
  };

  // USDC payments
  await settle("Coffee (10 USDC)",       USDC,         10n * 10n ** 6n,  nonces[0], "COFFEE-001");
  await settle("Lunch (25 USDC)",        USDC,         25n * 10n ** 6n,  nonces[1], "LUNCH-001");
  await settle("Groceries (50 USDC)",    USDC,         50n * 10n ** 6n,  nonces[2], "GROCERIES-001");

  // USDT payments
  await settle("Dinner (30 USDT)",       USDT,         30n * 10n ** 6n,  nonces[3], "DINNER-001");
  await settle("Transport (5 USDT)",     USDT,          5n * 10n ** 6n,  nonces[4], "TRANSPORT-001");

  // Native HSK payment (small amount)
  const hskAmount = ethers.parseEther("0.001");
  await settle("Tip (0.001 HSK)",        ethers.ZeroAddress, hskAmount, nonces[5], "TIP-001", hskAmount);

  console.log("\n✅ Seed transactions complete!");
  console.log(`   Session ${sessionId} on HashKey testnet (chain ${CHAIN_ID})`);
  console.log(`   Escrow: ${ESCROW}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
