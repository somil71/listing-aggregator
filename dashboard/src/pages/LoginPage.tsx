import React, { useEffect } from 'react';
import { SignIn, useAuth } from '@clerk/react';
import { useNavigate, Link } from 'react-router-dom';
import { Shield, BarChart2, Search } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';

const FEATURES = [
  { icon: Search,   title: 'Smart Parsing',    desc: 'Multi-layer AI + regex engine extracts price, location, config from raw WhatsApp messages.' },
  { icon: BarChart2, title: 'Market Analytics', desc: 'Real-time insights: avg prices, top locations, demand trends — all from your groups.' },
  { icon: Shield,   title: 'Private & Secure', desc: 'Your data stays yours. Each account sees only their own scraped listings.' },
];

export default function LoginPage() {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isSignedIn) navigate('/dashboard', { replace: true });
  }, [isSignedIn]);

  return (
    <div className="min-h-screen bg-slate-950 dark:bg-slate-950 flex flex-col">
      <PublicNavbar />

      <div className="flex-1 flex flex-col lg:flex-row mt-16">

        {/* Left panel — branding + features */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-14 xl:p-20 bg-slate-950">
          {/* Hero */}
          <div className="my-auto">
            <div className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-5">
              WhatsApp → Structured Listings
            </div>
            <h1 className="text-4xl xl:text-5xl font-black text-white leading-none tracking-tighter mb-6">
              Turn group chats<br />
              into <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">market data</span>
            </h1>
            <p className="text-slate-400 font-medium text-lg leading-relaxed max-w-sm mb-10">
              Automatically parse WhatsApp property listings, filter by location and price, and track your market in real time.
            </p>

            {/* Feature cards */}
            <div className="space-y-3">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-4 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl">
                  <div className="w-8 h-8 bg-blue-600/20 border border-blue-600/20 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-white">{title}</div>
                    <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 text-[10px] text-slate-600 font-bold mt-12">
            <span>© {new Date().getFullYear()} PropDigest</span>
            <Link to="/privacy" className="hover:text-slate-400 transition-colors">Privacy</Link>
            <Link to="/terms"   className="hover:text-slate-400 transition-colors">Terms</Link>
          </div>
        </div>

        {/* Right panel — Clerk sign-in */}
        <div className="flex-1 flex items-center justify-center p-8 bg-slate-900 lg:border-l border-slate-800">
          <div className="w-full max-w-sm">
            <div className="mb-8">
              <h2 className="text-2xl font-black text-white tracking-tight">Sign in to PropDigest</h2>
              <p className="text-slate-400 text-sm mt-1">Access your property intelligence dashboard</p>
            </div>
            <SignIn routing="hash" forceRedirectUrl="/dashboard" />
            <p className="text-xs text-slate-600 mt-6 text-center">
              By signing in you agree to our{' '}
              <Link to="/terms" className="text-slate-400 hover:text-white transition-colors">Terms</Link>
              {' '}and{' '}
              <Link to="/privacy" className="text-slate-400 hover:text-white transition-colors">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
