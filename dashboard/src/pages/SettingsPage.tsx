import React, { useState } from 'react';
import { Loader2, Users, Smartphone, WifiOff } from 'lucide-react';
import { useWhatsAppAuth } from '../hooks/useWhatsAppAuth';
import { useWhatsAppApi } from '../hooks/useWhatsAppApi';
import GroupSelectionModal from '../components/GroupSelectionModal';
import Layout from '../components/Layout';

export default function SettingsPage() {
  const { isConnected, phone, selectedGroups, sessionStatus, updatedAt, loading, refresh } = useWhatsAppAuth();
  const api = useWhatsAppApi();
  const [disconnecting, setDisconnecting] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);

  const handleDisconnect = async () => {
    if (!confirm('Disconnect WhatsApp? Scraping will stop until you reconnect.')) return;
    setDisconnecting(true);
    try {
      await api.disconnect();
      await refresh();
    } catch {
      alert('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Layout>
      <main className="flex-1 p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Settings</h1>
          </div>

          {/* WhatsApp Connection Card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-8">
            <div className="flex items-center gap-3 mb-6">
              <Smartphone className="w-6 h-6 text-green-600" />
              <h2 className="font-black text-slate-900 uppercase tracking-tight text-lg">WhatsApp Connection</h2>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="font-bold text-sm">Loading…</span>
              </div>
            ) : isConnected ? (
              <div className="space-y-5">
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-5 py-4">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                  <div>
                    <p className="font-black text-green-900 text-sm">{phone ?? 'Connected'}</p>
                    <p className="text-xs text-green-700 font-bold">Session: {sessionStatus}</p>
                    {updatedAt && <p className="text-xs text-green-600 mt-0.5">Last update: {new Date(updatedAt).toLocaleString()}</p>}
                  </div>
                </div>

                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl font-bold text-sm hover:bg-red-100 disabled:opacity-50"
                >
                  {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <WifiOff className="w-4 h-4" />}
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4">
                <WifiOff className="w-5 h-5 text-slate-400" />
                <div>
                  <p className="font-bold text-slate-700 text-sm">Not connected</p>
                  <p className="text-xs text-slate-400">Go to the dashboard to connect WhatsApp.</p>
                </div>
              </div>
            )}
          </div>

          {/* Selected Groups Card */}
          {isConnected && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Users className="w-6 h-6 text-blue-600" />
                  <h2 className="font-black text-slate-900 uppercase tracking-tight text-lg">Monitored Groups</h2>
                </div>
                <button
                  onClick={() => setShowGroupModal(true)}
                  className="text-xs font-black text-blue-600 hover:text-blue-800 uppercase tracking-widest"
                >
                  Edit
                </button>
              </div>

              {selectedGroups.length === 0 ? (
                <p className="text-slate-400 text-sm font-bold">No groups selected yet.</p>
              ) : (
                <div className="space-y-2">
                  {selectedGroups.map(g => (
                    <div key={g.group_id} className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3">
                      <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-xs font-black">
                        {g.group_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-bold text-sm text-slate-800">{g.group_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {showGroupModal && (
        <GroupSelectionModal
          onClose={() => setShowGroupModal(false)}
          onSaved={() => { setShowGroupModal(false); refresh(); }}
        />
      )}
    </Layout>
  );
}
