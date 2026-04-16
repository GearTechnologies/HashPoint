"use client";

import React from "react";
import { Virtuoso } from "react-virtuoso";
import { QueuedIntent } from "@hashpoint/sdk";
import { formatTokenAmount, getTokenByAddress } from "../lib/chain";

const STATUS_COLORS: Record<string, string> = {
  pending: "#6B778C",
  submitted: "#0052CC",
  confirmed: "#00875A",
  failed: "#DE350B",
};

interface TransactionListProps {
  transactions: QueuedIntent[];
}

export function TransactionList({ transactions }: TransactionListProps) {
  if (transactions.length === 0) {
    return <div className="tx-list--empty">No transactions yet</div>;
  }

  return (
    <Virtuoso
      style={{ height: "400px" }}
      data={transactions}
      itemContent={(_, tx) => (
        <TransactionRow tx={tx} />
      )}
    />
  );
}

function TransactionRow({ tx }: { tx: QueuedIntent }) {
  const [expanded, setExpanded] = React.useState(false);
  const token = getTokenByAddress(tx.intent.token);
  const amount = formatTokenAmount(tx.intent.amount, tx.intent.token);

  return (
    <div
      className="tx-row"
      onClick={() => setExpanded((e) => !e)}
      style={{ cursor: "pointer", padding: "12px", borderBottom: "1px solid #f0f0f0" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "4px",
              backgroundColor: STATUS_COLORS[tx.status] + "22",
              color: STATUS_COLORS[tx.status],
              fontSize: "12px",
              fontWeight: 600,
              marginRight: "8px",
            }}
          >
            {tx.status.toUpperCase()}
          </span>
          <span style={{ fontWeight: 600 }}>
            {amount} {token.label}
          </span>
        </div>
        <div style={{ fontSize: "12px", color: "#6B778C" }}>
          {new Date(tx.queuedAt).toLocaleTimeString()}
        </div>
      </div>
      {expanded && (
        <div
          style={{
            marginTop: "8px",
            fontSize: "12px",
            color: "#6B778C",
            fontFamily: "monospace",
          }}
        >
          <div>Merchant: {tx.intent.merchant}</div>
          <div>Customer: {tx.intent.customer}</div>
          <div>Nonce: {tx.intent.nonce.slice(0, 18)}...</div>
          <div>Attempts: {tx.attempts}</div>
          {tx.txHash && <div>TxHash: {tx.txHash.slice(0, 18)}...</div>}
          {tx.error && (
            <div style={{ color: "#DE350B" }}>Error: {tx.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
