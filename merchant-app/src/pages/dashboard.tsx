"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { OfflineBanner } from "../components/OfflineBanner";
import { TransactionList } from "../components/TransactionList";
import { useSettlementQueue } from "../hooks/useSettlementQueue";

export default function Dashboard() {
  const { queue, queueSize } = useSettlementQueue();

  const confirmed = queue.filter((t) => t.status === "confirmed");
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayTxs = confirmed.filter(
    (t) => t.queuedAt >= todayStart.getTime()
  );
  const todayVolume = todayTxs.reduce(
    (sum, t) => sum + Number(t.intent.amount),
    0
  );

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "16px" }}>
      <OfflineBanner />
      <h1 style={{ color: "#0052CC" }}>HashPoint</h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        <StatCard
          label="Today"
          value={(todayVolume / 1e18).toFixed(4)}
          unit="HSK"
        />
        <StatCard label="Pending" value={String(queueSize)} unit="intents" />
        <StatCard
          label="All Time"
          value={String(confirmed.length)}
          unit="payments"
        />
      </div>

      <Link href="/payment/new">
        <button
          style={{
            width: "100%",
            padding: "16px",
            backgroundColor: "#0052CC",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "18px",
            fontWeight: 700,
            cursor: "pointer",
            marginBottom: "24px",
          }}
        >
          + New Payment
        </button>
      </Link>

      <h2>Recent Transactions</h2>
      <TransactionList transactions={queue.slice(-20).reverse()} />

      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "space-around",
          backgroundColor: "white",
          borderTop: "1px solid #e0e0e0",
          padding: "8px 0",
        }}
      >
        <Link href="/dashboard">🏠 Home</Link>
        <Link href="/session">🔑 Session</Link>
        <Link href="/queue">📋 Queue</Link>
        <Link href="/settings">⚙️ Settings</Link>
      </nav>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div
      style={{
        padding: "16px",
        backgroundColor: "#F4F5F7",
        borderRadius: "8px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "12px", color: "#6B778C" }}>{label}</div>
      <div style={{ fontSize: "24px", fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#6B778C" }}>{unit}</div>
    </div>
  );
}
