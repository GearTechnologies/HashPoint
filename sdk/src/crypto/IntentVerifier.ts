import { ethers } from "ethers";
import {
  PaymentIntentData,
  HASHPOINT_DOMAIN_BASE,
  PAYMENT_INTENT_TYPES,
} from "../offline/PaymentIntent";

/**
 * IntentVerifier verifies payment intent signatures fully offline.
 * No network connection required.
 */
export class IntentVerifier {
  /**
   * Verify the signature of a payment intent.
   * @returns true if the signature is valid and was signed by intent.customer
   */
  static verify(
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

  /**
   * Check whether an intent has expired.
   */
  static isExpired(intent: PaymentIntentData): boolean {
    return Math.floor(Date.now() / 1000) > intent.expiry;
  }

  /**
   * Validate all fields of the intent are present and well-formed.
   */
  static validate(intent: PaymentIntentData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!ethers.isAddress(intent.merchant)) errors.push("Invalid merchant address");
    if (!ethers.isAddress(intent.customer)) errors.push("Invalid customer address");
    if (!ethers.isAddress(intent.token) && intent.token !== ethers.ZeroAddress)
      errors.push("Invalid token address");
    if (intent.amount <= 0n) errors.push("Amount must be > 0");
    if (intent.sessionId <= 0n) errors.push("SessionId must be > 0");
    if (!intent.nonce || intent.nonce.length !== 66) errors.push("Invalid nonce");
    if (IntentVerifier.isExpired(intent)) errors.push("Intent is expired");

    return { valid: errors.length === 0, errors };
  }
}
