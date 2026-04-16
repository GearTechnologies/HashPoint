import { ethers } from "ethers";
import { PaymentIntentData, HASHPOINT_DOMAIN_BASE, PAYMENT_INTENT_TYPES } from "../offline/PaymentIntent";

/**
 * Signer utilities for EIP-712 payment intents.
 */
export class Signer {
  constructor(private signer: ethers.Signer) {}

  async signPaymentIntent(
    intent: PaymentIntentData,
    contractAddress: string
  ): Promise<string> {
    const domain = { ...HASHPOINT_DOMAIN_BASE, chainId: intent.chainId, verifyingContract: contractAddress };
    return this.signer.signTypedData(domain, PAYMENT_INTENT_TYPES, {
      ...intent,
      amount: intent.amount.toString(),
      sessionId: intent.sessionId.toString(),
    });
  }

  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }
}
