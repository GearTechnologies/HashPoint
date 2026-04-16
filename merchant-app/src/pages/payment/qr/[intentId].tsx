"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { decodeQRPayload } from "@hashpoint/sdk";
import { PaymentQR } from "../../../components/PaymentQR";

/** Delay in ms before redirecting to dashboard after manual payment confirmation. */
const REDIRECT_DELAY_MS = 2000;

export default function QRDisplay() {
  const router = useRouter();
  const { intentId, qr } = router.query as Record<string, string>;

  const [confirmed, setConfirmed] = useState(false);
  const [countdown, setCountdown] = useState(30);

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

  if (!qr) return null;

  let intent, signature;
  try {
    ({ intent, signature } = decodeQRPayload(qr));
  } catch {
    return <div>Invalid QR payload</div>;
  }

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
          <PaymentQR intent={intent} qrPayload={qr} />
          <div
            style={{
              marginTop: "16px",
              fontSize: "14px",
              color: "#6B778C",
            }}
          >
            Auto-returning in {countdown}s
          </div>
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
