"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { PaymentQR } from "../../../components/PaymentQR";
import { formatTokenAmount, getTokenByAddress } from "../../../lib/chain";
import { buildMetaMaskPaymentUrl, buildPaymentUrl, decodePaymentRequest } from "../../../lib/paymentRequest";

/** Delay in ms before redirecting to dashboard after manual payment confirmation. */
const REDIRECT_DELAY_MS = 2000;

export default function QRDisplay() {
  const router = useRouter();
  const { intentId, request } = router.query as Record<string, string>;

  const [confirmed, setConfirmed] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [paymentUrl, setPaymentUrl] = useState("");
  const [metaMaskUrl, setMetaMaskUrl] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          router.push("/dashboard");
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [router]);

  const handleManualConfirm = () => {
    setConfirmed(true);
    setTimeout(() => router.push("/dashboard"), REDIRECT_DELAY_MS);
  };

  useEffect(() => {
    if (!intentId || !request || typeof window === "undefined") return;
    const url = buildPaymentUrl(window.location.origin, intentId, request);
    setPaymentUrl(url);
    setMetaMaskUrl(buildMetaMaskPaymentUrl(url));
  }, [intentId, request]);

  if (!request) return null;

  let paymentRequest;
  try {
    paymentRequest = decodePaymentRequest(request);
  } catch {
    return <div>Invalid payment request</div>;
  }

  const token = getTokenByAddress(paymentRequest.token);
  const amountLabel = `${formatTokenAmount(paymentRequest.amount, paymentRequest.token)} ${token.label}`;
  const scanInstruction = paymentUrl.includes("localhost")
    ? "This QR was generated from localhost, so it is only reachable on this device. Deploy the app or use a public URL before asking a customer to scan it."
    : "Scan with MetaMask or your phone camera to open the customer payment page.";

  return (
    <div
      style={{
        maxWidth: 400,
        margin: "0 auto",
        padding: "16px",
        textAlign: "center",
      }}
    >
      {!confirmed && (
        <div style={{ textAlign: "left", marginBottom: "16px" }}>
          <button onClick={() => router.back()} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", padding: "4px 8px" }}>←</button>
        </div>
      )}
      {confirmed ? (
        <div style={{ fontSize: "64px", marginTop: "80px" }}>
          ✅ Payment Received
        </div>
      ) : (
        <>
          {metaMaskUrl ? (
            <PaymentQR
              amountLabel={amountLabel}
              reference={paymentRequest.merchantRef}
              qrValue={metaMaskUrl}
              merchantName={process.env.NEXT_PUBLIC_MERCHANT_NAME}
              helperText={scanInstruction}
            />
          ) : (
            <div>Preparing payment QR…</div>
          )}
          <div
            style={{
              marginTop: "16px",
              fontSize: "14px",
              color: "#6B778C",
            }}
          >
            Auto-returning in {countdown}s
          </div>
          {paymentUrl && (
            <div style={{ marginTop: "16px", display: "grid", gap: "8px" }}>
              <a
                href={metaMaskUrl || paymentUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "block",
                  padding: "12px 16px",
                  backgroundColor: "#F6851B",
                  color: "white",
                  borderRadius: "8px",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                Open Customer Flow in MetaMask
              </a>
              <Link
                href={paymentUrl}
                target="_blank"
                style={{
                  display: "block",
                  padding: "12px 16px",
                  backgroundColor: "#F4F5F7",
                  color: "#172B4D",
                  borderRadius: "8px",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Open Customer Payment Page
              </Link>
            </div>
          )}
          <button
            onClick={handleManualConfirm}
            style={{
              marginTop: "16px",
              padding: "12px 24px",
              backgroundColor: "#00875A",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "16px",
              cursor: "pointer",
              width: "100%",
            }}
          >
            ✓ Payment Received
          </button>
        </>
      )}
    </div>
  );
}
