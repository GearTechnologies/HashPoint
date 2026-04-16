import { useEffect, useState } from "react";
import { type QueuedIntent } from "@hashpoint/sdk";
import { parseAbiItem } from "viem";
import { usePublicClient } from "wagmi";
import { getHistoryStartBlock, normalizeAddress, requireAddress, type ChainAddress } from "../lib/chain";

const PAYMENT_SETTLED_EVENT = parseAbiItem(
  "event PaymentSettled(address indexed merchant, address indexed customer, address token, uint256 amount, bytes32 merchantRef, uint256 sessionId, bytes32 nonce)"
);

interface PaymentSettledArgs {
  merchant?: ChainAddress;
  customer?: ChainAddress;
  token?: ChainAddress;
  amount?: bigint;
  merchantRef?: `0x${string}`;
  sessionId?: bigint;
  nonce?: `0x${string}`;
}

export function useOnchainPayments(merchantAddress?: string) {
  const publicClient = usePublicClient();
  const [payments, setPayments] = useState<QueuedIntent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalizedMerchant = normalizeAddress(merchantAddress, {
      allowZeroAddress: false,
    });

    let cancelled = false;

    async function loadPayments() {
      if (!publicClient || !normalizedMerchant) {
        if (!cancelled) {
          setPayments([]);
          setLoading(false);
          setError("");
        }
        return;
      }

      setLoading(true);
      setError("");

      try {
        const escrowAddress = requireAddress(
          process.env.NEXT_PUBLIC_ESCROW_ADDRESS,
          "NEXT_PUBLIC_ESCROW_ADDRESS",
          { allowZeroAddress: false }
        );

        const logs = await publicClient.getLogs({
          address: escrowAddress,
          event: PAYMENT_SETTLED_EVENT,
          args: { merchant: normalizedMerchant },
          fromBlock: getHistoryStartBlock(),
          toBlock: "latest",
        });

        const blockTimestamps = new Map<string, number>();
        const mapped = await Promise.all(
          logs.map(async (log) => {
            const args = log.args as PaymentSettledArgs | undefined;
            if (
              !args?.merchant ||
              !args.customer ||
              !args.token ||
              args.amount === undefined ||
              args.sessionId === undefined ||
              !args.nonce ||
              !args.merchantRef
            ) {
              return null;
            }

            let queuedAt = Date.now();
            if (log.blockNumber !== null && log.blockNumber !== undefined) {
              const blockKey = log.blockNumber.toString();
              let timestamp = blockTimestamps.get(blockKey);
              if (!timestamp) {
                const block = await publicClient.getBlock({
                  blockNumber: log.blockNumber,
                });
                timestamp = Number(block.timestamp) * 1000;
                blockTimestamps.set(blockKey, timestamp);
              }
              queuedAt = timestamp;
            }

            return {
              id: `${log.transactionHash ?? "payment"}-${log.logIndex?.toString() ?? "0"}`,
              intent: {
                merchant: args.merchant,
                customer: args.customer,
                token: args.token,
                amount: args.amount,
                sessionId: args.sessionId,
                nonce: args.nonce,
                expiry: 0,
                merchantRef: args.merchantRef,
                chainId: publicClient.chain?.id ?? Number(process.env.NEXT_PUBLIC_CHAIN_ID || 133),
              },
              signature: "",
              merkleProof: [],
              queuedAt,
              attempts: 1,
              lastAttempt: queuedAt,
              status: "confirmed" as const,
              txHash: log.transactionHash ?? null,
              error: null,
            } satisfies QueuedIntent;
          })
        );

        if (!cancelled) {
          const nextPayments: QueuedIntent[] = [];
          for (const payment of mapped) {
            if (payment) {
              nextPayments.push(payment);
            }
          }
          nextPayments.sort((left, right) => right.queuedAt - left.queuedAt);
          setPayments(nextPayments);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setPayments([]);
          setError(err instanceof Error ? err.message : "Failed to load on-chain payments.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPayments();
    const intervalId = window.setInterval(() => {
      void loadPayments();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [merchantAddress, publicClient]);

  return { payments, loading, error };
}