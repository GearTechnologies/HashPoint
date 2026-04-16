"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { OfflineBanner } from "../components/OfflineBanner";
import { TransactionList } from "../components/TransactionList";
import { useOnchainPayments } from "../hooks/useOnchainPayments";
import { useSettlementQueue } from "../hooks/useSettlementQueue";

export default function Dashboard() {
  const { queue, queueSize } = useSettlementQueue();
  const { address, isConnected } = useAccount();
  const { payments: onchainPayments, loading: onchainLoading, error: onchainError } = useOnchainPayments(address);

  const mergedTransactions = new Map<string, (typeof queue)[number]>();
  for (const transaction of [...onchainPayments, ...queue]) {
    const key = transaction.txHash?.toLowerCase() ?? `${transaction.intent.merchant.toLowerCase()}:${transaction.intent.nonce.toLowerCase()}`;
    const existing = mergedTransactions.get(key);
    if (!existing || existing.status !== "confirmed") {
      mergedTransactions.set(key, transaction);
    }
  }

  const transactions = Array.from(mergedTransactions.values()).sort(
    (left, right) => right.queuedAt - left.queuedAt
  );

  const confirmed = transactions.filter((t) => t.status === "confirmed");
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayTxs = confirmed.filter(
    (t) => t.queuedAt >= todayStart.getTime()
  );
  const walletLabel = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

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
          value={String(todayTxs.length)}
          unit="payments"
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

      <div style={{ fontSize: "14px", color: "#6B778C", marginBottom: "16px" }}>
        {isConnected
          ? `Showing local queue and on-chain payments for ${walletLabel}`
          : "Connect your wallet to load on-chain payment history for this merchant."}
      </div>

      {onchainError && (
        <div style={{ color: "#DE350B", marginBottom: "16px" }}>{onchainError}</div>
      )}

      <h2>Recent Transactions</h2>
      {onchainLoading && transactions.length === 0 ? (
        <div style={{ color: "#6B778C" }}>Loading on-chain payment history…</div>
      ) : (
        <TransactionList transactions={transactions.slice(0, 20)} />
      )}

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
        <Link href="/faucet">🚰 Faucet</Link>
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
