import { expect } from "chai";
import { ethers, network } from "hardhat";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import {
  HashPointEscrow,
  NonceRegistry,
  HSPAdapter,
  MerchantRegistry,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMerkleTree(nonces: string[]): {
  tree: MerkleTree;
  root: string;
  proofs: Record<string, string[]>;
} {
  const leaves = nonces.map((n) =>
    keccak256(Buffer.from(n.slice(2), "hex"))
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = "0x" + tree.getRoot().toString("hex");
  const proofs: Record<string, string[]> = {};
  nonces.forEach((n) => {
    const leaf = keccak256(Buffer.from(n.slice(2), "hex"));
    proofs[n] = tree.getHexProof(leaf);
  });
  return { tree, root, proofs };
}

async function signIntent(
  signer: HardhatEthersSigner,
  intent: {
    merchant: string;
    customer: string;
    token: string;
    amount: bigint;
    sessionId: bigint;
    nonce: string;
    expiry: number;
    merchantRef: string;
    chainId: number;
  },
  contractAddress: string,
  chainId: number
): Promise<string> {
  const domain = {
    name: "HashPoint",
    version: "1",
    chainId,
    verifyingContract: contractAddress,
  };
  const types = {
    PaymentIntent: [
      { name: "merchant", type: "address" },
      { name: "customer", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "sessionId", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "expiry", type: "uint256" },
      { name: "merchantRef", type: "bytes32" },
      { name: "chainId", type: "uint256" },
    ],
  };
  return signer.signTypedData(domain, types, intent);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HashPointEscrow", function () {
  let escrow: HashPointEscrow;
  let nonceRegistry: NonceRegistry;
  let hspAdapter: HSPAdapter;
  let merchantRegistry: MerchantRegistry;

  let owner: HardhatEthersSigner;
  let merchant: HardhatEthersSigner;
  let customer: HardhatEthersSigner;
  let feeRecipient: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;

  let chainId: number;
  let escrowAddress: string;

  // Session data
  let nonces: string[];
  let merkleRoot: string;
  let merkleProofs: Record<string, string[]>;
  let sessionId: bigint;

  beforeEach(async () => {
    [owner, merchant, customer, feeRecipient, relayer] =
      await ethers.getSigners();

    chainId = Number((await ethers.provider.getNetwork()).chainId);

    // Deploy contracts
    const NonceRegistryFactory = await ethers.getContractFactory(
      "NonceRegistry"
    );
    nonceRegistry = await NonceRegistryFactory.deploy();

    const MerchantRegistryFactory = await ethers.getContractFactory(
      "MerchantRegistry"
    );
    merchantRegistry = await MerchantRegistryFactory.deploy();

    const HSPAdapterFactory = await ethers.getContractFactory("HSPAdapter");
    hspAdapter = await HSPAdapterFactory.deploy();

    const EscrowFactory = await ethers.getContractFactory("HashPointEscrow");
    escrow = await EscrowFactory.deploy(
      await nonceRegistry.getAddress(),
      await merchantRegistry.getAddress(),
      await hspAdapter.getAddress(),
      feeRecipient.address,
      10 // 0.1% fee
    );

    // Grant ESCROW_ROLE on HSPAdapter
    const ESCROW_ROLE = await hspAdapter.ESCROW_ROLE();
    escrowAddress = await escrow.getAddress();
    await hspAdapter.grantRole(ESCROW_ROLE, escrowAddress);

    // Set escrow on merchant registry
    await merchantRegistry.setEscrow(escrowAddress);

    // Register merchant
    await merchantRegistry
      .connect(merchant)
      .registerMerchant("Test Merchant", "retail", ethers.ZeroAddress, 3600);

    // Open a session on NonceRegistry
    nonces = Array.from({ length: 10 }, () =>
      ethers.hexlify(ethers.randomBytes(32))
    );
    const { root, proofs } = buildMerkleTree(nonces);
    merkleRoot = root;
    merkleProofs = proofs;

    const tx = await nonceRegistry
      .connect(merchant)
      .openSession(merkleRoot, 3600, 100);
    const receipt = await tx.wait();
    sessionId = await nonceRegistry.currentSessionId(merchant.address);
  });

  // ─── Unit Tests ────────────────────────────────────────────────────────────

  describe("settlePayment", () => {
    it("valid signature + valid nonce → succeeds and transfers funds", async () => {
      const nonce = nonces[0];
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const amount = ethers.parseEther("1");

      const intent = {
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount,
        sessionId,
        nonce,
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-001"),
        chainId,
      };

      const sig = await signIntent(
        customer,
        intent,
        escrowAddress,
        chainId
      );

      const merchantBefore = await ethers.provider.getBalance(merchant.address);
      const feeBefore = await ethers.provider.getBalance(feeRecipient.address);

      await expect(
        escrow
          .connect(relayer)
          .settlePayment(intent, sig, merkleProofs[nonce], {
            value: amount,
          })
      )
        .to.emit(escrow, "PaymentSettled")
        .withArgs(
          merchant.address,
          customer.address,
          ethers.ZeroAddress,
          amount,
          ethers.encodeBytes32String("INV-001"),
          sessionId,
          nonce
        );

      const merchantAfter = await ethers.provider.getBalance(merchant.address);
      const feeAfter = await ethers.provider.getBalance(feeRecipient.address);

      const fee = (amount * 10n) / 10000n;
      const merchantAmount = amount - fee;

      expect(merchantAfter - merchantBefore).to.equal(merchantAmount);
      expect(feeAfter - feeBefore).to.equal(fee);
    });

    it("expired intent → reverts with IntentExpired", async () => {
      const nonce = nonces[0];
      const expiry = Math.floor(Date.now() / 1000) - 1; // already expired

      const intent = {
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount: ethers.parseEther("1"),
        sessionId,
        nonce,
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-001"),
        chainId,
      };

      const sig = await signIntent(
        customer,
        intent,
        escrowAddress,
        chainId
      );

      await expect(
        escrow
          .connect(relayer)
          .settlePayment(intent, sig, merkleProofs[nonce], {
            value: intent.amount,
          })
      ).to.be.revertedWithCustomError(escrow, "IntentExpired");
    });

    it("invalid signature → reverts with InvalidSignature", async () => {
      const nonce = nonces[0];
      const expiry = Math.floor(Date.now() / 1000) + 3600;

      const intent = {
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount: ethers.parseEther("1"),
        sessionId,
        nonce,
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-001"),
        chainId,
      };

      // Sign with wrong signer (relayer instead of customer)
      const sig = await signIntent(
        relayer,
        intent,
        escrowAddress,
        chainId
      );

      await expect(
        escrow
          .connect(relayer)
          .settlePayment(intent, sig, merkleProofs[nonce], {
            value: intent.amount,
          })
      ).to.be.revertedWithCustomError(escrow, "InvalidSignature");
    });

    it("already-spent nonce → reverts with NonceAlreadySpent", async () => {
      const nonce = nonces[0];
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const amount = ethers.parseEther("1");

      const intent = {
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount,
        sessionId,
        nonce,
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-001"),
        chainId,
      };

      const sig = await signIntent(
        customer,
        intent,
        escrowAddress,
        chainId
      );

      // First settlement succeeds
      await escrow
        .connect(relayer)
        .settlePayment(intent, sig, merkleProofs[nonce], { value: amount });

      // Second attempt must fail
      await expect(
        escrow
          .connect(relayer)
          .settlePayment(intent, sig, merkleProofs[nonce], { value: amount })
      ).to.be.revertedWithCustomError(nonceRegistry, "NonceAlreadySpent");
    });

    it("wrong chainId → reverts with WrongChainId", async () => {
      const nonce = nonces[0];
      const expiry = Math.floor(Date.now() / 1000) + 3600;

      const intent = {
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount: ethers.parseEther("1"),
        sessionId,
        nonce,
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-001"),
        chainId: 9999, // wrong
      };

      const sig = await signIntent(
        customer,
        { ...intent, chainId: 9999 },
        escrowAddress,
        chainId
      );

      await expect(
        escrow
          .connect(relayer)
          .settlePayment(intent, sig, merkleProofs[nonce], {
            value: intent.amount,
          })
      ).to.be.revertedWithCustomError(escrow, "WrongChainId");
    });

    it("protocol fee collected to feeRecipient", async () => {
      const nonce = nonces[0];
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const amount = ethers.parseEther("10");

      const intent = {
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount,
        sessionId,
        nonce,
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-FEE"),
        chainId,
      };

      const sig = await signIntent(
        customer,
        intent,
        escrowAddress,
        chainId
      );

      const feeBefore = await ethers.provider.getBalance(feeRecipient.address);
      await escrow
        .connect(relayer)
        .settlePayment(intent, sig, merkleProofs[nonce], { value: amount });
      const feeAfter = await ethers.provider.getBalance(feeRecipient.address);

      const expectedFee = (amount * 10n) / 10000n; // 0.1%
      expect(feeAfter - feeBefore).to.equal(expectedFee);
    });
  });

  describe("settleBatch", () => {
    it("mixed valid/invalid intents → valid ones settle, invalid ones skipped", async () => {
      const validNonce = nonces[0];
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const amount = ethers.parseEther("1");

      const validIntent = {
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount,
        sessionId,
        nonce: validNonce,
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-001"),
        chainId,
      };

      const invalidIntent = {
        ...validIntent,
        nonce: nonces[1],
        expiry: Math.floor(Date.now() / 1000) - 1, // expired
      };

      const validSig = await signIntent(
        customer,
        validIntent,
        escrowAddress,
        chainId
      );
      const invalidSig = await signIntent(
        customer,
        invalidIntent,
        escrowAddress,
        chainId
      );

      const tx = await escrow.connect(relayer).settleBatch(
        [validIntent, invalidIntent],
        [validSig, invalidSig],
        [merkleProofs[validNonce], merkleProofs[nonces[1]]],
        { value: amount * 2n }
      );

      await expect(tx).to.emit(escrow, "PaymentSettled");
      await expect(tx).to.emit(escrow, "PaymentFailed");
      await expect(tx).to.emit(escrow, "BatchSettled");
    });

    it("all invalid intents → no transfer, batch PaymentFailed events", async () => {
      const expiry = Math.floor(Date.now() / 1000) - 1; // all expired

      const intents = [0, 1].map((i) => ({
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount: ethers.parseEther("1"),
        sessionId,
        nonce: nonces[i],
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-00" + i),
        chainId,
      }));

      const sigs = await Promise.all(
        intents.map((intent) =>
          signIntent(customer, intent, escrowAddress, chainId)
        )
      );

      const tx = await escrow.connect(relayer).settleBatch(
        intents,
        sigs,
        [merkleProofs[nonces[0]], merkleProofs[nonces[1]]],
        { value: ethers.parseEther("2") }
      );

      await expect(tx).to.emit(escrow, "PaymentFailed");
      await expect(tx).to.not.emit(escrow, "PaymentSettled");
    });
  });

  // ─── Integration Tests ────────────────────────────────────────────────────

  describe("Full offline session flow", () => {
    it("openSession → sign 10 intents → settleBatch → verify all settled", async () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const amount = ethers.parseEther("0.1");

      const intents = nonces.map((nonce, i) => ({
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount,
        sessionId,
        nonce,
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-" + i.toString().padStart(3, "0")),
        chainId,
      }));

      const sigs = await Promise.all(
        intents.map((intent) =>
          signIntent(customer, intent, escrowAddress, chainId)
        )
      );

      const proofArray = nonces.map((n) => merkleProofs[n]);
      const totalValue = amount * BigInt(nonces.length);

      const tx = await escrow
        .connect(relayer)
        .settleBatch(intents, sigs, proofArray, { value: totalValue });

      const receipt = await tx.wait();
      const settledEvents = receipt!.logs.filter(
        (log) =>
          log.topics[0] ===
          escrow.interface.getEvent("PaymentSettled").topicHash
      );
      expect(settledEvents.length).to.equal(10);
    });

    it("session expiry: open session, advance time, attempt settlement → fails", async () => {
      // Open a very short session (1s)
      const shortNonces = [ethers.hexlify(ethers.randomBytes(32))];
      const { root: shortRoot, proofs: shortProofs } =
        buildMerkleTree(shortNonces);

      await nonceRegistry
        .connect(merchant)
        .openSession(shortRoot, 1, 10);
      const shortSessionId = await nonceRegistry.currentSessionId(
        merchant.address
      );

      // Advance time past session expiry
      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine", []);

      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const intent = {
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount: ethers.parseEther("1"),
        sessionId: shortSessionId,
        nonce: shortNonces[0],
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-EXP"),
        chainId,
      };

      const sig = await signIntent(
        customer,
        intent,
        escrowAddress,
        chainId
      );

      await expect(
        escrow
          .connect(relayer)
          .settlePayment(intent, sig, shortProofs[shortNonces[0]], {
            value: intent.amount,
          })
      ).to.be.revertedWithCustomError(nonceRegistry, "SessionExpired");
    });

    it("nonce exhaustion: attempt to use same nonce twice fails", async () => {
      const nonce = nonces[0];
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const amount = ethers.parseEther("1");

      const intent = {
        merchant: merchant.address,
        customer: customer.address,
        token: ethers.ZeroAddress,
        amount,
        sessionId,
        nonce,
        expiry,
        merchantRef: ethers.encodeBytes32String("INV-ONCE"),
        chainId,
      };

      const sig = await signIntent(
        customer,
        intent,
        escrowAddress,
        chainId
      );

      // First use succeeds
      await escrow
        .connect(relayer)
        .settlePayment(intent, sig, merkleProofs[nonce], { value: amount });

      // Second use fails
      await expect(
        escrow
          .connect(relayer)
          .settlePayment(intent, sig, merkleProofs[nonce], { value: amount })
      ).to.be.revertedWithCustomError(nonceRegistry, "NonceAlreadySpent");
    });
  });

  // ─── Emergency Withdrawal ────────────────────────────────────────────────

  describe("emergencyWithdraw", () => {
    it("owner can request and execute after 72h timelock", async () => {
      // Send some ETH to escrow
      await owner.sendTransaction({
        to: escrowAddress,
        value: ethers.parseEther("1"),
      });

      await escrow
        .connect(owner)
        .requestEmergencyWithdrawal(ethers.ZeroAddress, ethers.parseEther("1"));

      // Cannot execute before timelock
      await expect(
        escrow.connect(owner).executeEmergencyWithdrawal()
      ).to.be.revertedWithCustomError(escrow, "TimelockNotExpired");

      // Advance time 72 hours
      await network.provider.send("evm_increaseTime", [72 * 3600 + 1]);
      await network.provider.send("evm_mine", []);

      await expect(
        escrow.connect(owner).executeEmergencyWithdrawal()
      ).to.emit(escrow, "WithdrawalExecuted");
    });
  });
});

