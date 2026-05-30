import { useEffect, useRef, useState } from 'react';

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

const SSE_EVENTS = [
  'qr_generated', 'authenticated', 'disconnected',
  'error', 'scanning', 'groups_detected', 'groups_saved',
  'groups_syncing',
  'monitoring_started', 'backfill_progress', 'backfill_warning', 'backfill_complete',
  'listing_stored',
];

export function useSSE(url: string | null, onAuthError?: () => void) {
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  // Track whether we were ever connected on this URL so a fast initial
  // 401 (expired token) is distinguishable from a transient network blip.
  const wasConnected = useRef(false);

  useEffect(() => {
    if (!url) return;
    wasConnected.current = false;

    const es = new EventSource(url);

    es.addEventListener('connected', () => {
      wasConnected.current = true;
      setStreamReady(true);
    });

    for (const type of SSE_EVENTS) {
      es.addEventListener(type, (e: MessageEvent) => {
        setLastEvent({ type, data: JSON.parse(e.data) });
      });
    }

    es.onerror = () => {
      setStreamReady(false);
      // Always signal for a token refresh on error — we can't read the HTTP
      // status from EventSource, but a fresh getToken() call is cheap and
      // Clerk returns a cached valid token if the current one is still good.
      onAuthError?.();
    };

    return () => {
      es.close();
      setStreamReady(false);
    };
  }, [url]);

  return { lastEvent, streamReady };
}
