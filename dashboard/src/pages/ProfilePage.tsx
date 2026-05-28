import React, { useState } from 'react';
import { useUser, useClerk } from '@clerk/react';
import {
  UserCircle, Mail, Calendar, Shield, CheckCircle2,
  ExternalLink, LogOut, Smartphone, Edit3, Copy, Check,
} from 'lucide-react';
import Layout from '../components/Layout';
import { useWhatsAppAuth } from '../hooks/useWhatsAppAuth';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={handle} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-500" />
        : <Copy className="w-3.5 h-3.5 text-slate-400" />}
    </button>
  );
}

export default function ProfilePage() {
  const { user }    = useUser();
  const { signOut, openUserProfile } = useClerk();
  const { isConnected, phone, selectedGroupsCount, sessionStatus } = useWhatsAppAuth();

  if (!user) return null;

  const displayName   = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';
  const email         = user.primaryEmailAddress?.emailAddress ?? '—';
  const createdAt     = new Date(user.createdAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const lastSignIn    = user.lastSignInAt
    ? new Date(user.lastSignInAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
  const clerkId       = user.id;

  const providerBadge = user.externalAccounts?.[0]?.provider ?? 'email';

  return (
    <Layout>
      <main className="flex-1 p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* Page header */}
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
              Profile
            </h1>
            <button
              onClick={() => openUserProfile()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl transition-colors"
            >
              <Edit3 className="w-4 h-4" />
              Edit profile
            </button>
          </div>

          {/* Identity card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            {/* Blue banner */}
            <div className="h-24 bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-600" />

            <div className="px-8 pb-8">
              {/* Avatar — overlaps the banner */}
              <div className="-mt-12 mb-4 flex items-end gap-5">
                {user.imageUrl ? (
                  <img
                    src={user.imageUrl}
                    className="w-24 h-24 rounded-3xl ring-4 ring-white dark:ring-slate-900 object-cover shadow-xl"
                    alt="avatar"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-3xl ring-4 ring-white dark:ring-slate-900 bg-blue-600 flex items-center justify-center shadow-xl">
                    <span className="text-4xl font-black text-white">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="pb-2">
                  <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">
                    {displayName}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                      {providerBadge}
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 uppercase tracking-wider">
                      Free plan
                    </span>
                  </div>
                </div>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                  <Mail className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-0.5">Email</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white truncate">{email}</div>
                  </div>
                  <CopyButton text={email} />
                </div>

                <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                  <Calendar className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-0.5">Member since</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{createdAt}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                  <UserCircle className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-0.5">Last sign-in</div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{lastSignIn}</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                  <Shield className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-0.5">User ID</div>
                    <div className="text-xs font-mono text-slate-500 truncate">{clerkId}</div>
                  </div>
                  <CopyButton text={clerkId} />
                </div>
              </div>
            </div>
          </div>

          {/* WhatsApp status */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <Smartphone className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              <h2 className="font-black text-slate-900 dark:text-white uppercase tracking-tight text-base">
                WhatsApp Integration
              </h2>
            </div>

            <div className={`flex items-center gap-4 p-5 rounded-2xl border ${
              isConnected
                ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
            }`}>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                isConnected ? 'bg-green-100 dark:bg-green-900/50' : 'bg-slate-200 dark:bg-slate-700'
              }`}>
                {isConnected
                  ? <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                  : <Smartphone className="w-6 h-6 text-slate-400" />}
              </div>
              <div className="flex-1">
                <div className={`font-black text-base ${isConnected ? 'text-green-700 dark:text-green-400' : 'text-slate-700 dark:text-slate-300'}`}>
                  {isConnected ? 'Connected' : 'Not connected'}
                </div>
                {isConnected ? (
                  <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                    {phone && <span className="font-medium">{phone} · </span>}
                    {selectedGroupsCount} group{selectedGroupsCount !== 1 ? 's' : ''} monitored
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 mt-0.5">
                    Go to Settings to connect your WhatsApp account.
                  </div>
                )}
              </div>
              {!isConnected && (
                <a
                  href="/settings"
                  className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-colors"
                >
                  Connect
                </a>
              )}
            </div>
          </div>

          {/* Legal acceptance */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
            <h2 className="font-black text-slate-900 dark:text-white uppercase tracking-tight text-base mb-4">
              Legal Agreements
            </h2>
            <div className="space-y-3">
              {[
                { label: 'Terms of Service',  href: '/terms' },
                { label: 'Privacy Policy',    href: '/privacy' },
              ].map(({ label, href }) => (
                <div key={label} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{label}</span>
                    <span className="text-xs text-slate-500 font-medium">Accepted</span>
                  </div>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-500 transition-colors"
                  >
                    View <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* Danger zone */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-red-200 dark:border-red-900/50 shadow-sm p-6">
            <h2 className="font-black text-red-600 dark:text-red-400 uppercase tracking-tight text-base mb-4">
              Account Actions
            </h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => openUserProfile()}
                className="flex items-center gap-2 px-5 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-bold transition-all"
              >
                <Edit3 className="w-4 h-4" />
                Manage account (Clerk)
                <ExternalLink className="w-3.5 h-3.5 opacity-50" />
              </button>
              <button
                onClick={() => signOut({ redirectUrl: '/' })}
                className="flex items-center gap-2 px-5 py-3 rounded-2xl border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm font-bold transition-all"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </div>

        </div>
      </main>
    </Layout>
  );
}
