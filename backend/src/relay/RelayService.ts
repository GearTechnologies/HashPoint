import { ethers } from "ethers";
import { v4 as uuidv4 } from "uuid";

export interface RelayIntent {
  id: string;
  intent: {
    merchant: string;
    customer: string;
    token: string;
    amount: string;
    sessionId: string;
    nonce: string;
    expiry: number;
    merchantRef: string;
    chainId: number;
  };
  signature: string;
  merkleProof: string[];
  queuedAt: number;
  status: "queued" | "submitted" | "confirmed" | "failed";
  txHash?: string;
  error?: string;
}

/**
 * RelayService accepts signed PaymentIntents from merchants who cannot
 * submit transactions themselves and relays them to HashKey Chain.
 *
 * Gas sponsorship: relay deducts 0.05% of payment as relay fee.
 * Security: verifies EIP-712 signature before accepting.
 */
export class RelayService {
  private queue: Map<string, RelayIntent> = new Map();

  constructor(
    private provider: ethers.Provider,
    private relaySigner: ethers.Signer,
    private escrowContract: ethers.Contract
  ) {}

  /**
   * Verify and accept a signed intent for relay.
   */
  async acceptIntent(
    intent: RelayIntent["intent"],
    signature: string,
    merkleProof: string[]
  ): Promise<string> {
    // Reject intents expiring in < 10 minutes
    const now = Math.floor(Date.now() / 1000);
    if (intent.expiry - now < 600) {
      throw new Error("Intent expires too soon (< 10 minutes)");
    }

    // Verify EIP-712 signature
    const domain = {
      name: "HashPoint",
      version: "1",
      chainId: intent.chainId,
      verifyingContract: await this.escrowContract.getAddress(),
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

    let recovered: string;
    try {
      recovered = ethers.verifyTypedData(domain, types, intent, signature);
    } catch {
      throw new Error("Invalid EIP-712 signature");
    }

    if (recovered.toLowerCase() !== intent.customer.toLowerCase()) {
      throw new Error("Signature does not match customer");
    }

    const id = uuidv4();
    this.queue.set(id, {
      id,
      intent,
      signature,
      merkleProof,
      queuedAt: Date.now(),
      status: "queued",
    });

    return id;
  }

  async acceptBatch(
    intents: Array<{
      intent: RelayIntent["intent"];
      signature: string;
      merkleProof: string[];
    }>
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const item of intents) {
      const id = await this.acceptIntent(
        item.intent,
        item.signature,
        item.merkleProof
      );
      ids.push(id);
    }
    return ids;
  }

  async getStatus(id: string): Promise<RelayIntent | null> {
    return this.queue.get(id) ?? null;
  }

  async submitQueued(): Promise<void> {
    const queued = [...this.queue.values()].filter(
      (i) => i.status === "queued"
    );
    if (queued.length === 0) return;

    const intentStructs = queued.map((qi) => qi.intent);
    const sigs = queued.map((qi) => qi.signature);
    const proofs = queued.map((qi) => qi.merkleProof);

    queued.forEach((qi) => {
      qi.status = "submitted";
      this.queue.set(qi.id, qi);
    });

    try {
      const tx = await this.escrowContract
        .connect(this.relaySigner)
        .settleBatch(intentStructs, sigs, proofs);
      const receipt = await tx.wait();
      queued.forEach((qi) => {
        qi.status = "confirmed";
        qi.txHash = tx.hash;
        this.queue.set(qi.id, qi);
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      queued.forEach((qi) => {
        qi.status = "failed";
        qi.error = errorMessage;
        this.queue.set(qi.id, qi);
      });
    }
  }

  getQueueSize(): number {
    return this.queue.size;
  }
}
