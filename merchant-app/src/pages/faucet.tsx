"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ethers } from "ethers";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { parseAbi } from "viem";

const ERC20_WRITE_ABI = parseAbi(["function faucet() external"]);
const HSK_WRITE_ABI = parseAbi(["function claim() external"]);

const ERC20_WRITE_ABI = parseAbi(["function faucet() external"]);
const HSK_WRITE_ABI = parseAbi(["function claim() external"]);

const ERC20_ABI = [
  "function faucet() external",
  "function balanceOf(address) view returns (uint256)",
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
  cooldown: number;
  status: "idle" | "loading" | "success" | "error";
  message: string;
}

const defaultToken: TokenFaucetState = {
  balance: "—", claimed: "—", limit: "—", amount: "—", status: "idle", message: "",
};
const defaultHsk: HskState = {
  nativeBalance: "—", faucetBalance: "—", dripAmount: "—", cooldown: 0, status: "idle", message: "",
};

export default function FaucetPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const publicClient = usePublicClient();

  const [usdc, setUsdc] = useState<TokenFaucetState>(defaultToken);
  const [usdt, setUsdt] = useState<TokenFaucetState>(defaultToken);
  const [hsk, setHsk] = useState<HskState>(defaultHsk);

  const usdcAddress = process.env.NEXT_PUBLIC_USDC_ADDRESS || "";
  const usdtAddress = process.env.NEXT_PUBLIC_USDT_ADDRESS || "";
  const hskFaucetAddress = process.env.NEXT_PUBLIC_HSK_FAUCET_ADDRESS || "";

  const getReadProvider = useCallback(() => {
    return new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL || "https://testnet.hsk.xyz");
  }, []);

  const loadBalances = useCallback(
    async (addr: string) => {
      const provider = getReadProvider();
      if (usdcAddress) {
        const c = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
        const [bal, claimed, limit, amt] = await Promise.all([c.balanceOf(addr), c.faucetClaimed(addr), c.FAUCET_LIMIT(), c.FAUCET_AMOUNT()]);
        setUsdc((s) => ({ ...s, balance: (Number(bal) / 1e6).toFixed(2), claimed: (Number(claimed) / 1e6).toFixed(2), limit: (Number(limit) / 1e6).toFixed(0), amount: (Number(amt) / 1e6).toFixed(0) }));
      }
      if (usdtAddress) {
        const c = new ethers.Contract(usdtAddress, ERC20_ABI, provider);
        const [bal, claimed, limit, amt] = await Promise.all([c.balanceOf(addr), c.faucetClaimed(addr), c.FAUCET_LIMIT(), c.FAUCET_AMOUNT()]);
        setUsdt((s) => ({ ...s, balance: (Number(bal) / 1e6).toFixed(2), claimed: (Number(claimed) / 1e6).toFixed(2), limit: (Number(limit) / 1e6).toFixed(0), amount: (Number(amt) / 1e6).toFixed(0) }));
      }
      const nativeBal = await provider.getBalance(addr);
      if (hskFaucetAddress) {
        const fc = new ethers.Contract(hskFaucetAddress, HSK_FAUCET_ABI, provider);
        const [faucetBal, drip, cooldownSec] = await Promise.all([fc.balance(), fc.dripAmount(), fc.timeUntilNextClaim(addr)]);
        setHsk((s) => ({ ...s, nativeBalance: Number(ethers.formatEther(nativeBal)).toFixed(4), faucetBalance: Number(ethers.formatEther(faucetBal)).toFixed(4), dripAmount: Number(ethers.formatEther(drip)).toFixed(4), cooldown: Number(cooldownSec) }));
      } else {
        setHsk((s) => ({ ...s, nativeBalance: Number(ethers.formatEther(nativeBal)).toFixed(4) }));
      }
    },
    [getReadProvider, usdcAddress, usdtAddress, hskFaucetAddress]
  );

  useEffect(() => {
    if (address) loadBalances(address);
  }, [address, loadBalances]);

  const claimErc20 = async (contractAddr: string, setter: React.Dispatch<React.SetStateAction<TokenFaucetState>>) => {
    if (!address || !walletClient || !publicClient) return;
    setter((s) => ({ ...s, status: "loading", message: "Sending transaction…" }));
    try {
      const hash = await walletClient.writeContract({
        address: contractAddr.trim() as `0x${string}`,
        abi: ERC20_WRITE_ABI,
        functionName: "faucet",
      });
      setter((s) => ({ ...s, message: "Waiting for confirmation…" }));
      await publicClient.waitForTransactionReceipt({ hash });
      setter((s) => ({ ...s, status: "success", message: "Claimed successfully!" }));
      await loadBalances(address);
    } catch (e: unknown) {
      setter((s) => ({ ...s, status: "error", message: e instanceof Error ? e.message.split("(")[0].trim() : "Failed" }));
    }
  };

  const claimHsk = async () => {
    if (!address || !hskFaucetAddress || !walletClient || !publicClient) return;
    setHsk((s) => ({ ...s, status: "loading", message: "Sending transaction…" }));
    try {
      const hash = await walletClient.writeContract({
        address: hskFaucetAddress.trim() as `0x${string}`,
        abi: HSK_WRITE_ABI,
        functionName: "claim",
      });
      setHsk((s) => ({ ...s, message: "Waiting for confirmation…" }));
      await publicClient.waitForTransactionReceipt({ hash });
      setHsk((s) => ({ ...s, status: "success", message: "Claimed successfully!" }));
      await loadBalances(address);
    } catch (e: unknown) {
      setHsk((s) => ({ ...s, status: "error", message: e instanceof Error ? e.message.split("(")[0].trim() : "Failed" }));
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
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", padding: "4px 8px" }}>←</button>
        <h1 style={{ margin: 0, color: "#0B1E3D" }}>Testnet Faucet</h1>
        <div style={{ marginLeft: "auto" }}>
          <ConnectButton showBalance={false} accountStatus="address" chainStatus="none" />
        </div>
      </div>

      <p style={{ color: "#6B778C", fontSize: 14, marginBottom: 24 }}>Get testnet tokens on HashKey Chain (chain 133) for free.</p>

      {!isConnected && (
        <div style={{ textAlign: "center", padding: "24px" }}>
          <ConnectButton label="Connect Wallet to Claim" />
        </div>
      )}

      {usdcAddress && (
        <FaucetCard title="USDC" subtitle="USD Coin (Test) · 6 decimals" color="#2775CA"
          balance={`${usdc.balance} USDC`} claimLabel={`Claim ${usdc.amount || "1,000"} USDC`}
          detail={`Claimed: ${usdc.claimed} / ${usdc.limit}`} status={usdc.status} message={usdc.message}
          disabled={!isConnected || usdc.status === "loading"} onClaim={() => claimErc20(usdcAddress, setUsdc)} />
      )}

      {usdtAddress && (
        <FaucetCard title="USDT" subtitle="Tether USD (Test) · 6 decimals" color="#26A17B"
          balance={`${usdt.balance} USDT`} claimLabel={`Claim ${usdt.amount || "1,000"} USDT`}
          detail={`Claimed: ${usdt.claimed} / ${usdt.limit}`} status={usdt.status} message={usdt.message}
          disabled={!isConnected || usdt.status === "loading"} onClaim={() => claimErc20(usdtAddress, setUsdt)} />
      )}

      {hskFaucetAddress && (
        <FaucetCard title="HSK" subtitle={`Native · Drip: ${hsk.dripAmount} HSK · Faucet: ${hsk.faucetBalance} HSK`} color="#0B1E3D"
          balance={`${hsk.nativeBalance} HSK`}
          claimLabel={hsk.cooldown > 0 ? `Next claim in ${fmt(hsk.cooldown)}` : `Claim ${hsk.dripAmount || "0.01"} HSK`}
          detail={hsk.cooldown > 0 ? "24-hour cooldown between claims" : "Ready to claim"}
          status={hsk.status} message={hsk.message}
          disabled={!isConnected || hsk.status === "loading" || hsk.cooldown > 0} onClaim={claimHsk} />
      )}

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "space-around", backgroundColor: "white", borderTop: "1px solid #e0e0e0", padding: "8px 0" }}>
        <Link href="/dashboard">🏠 Home</Link>
        <Link href="/session">🔑 Session</Link>
        <Link href="/queue">📋 Queue</Link>
        <Link href="/faucet" style={{ color: "#0B1E3D", fontWeight: 700 }}>🚰 Faucet</Link>
        <Link href="/settings">⚙️ Settings</Link>
      </nav>
    </div>
  );
}

