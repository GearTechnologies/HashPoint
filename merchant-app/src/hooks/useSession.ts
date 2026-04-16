import { useState, useCallback, useEffect } from "react";
import { NonceManager } from "@hashpoint/sdk";

export interface Session {
  sessionId: bigint;
  nonceRoot: string;
  nonces: string[];
  expiry: number;
  maxPayments: number;
}

const SESSION_KEY = "hashpoint:session";
const MANAGER_KEY = "hashpoint:nonce_manager";

let _manager: NonceManager | null = null;

export interface PreparedSession {
  nonceRoot: string;
  nonces: string[];
  expiry: number;
  maxPayments: number;
}

function loadFromStorage(): { session: Session | null; remaining: number } {
  if (typeof window === "undefined") return { session: null, remaining: 0 };
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const managerRaw = localStorage.getItem(MANAGER_KEY);
    if (!raw || !managerRaw) return { session: null, remaining: 0 };

    const parsed = JSON.parse(raw);
    // Restore BigInt from stored string
    parsed.sessionId = BigInt(parsed.sessionId ?? "0");
    // Discard expired sessions immediately
    if (Math.floor(Date.now() / 1000) > parsed.expiry) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(MANAGER_KEY);
      return { session: null, remaining: 0 };
    }
    _manager = NonceManager.deserialize(managerRaw);
    return { session: parsed as Session, remaining: _manager.getRemainingSlots() };
  } catch {
    return { session: null, remaining: 0 };
  }
}

function saveToStorage(session: Session, manager: NonceManager) {
  if (typeof window === "undefined") return;
  // BigInt doesn't serialize with JSON.stringify — store as string
  const serializable = { ...session, sessionId: session.sessionId.toString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(serializable));
  localStorage.setItem(MANAGER_KEY, manager.serialize());
}

function clearStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(MANAGER_KEY);
}

export function useSession() {
  const [session, setSessionState] = useState<Session | null>(null);
  const [remainingNonces, setRemainingNonces] = useState(0);

  // Rehydrate from localStorage once on mount (client-side only)
  useEffect(() => {
    const { session: saved, remaining } = loadFromStorage();
    if (saved) {
      setSessionState(saved);
      setRemainingNonces(remaining);
    }
  }, []);

  const setSession = useCallback((s: Session | null) => {
    setSessionState(s);
  }, []);

  const prepareSession = useCallback(
    (maxPayments: number, durationSeconds: number): PreparedSession => {
      _manager = new NonceManager();
      const { nonceRoot, nonces } = _manager.prepareSession(maxPayments);
      const expiry = Math.floor(Date.now() / 1000) + durationSeconds;

      return {
        nonceRoot,
        nonces,
        expiry,
        maxPayments,
      };
    },
    []
  );

  const activateSession = useCallback((prepared: PreparedSession, sessionId: bigint) => {
    if (!_manager) {
      throw new Error("Session manager is not initialized.");
    }

    const newSession: Session = {
      sessionId,
      nonceRoot: prepared.nonceRoot,
      nonces: prepared.nonces,
      expiry: prepared.expiry,
      maxPayments: prepared.maxPayments,
    };

    setSessionState(newSession);
    setRemainingNonces(prepared.maxPayments);
    saveToStorage(newSession, _manager);
  }, []);

  const openSession = useCallback(
    async (
      maxPayments: number,
      durationSeconds: number
    ): Promise<{ nonceRoot: string; nonces: string[] }> => {
      const prepared = prepareSession(maxPayments, durationSeconds);
      activateSession(prepared, 0n);

      return { nonceRoot: prepared.nonceRoot, nonces: prepared.nonces };
    },
    [activateSession, prepareSession]
  );

  const getNextNonce = useCallback((): string | null => {
    if (!_manager || !session) return null;
    const nonce = _manager.getNextNonce();
    if (nonce) {
      _manager.markUsed(nonce);
      const remaining = _manager.getRemainingSlots();
      setRemainingNonces(remaining);
      saveToStorage(session, _manager);
    }
    return nonce;
  }, [session]);

  const getMerkleProof = useCallback((nonce: string): string[] => {
    if (!_manager) return [];
    return _manager.getMerkleProof(nonce);
  }, []);

  const closeSession = useCallback(() => {
    _manager = null;
    setSessionState(null);
    setRemainingNonces(0);
    clearStorage();
  }, []);

  const isExpired = session
    ? Math.floor(Date.now() / 1000) > session.expiry
    : true;

  return {
    session,
    setSession,
    prepareSession,
    activateSession,
    openSession,
    closeSession,
    remainingNonces,
    isExpired,
    getNextNonce,
    getMerkleProof,
  };
}
