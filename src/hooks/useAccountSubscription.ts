import { useEffect, useRef, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { AccountInfo, PublicKey } from "@solana/web3.js";

interface UseAccountSubscriptionOptions {
  /** Account to subscribe to. Pass null to disable. */
  account: PublicKey | null;
  /** Called on each WS account update. */
  onData: (info: AccountInfo<Buffer>) => void;
}

interface UseAccountSubscriptionResult {
  /** True after the first WS update has been received. */
  wsConnected: boolean;
}

/**
 * Reusable hook that subscribes to on-chain account changes via WebSocket.
 * - Pauses subscription when the tab is hidden (visibility API).
 * - Cleans up listener on unmount or when account changes.
 */
export function useAccountSubscription({
  account,
  onData,
}: UseAccountSubscriptionOptions): UseAccountSubscriptionResult {
  const { connection } = useConnection();
  const [wsConnected, setWsConnected] = useState(false);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  // Track visibility to pause/resume subscriptions
  const visibleRef = useRef(!document.hidden);

  const subscribe = useCallback(() => {
    if (!account) return undefined;

    const subId = connection.onAccountChange(
      account,
      (info) => {
        setWsConnected(true);
        onDataRef.current(info);
      },
      "confirmed",
    );

    return subId;
  }, [connection, account]);

  useEffect(() => {
    if (!account) {
      setWsConnected(false);
      return;
    }

    let subId: number | undefined;

    // Only subscribe when tab is visible
    if (visibleRef.current) {
      subId = subscribe();
    }

    const onVisibility = () => {
      visibleRef.current = !document.hidden;
      if (document.hidden) {
        // Unsubscribe when hidden
        if (subId !== undefined) {
          connection.removeAccountChangeListener(subId);
          subId = undefined;
        }
      } else {
        // Re-subscribe when visible
        if (subId === undefined) {
          subId = subscribe();
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (subId !== undefined) {
        connection.removeAccountChangeListener(subId);
      }
    };
  }, [connection, account, subscribe]);

  return { wsConnected };
}
