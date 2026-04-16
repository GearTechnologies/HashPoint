"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ethers } from "ethers";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 133);

const ERC20_ABI = [
  "function faucet() external",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function faucetClaimed(address) view returns (uint256)",
  "function FAUCET_LIMIT() view returns (uint256)",
  "function FAUCET_AMOUNT() view returns (uint256)",
];

const HSK_FAUCET_ABI = [
  "function claim() external",
  "function dripAmount() view returns (uint256)",
  "function timeUntilNextClaim(address) view returns (uint256)",
  "function balance() view returns (uint256)",
];

interface TokenFaucetState {
  balance: string;
  claimed: string;
  limit: string;
  amount: string;
  status: "idle" | "loading" | "success" | "error";
  message: string;
}

interface HskState {
  nativeBalance: string;
  faucetBalance: string;
  dripAmount: string;
  cooldown: number; // seconds remaining
  status: "idle" | "loading" | "success" | "error";
  message: string;
}

const defaultToken: TokenFaucetState = {
  balance: "—",
  claimed: "—",
  limit: "—",
  amount: "—",
  status: "idle",
  message: "",
};

const defaultHsk: HskState = {
  nativeBalance: "—",
  faucetBalance: "—",
  dripAmount: "—",
  cooldown: 0,
  status: "idle",
  message: "",
};

