import { useState, useEffect, useRef } from 'react';
import { useWhatsAppApi } from './useWhatsAppApi';

const POLL_INTERVAL_MS = 30_000; // refresh every 30 s to keep status current

interface WAStatus {
  connected: boolean;
  phone: string | null;
  selectedGroups: { group_id: string; group_name: string }[];
  selectedGroupsCount: number;
  sessionStatus: string;
  updatedAt: string | null;
}

export function useWhatsAppAuth() {
  // NOTE: useWhatsAppApi() returns a new object literal on every render.
  // Holding it in a ref keeps it out of effect dependency arrays so we don't
  // re-create the polling interval on every parent re-render.
  const api = useWhatsAppApi();
  const apiRef = useRef(api);
  apiRef.current = api;

  const [status, setStatus] = useState<WAStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Stable refresh that reads the latest api via ref — never changes identity.
  const refreshRef = useRef(async () => {
    try {
      const res = await apiRef.current.getStatus();
      if (mountedRef.current) setStatus(res.data);
    } catch {
      if (mountedRef.current) setStatus(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    // Immediate fetch on mount
    refreshRef.current();

    // Continuous polling so "connected" state persists and is always current
    intervalRef.current = setInterval(() => { refreshRef.current(); }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []); // run once — refresh reads latest api via ref, no re-creation needed

  return {
    isConnected: status?.connected ?? false,
    phone: status?.phone ?? null,
    selectedGroups: status?.selectedGroups ?? [],
    selectedGroupsCount: status?.selectedGroupsCount ?? 0,
    sessionStatus: status?.sessionStatus ?? 'none',
    updatedAt: status?.updatedAt ?? null,
    loading,
    refresh: () => refreshRef.current(),
  };
}
