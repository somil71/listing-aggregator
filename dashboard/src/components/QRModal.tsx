import React, { useEffect, useState, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { X, Loader2, CheckCircle, AlertCircle, Smartphone } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { useWhatsAppApi } from '../hooks/useWhatsAppApi';
import { useSSE } from '../hooks/useSSE';
import GroupSelectionModal from './GroupSelectionModal';

interface Props {
  onClose: () => void;
  onConnected: () => void;
}

type Phase = 'init' | 'starting' | 'qr' | 'scanning' | 'authenticated' | 'select_groups' | 'error';

// Translate raw wppconnect / network errors into something a non-technical
// user can act on. Anything that doesn't match a known pattern falls back
// to a generic message — we NEVER show JS stack traces to end users.
function friendlyError(raw: string): string {
  const m = (raw || '').toLowerCase();
  if (m.includes('chat not found') || m.includes('findchat')) {
    return 'One of your previously monitored groups is no longer accessible. You can pick a new group list and continue.';
  }
  if (m.includes('execution context') || m.includes('context was destroyed')) {
    return 'WhatsApp Web closed unexpectedly. Please reconnect.';
  }
  if (m.includes('timeout') || m.includes('timed out')) {
    return 'WhatsApp took too long to respond. Check your internet and try again.';
  }
  if (m.includes('auth') || m.includes('unauthor')) {
    return 'Your session has expired. Please reconnect WhatsApp.';
  }
  if (m.includes('disconnected') || m.includes('lost connection')) {
    return 'Connection to WhatsApp was lost. Please reconnect.';
  }
  if (m.includes('failed to start') || m.includes('spawn')) {
    return 'Could not launch WhatsApp Web. Please try again in a few seconds.';
  }
  // Generic fallback — don't leak internals
  return 'Something went wrong while connecting to WhatsApp. Please try again.';
}

export default function QRModal({ onClose, onConnected }: Props) {
  const { isLoaded, isSignedIn } = useAuth();
  const api = useWhatsAppApi();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('init');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const initiated = useRef(false);
  const sseErrorCount = useRef(0);
  const phaseRef = useRef<Phase>('init');

  // Fetch a fresh SSE nonce URL (nonce, not JWT — never leaks into URLs/logs)
  const fetchStreamUrl = useCallback(async () => {
    return api.getStreamUrl();
  }, [api]);

  // On SSE error, refresh the nonce URL.  Cap retries to 8.
  const refreshStreamUrl = useCallback(() => {
    sseErrorCount.current += 1;
    if (sseErrorCount.current > 8) {
      setPhase('error');
      setErrorMsg('Lost connection to server. Please try again.');
      return;
    }
    fetchStreamUrl()
      .then(url => {
        sseErrorCount.current = 0;
        setStreamUrl(url);
      })
      .catch(() => {
        setTimeout(refreshStreamUrl, 1500);
      });
  }, [fetchStreamUrl]);

  const { lastEvent, streamReady } = useSSE(streamUrl, refreshStreamUrl);

  const log = (msg: string) => setStatusLog(prev => [...prev.slice(-4), msg]);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Step 1: wait for Clerk to finish loading, THEN open the SSE stream.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    fetchStreamUrl().then(setStreamUrl).catch(() => {
      setTimeout(() => fetchStreamUrl().then(setStreamUrl).catch(() => {}), 800);
    });
  }, [isLoaded, isSignedIn]);

  // Step 2: once SSE stream is ready, call initiate-qr
  useEffect(() => {
    if (streamReady && !initiated.current) {
      initiated.current = true;
      setPhase('starting');
      log('Launching WhatsApp Web… (this takes ~20 s)');
      api.initiateQR().catch(() => {
        setPhase('error');
        setErrorMsg('Failed to start WhatsApp session. Please try again.');
      });
    }
  }, [streamReady]);

  // Step 3: handle incoming SSE events
  useEffect(() => {
    if (!lastEvent) return;
    const { type, data } = lastEvent;

    const currentPhase = phaseRef.current;
    const isTerminal = currentPhase === 'authenticated' || currentPhase === 'select_groups';

    if (type === 'qr_generated') {
      const dataUrl = (data as any).image as string;
      if (dataUrl && !isTerminal) {
        setQrDataUrl(dataUrl);
        setPhase('qr');
        log('QR code ready. Scan with WhatsApp on your phone.');
      }
    } else if (type === 'scanning') {
      if (!isTerminal) {
        setPhase('scanning');
        const msg = (data as any).message || 'Phone detected! Confirming login…';
        log(msg);
      } else {
        const msg = (data as any).message;
        if (msg) log(msg);
      }
    } else if (type === 'authenticated') {
      setPhase('authenticated');
      log('Authenticated successfully!');
      setTimeout(() => setPhase('select_groups'), 1200);
    } else if (type === 'groups_detected') {
      log(`${(data as any).count ?? '?'} groups found.`);
    } else if (type === 'backfill_warning') {
      // Per-group history-fetch failure — NOT a connection error. Show as
      // a status line and keep the current phase. Live messages still flow.
      const d = data as any;
      const name = (d.groupName || 'a group').toString().slice(0, 30);
      log(`Skipped history for "${name}" (no longer accessible).`);
    } else if (type === 'disconnected') {
      // Only treat as fatal if we're not already in a terminal phase.
      if (!isTerminal) {
        setPhase('error');
        const reason = (data as any).reason;
        setErrorMsg(
          reason === 'qr_timeout'
            ? 'The QR code expired before it was scanned. Tap Try Again to get a fresh code.'
            : 'Connection to WhatsApp was lost. Please reconnect.'
        );
      }
    } else if (type === 'error') {
      if (!isTerminal) {
        setPhase('error');
        setErrorMsg(friendlyError(String((data as any).message ?? '')));
      } else {
        // We're already past auth — log silently rather than tear the UI.
        log('Note: a background error occurred but the session is still active.');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  if (phase === 'select_groups') {
    return (
      <GroupSelectionModal
        onClose={onClose}
        onSaved={onConnected}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-green-600" />
            <h2 className="font-black text-slate-900 uppercase tracking-tight">Connect WhatsApp</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col items-center gap-5 min-h-[320px] justify-center">
          {phase === 'init' && (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <Loader2 className="w-10 h-10 animate-spin text-green-500" />
              <p className="font-bold text-sm">Opening secure stream…</p>
            </div>
          )}

          {phase === 'starting' && (
            <div className="flex flex-col items-center gap-4 text-slate-500">
              <Loader2 className="w-10 h-10 animate-spin text-green-500" />
              <div className="text-center">
                <p className="font-bold text-sm text-slate-700">Launching WhatsApp Web…</p>
                <p className="text-xs text-slate-400 mt-1">First launch takes ~20–30 seconds</p>
              </div>
            </div>
          )}

          {phase === 'qr' && qrDataUrl && (
            <>
              <img src={qrDataUrl} alt="WhatsApp QR" className="w-52 h-52 rounded-2xl border-4 border-green-500 shadow-lg" />
              <p className="text-xs font-bold text-slate-500 text-center">
                Open WhatsApp → Linked Devices → Link a Device
              </p>
            </>
          )}

          {phase === 'scanning' && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
              <p className="font-bold text-sm text-slate-700">Confirming login…</p>
            </div>
          )}

          {phase === 'authenticated' && (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle className="w-14 h-14 text-green-500" />
              <p className="font-black text-lg text-slate-900">Authenticated!</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center gap-3 text-center px-2">
              <AlertCircle className="w-10 h-10 text-red-500" />
              <p className="font-bold text-sm text-slate-700 leading-relaxed max-w-[280px]">{errorMsg}</p>
              <button
                onClick={async () => {
                  // Disconnect any zombie bridge BEFORE retrying, otherwise
                  // initiate-qr returns 'already_connected' and the modal
                  // hangs in 'starting' forever. Best-effort — failure here
                  // is fine because the user is mid-recovery.
                  try { await api.disconnect(); } catch (_) {}

                  // Reset all client-side modal state. No page refresh, no
                  // route navigation, no Clerk re-auth — just a clean retry.
                  setStatusLog([]);
                  setErrorMsg(null);
                  setQrDataUrl(null);
                  initiated.current = false;
                  sseErrorCount.current = 0;
                  setPhase('init');

                  // Mint a fresh SSE nonce and re-open the stream.
                  fetchStreamUrl().then(setStreamUrl).catch(() => {
                    // If the nonce mint itself fails, surface a clear message
                    setPhase('error');
                    setErrorMsg('Could not reach the server. Please check your connection.');
                  });
                }}
                className="mt-2 px-5 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Status log */}
        {statusLog.length > 0 && (
          <div className="px-6 pb-5">
            <div className="bg-slate-50 rounded-xl p-3 space-y-1">
              {statusLog.map((msg, i) => (
                <p key={i} className="text-[11px] font-mono text-slate-500">{msg}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