export default function FaucetPage() {
  const [account, setAccount] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<TokenFaucetState>(defaultToken);
  const [usdt, setUsdt] = useState<TokenFaucetState>(defaultToken);
  const [hsk, setHsk] = useState<HskState>(defaultHsk);

  const usdcAddress = process.env.NEXT_PUBLIC_USDC_ADDRESS || "";
  const usdtAddress = process.env.NEXT_PUBLIC_USDT_ADDRESS || "";
  const hskFaucetAddress = process.env.NEXT_PUBLIC_HSK_FAUCET_ADDRESS || "";

  const getProvider = useCallback(() => {
    if (!window.ethereum) throw new Error("No wallet found");
    return new ethers.BrowserProvider(window.ethereum);
  }, []);

  const connect = useCallback(async () => {
    const provider = getProvider();
    await provider.send("eth_requestAccounts", []);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) {
      try {
        await provider.send("wallet_switchEthereumChain", [
          { chainId: `0x${CHAIN_ID.toString(16)}` },
        ]);
      } catch {
        await provider.send("wallet_addEthereumChain", [
          {
            chainId: `0x${CHAIN_ID.toString(16)}`,
            chainName: "HashKey Chain Testnet",
            nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
            rpcUrls: [process.env.NEXT_PUBLIC_RPC_URL || "https://testnet.hsk.xyz"],
          },
        ]);
      }
    }
    const signer = await provider.getSigner();
    setAccount(await signer.getAddress());
  }, [getProvider]);

  const loadBalances = useCallback(
    async (addr: string) => {
      const provider = getProvider();

      // USDC
      if (usdcAddress) {
        const c = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
        const [bal, claimed, limit, amt] = await Promise.all([
          c.balanceOf(addr),
          c.faucetClaimed(addr),
          c.FAUCET_LIMIT(),
          c.FAUCET_AMOUNT(),
        ]);
        setUsdc((s) => ({
          ...s,
          balance: (Number(bal) / 1e6).toFixed(2),
          claimed: (Number(claimed) / 1e6).toFixed(2),
          limit: (Number(limit) / 1e6).toFixed(0),
          amount: (Number(amt) / 1e6).toFixed(0),
        }));
      }

      // USDT
      if (usdtAddress) {
        const c = new ethers.Contract(usdtAddress, ERC20_ABI, provider);
        const [bal, claimed, limit, amt] = await Promise.all([
          c.balanceOf(addr),
          c.faucetClaimed(addr),
          c.FAUCET_LIMIT(),
          c.FAUCET_AMOUNT(),
        ]);
        setUsdt((s) => ({
          ...s,
          balance: (Number(bal) / 1e6).toFixed(2),
          claimed: (Number(claimed) / 1e6).toFixed(2),
          limit: (Number(limit) / 1e6).toFixed(0),
          amount: (Number(amt) / 1e6).toFixed(0),
        }));
      }

      // HSK native + faucet
      const nativeBal = await provider.getBalance(addr);
      if (hskFaucetAddress) {
        const fc = new ethers.Contract(hskFaucetAddress, HSK_FAUCET_ABI, provider);
        const [faucetBal, drip, cooldownSec] = await Promise.all([
          fc.balance(),
          fc.dripAmount(),
          fc.timeUntilNextClaim(addr),
        ]);
        setHsk((s) => ({
          ...s,
          nativeBalance: Number(ethers.formatEther(nativeBal)).toFixed(4),
          faucetBalance: Number(ethers.formatEther(faucetBal)).toFixed(4),
          dripAmount: Number(ethers.formatEther(drip)).toFixed(4),
          cooldown: Number(cooldownSec),
        }));
      } else {
        setHsk((s) => ({
          ...s,
          nativeBalance: Number(ethers.formatEther(nativeBal)).toFixed(4),
        }));
      }
    },
    [getProvider, usdcAddress, usdtAddress, hskFaucetAddress]
  );

  useEffect(() => {
    if (account) loadBalances(account);
  }, [account, loadBalances]);

  const claimErc20 = async (
    address: string,
    setter: React.Dispatch<React.SetStateAction<TokenFaucetState>>
  ) => {
    if (!account) return;
    setter((s) => ({ ...s, status: "loading", message: "Sending transaction…" }));
    try {
      const provider = getProvider();
      const signer = await provider.getSigner();
      const c = new ethers.Contract(address, ERC20_ABI, signer);
      const tx = await c.faucet();
      setter((s) => ({ ...s, message: "Waiting for confirmation…" }));
      await tx.wait();
      setter((s) => ({ ...s, status: "success", message: "Claimed successfully!" }));
      await loadBalances(account);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.split("(")[0].trim() : "Failed";
      setter((s) => ({ ...s, status: "error", message: msg }));
    }
  };

  const claimHsk = async () => {
    if (!account || !hskFaucetAddress) return;
    setHsk((s) => ({ ...s, status: "loading", message: "Sending transaction…" }));
    try {
      const provider = getProvider();
      const signer = await provider.getSigner();
      const fc = new ethers.Contract(hskFaucetAddress, HSK_FAUCET_ABI, signer);
      const tx = await fc.claim();
      setHsk((s) => ({ ...s, message: "Waiting for confirmation…" }));
      await tx.wait();
      setHsk((s) => ({ ...s, status: "success", message: "Claimed successfully!" }));
      await loadBalances(account);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.split("(")[0].trim() : "Failed";
      setHsk((s) => ({ ...s, status: "error", message: msg }));
    }
  };

  const fmt = (secs: number) => {
    if (secs <= 0) return null;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 16px 100px" }}>
      <h1 style={{ color: "#0B1E3D", marginBottom: 4 }}>Testnet Faucet</h1>
      <p style={{ color: "#6B778C", fontSize: 14, marginBottom: 24 }}>
        Get testnet tokens on HashKey Chain (chain 133) for free.
      </p>

      {!account ? (
        <button onClick={connect} style={btnPrimary}>
          Connect Wallet
        </button>
      ) : (
        <div style={{ fontSize: 13, color: "#6B778C", marginBottom: 24, wordBreak: "break-all" }}>
          Connected: <strong style={{ color: "#0B1E3D" }}>{account}</strong>
        </div>
      )}

      {/* USDC */}
      {usdcAddress && (
        <FaucetCard
          title="USDC"
          subtitle="USD Coin (Test) · 6 decimals"
          color="#2775CA"
          balance={`${usdc.balance} USDC`}
          claimLabel={`Claim ${usdc.amount || "1,000"} USDC`}
          detail={`Claimed: ${usdc.claimed} / ${usdc.limit}`}
          status={usdc.status}
          message={usdc.message}
          disabled={!account || usdc.status === "loading"}
          onClaim={() => claimErc20(usdcAddress, setUsdc)}
        />
      )}

      {/* USDT */}
      {usdtAddress && (
        <FaucetCard
          title="USDT"
          subtitle="Tether USD (Test) · 6 decimals"
          color="#26A17B"
          balance={`${usdt.balance} USDT`}
          claimLabel={`Claim ${usdt.amount || "1,000"} USDT`}
          detail={`Claimed: ${usdt.claimed} / ${usdt.limit}`}
          status={usdt.status}
          message={usdt.message}
          disabled={!account || usdt.status === "loading"}
          onClaim={() => claimErc20(usdtAddress, setUsdt)}
        />
      )}

      {/* HSK */}
      {hskFaucetAddress && (
        <FaucetCard
          title="HSK"
          subtitle={`Native token · Drip: ${hsk.dripAmount} HSK · Faucet holds: ${hsk.faucetBalance} HSK`}
          color="#0B1E3D"
          balance={`${hsk.nativeBalance} HSK`}
          claimLabel={
            hsk.cooldown > 0
              ? `Next claim in ${fmt(hsk.cooldown)}`
              : `Claim ${hsk.dripAmount || "0.01"} HSK`
          }
          detail={hsk.cooldown > 0 ? "24-hour cooldown between claims" : "Ready to claim"}
          status={hsk.status}
          message={hsk.message}
          disabled={!account || hsk.status === "loading" || hsk.cooldown > 0}
          onClaim={claimHsk}
        />
      )}

      {/* Bottom nav */}
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
        <Link href="/faucet" style={{ color: "#0B1E3D", fontWeight: 700 }}>
          🚰 Faucet
        </Link>
        <Link href="/settings">⚙️ Settings</Link>
      </nav>
    </div>
  );
}

