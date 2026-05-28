import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUser, useClerk } from '@clerk/react';
import {
  Home, LayoutDashboard, BarChart2, Settings,
  LogOut, Moon, Sun, ChevronRight, Globe, Info, Phone, FileText,
  UserCircle, Wifi, WifiOff,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useWhatsAppAuth } from '../hooks/useWhatsAppAuth';

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { label: 'Dashboard',  path: '/dashboard',  icon: LayoutDashboard },
  { label: 'Analytics',  path: '/analytics',  icon: BarChart2 },
  { label: 'Profile',    path: '/profile',    icon: UserCircle },
  { label: 'Settings',   path: '/settings',   icon: Settings },
];

const PUBLIC_LINKS: NavItem[] = [
  { label: 'Home / Landing', path: '/',        icon: Globe },
  { label: 'About us',       path: '/about',   icon: Info },
  { label: 'Contact',        path: '/contact', icon: Phone },
  { label: 'Privacy & Terms',path: '/privacy', icon: FileText },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user }          = useUser();
  const { signOut }       = useClerk();
  const { dark, toggle }  = useTheme();
  const { pathname }      = useLocation();
  const { isConnected, phone, loading: waLoading } = useWhatsAppAuth();

  const displayName = user
    ? (user.firstName ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : 'User').trim()
    : '';
  const email   = user?.primaryEmailAddress?.emailAddress ?? '';
  const initial = (displayName || email || '?').charAt(0).toUpperCase();

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 font-sans">

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="w-64 bg-slate-900 flex flex-col fixed inset-y-0 z-20 border-r border-slate-800/60">

        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800/60">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-blue-900/40">
              <Home className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-black text-white text-[15px] tracking-tight leading-none">PROPDIGEST</div>
              <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Property Intelligence</div>
            </div>
          </Link>
        </div>

        {/* ── Persistent WhatsApp connection status ── */}
        {!waLoading && (
          <div className={`mx-3 mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2 border text-xs font-bold transition-all ${
            isConnected
              ? 'bg-green-950/60 border-green-800/60 text-green-400'
              : 'bg-slate-800/40 border-slate-700/40 text-slate-500'
          }`}>
            {isConnected ? (
              <>
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
                <span className="flex-1 truncate">
                  {phone ? `WA · ${phone}` : 'WhatsApp Connected'}
                </span>
                <Wifi className="w-3 h-3 shrink-0" />
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 shrink-0 text-slate-600" />
                <span className="flex-1">WhatsApp offline</span>
              </>
            )}
          </div>
        )}

        {/* App navigation */}
        <nav className="px-3 py-4 space-y-0.5">
          <div className="text-[9px] text-slate-600 font-black uppercase tracking-widest px-3 mb-2">App</div>
          {NAV.map(({ label, path, icon: Icon }) => {
            const active = pathname === path || (path !== '/dashboard' && pathname.startsWith(path));
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  active
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {active && <ChevronRight className="w-3.5 h-3.5 opacity-50" />}
              </Link>
            );
          })}
        </nav>

        {/* Divider */}
        <div className="mx-4 border-t border-slate-800/60" />

        {/* Public pages links */}
        <nav className="px-3 py-3 space-y-0.5 flex-1 overflow-y-auto">
          <div className="text-[9px] text-slate-600 font-black uppercase tracking-widest px-3 mb-2">Public site</div>
          {PUBLIC_LINKS.map(({ label, path, icon: Icon }) => {
            const active = pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                  active
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-800/60 p-3 space-y-1">
          {/* Dark mode toggle */}
          <button
            onClick={toggle}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white text-xs font-bold transition-all"
          >
            {dark
              ? <Sun  className="w-4 h-4 text-amber-400" />
              : <Moon className="w-4 h-4 text-slate-400" />}
            {dark ? 'Switch to light mode' : 'Switch to dark mode'}
          </button>

          {/* Profile card */}
          {user && (
            <div className="mt-1 rounded-xl bg-slate-800/50 p-3">
              <Link to="/profile" className="flex items-center gap-2.5 mb-3 group">
                {user.imageUrl ? (
                  <img
                    src={user.imageUrl}
                    className="w-8 h-8 rounded-full ring-2 ring-slate-700 group-hover:ring-blue-500 object-cover shrink-0 transition-all"
                    alt="avatar"
                  />
                ) : (
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0">
                    {initial}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm font-bold truncate leading-none group-hover:text-blue-400 transition-colors">{displayName}</div>
                  <div className="text-slate-500 text-[10px] truncate mt-0.5">{email}</div>
                </div>
              </Link>
              <button
                onClick={() => signOut({ redirectUrl: '/' })}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-slate-400 hover:bg-red-900/40 hover:text-red-400 text-[11px] font-bold transition-all"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="ml-64 flex-1 flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}