describe("NonceRegistry", function () {
  let nonceRegistry: NonceRegistry;
  let merchant: HardhatEthersSigner;

  beforeEach(async () => {
    [, merchant] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("NonceRegistry");
    nonceRegistry = await Factory.deploy();
  });

  it("opens a session and returns sequential session IDs", async () => {
    const { root } = buildMerkleTree([ethers.hexlify(ethers.randomBytes(32))]);
    await nonceRegistry.connect(merchant).openSession(root, 3600, 10);
    await nonceRegistry.connect(merchant).openSession(root, 3600, 10);
    expect(await nonceRegistry.currentSessionId(merchant.address)).to.equal(2n);
  });

  it("rejects sessions longer than 24h", async () => {
    const { root } = buildMerkleTree([ethers.hexlify(ethers.randomBytes(32))]);
    await expect(
      nonceRegistry.connect(merchant).openSession(root, 86401, 10)
    ).to.be.revertedWith("Max 24h session");
  });

  it("rejects sessions with more than 1000 payments", async () => {
    const { root } = buildMerkleTree([ethers.hexlify(ethers.randomBytes(32))]);
    await expect(
      nonceRegistry.connect(merchant).openSession(root, 3600, 1001)
    ).to.be.revertedWith("Max 1000 payments per session");
  });
});

