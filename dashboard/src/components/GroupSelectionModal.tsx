import React, { useEffect, useState } from 'react';
import { X, Users, Loader2, CheckCircle } from 'lucide-react';
import { useWhatsAppApi } from '../hooks/useWhatsAppApi';

interface Group {
  id: string;
  name: string;
  participantsCount?: number;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export default function GroupSelectionModal({ onClose, onSaved }: Props) {
  const api = useWhatsAppApi();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('Connecting to WhatsApp…');

  // Open an SSE channel to show live "Found N chats so far…" progress while
  // the bridge scans. The actual group list comes from getGroups() below which
  // triggers the scan and waits for it to finish (up to 95s). The /groups
  // endpoint is excluded from the server's 30s request timeout so this is safe.
  useEffect(() => {
    let es: EventSource | null = null;
    (async () => {
      const sseUrl = await api.getStreamUrl().catch(() => null);
      if (!sseUrl) return;
      es = new EventSource(sseUrl);
      es.addEventListener('groups_syncing', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.message) setSyncStatus(data.message);
        } catch (_) {}
      });
    })();
    return () => { if (es) es.close(); };
  }, []);

  // Trigger the group scan immediately — sends get_groups to the bridge and
  // waits up to 95s for it to complete. Progress shows via the SSE channel above.
  useEffect(() => {
    api.getGroups()
      .then(res => setGroups(res.data?.groups ?? []))
      .catch(() => setError('Failed to load groups. Make sure WhatsApp is connected.'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const selectedGroups = groups.filter(g => selected.has(g.id));
      await api.selectGroups(
        selectedGroups.map(g => g.id),
        selectedGroups.map(g => g.name),
      );
      onSaved();
    } catch {
      setError('Failed to save groups. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <h2 className="font-black text-slate-900 uppercase tracking-tight">Select Groups</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-12 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-sm font-bold">Loading your groups…</p>
              <p className="text-xs text-slate-400 font-mono mt-1">{syncStatus}</p>
              <p className="text-[11px] text-slate-300 max-w-[260px] text-center mt-2">
                WhatsApp may take up to 90 seconds on first connect while it
                syncs your chats from the phone.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-sm font-bold text-center">
              {error}
            </div>
          )}

          {!loading && !error && groups.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm font-bold">
              No groups found. Make sure your WhatsApp account is in some groups.
            </div>
          )}

          {!loading && groups.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest px-2 pb-2">
                {groups.length} groups available — select which to monitor
              </p>
              {groups.map(group => (
                <label
                  key={group.id}
                  className={`flex items-center gap-3 p-4 rounded-2xl cursor-pointer border-2 transition-all ${
                    selected.has(group.id)
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-transparent bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(group.id)}
                    onChange={() => toggle(group.id)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-slate-900 truncate">{group.name}</p>
                    {group.participantsCount != null && (
                      <p className="text-xs text-slate-400 font-bold">{group.participantsCount} participants</p>
                    )}
                  </div>
                  {selected.has(group.id) && <CheckCircle className="w-4 h-4 text-blue-600 shrink-0" />}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t shrink-0 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl border-2 border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={selected.size === 0 || saving}
            className="flex-1 py-3 rounded-2xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
