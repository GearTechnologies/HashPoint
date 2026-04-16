import { ethers } from "ethers";

export interface PaymentRequestData {
  merchant: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  sessionId: bigint;
  nonce: `0x${string}`;
  expiry: number;
  merchantRef: `0x${string}`;
  chainId: number;
  merkleProof: `0x${string}`[];
}

function encodeUtf8ToBase64(value: string): string {
  if (typeof globalThis.btoa === "function") {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return globalThis.btoa(binary);
  }

  return Buffer.from(value, "utf8").toString("base64");
}

function decodeBase64ToUtf8(value: string): string {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  return Buffer.from(value, "base64").toString("utf8");
}

function encodeBase64Url(value: string): string {
  return encodeUtf8ToBase64(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (base64.length % 4)) % 4;
  return decodeBase64ToUtf8(base64 + "=".repeat(padding));
}

export function encodePaymentRequest(request: PaymentRequestData): string {
  return encodeBase64Url(
    JSON.stringify({
      v: 1,
      m: request.merchant,
      t: request.token,
      a: request.amount.toString(),
      s: request.sessionId.toString(),
      n: request.nonce,
      e: request.expiry,
      r: request.merchantRef,
      ch: request.chainId,
      p: request.merkleProof,
    })
  );
}

export function decodePaymentRequest(encoded: string): PaymentRequestData {
  const payload = JSON.parse(decodeBase64Url(encoded));
  return {
    merchant: payload.m,
    token: payload.t,
    amount: BigInt(payload.a),
    sessionId: BigInt(payload.s),
    nonce: payload.n,
    expiry: Number(payload.e),
    merchantRef: payload.r,
    chainId: Number(payload.ch ?? 133),
    merkleProof: Array.isArray(payload.p) ? payload.p : [],
  };
}

export function buildPaymentUrl(baseUrl: string, intentId: string, encodedRequest: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return `${normalizedBaseUrl}/pay/${encodeURIComponent(intentId)}/${encodedRequest}`;
}

export function buildMetaMaskPaymentUrl(paymentUrl: string): string {
  const withoutProtocol = paymentUrl.replace(/^https?:\/\//, "");
  return `https://metamask.app.link/dapp/${withoutProtocol}`;
}

export function decodeMerchantReference(merchantRef: string): string {
  try {
    return ethers.decodeBytes32String(merchantRef);
  } catch {
    return merchantRef;
  }
}

export function generateRequestId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}