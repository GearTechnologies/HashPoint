import { ethers } from "ethers";

export interface PaymentIntentData {
  merchant: string;
  customer: string;
  token: string; // address(0) for native HSK
  amount: bigint;
  sessionId: bigint;
  nonce: string; // bytes32 hex
  expiry: number; // unix timestamp
  merchantRef: string; // bytes32 hex — invoice reference
  chainId: number; // HashKey Chain ID
}

export const HASHPOINT_DOMAIN_BASE = {
  name: "HashPoint",
  version: "1",
};

export const PAYMENT_INTENT_TYPES = {
  PaymentIntent: [
    { name: "merchant", type: "address" },
    { name: "customer", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "sessionId", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint256" },
    { name: "merchantRef", type: "bytes32" },
    { name: "chainId", type: "uint256" },
  ],
};

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

/**
 * Creates and signs a PaymentIntent offline using EIP-712.
 * This is called on the CUSTOMER's device — no network required.
 */
export async function createSignedPaymentIntent(
  signer: ethers.Signer,
  intent: PaymentIntentData,
  contractAddress: string
): Promise<{ intent: PaymentIntentData; signature: string; qrPayload: string }> {
  if (!contractAddress || contractAddress === "0x") {
    throw new Error("NEXT_PUBLIC_ESCROW_ADDRESS is not set. Check your environment configuration.");
  }
  const domain = { ...HASHPOINT_DOMAIN_BASE, chainId: intent.chainId, verifyingContract: contractAddress };
  const signature = await signer.signTypedData(domain, PAYMENT_INTENT_TYPES, {
    ...intent,
    amount: intent.amount.toString(),
    sessionId: intent.sessionId.toString(),
  });

  const qrPayload = encodeQRPayload(intent, signature);
  return { intent, signature, qrPayload };
}

/**
 * Encodes payment intent + signature into a compact QR string.
 * Uses base64url encoding to minimize QR density.
 */
export function encodeQRPayload(intent: PaymentIntentData, signature: string): string {
  const payload = {
    v: 1,
    m: intent.merchant,
    c: intent.customer,
    t: intent.token,
    a: intent.amount.toString(),
    s: intent.sessionId.toString(),
    n: intent.nonce,
    e: intent.expiry,
    r: intent.merchantRef,
    ch: intent.chainId,
    sig: signature,
  };
  return encodeBase64Url(JSON.stringify(payload));
}

export function decodeQRPayload(encoded: string): {
  intent: PaymentIntentData;
  signature: string;
} {
  const payload = JSON.parse(decodeBase64Url(encoded));
  return {
    intent: {
      merchant: payload.m,
      customer: payload.c,
      token: payload.t,
      amount: BigInt(payload.a),
      sessionId: BigInt(payload.s),
      nonce: payload.n,
      expiry: payload.e,
      merchantRef: payload.r,
      chainId: Number(payload.ch ?? 133),
    },
    signature: payload.sig,
  };
}

/**
 * Verifies a payment intent signature OFFLINE — no chain call needed.
 * Merchant device can confirm authenticity before accepting payment.
 */
export function verifyPaymentIntentOffline(
  intent: PaymentIntentData,
  signature: string,
  contractAddress: string
): boolean {
  try {
    const domain = { ...HASHPOINT_DOMAIN_BASE, chainId: intent.chainId, verifyingContract: contractAddress };
    const recovered = ethers.verifyTypedData(
      domain,
      PAYMENT_INTENT_TYPES,
      {
        ...intent,
        amount: intent.amount.toString(),
        sessionId: intent.sessionId.toString(),
      },
      signature
    );
    return recovered.toLowerCase() === intent.customer.toLowerCase();
  } catch {
    return false;
  }
}
