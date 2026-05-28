import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, AlertCircle } from 'lucide-react';
import { useWhatsAppApi } from '../hooks/useWhatsAppApi';
import { useWhatsAppAuth } from '../hooks/useWhatsAppAuth';

interface Props {
  onDone?: () => void; // called when the backfill finishes
}

export default function RefetchChatsButton({ onDone }: Props) {
  const { isConnected } = useWhatsAppAuth();
  const api = useWhatsAppApi();

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState<{ groups: number; messages: number } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open a side SSE channel so we can show live backfill progress
  useEffect(() => {
    if (!running) return;

    let cancelled = false;
    const cleanup = () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
    };

    (async () => {
      // Exchange Clerk JWT for a short-lived nonce — keeps the JWT out of URLs
      const sseUrl = await api.getStreamUrl().catch(() => null);
      if (cancelled) return;
      if (!sseUrl) {
        setError('Could not open progress stream. Please refresh and try again.');
        setRunning(false);
        return;
      }
      const es = new EventSource(sseUrl);
      esRef.current = es;

      let totalStored = 0;

      es.addEventListener('monitoring_started', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        setProgress(`Starting backfill of ${data.groupCount} groups…`);
      });
      es.addEventListener('backfill_progress', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        totalStored += data.stored || 0;
        setProgress(`${data.groupName}: ${data.stored} messages (total ${totalStored})`);
      });
      es.addEventListener('backfill_complete', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        setDoneCount({ groups: data.groups, messages: data.totalStored });
        setProgress(`Done — ${data.totalStored} messages from ${data.groups} groups`);
        setRunning(false);
        cleanup();
        onDone?.();
      });

      // On any SSE error, surface it to the user — never silently leave the
      // button spinning forever.
      es.onerror = () => {
        if (cancelled) return;
        setError('Connection lost. Please refresh and try again.');
        setProgress('');
        setRunning(false);
        cleanup();
      };

      // Safety timeout — if the bridge never reports completion within 5
      // minutes, force the UI back to an actionable state.
      safetyTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setError('Backfill timed out after 5 minutes. Try again or check server logs.');
        setProgress('');
        setRunning(false);
        cleanup();
      }, 5 * 60 * 1000);
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [running]);

  // Auto-clear the success badge after a delay
  useEffect(() => {
    if (doneCount) {
      const t = setTimeout(() => setDoneCount(null), 8000);
      return () => clearTimeout(t);
    }
  }, [doneCount]);

  // Auto-clear the error badge after 10 seconds
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 10_000);
      return () => clearTimeout(t);
    }
  }, [error]);

  const handleClick = async () => {
    if (running) return;
    if (!isConnected) {
      alert('WhatsApp is not connected.\n\nClick "Connect WhatsApp" first and scan the QR code, then come back and click Refetch all chats.');
      return;
    }
    if (!confirm('Refetch all chats from WhatsApp Web?\n\nThis will scroll back through each selected group and pull every available historical message (up to 1000 per group). Takes 30–120 seconds.')) return;
    setRunning(true);
    setProgress('Starting…');
    setError(null);
    setDoneCount(null);
    try {
      await api.rescrape();
    } catch (e) {
      setError(`Failed: ${(e as Error).message}`);
      setProgress('');
      setRunning(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={running}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm shadow transition-all active:scale-95 text-white ${
          isConnected
            ? 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300'
            : 'bg-slate-400 hover:bg-slate-500 cursor-help'
        }`}
        title={isConnected ? 'Re-scrape all history from your selected WhatsApp groups' : 'Connect WhatsApp first, then click this to refetch all history'}
      >
        {running ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {running ? 'Fetching…' : 'Refetch all chats'}
      </button>
      {(running || doneCount) && progress && (
        <div className="text-xs font-bold text-slate-600 max-w-[280px] truncate" title={progress}>
          {progress}
        </div>
      )}
      {error && (
        <div className="text-xs font-bold text-red-700 max-w-[320px] flex items-center gap-1.5" title={error}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}
    </div>
  );
}
