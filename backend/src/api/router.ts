import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { RelayService } from "../relay/RelayService";

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 100;

export function createApi(relayService: RelayService): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Per-merchant rate limit: max 100 intents/minute
  const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    keyGenerator: (req) => req.body?.intent?.merchant ?? req.ip ?? "unknown",
    message: { error: "Rate limit exceeded" },
  });

  // ─── Relay routes ─────────────────────────────────────────────────────────

  /**
   * POST /api/relay/submit
   * Accept a single signed PaymentIntent for relay.
   */
  app.post("/api/relay/submit", limiter, async (req, res) => {
    const { intent, signature, merkleProof } = req.body;

    if (!intent || !signature || !merkleProof) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const id = await relayService.acceptIntent(intent, signature, merkleProof);
      return res.json({ id, status: "queued" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(400).json({ error: message });
    }
  });

  /**
   * POST /api/relay/batch
   * Accept an array of signed PaymentIntents for batch relay.
   */
  app.post("/api/relay/batch", limiter, async (req, res) => {
    const { intents } = req.body;

    if (!Array.isArray(intents) || intents.length === 0) {
      return res.status(400).json({ error: "intents must be a non-empty array" });
    }

    if (intents.length > 50) {
      return res.status(400).json({ error: "Max 50 intents per batch" });
    }

    try {
      const ids = await relayService.acceptBatch(intents);
      // Trigger immediate submission
      relayService.submitQueued().catch(console.error);
      return res.json({ ids, status: "queued" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(400).json({ error: message });
    }
  });

  /**
   * GET /api/relay/status/:intentId
   * Check relay status for an intent.
   */
  app.get("/api/relay/status/:intentId", async (req, res) => {
    const { intentId } = req.params;
    const intent = await relayService.getStatus(intentId);

    if (!intent) {
      return res.status(404).json({ error: "Intent not found" });
    }

    return res.json({
      id: intent.id,
      status: intent.status,
      txHash: intent.txHash ?? null,
      error: intent.error ?? null,
    });
  });

  /**
   * GET /api/relay/receipt/:intentId
   * Get full HSP receipt for an intent.
   */
  app.get("/api/relay/receipt/:intentId", async (req, res) => {
    const { intentId } = req.params;
    const intent = await relayService.getStatus(intentId);

    if (!intent) {
      return res.status(404).json({ error: "Intent not found" });
    }

    return res.json({
      id: intent.id,
      intent: intent.intent,
      status: intent.status,
      txHash: intent.txHash ?? null,
      queuedAt: intent.queuedAt,
    });
  });

  // ─── Health ───────────────────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", queueSize: relayService.getQueueSize() });
  });

  return app;
}
