import { ethers } from "ethers";
import { Pool } from "pg";

export interface PaymentRecord {
  id: string;
  merchant: string;
  customer: string;
  token: string;
  amount: string;
  merchantRef: string;
  sessionId: string;
  nonce: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  status: string;
}

/**
 * EventIndexer indexes PaymentSettled and BatchSettled events from HashPointEscrow.
 * Stores results in PostgreSQL for merchant dashboard queries.
 */
export class EventIndexer {
  private _running = false;

  constructor(
    private provider: ethers.Provider,
    private escrowContract: ethers.Contract,
    private db: Pool
  ) {}

  async initDb(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        merchant TEXT NOT NULL,
        customer TEXT NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        merchant_ref TEXT,
        session_id TEXT,
        nonce TEXT,
        tx_hash TEXT,
        block_number INTEGER,
        timestamp BIGINT,
        status TEXT DEFAULT 'confirmed',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        merchant TEXT NOT NULL,
        session_id TEXT,
        nonce_root TEXT,
        expiry BIGINT,
        max_payments INTEGER,
        used_payments INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS merchants (
        address TEXT PRIMARY KEY,
        name TEXT,
        category TEXT,
        registered_at BIGINT,
        total_payments INTEGER DEFAULT 0,
        total_volume TEXT DEFAULT '0',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  }

  /**
   * Sync historical events from `fromBlock` to current.
   */
  async syncHistorical(fromBlock = 0): Promise<void> {
    const filter = this.escrowContract.filters.PaymentSettled();
    const events = await this.escrowContract.queryFilter(filter, fromBlock, "latest");

    for (const event of events) {
      await this._handlePaymentSettled(event as ethers.EventLog);
    }
    console.log(`Synced ${events.length} historical payments`);
  }

  /**
   * Start watching for new events in real-time.
   */
  start(): void {
    if (this._running) return;
    this._running = true;

    this.escrowContract.on(
      "PaymentSettled",
      (merchant, customer, token, amount, merchantRef, sessionId, nonce, event) => {
        this._handlePaymentSettled(event as ethers.EventLog).catch(console.error);
      }
    );
    console.log("EventIndexer started");
  }

  stop(): void {
    this._running = false;
    this.escrowContract.removeAllListeners("PaymentSettled");
  }

  private async _handlePaymentSettled(event: ethers.EventLog): Promise<void> {
    const { args, transactionHash, blockNumber } = event;
    const block = await this.provider.getBlock(blockNumber);
    const id = `${transactionHash}-${event.index}`;

    await this.db.query(
      `INSERT INTO payments (id, merchant, customer, token, amount, merchant_ref,
        session_id, nonce, tx_hash, block_number, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        args[0],
        args[1],
        args[2],
        args[3].toString(),
        args[4],
        args[5].toString(),
        args[6],
        transactionHash,
        blockNumber,
        block?.timestamp ?? 0,
      ]
    );
  }

  async getPayments(merchant: string, limit = 50): Promise<PaymentRecord[]> {
    const result = await this.db.query(
      `SELECT * FROM payments WHERE merchant = $1 ORDER BY timestamp DESC LIMIT $2`,
      [merchant.toLowerCase(), limit]
    );
    return result.rows;
  }

  async getTotalVolume(merchant: string): Promise<string> {
    const result = await this.db.query(
      `SELECT COALESCE(SUM(amount::NUMERIC), 0) AS total FROM payments WHERE merchant = $1`,
      [merchant.toLowerCase()]
    );
    return result.rows[0]?.total ?? "0";
  }
}
