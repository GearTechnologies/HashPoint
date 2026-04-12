import { useState, useEffect, useCallback } from "react";
import { IntentQueue, QueuedIntent } from "@hashpoint/sdk";

const queue = new IntentQueue();

export function useSettlementQueue() {
  const [items, setItems] = useState<QueuedIntent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const all = await queue.getAll();
    setItems(all);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const enqueue = useCallback(
    async (
      intent: Parameters<IntentQueue["enqueue"]>[0],
      signature: string,
      merkleProof: string[]
    ) => {
      const id = await queue.enqueue(intent, signature, merkleProof);
      await refresh();
      return id;
    },
    [refresh]
  );

  const queueSize = items.filter((i) => i.status === "pending").length;

  return { queue: items, enqueue, queueSize, refresh, loading };
}
