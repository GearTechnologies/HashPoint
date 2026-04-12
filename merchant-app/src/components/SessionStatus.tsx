"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "../hooks/useSession";

export function SessionStatus() {
  const { session, remainingNonces, isExpired } = useSession();
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!session) return;
    const update = () => {
      const left = session.expiry - Math.floor(Date.now() / 1000);
      setTimeLeft(Math.max(0, left));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [session]);

  if (!session) {
    return (
      <div className="session-status session-status--none">
        No active session
      </div>
    );
  }

  const pct = Math.round(
    (remainingNonces / session.maxPayments) * 100
  );
  const hours = Math.floor(timeLeft / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  const seconds = timeLeft % 60;

  return (
    <div className={`session-status ${isExpired ? "session-status--expired" : "session-status--active"}`}>
      <div className="session-status__circle">
        <svg viewBox="0 0 36 36" width={80} height={80}>
          <circle
            cx="18" cy="18" r="15.9"
            fill="none"
            stroke="#e0e0e0"
            strokeWidth="3"
          />
          <circle
            cx="18" cy="18" r="15.9"
            fill="none"
            stroke={pct > 10 ? "#0052CC" : "#FF5630"}
            strokeWidth="3"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset="25"
          />
          <text x="18" y="20" textAnchor="middle" fontSize="8" fill="#333">
            {remainingNonces}
          </text>
        </svg>
      </div>
      <div className="session-status__info">
        <div>{remainingNonces} / {session.maxPayments} slots remaining</div>
        {isExpired ? (
          <div className="session-status__expired">Session expired</div>
        ) : (
          <div className="session-status__countdown">
            Expires in {hours}h {minutes}m {seconds}s
          </div>
        )}
        {pct <= 10 && !isExpired && (
          <div className="session-status__warning">
            ⚠️ Less than 10% nonces remaining
          </div>
        )}
      </div>
    </div>
  );
}
