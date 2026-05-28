import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '@clerk/react';
import { TrendingUp, MapPin, Home, Bed, BarChart2, DollarSign, Loader2 } from 'lucide-react';
import Layout from '../components/Layout';

// Server-side aggregations — all heavy lifting happens in Postgres.
// The page just renders. This scales to millions of listings.

interface AnalyticsOverview {
  window: string;
  totals: {
    total?: number | string;
    high_confidence?: number | string;
    avg_price_inr?: number | null;
    avg_price_aed?: number | null;
    distinct_communities?: number | string;
    distinct_agents?: number | string;
  };
  byGroup:     { group_name: string; count: string; avg_price: number | null }[];
  byIntent:    { intent: string; count: string }[];
  byBedrooms:  { bedrooms: string; count: string }[];
  byCommunity: { community: string; count: string; avg_price: number | null }[];
  priceBuckets: { currency: string; bucket: number; count: string; lo: number; hi: number }[];
}

const fmtPrice = (p: number | null | undefined, currency = 'INR'): string => {
  if (p == null) return '—';
  if (currency === 'INR') {
    if (p >= 10_000_000) return `₹${(p / 10_000_000).toFixed(1)} Cr`;
    if (p >= 100_000)    return `₹${(p / 100_000).toFixed(1)} L`;
    if (p >= 1_000)      return `₹${(p / 1_000).toFixed(1)}k`;
    return `₹${p}`;
  }
  if (p >= 1_000_000) return `${currency} ${(p / 1_000_000).toFixed(1)}M`;
  if (p >= 1_000)     return `${currency} ${(p / 1_000).toFixed(1)}k`;
  return `${currency} ${p}`;
};

function StatCard({
  label, value, sub, accent = 'blue',
}: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  const accents: Record<string, string> = {
    blue:   'from-blue-500/10 to-blue-600/5 border-blue-500/20',
    green:  'from-green-500/10 to-green-600/5 border-green-500/20',
    purple: 'from-purple-500/10 to-purple-600/5 border-purple-500/20',
    amber:  'from-amber-500/10 to-amber-600/5 border-amber-500/20',
  };
  return (
    <div className={`bg-gradient-to-br ${accents[accent] ?? accents.blue} border rounded-2xl p-5`}>
      <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">{label}</div>
      <div className="text-2xl font-black text-slate-900 dark:text-white">{value}</div>
      {sub && <div className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-1">{sub}</div>}
    </div>
  );
}

function BarRow({ label, value, max, color = 'bg-blue-500' }: {
  label: string; value: number; max: number; color?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xs font-bold text-slate-700 dark:text-slate-300 truncate shrink-0">{label}</div>
      <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
        <div className={`${color} h-full rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs font-black text-slate-900 dark:text-white w-8 text-right">{value}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { getToken } = useAuth();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading]   = useState(true);
  const [window, setWindow]     = useState<'1d' | '4d' | '7d' | '30d'>('4d');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const { data } = await axios.get(`/api/v1/analytics/overview?window=${window}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) {
          setOverview(data.data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError('Failed to load analytics. Try refreshing.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [window, getToken]);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !overview) {
    return (
      <Layout>
        <div className="text-center py-12 text-slate-400">{error || 'No data available.'}</div>
      </Layout>
    );
  }

  const total          = parseInt(String(overview.totals.total || 0));
  const highConfidence = parseInt(String(overview.totals.high_confidence || 0));
  const groupMax       = Math.max(1, ...overview.byGroup.map(r => parseInt(r.count)));
  const intentMax      = Math.max(1, ...overview.byIntent.map(r => parseInt(r.count)));
  const bedroomMax     = Math.max(1, ...overview.byBedrooms.map(r => parseInt(r.count)));

  return (
    <Layout>
      <div className="px-6 py-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Analytics</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Listings activity over the last {overview.window}</p>
          </div>
          <select
            value={window}
            onChange={e => setWindow(e.target.value as '1d' | '4d' | '7d' | '30d')}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 dark:text-slate-300"
          >
            <option value="1d">Last 24h</option>
            <option value="4d">Last 4 days</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total listings"      value={total}                       accent="blue"   />
          <StatCard label="High confidence"     value={highConfidence}              sub={`${total ? Math.round(highConfidence * 100 / total) : 0}% of total`} accent="green" />
          <StatCard label="Distinct communities"value={overview.totals.distinct_communities || 0} accent="purple" />
          <StatCard label="Distinct agents"     value={overview.totals.distinct_agents     || 0} accent="amber"  />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* By group */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-blue-600" />
              <h2 className="font-black text-slate-900 dark:text-white uppercase text-sm tracking-tight">Top groups</h2>
            </div>
            <div className="space-y-2.5">
              {overview.byGroup.map(g => (
                <BarRow key={g.group_name} label={g.group_name} value={parseInt(g.count)} max={groupMax} color="bg-blue-500" />
              ))}
            </div>
          </div>

          {/* By intent */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Home className="w-4 h-4 text-green-600" />
              <h2 className="font-black text-slate-900 dark:text-white uppercase text-sm tracking-tight">Intent breakdown</h2>
            </div>
            <div className="space-y-2.5">
              {overview.byIntent.map(i => (
                <BarRow key={i.intent} label={i.intent} value={parseInt(i.count)} max={intentMax} color="bg-green-500" />
              ))}
            </div>
          </div>

          {/* Bedrooms */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Bed className="w-4 h-4 text-purple-600" />
              <h2 className="font-black text-slate-900 dark:text-white uppercase text-sm tracking-tight">Bedrooms</h2>
            </div>
            <div className="space-y-2.5">
              {overview.byBedrooms.map(b => (
                <BarRow key={b.bedrooms} label={b.bedrooms} value={parseInt(b.count)} max={bedroomMax} color="bg-purple-500" />
              ))}
            </div>
          </div>

          {/* Communities */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 className="w-4 h-4 text-amber-600" />
              <h2 className="font-black text-slate-900 dark:text-white uppercase text-sm tracking-tight">Top communities</h2>
            </div>
            <div className="space-y-3">
              {overview.byCommunity.map(c => (
                <div key={c.community} className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate flex-1">{c.community}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{c.count}</span>
                  <span className="ml-3 text-xs font-mono text-slate-600 dark:text-slate-400">
                    {c.avg_price ? fmtPrice(c.avg_price, 'INR') : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