interface FaucetCardProps {
  title: string; subtitle: string; color: string; balance: string;
  claimLabel: string; detail: string; status: "idle" | "loading" | "success" | "error";
  message: string; disabled: boolean; onClaim: () => void;
}

function FaucetCard({ title, subtitle, color, balance, claimLabel, detail, status, message, disabled, onClaim }: FaucetCardProps) {
  return (
    <div style={{ border: `1.5px solid ${color}33`, borderRadius: 12, padding: "20px", marginBottom: 16, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{title}</div>
        <div>
          <div style={{ fontWeight: 600, color: "#0B1E3D" }}>{title}</div>
          <div style={{ fontSize: 12, color: "#6B778C" }}>{subtitle}</div>
        </div>
        <div style={{ marginLeft: "auto", fontWeight: 700, color: "#0B1E3D", fontSize: 16 }}>{balance}</div>
      </div>
      <div style={{ fontSize: 12, color: "#6B778C", marginBottom: 12 }}>{detail}</div>
      <button onClick={onClaim} disabled={disabled} style={{ width: "100%", padding: "10px", fontSize: 14, border: "none", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", background: disabled ? "#DFE1E6" : color, color: disabled ? "#6B778C" : "white", fontWeight: 600 }}>
        {status === "loading" ? "⏳ " : ""}{claimLabel}
      </button>
      {message && (
        <div style={{ marginTop: 8, fontSize: 13, color: status === "error" ? "#DE350B" : status === "success" ? "#00875A" : "#6B778C" }}>
          {status === "success" ? "✓ " : status === "error" ? "✕ " : ""}{message}
        </div>
      )}
    </div>
  );
}
