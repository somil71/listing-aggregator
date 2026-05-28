import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import axios from 'axios';
import { ThemeProvider } from './context/ThemeContext';

// Public pages
import LandingPage    from './pages/LandingPage';
import AboutPage      from './pages/AboutPage';
import PrivacyPage    from './pages/PrivacyPage';
import TermsPage      from './pages/TermsPage';
import ContactPage    from './pages/ContactPage';
import LoginPage      from './pages/LoginPage';

// App pages (protected)
import DashboardPage     from './pages/DashboardPage';
import SettingsPage      from './pages/SettingsPage';
import ListingDetailPage from './pages/ListingDetailPage';
import AnalyticsPage     from './pages/AnalyticsPage';
import ProfilePage       from './pages/ProfilePage';

// Blocking modal shown once on first login
import AcceptTermsModal  from './components/AcceptTermsModal';

// ─── TOS gate — fetches once per authenticated session ───────────────────────

function useTosStatus() {
  const { isSignedIn, getToken } = useAuth();
  const [accepted, setAccepted] = useState<boolean | null>(null); // null = still loading

  const check = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      const { data } = await axios.get('/api/user/tos-status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAccepted(data.accepted ?? false);
    } catch {
      // If the check fails (network, or DB not yet migrated) let the user through
      // so a backend outage doesn't hard-block the whole app.
      setAccepted(true);
    }
  }, [isSignedIn, getToken]);

  useEffect(() => {
    if (isSignedIn) check();
  }, [isSignedIn, check]);

  return { accepted, markAccepted: () => setAccepted(true) };
}

// ─── Auth + TOS guard ────────────────────────────────────────────────────────

function ProtectedRoute({ children, tosAccepted, onAccepted }: {
  children: React.ReactNode;
  tosAccepted: boolean | null;
  onAccepted: () => void;
}) {
  const { isSignedIn, isLoaded } = useAuth();

  // Waiting for Clerk load OR for the TOS check to resolve
  if (!isLoaded || (isSignedIn && tosAccepted === null)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) return <Navigate to="/login" replace />;

  // Signed in but hasn't accepted T&C yet — overlay the modal on top of a blurred page
  if (!tosAccepted) {
    return (
      <>
        <div className="pointer-events-none select-none blur-sm opacity-40">
          {children}
        </div>
        <AcceptTermsModal onAccepted={onAccepted} />
      </>
    );
  }

  return <>{children}</>;
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    // ThemeProvider is the single source of truth for dark/light mode.
    // It wraps everything so useTheme() returns shared context everywhere.
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}

// Separate component so hooks can be used inside BrowserRouter context
function AppRoutes() {
  const { accepted, markAccepted } = useTosStatus();

  return (
    <Routes>
      {/* ── Public ── */}
      <Route path="/"        element={<LandingPage />} />
      <Route path="/about"   element={<AboutPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms"   element={<TermsPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/login"   element={<LoginPage />} />

      {/* ── Protected (all gated behind TOS acceptance) ── */}
      <Route path="/dashboard" element={
        <ProtectedRoute tosAccepted={accepted} onAccepted={markAccepted}>
          <DashboardPage />
        </ProtectedRoute>
      } />
      <Route path="/listing/:id" element={
        <ProtectedRoute tosAccepted={accepted} onAccepted={markAccepted}>
          <ListingDetailPage />
        </ProtectedRoute>
      } />
      <Route path="/settings" element={
        <ProtectedRoute tosAccepted={accepted} onAccepted={markAccepted}>
          <SettingsPage />
        </ProtectedRoute>
      } />
      <Route path="/analytics" element={
        <ProtectedRoute tosAccepted={accepted} onAccepted={markAccepted}>
          <AnalyticsPage />
        </ProtectedRoute>
      } />
      <Route path="/profile" element={
        <ProtectedRoute tosAccepted={accepted} onAccepted={markAccepted}>
          <ProfilePage />
        </ProtectedRoute>
      } />

      {/* ── Fallback ── */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
