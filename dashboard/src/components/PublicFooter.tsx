import React from 'react';
import { Link } from 'react-router-dom';
import { Home, Twitter, Linkedin, Github, Mail } from 'lucide-react';

const COLS = {
  Product: [
    { label: 'Features',     href: '/#features' },
    { label: 'How it works', href: '/#how-it-works' },
    { label: 'Dashboard',    href: '/dashboard' },
    { label: 'Analytics',    href: '/analytics' },
    { label: 'Get started',  href: '/login' },
  ],
  Company: [
    { label: 'About us',  href: '/about' },
    { label: 'Contact',   href: '/contact' },
    { label: 'Blog',      href: '#' },
    { label: 'Careers',   href: '#' },
  ],
  Legal: [
    { label: 'Privacy Policy',    href: '/privacy' },
    { label: 'Terms of Service',  href: '/terms' },
    { label: 'Cookie Policy',     href: '/privacy#cookies' },
  ],
};

const SOCIALS = [
  { Icon: Twitter,  href: '#' },
  { Icon: Linkedin, href: '#' },
  { Icon: Github,   href: '#' },
  { Icon: Mail,     href: '/contact' },
];

function FooterLink({ label, href }: { label: string; href: string }) {
  if (href.startsWith('/') && !href.startsWith('/#')) {
    return <Link to={href} className="text-sm text-slate-400 hover:text-white transition-colors">{label}</Link>;
  }
  return <a href={href} className="text-sm text-slate-400 hover:text-white transition-colors">{label}</a>;
}

export default function PublicFooter() {
  return (
    <footer className="bg-slate-900 dark:bg-black border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-6 pt-16 pb-10">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-14">
          {/* Brand col — spans 2 */}
          <div className="col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/40">
                <Home className="w-4 h-4 text-white" />
              </div>
              <span className="font-black text-white text-[15px] tracking-tight">PROPDIGEST</span>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
              Turning raw WhatsApp property messages into structured market data for real estate professionals across India.
            </p>
            <div className="flex items-center gap-2.5 mt-6">
              {SOCIALS.map(({ Icon, href }, i) => (
                <a key={i} href={href}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all">
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(COLS).map(([title, items]) => (
            <div key={title}>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">{title}</div>
              <ul className="space-y-3">
                {items.map(item => (
                  <li key={item.label}>
                    <FooterLink {...item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <span>© {new Date().getFullYear()} PropDigest. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="hover:text-slate-400 transition-colors">Privacy</Link>
            <Link to="/terms"   className="hover:text-slate-400 transition-colors">Terms</Link>
            <Link to="/contact" className="hover:text-slate-400 transition-colors">Support</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
