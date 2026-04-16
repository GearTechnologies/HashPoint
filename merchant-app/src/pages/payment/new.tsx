"use client";

import React, { useState } from "react";
import { useRouter } from "next/router";
import { ethers } from "ethers";
import { useConnectivity } from "../../hooks/useConnectivity";
import { useSession } from "../../hooks/useSession";
import { useSettlementQueue } from "../../hooks/useSettlementQueue";
import { createSignedPaymentIntent } from "@hashpoint/sdk";

// Filter out tokens whose env vars aren't set — an empty address string
// triggers ENS resolution in ethers v6 signTypedData (address type).
const ALL_TOKENS = [
  { label: "HSK", address: "0x0000000000000000000000000000000000000000" },
  { label: "USDC", address: process.env.NEXT_PUBLIC_USDC_ADDRESS || "" },
  { label: "USDT", address: process.env.NEXT_PUBLIC_USDT_ADDRESS || "" },
];
const TOKENS = ALL_TOKENS.filter((t) => t.address.startsWith("0x") && t.address.length === 42);

export default function NewPayment() {
  const router = useRouter();
  const { isOnline } = useConnectivity();
  const { session, getNextNonce, getMerkleProof } = useSession();
  const { enqueue } = useSettlementQueue();

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [token, setToken] = useState(TOKENS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleNumpad = (val: string) => {
    if (val === "⌫") {
      setAmount((a) => a.slice(0, -1));
    } else if (val === "." && amount.includes(".")) {
      return;
    } else {
      setAmount((a) => a + val);
    }
  };

  const handleGenerate = async () => {
    if (!session) {
      setError("No active session. Open a session first.");
      return;
    }
    const nonce = getNextNonce();
    if (!nonce) {
      setError("No remaining nonce slots. Open a new session.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      // Get signer from wallet
      if (!window.ethereum) throw new Error("No wallet found");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const customer = await signer.getAddress();
      const merchant = customer; // in real app: merchant address from config

      const amountWei = ethers.parseEther(amount || "0");
      const expiry = session.expiry;
      const merchantRef = ethers.encodeBytes32String(
        description.slice(0, 31) || "PAYMENT"
      );
      const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
      const contractAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "";

      const { intent, signature, qrPayload } = await createSignedPaymentIntent(
        signer,
        {
          merchant,
          customer,
          token: token.address,
          amount: amountWei,
          sessionId: session.sessionId,
          nonce,
          expiry,
          merchantRef,
          chainId,
        },
        contractAddress
      );

      const merkleProof = getMerkleProof(nonce);
      const id = await enqueue(intent, signature, merkleProof);

      router.push(`/payment/qr/${id}?qr=${encodeURIComponent(qrPayload)}&amount=${amount}&token=${token.label}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create payment");
    } finally {
      setLoading(false);
    }
  };

  const numpad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

  return (
    <div style={{ maxWidth: 400, margin: "0 auto", padding: "16px" }}>
      {!isOnline && (
        <div
          style={{
            background: "#FFEBE6",
            color: "#DE350B",
            padding: "8px",
            borderRadius: "4px",
            marginBottom: "16px",
          }}
        >
          Offline mode — payment will be queued
        </div>
      )}

      <h1>New Payment</h1>

      <div
        style={{
          fontSize: "48px",
          fontWeight: 700,
          textAlign: "center",
          padding: "24px",
          borderBottom: "2px solid #0052CC",
          marginBottom: "16px",
        }}
      >
        {amount || "0"} {token.label}
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {TOKENS.map((t) => (
          <button
            key={t.label}
            onClick={() => setToken(t)}
            style={{
              flex: 1,
              padding: "8px",
              backgroundColor: token.label === t.label ? "#0052CC" : "#F4F5F7",
              color: token.label === t.label ? "white" : "#172B4D",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{
          width: "100%",
          padding: "12px",
          marginBottom: "16px",
          border: "1px solid #DFE1E6",
          borderRadius: "4px",
          fontSize: "16px",
          boxSizing: "border-box",
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "8px",
          marginBottom: "24px",
        }}
      >
        {numpad.map((k) => (
          <button
            key={k}
            onClick={() => handleNumpad(k)}
            style={{
              padding: "16px",
              fontSize: "20px",
              backgroundColor: k === "⌫" ? "#FFEBE6" : "#F4F5F7",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ color: "#DE350B", marginBottom: "16px" }}>{error}</div>
      )}

      <button
        onClick={handleGenerate}
        disabled={!amount || loading}
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
          opacity: !amount || loading ? 0.5 : 1,
        }}
      >
        {loading ? "Generating..." : "Generate QR"}
      </button>
    </div>
  );
}
