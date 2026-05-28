import React from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare, BarChart2, Search, Shield, Zap, MapPin,
  Check, ArrowRight, Star, ChevronRight,
} from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';

// ─── Data ────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: MessageSquare,
    title: 'WhatsApp Parser',
    desc: 'Monitor any number of WhatsApp property groups simultaneously. New messages hit your dashboard within seconds.',
    color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/20',
  },
  {
    icon: Search,
    title: 'AI + Regex Extraction',
    desc: 'Multi-layer engine: Groq LLM + regex + conflict detection. Pulls price, location, BHK, furnishing, and intent from raw informal text.',
    color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20',
  },
  {
    icon: BarChart2,
    title: 'Market Analytics',
    desc: 'Avg prices, location breakdowns, BHK mix, furnished status, inventory trends — live from your monitored groups.',
    color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/20',
  },
  {
    icon: MapPin,
    title: 'Location Intelligence',
    desc: 'Community-level heatmaps. See which micro-markets have the most active inventory and where prices are moving.',
    color: 'text-rose-400', bg: 'bg-rose-400/10', border: 'border-rose-400/20',
  },
  {
    icon: Shield,
    title: 'Fully Private',
    desc: 'Your scraped data is siloed to your account. No cross-user data sharing, no ads, no reselling of your market data.',
    color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20',
  },
  {
    icon: Zap,
    title: 'Smart Filtering',
    desc: 'Filter by price range, location, BHK, furnished status, listing intent. Export to CSV for your CRM or spreadsheets.',
    color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20',
  },
];

const STEPS = [
  { n: '01', title: 'Connect WhatsApp', desc: 'Scan a QR code to link your WhatsApp number. Takes less than 60 seconds — no app install needed.' },
  { n: '02', title: 'Select Your Groups', desc: 'Choose which property groups to monitor. Add or remove groups any time from your settings.' },
  { n: '03', title: 'Get Live Intelligence', desc: 'Every new message is parsed instantly. Browse structured listings and market analytics in real time.' },
];

const TESTIMONIALS = [
  {
    name: 'Rahul Sharma', role: 'Senior Broker, Mumbai', stars: 5,
    body: 'PropDigest saves me 3+ hours a day. I used to manually copy listings from 15 groups — now it\'s fully automated and I can search across everything.',
  },
  {
    name: 'Priya Mehta', role: 'Real Estate Investor, Pune', stars: 5,
    body: 'The analytics alone are worth it. I spot price trends in Hinjewadi a week before they show up anywhere else.',
  },
  {
    name: 'Ankit Gupta', role: 'Property Consultant, Bangalore', stars: 5,
    body: 'Finally a tool that actually understands Indian real estate language — "2BHK semi-furnished near metro 35k". It just works.',
  },
];

const STATS = [
  { value: '50K+',  label: 'Listings parsed' },
  { value: '500+',  label: 'Active agents' },
  { value: '30+',   label: 'Cities covered' },
  { value: '99.9%', label: 'Uptime' },
];

