import React from 'react';
import { Home, Target, Eye, Heart, Zap, Users } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import { Link } from 'react-router-dom';

const VALUES = [
  { icon: Eye,    color: 'text-blue-400',   bg: 'bg-blue-400/10',   title: 'Transparency',    desc: 'Clear data sourcing, honest confidence scoring, no hidden black boxes.' },
  { icon: Heart,  color: 'text-rose-400',   bg: 'bg-rose-400/10',   title: 'Privacy First',   desc: 'Your market data is yours. We never share, sell, or use it for ads.' },
  { icon: Zap,    color: 'text-amber-400',  bg: 'bg-amber-400/10',  title: 'Speed',           desc: 'Listings hit your dashboard within seconds of being posted in the group.' },
  { icon: Target, color: 'text-purple-400', bg: 'bg-purple-400/10', title: 'Accuracy',        desc: 'Multi-layer parser with LLM + regex + conflict detection for reliable extraction.' },
];

const TEAM = [
  { name: 'PropDigest Team', role: 'Product & Engineering', initial: 'P', gradient: 'from-blue-500 to-blue-700' },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white">
      <PublicNavbar />

      {/* Hero */}
      <section className="pt-32 pb-20 px-6 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-4">About us</div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tighter mb-6 leading-none">
            We're building the{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-cyan-500">
              Bloomberg for Indian real estate
            </span>
          </h1>
          <p className="text-lg text-slate-500 dark:text-slate-400 leading-relaxed">
            India's property market runs on WhatsApp groups — thousands of listings shared daily in informal, unstructured messages. We built PropDigest to bring structure, intelligence, and analytics to this fragmented data.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 px-6 bg-slate-50 dark:bg-slate-900/30">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-blue-900/30">
              <Home className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-3xl font-black tracking-tighter mb-4">Our mission</h2>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
              Real estate agents and investors across India are drowning in unstructured WhatsApp messages. Critical listing information — price, location, configuration — is buried in informal text, emojis, and voice notes.
            </p>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              PropDigest turns that noise into structured, searchable, and analyzable market intelligence. Our mission is to level the playing field — giving every agent and investor the same quality of market data as the largest institutional players.
            </p>
          </div>
          <div className="space-y-4">
            {[
              { n: '2024', label: 'Founded' },
              { n: '50K+', label: 'Listings parsed' },
              { n: '30+',  label: 'Cities covered' },
              { n: '500+', label: 'Active users' },
            ].map(({ n, label }) => (
              <div key={label} className="flex items-center gap-4 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
                <div className="text-2xl font-black text-blue-600 w-16 shrink-0">{n}</div>
                <div className="text-sm font-bold text-slate-600 dark:text-slate-400">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">Our values</div>
            <h2 className="text-4xl font-black tracking-tighter">What we stand for</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {VALUES.map(({ icon: Icon, color, bg, title, desc }) => (
              <div key={title} className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className={`w-10 h-10 ${bg} rounded-2xl flex items-center justify-center mb-4`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <h3 className="text-base font-black text-slate-900 dark:text-white mb-2">{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Technology */}
      <section className="py-20 px-6 bg-slate-50 dark:bg-slate-900/30">
        <div className="max-w-4xl mx-auto text-center">
          <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">Technology</div>
          <h2 className="text-3xl font-black tracking-tighter mb-6">Built on modern, proven tech</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {['Groq LLM', 'React + Vite', 'PostgreSQL / Neon', 'Clerk Auth', 'Baileys WA', 'Tailwind CSS', 'Node.js', 'Express'].map(t => (
              <span key={t} className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-300">
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl font-black tracking-tighter mb-4">Join us on the journey</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-8">
            We're in beta and growing fast. Come shape the product with us.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/login" className="px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-2xl transition-all">
              Get started free
            </Link>
            <Link to="/contact" className="px-8 py-3.5 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
              Contact us
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
