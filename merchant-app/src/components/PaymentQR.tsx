"use client";

import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { PaymentIntentData } from "@hashpoint/sdk";

interface PaymentQRProps {
  intent: PaymentIntentData;
  qrPayload: string;
  merchantName?: string;
}

export function PaymentQR({ intent, qrPayload, merchantName }: PaymentQRProps) {
  const amount = Number(intent.amount) / 1e18;
  const tokenLabel = intent.token === "0x0000000000000000000000000000000000000000"
    ? "HSK"
    : "Token";

  return (
    <div className="payment-qr">
      <div className="payment-qr__amount">
        {amount.toFixed(4)} {tokenLabel}
      </div>
      {merchantName && (
        <div className="payment-qr__merchant">{merchantName}</div>
      )}
      <div className="payment-qr__code">
        <QRCodeSVG
          value={qrPayload}
          size={320}
          level="M"
          includeMargin
        />
      </div>
      <div className="payment-qr__ref">
        Ref: {Buffer.from(intent.merchantRef.slice(2), "hex")
          .toString("utf8")
          .replace(/\0/g, "")}
      </div>
    </div>
  );
}