describe("MerchantRegistry", function () {
  let merchantRegistry: MerchantRegistry;
  let owner: HardhatEthersSigner;
  let merchant: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, merchant] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MerchantRegistry");
    merchantRegistry = await Factory.deploy();
  });

  it("registers a merchant", async () => {
    await expect(
      merchantRegistry
        .connect(merchant)
        .registerMerchant("My Shop", "retail", ethers.ZeroAddress, 3600)
    )
      .to.emit(merchantRegistry, "MerchantRegistered")
      .withArgs(merchant.address, "My Shop", "retail", ethers.ZeroAddress);

    expect(await merchantRegistry.isMerchant(merchant.address)).to.be.true;
  });

  it("prevents duplicate registration", async () => {
    await merchantRegistry
      .connect(merchant)
      .registerMerchant("My Shop", "retail", ethers.ZeroAddress, 3600);

    await expect(
      merchantRegistry
        .connect(merchant)
        .registerMerchant("My Shop 2", "retail", ethers.ZeroAddress, 3600)
    ).to.be.revertedWithCustomError(merchantRegistry, "AlreadyRegistered");
  });

  it("updates merchant info", async () => {
    await merchantRegistry
      .connect(merchant)
      .registerMerchant("My Shop", "retail", ethers.ZeroAddress, 3600);

    await expect(
      merchantRegistry
        .connect(merchant)
        .updateMerchant("Updated Shop", "food", ethers.ZeroAddress, 7200)
    ).to.emit(merchantRegistry, "MerchantUpdated");

    const info = await merchantRegistry.getMerchantInfo(merchant.address);
    expect(info.name).to.equal("Updated Shop");
  });
});