interface FaucetCardProps {
  title: string;
  subtitle: string;
  color: string;
  balance: string;
  claimLabel: string;
  detail: string;
  status: "idle" | "loading" | "success" | "error";
  message: string;
  disabled: boolean;
  onClaim: () => void;
}

function FaucetCard({
  title,
  subtitle,
  color,
  balance,
  claimLabel,
  detail,
  status,
  message,
  disabled,
  onClaim,
}: FaucetCardProps) {
  return (
    <div
      style={{
        border: `1.5px solid ${color}22`,
        borderRadius: 12,
        padding: "20px",
        marginBottom: 16,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontWeight: 700,
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          {title}
        </div>
        <div>
          <div style={{ fontWeight: 600, color: "#0B1E3D" }}>{title}</div>
          <div style={{ fontSize: 12, color: "#6B778C" }}>{subtitle}</div>
        </div>
        <div style={{ marginLeft: "auto", fontWeight: 700, color: "#0B1E3D", fontSize: 16 }}>
          {balance}
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#6B778C", marginBottom: 12 }}>{detail}</div>

      <button
        onClick={onClaim}
        disabled={disabled}
        style={{
          ...btnPrimary,
          background: disabled ? "#DFE1E6" : color,
          color: disabled ? "#6B778C" : "white",
          cursor: disabled ? "not-allowed" : "pointer",
          width: "100%",
          padding: "10px",
          fontSize: 14,
        }}
      >
        {status === "loading" ? "⏳ " : ""}
        {claimLabel}
      </button>

      {message && (
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: status === "error" ? "#DE350B" : status === "success" ? "#00875A" : "#6B778C",
          }}
        >
          {status === "success" ? "✓ " : status === "error" ? "✕ " : ""}
          {message}
        </div>
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  background: "#0B1E3D",
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "12px 24px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  display: "block",
  width: "100%",
  marginBottom: 24,
};
