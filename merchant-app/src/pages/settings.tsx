"use client";

import React, { useState } from "react";

export default function Settings() {
  const [merchantName, setMerchantName] = useState(
    process.env.NEXT_PUBLIC_MERCHANT_NAME || ""
  );
  const [category, setCategory] = useState("retail");
  const [maxGasPrice, setMaxGasPrice] = useState("50");
  const [autoSettle, setAutoSettle] = useState(true);

  const handleSave = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "hashpoint:settings",
        JSON.stringify({ merchantName, category, maxGasPrice, autoSettle })
      );
      alert("Settings saved");
    }
  };

  return (
    <div style={{ maxWidth: 500, margin: "0 auto", padding: "16px" }}>
      <h1>Settings</h1>

      <section style={{ marginBottom: "24px" }}>
        <h2>Merchant Profile</h2>
        <label>Merchant Name</label>
        <input
          value={merchantName}
          onChange={(e) => setMerchantName(e.target.value)}
          style={{ ...inputStyle }}
        />
        <label>Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ ...inputStyle }}
        >
          <option value="retail">Retail</option>
          <option value="food">Food & Beverage</option>
          <option value="services">Services</option>
          <option value="transport">Transport</option>
        </select>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2>Settlement</h2>
        <label>Max Gas Price (Gwei)</label>
        <input
          type="number"
          value={maxGasPrice}
          onChange={(e) => setMaxGasPrice(e.target.value)}
          style={{ ...inputStyle }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px" }}>
          <input
            type="checkbox"
            checked={autoSettle}
            onChange={(e) => setAutoSettle(e.target.checked)}
            id="autoSettle"
          />
          <label htmlFor="autoSettle">Auto-settle when online</label>
        </div>
      </section>

      <section style={{ marginBottom: "24px" }}>
        <h2>Network</h2>
        <div style={{ color: "#6B778C", fontSize: "14px" }}>
          <div>Chain: HashKey Chain</div>
          <div>Chain ID: {process.env.NEXT_PUBLIC_CHAIN_ID || "177"}</div>
          <div>RPC: {process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.hsk.xyz"}</div>
          <div style={{ marginTop: "8px" }}>
            Escrow: {process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "Not deployed"}
          </div>
        </div>
      </section>

      <button
        onClick={handleSave}
        style={{
          width: "100%",
          padding: "14px",
          backgroundColor: "#0052CC",
          color: "white",
          border: "none",
          borderRadius: "8px",
          fontSize: "16px",
          cursor: "pointer",
        }}
      >
        Save Settings
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "10px",
  marginTop: "4px",
  marginBottom: "12px",
  border: "1px solid #DFE1E6",
  borderRadius: "4px",
  fontSize: "16px",
  boxSizing: "border-box",
};
