import { ethers } from "ethers";

export interface HSPMessagePayload {
  messageId: string;
  messageType: "PAYMENT_REQUEST" | "PAYMENT_CONFIRMATION" | "PAYMENT_RECEIPT";
  sender: string;
  recipient: string;
  amount: string;
  token: string;
  reference: string;
  timestamp: number;
  status: "PENDING" | "CONFIRMED" | "FAILED";
}

/**
 * HSPClient builds and encodes HSP-compatible messages for off-chain use.
 * On-chain HSP events are emitted by HSPAdapter.sol.
 */
export class HSPClient {
  constructor(
    private provider: ethers.Provider,
    private hspAdapterContract: ethers.Contract
  ) {}

  async getMessageStatus(messageId: string): Promise<string> {
    const status = await this.hspAdapterContract.getMessageStatus(messageId);
    const statusMap: Record<number, string> = {
      0: "PENDING",
      1: "CONFIRMED",
      2: "FAILED",
    };
    return statusMap[Number(status)] ?? "UNKNOWN";
  }

  async getReceipt(messageId: string): Promise<HSPMessagePayload | null> {
    try {
      const receipt = await this.hspAdapterContract.getReceipt(messageId);
      if (!receipt || receipt.messageId === ethers.ZeroHash) return null;

      return {
        messageId: receipt.messageId,
        messageType: "PAYMENT_RECEIPT",
        sender: receipt.customer,
        recipient: receipt.merchant,
        amount: receipt.amount.toString(),
        token: receipt.token,
        reference: receipt.merchantRef,
        timestamp: Number(receipt.settledAt),
        status: "CONFIRMED",
      };
    } catch {
      return null;
    }
  }

  buildMessageId(
    merchant: string,
    customer: string,
    nonce: string,
    blockNumber: number
  ): string {
    return ethers.keccak256(
      ethers.solidityPacked(
        ["address", "address", "bytes32", "uint256"],
        [merchant, customer, nonce, blockNumber]
      )
    );
  }
}
