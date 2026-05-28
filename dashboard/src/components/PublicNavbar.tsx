import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Moon, Sun, Menu, X } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const NAV_LINKS = [
  { label: 'Features',     href: '/#features' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'About',        href: '/about' },
  { label: 'Contact',      href: '/contact' },
];

export default function PublicNavbar() {
  const { dark, toggle } = useTheme();
  const [scrolled, setScrolled]   = useState(false);
  const [menuOpen, setMenuOpen]   = useState(false);
  const { pathname }               = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // close mobile menu on route change
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-200 ${
        scrolled || menuOpen
          ? 'bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-sm border-b border-slate-200 dark:border-slate-800'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-5 h-16 flex items-center gap-4">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0 mr-2">
          <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/30">
            <Home className="w-4 h-4 text-white" />
          </div>
          <span className="font-black text-slate-900 dark:text-white text-[15px] tracking-tight">PROPDIGEST</span>
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1">
          {NAV_LINKS.map(l =>
            l.href.startsWith('/#') ? (
              <a
                key={l.href}
                href={l.href}
                className="px-3.5 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.href}
                to={l.href}
                className="px-3.5 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all"
              >
                {l.label}
              </Link>
            )
          )}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={toggle}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            aria-label="Toggle theme"
          >
            {dark
              ? <Sun  className="w-4 h-4 text-amber-400" />
              : <Moon className="w-4 h-4" />}
          </button>

          <Link
            to="/login"
            className="hidden md:block px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
          >
            Sign in
          </Link>

          <Link
            to="/login"
            className="hidden md:inline-flex items-center px-4 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-sm shadow-blue-600/30"
          >
            Get started free
          </Link>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            aria-label="Menu"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden px-5 pb-5 space-y-1 border-t border-slate-200 dark:border-slate-800 pt-3">
          {NAV_LINKS.map(l =>
            l.href.startsWith('/#') ? (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
                className="block px-3.5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                {l.label}
              </a>
            ) : (
              <Link key={l.href} to={l.href}
                className="block px-3.5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                {l.label}
              </Link>
            )
          )}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-2">
            <Link to="/login" className="text-center py-2.5 text-sm font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
              Sign in
            </Link>
            <Link to="/login" className="text-center py-2.5 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all">
              Get started free
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
