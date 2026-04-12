import { useState, useEffect } from "react";

export interface ConnectivityState {
  isOnline: boolean;
  connectionType: string;
  latency: number | null;
}

export function useConnectivity(): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    connectionType: "unknown",
    latency: null,
  });

  useEffect(() => {
    let pingTimer: ReturnType<typeof setInterval>;

    const updateOnline = () =>
      setState((prev) => ({ ...prev, isOnline: navigator.onLine }));

    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    const ping = async () => {
      const start = performance.now();
      try {
        const rpc = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.hsk.xyz";
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_blockNumber",
            params: [],
          }),
          signal: AbortSignal.timeout(5000),
        });
        const latency = Math.round(performance.now() - start);
        setState((prev) => ({
          ...prev,
          isOnline: res.ok,
          latency: res.ok ? latency : null,
        }));
      } catch {
        setState((prev) => ({ ...prev, isOnline: false, latency: null }));
      }
    };

    ping();
    pingTimer = setInterval(ping, 30_000);

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      clearInterval(pingTimer);
    };
  }, []);

  return state;
}
