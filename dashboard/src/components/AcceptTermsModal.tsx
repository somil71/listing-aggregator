/**
 * AcceptTermsModal
 *
 * Full-screen blocking gate shown to every new user on first login.
 * They must check both boxes and click "I Agree & Continue" before the
 * app is accessible. Acceptance is recorded in the DB via POST /api/user/accept-terms.
 * On subsequent logins, GET /api/user/tos-status returns accepted=true and this
 * modal is never shown.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, FileText, CheckCircle2, Loader2, Home } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '@clerk/react';

interface Props {
  onAccepted: () => void;
}

export default function AcceptTermsModal({ onAccepted }: Props) {
  const { getToken } = useAuth();
  const [tosChecked,     setTosChecked]     = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');

  const canProceed = tosChecked && privacyChecked;

  const handleAccept = async () => {
    if (!canProceed) return;
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      await axios.post(
        '/api/user/accept-terms',
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      onAccepted();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    /* Full-screen overlay — pointer-events on overlay are none so nothing behind is clickable */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-sm p-4">

      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-br from-blue-700 to-blue-600 px-8 py-7">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
              <Home className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-white text-xl tracking-tight">PROPDIGEST</span>
          </div>
          <h1 className="text-2xl font-black text-white leading-tight tracking-tight">
            Welcome! Before you start…
          </h1>
          <p className="text-blue-200 text-sm mt-2 leading-relaxed">
            Please read and accept our Terms of Service and Privacy Policy to continue.
            This is a one-time step.
          </p>
        </div>

        {/* Body */}
        <div className="px-8 py-6 space-y-5">

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4">
              <FileText className="w-5 h-5 text-blue-400 mb-2" />
              <div className="text-white text-sm font-bold mb-1">Terms of Service</div>
              <p className="text-slate-400 text-xs leading-relaxed">
                You agree to use PropDigest for lawful purposes only. We may suspend
                accounts that violate our policies.
              </p>
            </div>
            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4">
              <Shield className="w-5 h-5 text-green-400 mb-2" />
              <div className="text-white text-sm font-bold mb-1">Privacy Policy</div>
              <p className="text-slate-400 text-xs leading-relaxed">
                We collect only what's needed to run the service. Your WhatsApp data
                is never shared with third parties.
              </p>
            </div>
          </div>

          {/* Checkboxes */}
          <div className="space-y-3">
            <label className={`flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${
              tosChecked
                ? 'border-blue-600 bg-blue-600/10'
                : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
            }`}>
              <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                tosChecked ? 'border-blue-500 bg-blue-600' : 'border-slate-600'
              }`}>
                {tosChecked && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
              </div>
              <input
                type="checkbox"
                className="sr-only"
                checked={tosChecked}
                onChange={e => setTosChecked(e.target.checked)}
              />
              <span className="text-sm text-slate-300 leading-relaxed">
                I have read and agree to the{' '}
                <Link to="/terms" target="_blank" className="text-blue-400 hover:text-blue-300 font-bold underline underline-offset-2">
                  Terms of Service
                </Link>
              </span>
            </label>

            <label className={`flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${
              privacyChecked
                ? 'border-green-600 bg-green-600/10'
                : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
            }`}>
              <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                privacyChecked ? 'border-green-500 bg-green-600' : 'border-slate-600'
              }`}>
                {privacyChecked && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
              </div>
              <input
                type="checkbox"
                className="sr-only"
                checked={privacyChecked}
                onChange={e => setPrivacyChecked(e.target.checked)}
              />
              <span className="text-sm text-slate-300 leading-relaxed">
                I have read and agree to the{' '}
                <Link to="/privacy" target="_blank" className="text-green-400 hover:text-green-300 font-bold underline underline-offset-2">
                  Privacy Policy
                </Link>
              </span>
            </label>
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-950/40 border border-red-800/60 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          {/* CTA */}
          <button
            onClick={handleAccept}
            disabled={!canProceed || loading}
            className={`w-full py-3.5 rounded-2xl font-black text-sm tracking-wide transition-all flex items-center justify-center gap-2 ${
              canProceed && !loading
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/40 cursor-pointer'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : (
              'I Agree & Continue to PropDigest'
            )}
          </button>

          <p className="text-center text-slate-600 text-xs">
            Your acceptance is recorded with a timestamp. You won't be asked again.
          </p>
        </div>
      </div>
    </div>
  );
}
