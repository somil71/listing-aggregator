import React, { useState } from 'react';
import { Mail, MessageSquare, AlertCircle, Lightbulb, CreditCard, HelpCircle, CheckCircle } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';

const CATEGORIES = [
  { id: 'bug',      label: 'Report a Bug',      icon: AlertCircle,   color: 'text-rose-500',   bg: 'bg-rose-50 dark:bg-rose-900/20',   border: 'border-rose-200 dark:border-rose-800' },
  { id: 'feature',  label: 'Feature Request',   icon: Lightbulb,     color: 'text-amber-500',  bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' },
  { id: 'billing',  label: 'Billing / Account', icon: CreditCard,    color: 'text-blue-500',   bg: 'bg-blue-50 dark:bg-blue-900/20',   border: 'border-blue-200 dark:border-blue-800' },
  { id: 'general',  label: 'General Question',  icon: HelpCircle,    color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800' },
];

const FAQ = [
  { q: 'How long does setup take?',               a: 'Under 3 minutes. Scan the QR code, select your groups, and you\'re live.' },
  { q: 'Can I monitor multiple WhatsApp groups?', a: 'Yes — there is no hard limit during beta. Select as many property groups as you like.' },
  { q: 'Is my WhatsApp data secure?',             a: 'Yes. Session credentials are encrypted, and we never store raw message content — only extracted structured fields.' },
  { q: 'Why are some listings not parsing correctly?', a: 'Our parser handles most Indian real estate formats, but very unusual messages may extract with lower confidence. Use the confidence score filter to focus on high-quality listings.' },
  { q: 'Do I need a separate WhatsApp number?',   a: 'No — you connect your existing WhatsApp number via QR code, the same way WhatsApp Web works.' },
  { q: 'Is PropDigest free?',                     a: 'Yes, during beta. We will announce pricing well in advance before any paid plans are introduced.' },
];

export default function ContactPage() {
  const [category, setCategory] = useState('');
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [message,  setMessage]  = useState('');
  const [sent,     setSent]     = useState(false);
  const [sending,  setSending]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !name.trim() || !email.trim() || !message.trim()) return;
    setSending(true);
    // Simulated send — replace with real API call
    await new Promise(r => setTimeout(r, 1200));
    setSent(true);
    setSending(false);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white">
      <PublicNavbar />

      {/* Header */}
      <section className="pt-32 pb-12 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-4">Support</div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter mb-4">We're here to help</h1>
          <p className="text-slate-500 dark:text-slate-400">
            Bug report, feature idea, or general question — send us a message and we'll get back within 24 hours.
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 pb-24 grid grid-cols-1 lg:grid-cols-5 gap-12">

        {/* Contact form */}
        <div className="lg:col-span-3">
          {sent ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-black mb-3">Message sent!</h2>
              <p className="text-slate-500 dark:text-slate-400 max-w-sm">
                Thanks for reaching out. We'll reply to <strong className="text-slate-700 dark:text-slate-300">{email}</strong> within 24 hours.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Category picker */}
              <div>
                <label className="block text-sm font-black text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wider text-[11px]">
                  What can we help with? <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {CATEGORIES.map(({ id, label, icon: Icon, color, bg, border }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCategory(id)}
                      className={`flex items-center gap-3 p-4 rounded-2xl border text-left transition-all ${
                        category === id
                          ? `${bg} ${border} ring-2 ring-offset-0 ring-blue-500`
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <Icon className={`w-5 h-5 shrink-0 ${color}`} />
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Name + Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2">
                    Full name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Rahul Sharma"
                    required
                    className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2">
                    Email address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wider mb-2">
                  Message <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Describe your issue or question in detail. Include any error messages or steps to reproduce."
                  required
                  rows={6}
                  className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={sending || !category}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white font-black text-sm rounded-2xl transition-all flex items-center justify-center gap-2"
              >
                {sending ? (
                  <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Sending…</>
                ) : (
                  <><MessageSquare className="w-4 h-4" /> Send message</>
                )}
              </button>

              <p className="text-xs text-slate-400 text-center">
                We aim to reply within 24 hours on business days.
              </p>
            </form>
          )}
        </div>

        {/* Sidebar: contact info + FAQ */}
        <div className="lg:col-span-2 space-y-8">
          {/* Direct contact */}
          <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest mb-4">Direct contact</h3>
            <div className="space-y-3">
              {[
                { label: 'General support', value: 'support@propdigest.in', icon: Mail },
                { label: 'Privacy & data',  value: 'privacy@propdigest.in',  icon: Mail },
                { label: 'WhatsApp',        value: '+91 98765 00000',         icon: MessageSquare },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-black uppercase tracking-wider">{label}</div>
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-300 mt-0.5">{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Response time */}
          <div className="p-5 rounded-2xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm font-black text-green-800 dark:text-green-300">Typically responds in &lt; 4 hours</span>
            </div>
            <p className="text-xs text-green-700 dark:text-green-400">During business hours (IST). All queries acknowledged within 24h.</p>
          </div>

          {/* FAQ */}
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest mb-4">FAQ</h3>
            <div className="space-y-3">
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                  <summary className="px-4 py-3.5 cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all list-none">
                    {q}
                    <span className="text-slate-400 group-open:rotate-45 transition-transform shrink-0 text-lg leading-none">+</span>
                  </summary>
                  <div className="px-4 pb-4 pt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-200 dark:border-slate-800">
                    {a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
