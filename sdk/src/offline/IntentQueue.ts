import { openDB, IDBPDatabase } from "idb";
import { PaymentIntentData } from "./PaymentIntent";

export type IntentStatus =
  | "pending"
  | "submitted"
  | "confirmed"
  | "failed";

export interface QueuedIntent {
  id: string;
  intent: PaymentIntentData;
  signature: string;
  merkleProof: string[];
  queuedAt: number;
  attempts: number;
  lastAttempt: number | null;
  status: IntentStatus;
  txHash: string | null;
  error: string | null;
}

const DB_NAME = "hashpoint-queue";
const STORE_NAME = "pending-intents";
const DB_VERSION = 1;

async function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status");
        store.createIndex("queuedAt", "queuedAt");
      }
    },
  });
}

function generateId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2)
  ).toUpperCase();
}

/**
 * IntentQueue manages pending payment intents in IndexedDB.
 * Persists across page refreshes and app restarts.
 */
export class IntentQueue {
  async enqueue(
    intent: PaymentIntentData,
    signature: string,
    merkleProof: string[]
  ): Promise<string> {
    const db = await getDb();
    const id = generateId();
    const record: QueuedIntent = {
      id,
      intent,
      signature,
      merkleProof,
      queuedAt: Date.now(),
      attempts: 0,
      lastAttempt: null,
      status: "pending",
      txHash: null,
      error: null,
    };
    await db.put(STORE_NAME, record);
    return id;
  }

  async dequeue(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(STORE_NAME, id);
  }

  async getPending(): Promise<QueuedIntent[]> {
    const db = await getDb();
    const all = await db.getAllFromIndex(STORE_NAME, "status", "pending");
    return all.sort((a, b) => a.intent.expiry - b.intent.expiry);
  }

  async updateStatus(
    id: string,
    status: IntentStatus,
    txHash?: string,
    error?: string
  ): Promise<void> {
    const db = await getDb();
    const record: QueuedIntent | undefined = await db.get(STORE_NAME, id);
    if (!record) return;

    record.status = status;
    record.lastAttempt = Date.now();
    record.attempts += 1;
    if (txHash !== undefined) record.txHash = txHash;
    if (error !== undefined) record.error = error;

    await db.put(STORE_NAME, record);
  }

  async getAll(): Promise<QueuedIntent[]> {
    const db = await getDb();
    return db.getAll(STORE_NAME);
  }

  async clearConfirmed(): Promise<void> {
    const db = await getDb();
    const confirmed = await db.getAllFromIndex(
      STORE_NAME,
      "status",
      "confirmed"
    );
    const tx = db.transaction(STORE_NAME, "readwrite");
    await Promise.all(
      confirmed.map((r: QueuedIntent) => tx.store.delete(r.id))
    );
    await tx.done;
  }

  async size(): Promise<number> {
    const db = await getDb();
    return db.count(STORE_NAME);
  }
}
