import { ethers } from "ethers";
import { IntentQueue, QueuedIntent } from "../offline/IntentQueue";
import { ConnectivityMonitor } from "./ConnectivityMonitor";

export interface BatchSettlerConfig {
  maxBatchSize: number;
  maxRetries: number;
  maxGasPrice: bigint;
  retryDelayMs: number;
}

export type BatchSettlerStatus = {
  pending: number;
  submitted: number;
  confirmed: number;
  failed: number;
};

/**
 * BatchSettler watches the intent queue and submits batches to HashKey Chain
 * when connectivity is available.
 */
export class BatchSettler {
  private _running = false;
  private _watchInterval: ReturnType<typeof setInterval> | null = null;
  private _unsubscribeConnectivity: (() => void) | null = null;

  constructor(
    private queue: IntentQueue,
    private connectivity: ConnectivityMonitor,
    private provider: ethers.Provider,
    private signer: ethers.Signer,
    private escrowContract: ethers.Contract,
    private config: BatchSettlerConfig
  ) {}

  /** Begin watching connectivity + queue */
  start(): void {
    if (this._running) return;
    this._running = true;

    // React to connectivity changes
    this._unsubscribeConnectivity = this.connectivity.onChange(
      async (online) => {
        if (online) await this._trySend();
      }
    );

    // Periodic sweep every 60s
    this._watchInterval = setInterval(async () => {
      if (this.connectivity.isOnline) await this._trySend();
    }, 60_000);
  }

  stop(): void {
    this._running = false;
    if (this._watchInterval !== null) {
      clearInterval(this._watchInterval);
      this._watchInterval = null;
    }
    if (this._unsubscribeConnectivity) {
      this._unsubscribeConnectivity();
      this._unsubscribeConnectivity = null;
    }
  }

  async submitBatch(
    intents: QueuedIntent[]
  ): Promise<ethers.TransactionReceipt | null> {
    if (intents.length === 0) return null;

    // Check gas price
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 0n;
    if (gasPrice > this.config.maxGasPrice) {
      console.warn("Gas price too high, deferring batch");
      return null;
    }

    // Sort by expiry ascending
    const sorted = [...intents].sort(
      (a, b) => a.intent.expiry - b.intent.expiry
    );
    const batch = sorted.slice(0, this.config.maxBatchSize);

    const intentStructs = batch.map((qi) => ({
      merchant: qi.intent.merchant,
      customer: qi.intent.customer,
      token: qi.intent.token,
      amount: qi.intent.amount,
      sessionId: qi.intent.sessionId,
      nonce: qi.intent.nonce,
      expiry: qi.intent.expiry,
      merchantRef: qi.intent.merchantRef,
      chainId: qi.intent.chainId,
    }));
    const sigs = batch.map((qi) => qi.signature);
    const proofs = batch.map((qi) => qi.merkleProof);

    // Mark as submitted
    await Promise.all(
      batch.map((qi) => this.queue.updateStatus(qi.id, "submitted"))
    );

    let txHash = "";
    try {
      const tx = await this.escrowContract
        .connect(this.signer)
        .settleBatch(intentStructs, sigs, proofs);
      txHash = tx.hash;
      const receipt = await tx.wait();

      await Promise.all(
        batch.map((qi) =>
          this.queue.updateStatus(qi.id, "confirmed", txHash)
        )
      );

      return receipt;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await Promise.all(
        batch.map((qi) => {
          const shouldRetry = qi.attempts < this.config.maxRetries;
          return this.queue.updateStatus(
            qi.id,
            shouldRetry ? "pending" : "failed",
            undefined,
            errorMessage
          );
        })
      );
      return null;
    }
  }

  async estimateGas(count: number): Promise<bigint> {
    // Rough estimate: ~150k gas per intent. Actual usage varies by token type
    // (native HSK is cheaper than ERC-20 safeTransferFrom), nonce proof depth,
    // and network conditions. A 1.25x safety margin is recommended when setting gas limits.
    return BigInt(count) * 150_000n;
  }

  async getStatus(): Promise<BatchSettlerStatus> {
    const all = await this.queue.getAll();
    const counts = { pending: 0, submitted: 0, confirmed: 0, failed: 0 };
    for (const item of all) {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    }
    return counts;
  }

  private async _trySend(): Promise<void> {
    try {
      const pending = await this.queue.getPending();
      if (pending.length === 0) return;
      await this.submitBatch(pending);
    } catch (err) {
      console.error("BatchSettler error:", err);
    }
  }
}
