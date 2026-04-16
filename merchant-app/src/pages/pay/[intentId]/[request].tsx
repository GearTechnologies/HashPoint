"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { parseAbi } from "viem";
import { HASHPOINT_DOMAIN_BASE, PAYMENT_INTENT_TYPES } from "@hashpoint/sdk";
import { ZERO_ADDRESS, formatTokenAmount, getTokenByAddress, normalizeAddress, requireAddress } from "../../../lib/chain";
import { decodeMerchantReference, decodePaymentRequest } from "../../../lib/paymentRequest";

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const ESCROW_ABI = parseAbi([
  "function settlePayment((address merchant,address customer,address token,uint256 amount,uint256 sessionId,bytes32 nonce,uint256 expiry,bytes32 merchantRef,uint256 chainId) intent, bytes sig, bytes32[] merkleProof) payable",
]);

export default function CustomerPaymentPage() {
  const router = useRouter();
  const { intentId, request } = router.query as Record<string, string>;
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  if (!request) {
    return null;
  }

  let paymentRequest;
  try {
    paymentRequest = decodePaymentRequest(request);
  } catch {
    return <div style={{ padding: "24px" }}>Invalid payment request.</div>;
  }

  const token = getTokenByAddress(paymentRequest.token);
  const amountLabel = `${formatTokenAmount(paymentRequest.amount, paymentRequest.token)} ${token.label}`;
  const isExpired = Math.floor(Date.now() / 1000) > paymentRequest.expiry;
  const canPay = paymentRequest.sessionId > 0n && !isExpired;

  const handlePay = async () => {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setError("Connect a customer wallet to continue.");
      return;
    }

    const customerAddress = normalizeAddress(address, { allowZeroAddress: false });
    if (!customerAddress) {
      setError("Connected wallet address is invalid.");
      return;
    }

    setLoading(true);
    setError("");
    setStep("Preparing payment intent…");

    try {
      const escrowAddress = requireAddress(
        process.env.NEXT_PUBLIC_ESCROW_ADDRESS,
        "NEXT_PUBLIC_ESCROW_ADDRESS",
        { allowZeroAddress: false }
      );

      const intent = {
        merchant: paymentRequest.merchant,
        customer: customerAddress,
        token: paymentRequest.token,
        amount: paymentRequest.amount,
        sessionId: paymentRequest.sessionId,
        nonce: paymentRequest.nonce,
        expiry: paymentRequest.expiry,
        merchantRef: paymentRequest.merchantRef,
        chainId: paymentRequest.chainId,
      };

      setStep("Requesting wallet signature…");
      const signature = await walletClient.signTypedData({
        domain: {
          ...HASHPOINT_DOMAIN_BASE,
          chainId: paymentRequest.chainId,
          verifyingContract: escrowAddress,
        },
        types: PAYMENT_INTENT_TYPES as Parameters<typeof walletClient.signTypedData>[0]["types"],
        primaryType: "PaymentIntent",
        message: {
          merchant: intent.merchant,
          customer: intent.customer,
          token: intent.token,
          amount: intent.amount,
          sessionId: intent.sessionId,
          nonce: intent.nonce as `0x${string}`,
          expiry: BigInt(intent.expiry),
          merchantRef: intent.merchantRef,
          chainId: BigInt(intent.chainId),
        },
      });

      if (paymentRequest.token !== ZERO_ADDRESS) {
        setStep(`Checking ${token.label} allowance…`);
        const allowance = await publicClient.readContract({
          address: paymentRequest.token,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [customerAddress, escrowAddress],
        });

        if (allowance < paymentRequest.amount) {
          setStep(`Approving ${token.label} for escrow…`);
          const approveHash = await walletClient.writeContract({
            address: paymentRequest.token,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [escrowAddress, paymentRequest.amount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      setStep("Submitting payment on-chain…");
      const settleHash = await walletClient.writeContract({
        address: escrowAddress,
        abi: ESCROW_ABI,
        functionName: "settlePayment",
        args: [
          {
            merchant: intent.merchant,
            customer: intent.customer,
            token: intent.token,
            amount: intent.amount,
            sessionId: intent.sessionId,
            nonce: intent.nonce as `0x${string}`,
            expiry: BigInt(intent.expiry),
            merchantRef: intent.merchantRef,
            chainId: BigInt(intent.chainId),
          },
          signature,
          paymentRequest.merkleProof,
        ],
        value: paymentRequest.token === ZERO_ADDRESS ? paymentRequest.amount : undefined,
      });

      await publicClient.waitForTransactionReceipt({ hash: settleHash });
      setTxHash(settleHash);
      setStep("Payment confirmed.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Payment failed.");
      setStep("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px 72px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", padding: "4px 8px" }}>←</button>
        <h1 style={{ margin: 0, color: "#0B1E3D" }}>Pay with HashPoint</h1>
        <div style={{ marginLeft: "auto" }}>
          <ConnectButton showBalance={false} accountStatus="address" chainStatus="none" />
        </div>
      </div>

      <div style={{ borderRadius: "16px", background: "#ffffff", boxShadow: "0 14px 40px rgba(11,30,61,0.08)", padding: "24px" }}>
        <div style={{ fontSize: "14px", color: "#6B778C", marginBottom: "8px" }}>Request ID: {intentId}</div>
        <div style={{ fontSize: "40px", fontWeight: 800, color: "#0B1E3D", marginBottom: "8px" }}>{amountLabel}</div>
        <div style={{ color: "#6B778C", marginBottom: "16px" }}>Merchant: {process.env.NEXT_PUBLIC_MERCHANT_NAME || `${paymentRequest.merchant.slice(0, 6)}...${paymentRequest.merchant.slice(-4)}`}</div>
        <div style={{ fontSize: "14px", color: "#172B4D", marginBottom: "8px" }}>Reference: {decodeMerchantReference(paymentRequest.merchantRef)}</div>
        <div style={{ fontSize: "14px", color: "#172B4D", marginBottom: "8px" }}>Expires: {new Date(paymentRequest.expiry * 1000).toLocaleString()}</div>
        <div style={{ fontSize: "14px", color: paymentRequest.sessionId > 0n ? "#172B4D" : "#DE350B", marginBottom: "20px" }}>
          Session ID: {paymentRequest.sessionId.toString()}
        </div>

        {!canPay && (
          <div style={{ background: "#FFEBE6", color: "#DE350B", padding: "12px", borderRadius: "10px", marginBottom: "16px" }}>
            {isExpired
              ? "This payment request has expired. Ask the merchant to generate a new one."
              : "This payment request is tied to a local-only merchant session and cannot be settled. Ask the merchant to reopen their session on-chain and generate a new QR."}
          </div>
        )}

        {error && (
          <div style={{ background: "#FFEBE6", color: "#DE350B", padding: "12px", borderRadius: "10px", marginBottom: "16px" }}>
            {error}
          </div>
        )}

        {step && !txHash && (
          <div style={{ background: "#E9F2FF", color: "#0052CC", padding: "12px", borderRadius: "10px", marginBottom: "16px" }}>
            {step}
          </div>
        )}

        {txHash ? (
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={{ background: "#E3FCEF", color: "#006644", padding: "12px", borderRadius: "10px" }}>
              Payment confirmed on-chain.
            </div>
            <a
              href={`https://testnet.hashkeyscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#0052CC", fontWeight: 700, textDecoration: "none" }}
            >
              View transaction on explorer
            </a>
            <Link href="/dashboard" style={{ color: "#172B4D", fontWeight: 600, textDecoration: "none" }}>
              Return to merchant dashboard
            </Link>
          </div>
        ) : (
          <button
            onClick={handlePay}
            disabled={!canPay || loading || !isConnected}
            style={{
              width: "100%",
              padding: "16px",
              backgroundColor: !canPay || loading || !isConnected ? "#DFE1E6" : "#0B1E3D",
              color: !canPay || loading || !isConnected ? "#6B778C" : "white",
              border: "none",
              borderRadius: "12px",
              fontSize: "16px",
              fontWeight: 700,
              cursor: !canPay || loading || !isConnected ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Waiting for wallet…" : isConnected ? `Pay ${amountLabel}` : "Connect Wallet to Pay"}
          </button>
        )}
      </div>
    </div>
  );
}