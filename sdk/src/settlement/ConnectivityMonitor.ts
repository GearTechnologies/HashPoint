/**
 * ConnectivityMonitor detects network availability and monitors
 * connection type for the merchant PWA.
 */
export class ConnectivityMonitor {
  private _isOnline: boolean = navigator.onLine;
  private _listeners: Array<(online: boolean) => void> = [];
  private _pingInterval: ReturnType<typeof setInterval> | null = null;
  private _rpcUrl: string;

  constructor(rpcUrl: string = "https://mainnet.hsk.xyz") {
    this._rpcUrl = rpcUrl;
    this._isOnline = navigator.onLine;

    window.addEventListener("online", this._handleOnline.bind(this));
    window.addEventListener("offline", this._handleOffline.bind(this));
  }

  start(pingIntervalMs: number = 30_000): void {
    this._pingInterval = setInterval(async () => {
      const reachable = await this._pingRpc();
      const wasOnline = this._isOnline;
      this._isOnline = reachable;
      if (wasOnline !== reachable) {
        this._listeners.forEach((l) => l(reachable));
      }
    }, pingIntervalMs);
  }

  stop(): void {
    if (this._pingInterval !== null) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    window.removeEventListener("online", this._handleOnline.bind(this));
    window.removeEventListener("offline", this._handleOffline.bind(this));
  }

  get isOnline(): boolean {
    return this._isOnline;
  }

  onChange(listener: (online: boolean) => void): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  private _handleOnline(): void {
    this._isOnline = true;
    this._listeners.forEach((l) => l(true));
  }

  private _handleOffline(): void {
    this._isOnline = false;
    this._listeners.forEach((l) => l(false));
  }

  private async _pingRpc(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(this._rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: [],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }
}
