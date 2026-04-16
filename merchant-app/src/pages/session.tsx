"use client";

import React, { useState } from "react";
import { useRouter } from "next/router";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { parseAbi } from "viem";
import { SessionStatus } from "../components/SessionStatus";
import { useSession } from "../hooks/useSession";
import { useConnectivity } from "../hooks/useConnectivity";
import { requireAddress } from "../lib/chain";

const NONCE_REGISTRY_ABI = parseAbi([
  "function openSession(bytes32 nonceRoot, uint256 durationSeconds, uint256 maxPayments) returns (uint256)",
  "function currentSessionId(address merchant) view returns (uint256)",
]);

const DURATIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "4 hours", seconds: 14400 },
  { label: "8 hours", seconds: 28800 },
  { label: "24 hours", seconds: 86400 },
];

export default function SessionPage() {
  const router = useRouter();
  const { session, prepareSession, activateSession, closeSession } = useSession();
  const { isOnline } = useConnectivity();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [selectedDuration, setSelectedDuration] = useState(DURATIONS[0]);
  const [maxPayments, setMaxPayments] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleOpenSession = async () => {
    if (!isOnline) {
      setError("Must be online to open a session");
      return;
    }
    if (!isConnected || !address || !walletClient || !publicClient) {
      setError("Connect the merchant wallet to open an on-chain session.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const prepared = prepareSession(maxPayments, selectedDuration.seconds);
      const nonceRegistryAddress = requireAddress(
        process.env.NEXT_PUBLIC_NONCE_REGISTRY_ADDRESS,
        "NEXT_PUBLIC_NONCE_REGISTRY_ADDRESS",
        { allowZeroAddress: false }
      );

      const hash = await walletClient.writeContract({
        address: nonceRegistryAddress,
        abi: NONCE_REGISTRY_ABI,
        functionName: "openSession",
        args: [prepared.nonceRoot as `0x${string}`, BigInt(selectedDuration.seconds), BigInt(maxPayments)],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      const sessionId = await publicClient.readContract({
        address: nonceRegistryAddress,
        abi: NONCE_REGISTRY_ABI,
        functionName: "currentSessionId",
        args: [address as `0x${string}`],
      });

      activateSession(prepared, sessionId);
    } catch (err: unknown) {
      closeSession();
      setError(err instanceof Error ? err.message : "Failed to open session");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 500, margin: "0 auto", padding: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", padding: "4px 8px" }}>←</button>
        <h1 style={{ margin: 0 }}>Session Manager</h1>
        <div style={{ marginLeft: "auto" }}>
          <ConnectButton showBalance={false} accountStatus="address" chainStatus="none" />
        </div>
      </div>
      <SessionStatus />

      {session ? (
        <button
          onClick={closeSession}
          style={{
            marginTop: "16px",
            padding: "12px 24px",
            backgroundColor: "#DE350B",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          Close Session
        </button>
      ) : (
        <div style={{ marginTop: "24px" }}>
          <h2>Open New Session</h2>

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
              ⚠️ Internet connection required to open a session
            </div>
          )}

          <div style={{ marginBottom: "16px" }}>
            <label>Duration:</label>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
              {DURATIONS.map((d) => (
                <button
                  key={d.seconds}
                  onClick={() => setSelectedDuration(d)}
                  style={{
                    flex: 1,
                    padding: "8px",
                    backgroundColor:
                      selectedDuration.seconds === d.seconds
                        ? "#0052CC"
                        : "#F4F5F7",
                    color:
                      selectedDuration.seconds === d.seconds ? "white" : "#172B4D",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label>Max Payments: {maxPayments}</label>
            <input
              type="range"
              min={1}
              max={1000}
              value={maxPayments}
              onChange={(e) => setMaxPayments(Number(e.target.value))}
              style={{ width: "100%", marginTop: "8px" }}
            />
          </div>

          {error && (
            <div style={{ color: "#DE350B", marginBottom: "16px" }}>{error}</div>
          )}

          <button
            onClick={handleOpenSession}
            disabled={loading || !isOnline}
            style={{
              width: "100%",
              padding: "16px",
              backgroundColor: "#0052CC",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "16px",
              cursor: "pointer",
              opacity: loading || !isOnline ? 0.5 : 1,
            }}
          >
            {loading ? "Opening..." : "Open Session"}
          </button>
        </div>
      )}
    </div>
  );
}
