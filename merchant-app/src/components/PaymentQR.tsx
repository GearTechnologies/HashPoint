"use client";

import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { decodeMerchantReference } from "../lib/paymentRequest";

interface PaymentQRProps {
  amountLabel: string;
  reference: string;
  qrValue: string;
  merchantName?: string;
  helperText?: string;
}

export function PaymentQR({ amountLabel, reference, qrValue, merchantName, helperText }: PaymentQRProps) {
  return (
    <div className="payment-qr">
      <div className="payment-qr__amount">
        {amountLabel}
      </div>
      {merchantName && (
        <div className="payment-qr__merchant">{merchantName}</div>
      )}
      <div className="payment-qr__code">
        <QRCodeSVG
          value={qrValue}
          size={320}
          level="M"
          includeMargin
        />
      </div>
      {helperText && <div className="payment-qr__helper">{helperText}</div>}
      <div className="payment-qr__ref">
        Ref: {decodeMerchantReference(reference)}
      </div>
    </div>
  );
}
