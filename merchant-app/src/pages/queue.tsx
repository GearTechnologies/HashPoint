"use client";

import React from "react";
import { useRouter } from "next/router";
import { TransactionList } from "../components/TransactionList";
import { useSettlementQueue } from "../hooks/useSettlementQueue";
import { useConnectivity } from "../hooks/useConnectivity";

export default function QueuePage() {
  const router = useRouter();
  const { queue, refresh } = useSettlementQueue();
  const { isOnline } = useConnectivity();

  const pending = queue.filter((t) => t.status === "pending");
  const submitted = queue.filter((t) => t.status === "submitted");
  const confirmed = queue.filter((t) => t.status === "confirmed");
  const failed = queue.filter((t) => t.status === "failed");

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", padding: "4px 8px" }}>←</button>
        <h1 style={{ margin: 0 }}>Settlement Queue</h1>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: "8px",
          marginBottom: "24px",
        }}
      >
        <Stat label="Pending" value={pending.length} color="#6B778C" />
        <Stat label="Submitted" value={submitted.length} color="#0052CC" />
        <Stat label="Confirmed" value={confirmed.length} color="#00875A" />
        <Stat label="Failed" value={failed.length} color="#DE350B" />
      </div>

      <button
        disabled={!isOnline || pending.length === 0}
        style={{
          width: "100%",
          padding: "12px",
          backgroundColor: "#0052CC",
          color: "white",
          border: "none",
          borderRadius: "8px",
          fontSize: "16px",
          cursor: "pointer",
          marginBottom: "16px",
          opacity: !isOnline || pending.length === 0 ? 0.5 : 1,
        }}
      >
        Settle Now ({pending.length} pending)
      </button>

      <h2>All Transactions</h2>
      <TransactionList transactions={[...queue].reverse()} />
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "12px",
        borderRadius: "8px",
        backgroundColor: color + "11",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "24px", fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#6B778C" }}>{label}</div>
    </div>
  );
}