const PARSED_EXAMPLE = [
  { label: 'Community', value: 'Alpha 2' },
  { label: 'Config',    value: '2 BHK' },
  { label: 'Furnished', value: 'Fully' },
  { label: 'Rent',      value: '₹28K/mo' },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white">
      <PublicNavbar />

      {/* ══ HERO ══════════════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
        {/* Dark gradient background — always dark for dramatic effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(37,99,235,0.25),transparent)]" />
        <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 py-28 flex flex-col items-center text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] font-bold mb-8 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Now in beta · Join 500+ real estate professionals
          </div>

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-black text-white leading-none tracking-tighter mb-6 max-w-5xl">
            Turn WhatsApp group chats into{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-blue-300 to-cyan-400">
              property market intelligence
            </span>
          </h1>

          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mb-10 leading-relaxed">
            PropDigest automatically parses listings from your WhatsApp real estate groups — extracting price, location, BHK, and furnishing — delivering structured data and live analytics.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3 mb-16">
            <Link
              to="/login"
              className="px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-sm rounded-2xl transition-all shadow-xl shadow-blue-900/40 flex items-center gap-2 group"
            >
              Get started — it's free
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="#how-it-works"
              className="px-8 py-3.5 bg-white/5 hover:bg-white/10 text-white font-bold text-sm rounded-2xl border border-white/10 hover:border-white/20 transition-all"
            >
              See how it works
            </a>
          </div>

          {/* Product preview card */}
          <div className="w-full max-w-2xl bg-slate-900/70 border border-slate-700/50 rounded-3xl p-6 backdrop-blur-sm text-left shadow-2xl shadow-black/40">
            <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-2">Raw WhatsApp message</div>
            <div className="font-mono text-sm text-slate-300 bg-slate-800/60 rounded-xl p-4 mb-5 border border-slate-700/30 leading-relaxed">
              Alpha 2 2bhk fully furnished 3rd flr 28k/month owner only contact 9876XXXXXX
            </div>
            <div className="flex items-center gap-2 text-[10px] text-blue-400 font-black uppercase tracking-widest mb-3">
              <Zap className="w-3 h-3" /> Parsed by PropDigest
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {PARSED_EXAMPLE.map(({ label, value }) => (
                <div key={label} className="bg-slate-800/70 border border-slate-700/30 rounded-xl p-3">
                  <div className="text-[9px] text-slate-500 font-black uppercase tracking-widest">{label}</div>
                  <div className="text-sm font-black text-white mt-1">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ STATS ══════════════════════════════════════════════════════════════ */}
      <section className="border-y border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
        <div className="max-w-5xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {STATS.map(({ value, label }) => (
            <div key={label}>
              <div className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white">{value}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ FEATURES ═══════════════════════════════════════════════════════════ */}
      <section id="features" className="py-28 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">Features</div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4">
              Everything you need to dominate your market
            </h2>
            <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto text-lg">
              From raw WhatsApp messages to structured dashboards — PropDigest handles the entire data pipeline.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc, color, bg, border }) => (
              <div
                key={title}
                className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-lg hover:border-slate-300 dark:hover:border-slate-700 transition-all"
              >
                <div className={`w-10 h-10 ${bg} border ${border} rounded-2xl flex items-center justify-center mb-4`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <h3 className="text-base font-black text-slate-900 dark:text-white mb-2">{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ HOW IT WORKS ═══════════════════════════════════════════════════════ */}
      <section id="how-it-works" className="py-28 px-6 bg-slate-50 dark:bg-slate-900/30">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">How it works</div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4">Set up in under 3 minutes</h2>
            <p className="text-slate-500 dark:text-slate-400">
              No code, no complex setup. Just scan, select, and start getting insights.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {STEPS.map(({ n, title, desc }, i) => (
              <div key={n} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-full w-full h-px bg-gradient-to-r from-slate-300 dark:from-slate-700 to-transparent -translate-x-4 translate-y-px" />
                )}
                <div className="text-5xl font-black text-slate-100 dark:text-slate-800 leading-none mb-4 select-none">{n}</div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link to="/login" className="inline-flex items-center gap-2 px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-2xl transition-all shadow-sm group">
              Start for free
              <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* ══ TESTIMONIALS ═══════════════════════════════════════════════════════ */}
      <section className="py-28 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">Testimonials</div>
            <h2 className="text-4xl font-black tracking-tighter">Loved by real estate professionals</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map(({ name, role, body, stars }) => (
              <div key={name} className="p-7 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="flex items-center gap-0.5 mb-4">
                  {Array.from({ length: stars }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-6 italic">"{body}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0">
                    {name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">{name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CTA BANNER ═════════════════════════════════════════════════════════ */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-3xl p-12 text-center shadow-2xl shadow-blue-900/30 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(255,255,255,0.15),transparent)]" />
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-black text-white tracking-tighter mb-4">
                Ready to transform your workflow?
              </h2>
              <p className="text-blue-100 mb-8 max-w-xl mx-auto text-lg">
                Join hundreds of brokers and investors who use PropDigest to get ahead of the market.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-8 py-4 bg-white text-blue-700 font-black text-sm rounded-2xl hover:bg-blue-50 transition-all shadow-xl group"
              >
                Get started free
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-blue-200 text-xs font-medium">
                {['No credit card required', 'Free during beta', 'Cancel anytime', 'Your data stays private'].map(t => (
                  <span key={t} className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
