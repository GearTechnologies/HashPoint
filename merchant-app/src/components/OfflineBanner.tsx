"use client";

import React from "react";
import { useConnectivity } from "../hooks/useConnectivity";
import { useSettlementQueue } from "../hooks/useSettlementQueue";

export function OfflineBanner() {
  const { isOnline } = useConnectivity();
  const { queueSize } = useSettlementQueue();

  if (isOnline && queueSize === 0) {
    return (
      <div className="banner banner--green">
        ✅ Online — All payments settled
      </div>
    );
  }

  if (isOnline && queueSize > 0) {
    return (
      <div className="banner banner--amber">
        ⏳ Online — {queueSize} payment{queueSize !== 1 ? "s" : ""} pending settlement
      </div>
    );
  }

  return (
    <div className="banner banner--red">
      📡 Offline — {queueSize} payment{queueSize !== 1 ? "s" : ""} queued locally
    </div>
  );
}
