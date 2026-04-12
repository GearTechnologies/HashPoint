import { useState, useCallback } from "react";
import { NonceManager } from "@hashpoint/sdk";

export interface Session {
  sessionId: bigint;
  nonceRoot: string;
  nonces: string[];
  expiry: number;
  maxPayments: number;
}

let _manager: NonceManager | null = null;

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [remainingNonces, setRemainingNonces] = useState(0);

  const openSession = useCallback(
    async (
      maxPayments: number,
      durationSeconds: number
    ): Promise<{ nonceRoot: string; nonces: string[] }> => {
      _manager = new NonceManager();
      const { nonceRoot, nonces } = _manager.prepareSession(maxPayments);
      const expiry = Math.floor(Date.now() / 1000) + durationSeconds;

      setSession({
        sessionId: 0n, // updated after on-chain tx
        nonceRoot,
        nonces,
        expiry,
        maxPayments,
      });
      setRemainingNonces(maxPayments);

      return { nonceRoot, nonces };
    },
    []
  );

  const getNextNonce = useCallback((): string | null => {
    if (!_manager) return null;
    const nonce = _manager.getNextNonce();
    if (nonce) _manager.markUsed(nonce);
    setRemainingNonces(_manager.getRemainingSlots());
    return nonce;
  }, []);

  const getMerkleProof = useCallback((nonce: string): string[] => {
    if (!_manager) return [];
    return _manager.getMerkleProof(nonce);
  }, []);

  const closeSession = useCallback(() => {
    _manager = null;
    setSession(null);
    setRemainingNonces(0);
  }, []);

  const isExpired = session
    ? Math.floor(Date.now() / 1000) > session.expiry
    : true;

  return {
    session,
    setSession,
    openSession,
    closeSession,
    remainingNonces,
    isExpired,
    getNextNonce,
    getMerkleProof,
  };
}
