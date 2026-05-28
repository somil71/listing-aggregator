import React, { useState, useRef, useEffect } from 'react';
import {
  Smartphone,
  CheckCircle,
  ChevronDown,
  Users,
  LogOut,
  RefreshCw,
  Loader2,
  History,
} from 'lucide-react';
import { useWhatsAppAuth } from '../hooks/useWhatsAppAuth';
import { useWhatsAppApi } from '../hooks/useWhatsAppApi';
import QRModal from './QRModal';
import GroupSelectionModal from './GroupSelectionModal';

export default function ConnectWhatsAppButton() {
  const { isConnected, phone, selectedGroupsCount, loading, refresh } = useWhatsAppAuth();
  const api = useWhatsAppApi();
  const [showQR, setShowQR] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const handleDisconnect = async () => {
    if (!confirm('Disconnect WhatsApp? You will need to scan the QR again to reconnect.')) return;
    setBusy(true);
    setMenuOpen(false);
    try {
      await api.disconnect();
      await refresh();
    } catch (e) {
      console.error('disconnect failed', e);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-xl animate-pulse">
        <div className="w-4 h-4 bg-slate-300 rounded-full" />
        <div className="w-24 h-3 bg-slate-300 rounded" />
      </div>
    );
  }

  if (isConnected) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition-all disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 text-green-700 animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4 text-green-600" />
          )}
          <span className="text-sm font-bold text-green-800">
            {phone ? `+${phone}` : 'Connected'}
          </span>
          {selectedGroupsCount > 0 && (
            <span className="bg-green-200 text-green-900 text-xs font-black px-2 py-0.5 rounded-full">
              {selectedGroupsCount}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-green-700 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-30">
            {/* Header */}
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-black text-slate-400 uppercase tracking-widest">
                    WhatsApp
                  </div>
                  <div className="text-sm font-bold text-slate-900 truncate">
                    {phone ? `+${phone}` : 'Connected'}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 font-medium">
                Monitoring <span className="font-black text-slate-700">{selectedGroupsCount}</span>{' '}
                {selectedGroupsCount === 1 ? 'group' : 'groups'}
              </div>
            </div>

            {/* Actions */}
            <button
              onClick={() => { setMenuOpen(false); setShowGroups(true); }}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 text-sm font-bold text-slate-700"
            >
              <Users className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Manage groups</span>
            </button>
            <button
              onClick={async () => {
                setMenuOpen(false);
                setBusy(true);
                try {
                  await api.rescrape();
                  alert('Rescrape started. Refresh the dashboard in 30–60 seconds to see new listings.');
                } catch (e) {
                  alert('Failed to start rescrape: ' + (e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 text-sm font-bold text-slate-700 border-t border-slate-100"
            >
              <History className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Re-scrape history</span>
            </button>
            <button
              onClick={async () => { setMenuOpen(false); await refresh(); }}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 text-sm font-bold text-slate-700 border-t border-slate-100"
            >
              <RefreshCw className="w-4 h-4 text-slate-500 shrink-0" />
              <span>Refresh status</span>
            </button>
            <button
              onClick={handleDisconnect}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-red-50 text-sm font-bold text-red-700 border-t border-slate-100"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Disconnect</span>
            </button>
          </div>
        )}

        {showGroups && (
          <GroupSelectionModal
            onClose={() => setShowGroups(false)}
            onSaved={() => { setShowGroups(false); refresh(); }}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowQR(true)}
        className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm shadow transition-all active:scale-95"
      >
        <Smartphone className="w-4 h-4" />
        Connect WhatsApp
      </button>
      {showQR && (
        <QRModal
          onClose={() => setShowQR(false)}
          onConnected={() => { setShowQR(false); refresh(); }}
        />
      )}
    </>
  );
}
