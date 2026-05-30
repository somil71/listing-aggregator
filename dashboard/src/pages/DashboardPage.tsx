import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Search, MapPin, Bed, Ruler, TrendingUp, Activity, Eye, EyeOff, MessageCircle, User, SlidersHorizontal, X } from 'lucide-react';
import { useAuth } from '@clerk/react';
import { Link, useNavigate } from 'react-router-dom';
import ConnectWhatsAppButton from '../components/ConnectWhatsAppButton';
import RefetchChatsButton from '../components/RefetchChatsButton';
import Layout from '../components/Layout';
import { sanitizePhone, formatPhone, waIdToPhone, toDisplayName } from '../utils/phone';

interface Listing {
  id: string;
  price: number | string | null;
  currency: string | null;
  location: string | null;
  area_text: string | null;
  bedrooms: number | string | null;   // Postgres NUMERIC comes back as string
  bathrooms: number | string | null;
  unit_type: string | null;           // 'BHK' | 'RK' | 'BK' | 'BR' | null
  property_type: string | null;
  area_sqft: number | string | null;
  area_sqm: number | string | null;
  furnished: string | null;           // 'furnished' | 'semi-furnished' | 'unfurnished' | null (TEXT in DB)
  parking: number | null;
  description: string | null;
  agent_phone: string | null;
  agent_name: string | null;
  group_name: string;
  wa_group_id: string | null;
  created_at: string;
  extraction_confidence: number | string | null;
  intent: string | null;
  rent_period: string | null;
  vacant: boolean | null;
  amenities: string[] | null;
  sender_wa_id: string | null;
  sender_name: string | null;
  has_media: boolean | null;
  media_keys: string[] | null;   // e.g. ["/app/data/media/abc123.jpg"]
  repost_count: number | string | null;  // times this exact message was re-posted by the same sender
}

interface ScrapeStats {
  rawMessages: number;
  listingsTotal: number;
  listingsHighConfidence: number;
  byGroup: { group_name: string; count: number }[];
  byConfidence: { high: number; medium: number; low: number };
}

// All values fetched dynamically from the user's actual DB data — no hardcoding.
interface FilterOptions {
  locations:      string[];
  configurations: { bedrooms: number; unit_type: string | null }[];
  price_ranges:   { currency: string; min_price: number; max_price: number }[];
  intents:        string[];
  property_types: string[];
  furnished:      string[];
  rent_periods:   string[];
}

interface ActiveFilters {
  intent:        string;
  bedrooms:      string;   // numeric string or '' for none
  unit_type:     string;   // paired with bedrooms
  location:      string;
  property_type: string;
  furnished:     string;   // canonical: 'furnished' | 'semi-furnished' | 'unfurnished'
  rent_period:   string;
  min_price:     string;
  max_price:     string;
  min_reposts:   string;   // '' | '2' | '3' | '5' — only show listings reposted ≥ N times
}

const EMPTY_FILTERS: ActiveFilters = {
  intent: '', bedrooms: '', unit_type: '', location: '',
  property_type: '', furnished: '', rent_period: '',
  min_price: '', max_price: '', min_reposts: '',
};

// Phone helpers live in dashboard/src/utils/phone.ts so both DashboardPage
// and ListingDetailPage share one implementation.

// toDisplayName is imported from utils/phone — kept here for visual reference:
// it returns null for WA IDs and phone-number-only strings, the trimmed string otherwise.

// Extract a location hint from raw/collapsed message text.
// Strategy 1 (works on whitespace-collapsed description): find text BEFORE the first
//   non-location stopword (independent, bhk, rent, furnished, …).
//   e.g. "Alpha 2 Independent Semi furnished 1bhk Rent 12.5k" → "Alpha 2"
// Strategy 2 (fallback for true multiline raw text): first non-skippable line.
const guessLocationFromText = (text: string | null): string | null => {
  if (!text) return null;

  // Stop-token approach — find the first keyword that signals "not location"
  const stopRe = /\b(?:independent|semi[\s-]?furnished|furnished|unfurnished|available|vacant|for\s+(?:rent|sale)|rent|sale|lease|only|\d+\s*(?:bhk|rk|bk|br|bedroom|bath|sqft|sqm)|flats?|studio|apartment|house|room|pg\b|bachelor|single|double|triple|looking|wanted)\b/i;
  const m = text.match(stopRe);
  if (m && typeof m.index === 'number' && m.index > 0) {
    const before = text.slice(0, m.index).trim().replace(/[^\w\s]/g, '').trim();
    if (before.length >= 2 && before.length <= 50 && /[a-zA-Z]/.test(before)) return before;
  }

  // Multiline fallback — first non-skippable line
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const skipRe = /\b(?:furnished|unfurnished|owner|story|storey|available|vacant|rent|sale|lease|flats?|studio|apartments?|house|room|pg\b|bachelor|looking|wanted|independent|semi)\b/i;
    for (const line of lines) {
      if (skipRe.test(line)) continue;
      const clean = line.replace(/[^\w\s]/g, '').trim();
      if (clean.length >= 2 && clean.length <= 40 && /[a-zA-Z]/.test(clean)) return clean;
    }
  }

  return null;
};

// Rejects strings that are property attributes masquerading as location names.
// "Fully Furnished", "With Owner", "Singal Story" are NOT locations.
// Uses word-boundary check (not ^) so "Fully Furnished" is caught even though
// it starts with "Fully", not "Furnished".
const isLikelyLocation = (str: string | null): boolean => {
  if (!str) return false;
  const nonLocRe = /\b(?:furnished|unfurnished|owner|story|storey|available|vacant|with\s+owner|independent|raw|bare|semi|separate|seprate|entry|\d*\s*(?:bhk|rk|bk|br))\b/i;
  return !nonLocRe.test(str);
};

// Location title for a listing — validates DB value first, then falls back to text extraction
const listingTitle = (l: Listing): string | null => {
  const dbLoc = l.location || l.area_text;
  if (dbLoc && isLikelyLocation(dbLoc)) return dbLoc;
  return guessLocationFromText(l.description) || null;
};

// Format bedroom count + unit type as "2 BHK", "1 RK", "3 BR", or just "2 BR" if no unit_type
const fmtBeds = (bedrooms: number | string | null, unit_type: string | null): string | null => {
  const n = bedrooms === null || bedrooms === undefined ? null : parseFloat(String(bedrooms));
  if (n === null || isNaN(n)) return null;
  if (n === 0) return 'Studio';
  const label = unit_type ? unit_type.toUpperCase() : 'BR';
  return `${n % 1 === 0 ? n : n.toFixed(1)} ${label}`;
};

// Intent → label + colour
const intentBadge = (intent: string | null) => {
  switch ((intent || '').toLowerCase()) {
    case 'rent':    return { label: 'RENT',     cls: 'bg-blue-100 text-blue-700' };
    case 'sale':    return { label: 'SALE',     cls: 'bg-purple-100 text-purple-700' };
    case 'wanted':  return { label: 'WANTED',   cls: 'bg-amber-100 text-amber-700' };
    case 'roommate':return { label: 'ROOMMATE', cls: 'bg-pink-100 text-pink-700' };
    default:        return { label: 'LISTING',  cls: 'bg-slate-100 text-slate-500' };
  }
};

// ─── FilterBar ───────────────────────────────────────────────────────────────
// Extracted as its own component to avoid JSX-multiple-siblings errors inside
// the DashboardPage JSX tree.  All values are dynamic from the API.

// Stacked control: a small uppercase label sitting above a full-width select.
// Every control shares the same footprint so the filter grid lines up cleanly
// instead of the old inline label+select that wrapped at odd points.
const SELECT_BASE = 'w-full text-xs font-bold rounded-xl px-3 py-2 border outline-none cursor-pointer transition-all';
const SELECT_ON   = 'bg-blue-600 text-white border-blue-600';
const SELECT_OFF  = 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-blue-300';

function FilterSelect({
  label, value, options, onChange,
}: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${SELECT_BASE} ${value ? SELECT_ON : SELECT_OFF}`}
      >
        <option value="">All</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function FilterBar({
  options, active, activeCount, onUpdate, onUpdateMany, onClear,
}: {
  options:      FilterOptions;
  active:       ActiveFilters;
  activeCount:  number;
  onUpdate:     (k: keyof ActiveFilters, v: string) => void;
  onUpdateMany: (patch: Partial<ActiveFilters>) => void;
  onClear:      () => void;
}) {
  const hasAnyOption =
    options.intents.length > 0 || options.configurations.length > 0 ||
    options.locations.length > 0 || options.property_types.length > 0 ||
    options.furnished.length > 0 || options.rent_periods.length > 0 ||
    options.price_ranges.length > 0;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="bg-blue-600 text-white rounded-full px-1.5 py-0.5 text-[9px] font-black">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500 transition-colors flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear all
          </button>
        )}
      </div>

      {/* Empty state */}
      {!hasAnyOption && (
        <p className="text-xs text-slate-400 font-medium">
          Filter options load from your listings — restart the server to activate if you just deployed.
        </p>
      )}

      {/* Filter controls — uniform grid so every control aligns instead of
          wrapping at ragged points. */}
      {hasAnyOption && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3 items-end">
          {options.intents.length > 0 && (
            <FilterSelect
              label="Intent"
              value={active.intent}
              options={options.intents.map(i => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
              onChange={v => onUpdate('intent', v)}
            />
          )}
          {options.configurations.length > 0 && (
            <FilterSelect
              label="Config"
              value={active.bedrooms ? `${active.bedrooms}|${active.unit_type}` : ''}
              options={options.configurations.map(c => ({
                value: `${c.bedrooms}|${c.unit_type || ''}`,
                label: c.bedrooms === 0 ? 'Studio' : `${c.bedrooms} ${c.unit_type || 'BR'}`,
              }))}
              onChange={v => {
                if (!v) { onUpdateMany({ bedrooms: '', unit_type: '' }); return; }
                const [beds, ut] = v.split('|');
                onUpdateMany({ bedrooms: beds, unit_type: ut || '' });
              }}
            />
          )}
          {options.locations.length > 0 && (
            <FilterSelect
              label="Location"
              value={active.location}
              options={options.locations.map(l => ({ value: l, label: l }))}
              onChange={v => onUpdate('location', v)}
            />
          )}
          {options.property_types.length > 0 && (
            <FilterSelect
              label="Type"
              value={active.property_type}
              options={options.property_types.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
              onChange={v => onUpdate('property_type', v)}
            />
          )}
          {options.furnished.length > 0 && (
            <FilterSelect
              label="Furnished"
              value={active.furnished}
              options={options.furnished.map(f => ({
                value: f,
                label: ({ furnished: 'Furnished', 'semi-furnished': 'Semi', unfurnished: 'Unfurnished' } as Record<string,string>)[f] ?? f,
              }))}
              onChange={v => onUpdate('furnished', v)}
            />
          )}
          {options.rent_periods.length > 0 && (
            <FilterSelect
              label="Period"
              value={active.rent_period}
              options={options.rent_periods.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
              onChange={v => onUpdate('rent_period', v)}
            />
          )}
          {/* Reposts — eager-seller filter. Always available; doesn't depend on
              option lists since it's computed server-side from repost_count. */}
          <FilterSelect
            label="Reposts"
            value={active.min_reposts}
            options={[
              { value: '2', label: 'Reposted 2+×' },
              { value: '3', label: 'Reposted 3+×' },
              { value: '5', label: 'Reposted 5+×' },
            ]}
            onChange={v => onUpdate('min_reposts', v)}
          />
          {options.price_ranges.length > 0 && (
            <div className="flex flex-col gap-1.5 col-span-2">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                Price ({options.price_ranges[0].currency})
              </span>
              <div className="flex items-center gap-2">
                {['min_price', 'max_price'].map(k => (
                  <input
                    key={k}
                    type="number"
                    placeholder={k === 'min_price' ? 'Min' : 'Max'}
                    value={active[k as keyof ActiveFilters]}
                    onChange={e => onUpdate(k as keyof ActiveFilters, e.target.value)}
                    className={`w-full text-xs font-bold rounded-xl px-3 py-2 border outline-none transition-all ${
                      active[k as keyof ActiveFilters]
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active-filter chips */}
      {activeCount > 0 && (
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
          {active.intent        && <Chip label={active.intent}        onRemove={() => onUpdate('intent', '')} />}
          {active.bedrooms      && <Chip
            label={active.bedrooms === '0' ? 'Studio' : `${active.bedrooms} ${active.unit_type || 'BR'}`}
            onRemove={() => onUpdateMany({ bedrooms: '', unit_type: '' })}
          />}
          {active.location      && <Chip label={active.location}      onRemove={() => onUpdate('location', '')} />}
          {active.property_type && <Chip label={active.property_type} onRemove={() => onUpdate('property_type', '')} />}
          {active.furnished     && <Chip label={active.furnished}     onRemove={() => onUpdate('furnished', '')} />}
          {active.rent_period   && <Chip label={active.rent_period}   onRemove={() => onUpdate('rent_period', '')} />}
          {active.min_price     && <Chip label={`≥ ${active.min_price}`} onRemove={() => onUpdate('min_price', '')} />}
          {active.max_price     && <Chip label={`≤ ${active.max_price}`} onRemove={() => onUpdate('max_price', '')} />}
          {active.min_reposts   && <Chip label={`Reposted ${active.min_reposts}+×`} onRemove={() => onUpdate('min_reposts', '')} />}
        </div>
      )}
    </div>
  );
}

// Small removable chip used in the active-filter strip
function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold capitalize">
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 hover:text-blue-900 leading-none"
        aria-label={`Remove ${label} filter`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

export default function DashboardPage() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [scrapeStats, setScrapeStats] = useState<ScrapeStats | null>(null);
  const [showLowConfidence, setShowLowConfidence] = useState(false);
  const [showNonProperty, setShowNonProperty] = useState(false);
  // total = server-side count of all matching rows (before LIMIT/OFFSET).
  // We use it to drive pagination + show the user how many more exist.
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    locations: [], configurations: [], price_ranges: [],
    intents: [], property_types: [], furnished: [], rent_periods: [],
  });
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
  // Prevent double-fetch from activeFilters effect firing on initial mount
  const filtersInitialized = useRef(false);

  // Fetch listings + stats on mount, and whenever confidence/non-property toggle changes
  useEffect(() => {
    fetchListings();
    fetchScrapeStats();
    fetchFilterOptions();
    filtersInitialized.current = true;
  }, [showLowConfidence, showNonProperty]);

  // Re-fetch listings (only) when filters change — skip initial render
  useEffect(() => {
    if (!filtersInitialized.current) return;
    fetchListings();
  }, [
    activeFilters.intent, activeFilters.bedrooms, activeFilters.unit_type,
    activeFilters.location, activeFilters.property_type, activeFilters.furnished,
    activeFilters.rent_period, activeFilters.min_price, activeFilters.max_price,
    activeFilters.min_reposts,
  ]);

  const authHeaders = async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  };

  const fetchListings = async (append = false) => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const minConf = showLowConfidence ? 0 : 0.2;

      const params = new URLSearchParams({ min_confidence: String(minConf) });
      // Pull 250 at a time (server cap is 500). For "Load more" we send the
      // current offset so the second page picks up where the first left off.
      params.set('limit', '250');
      if (append) params.set('offset', String(listings.length));
      // Default behaviour hides non-property mis-classifications (bikes,
      // services, etc.). User can opt-in via the toggle.
      if (showNonProperty) params.set('include_non_property', 'true');

      // Append only non-empty active filters — all values come from the user's actual data
      if (activeFilters.intent)        params.set('intent',        activeFilters.intent);
      if (activeFilters.location)      params.set('location',      activeFilters.location);
      if (activeFilters.property_type) params.set('property_type', activeFilters.property_type);
      if (activeFilters.furnished)     params.set('furnished',     activeFilters.furnished);
      if (activeFilters.rent_period)   params.set('rent_period',   activeFilters.rent_period);
      if (activeFilters.min_price)     params.set('min_price',     activeFilters.min_price);
      if (activeFilters.max_price)     params.set('max_price',     activeFilters.max_price);
      if (activeFilters.min_reposts)   params.set('min_reposts',   activeFilters.min_reposts);
      // bedrooms + unit_type are sent together (unit_type alone is not useful)
      if (activeFilters.bedrooms)      params.set('bedrooms',      activeFilters.bedrooms);
      if (activeFilters.bedrooms && activeFilters.unit_type)
                                       params.set('unit_type',     activeFilters.unit_type);

      const res = await axios.get(`/api/listings/today?${params.toString()}`, { headers });
      const next = res.data.data.listings ?? [];
      setListings(append ? prev => [...prev, ...next] : next);
      setStats(res.data.data.statistics);
      setTotal(res.data.data.pagination?.total ?? next.length);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchFilterOptions = async () => {
    try {
      const headers = await authHeaders();
      const res = await axios.get('/api/listings/filters', { headers });
      if (res.data.success && res.data.data) {
        setFilterOptions(res.data.data);
      }
    } catch (err) {
      console.error('fetchFilterOptions failed', err);
    }
  };

  // Update a single filter field
  const updateFilter = (key: keyof ActiveFilters, value: string) => {
    setActiveFilters(prev => ({ ...prev, [key]: value }));
  };

  // Update multiple filter fields at once (e.g. bedrooms + unit_type together)
  const updateFilters = (patch: Partial<ActiveFilters>) => {
    setActiveFilters(prev => ({ ...prev, ...patch }));
  };

  const clearAllFilters = () => setActiveFilters(EMPTY_FILTERS);

  const activeFilterCount = Object.entries(activeFilters).filter(([k, v]) => {
    // Count unit_type only when bedrooms is also set (they're one combined filter)
    if (k === 'unit_type') return false;
    return !!v;
  }).length;

  const fetchScrapeStats = async () => {
    try {
      const headers = await authHeaders();
      const res = await axios.get('/api/scrape-stats', { headers });
      setScrapeStats(res.data.data);
    } catch (err) {
      console.error(err);
    }
  };

  // Postgres NUMERIC comes back as a string — always parseFloat before arithmetic/comparison.
  const fmt = (price: number | string | null, currency?: string | null) => {
    const p = price === null || price === undefined ? NaN : parseFloat(String(price));
    if (!p || isNaN(p)) return '—';
    // Show one decimal only when the division isn't exact (e.g. 18500 → 18.5k, 21000 → 21k)
    const k = (v: number) => { const r = v / 1_000; return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}k`; };
    if (currency === 'INR') {
      if (p >= 10_000_000) return `₹${(p / 10_000_000).toFixed(2)} Cr`;
      if (p >= 100_000)    return `₹${(p / 100_000).toFixed(2)} L`;
      if (p >= 1_000)      return `₹${k(p)}`;
      return `₹${p.toLocaleString()}`;
    }
    if (currency === 'USD') {
      if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(2)}M`;
      if (p >= 1_000)     return `$${k(p)}`;
      return `$${p.toLocaleString()}`;
    }
    // AED (default) or unknown currency
    const prefix = currency === 'AED' ? 'AED ' : currency ? `${currency} ` : '';
    if (p >= 1_000_000) return `${prefix}${(p / 1_000_000).toFixed(2)}M`;
    if (p >= 1_000)     return `${prefix}${k(p)}`;
    return `${prefix}${p.toLocaleString()}`;
  };

  const filtered = listings.filter(l =>
    (l.description ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.location ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.area_text ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.agent_name ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <main className="flex-1 flex flex-col min-h-screen">
        {/* Header */}
        <header className="h-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-8 flex items-center justify-between sticky top-0 z-10 gap-4">
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search areas, agents, descriptions…"
              className="w-full pl-12 pr-6 py-3 bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 border-none rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-medium"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <RefetchChatsButton onDone={() => { fetchListings(); fetchScrapeStats(); }} />
            <ConnectWhatsAppButton />
            <button
              onClick={() => { fetchListings(); fetchScrapeStats(); }}
              className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-sm shadow-lg hover:bg-blue-700 transition-all active:scale-95"
            >
              REFRESH
            </button>
          </div>
        </header>

        <div className="p-8 bg-slate-50 dark:bg-slate-950 flex-1">
          <div className="max-w-7xl mx-auto space-y-8">
            {/* Page title */}
            <div>
              <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">Market Pulse</h1>
              <p className="text-slate-500 dark:text-slate-400 font-bold mt-1 uppercase text-xs tracking-widest">
                Real-time property insights for {new Date().toLocaleDateString()}
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  label: 'Avg Market Price',
                  value: fmt(stats.avg_price ?? null),
                  sub: <span className="flex items-center gap-1 text-green-600 font-bold text-xs"><TrendingUp className="w-4 h-4" /> Healthy Volume</span>,
                },
                {
                  label: 'Avg Configuration',
                  value: `${parseFloat(stats.avg_bedrooms ?? 0).toFixed(1)} BR`,
                  sub: <span className="text-slate-400 font-bold text-xs">Average bedrooms</span>,
                },
                {
                  label: 'Total Listings',
                  value: <span className="text-blue-600">{listings.length}</span>,
                  sub: <span className="text-slate-400 font-bold text-xs">Today</span>,
                },
              ].map((card, i) => (
                <div key={i} className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-800">
                  <div className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">{card.label}</div>
                  <div className="text-3xl font-black text-slate-900 dark:text-white">{card.value}</div>
                  <div className="mt-4">{card.sub}</div>
                </div>
              ))}
            </div>

            {/* Scrape Activity panel */}
            {scrapeStats && (scrapeStats.rawMessages > 0 || scrapeStats.listingsTotal > 0) && (
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Activity className="w-5 h-5 text-blue-600" />
                  <h2 className="font-black text-slate-900 uppercase tracking-tight text-sm">Today's Scrape Activity</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <div className="text-2xl font-black text-slate-900">{scrapeStats.rawMessages}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">messages scraped</div>
                  </div>
                  <div>
                    <div className="text-2xl font-black text-green-600">{scrapeStats.byConfidence.high || 0}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">high confidence ≥70%</div>
                  </div>
                  <div>
                    <div className="text-2xl font-black text-amber-600">{scrapeStats.byConfidence.medium || 0}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">medium 30-70%</div>
                  </div>
                  <div>
                    <div className="text-2xl font-black text-slate-400">{scrapeStats.byConfidence.low || 0}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">low &lt; 30%</div>
                  </div>
                </div>
                {scrapeStats.byGroup.length > 0 && (
                  <div className="border-t border-slate-100 pt-4">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">scraped from</div>
                    <div className="flex flex-wrap gap-2">
                      {scrapeStats.byGroup.map(g => (
                        <span key={g.group_name} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-bold">
                          {g.group_name} <span className="text-blue-400">({g.count})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {scrapeStats.listingsHighConfidence === 0 && scrapeStats.listingsTotal > 0 && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs font-bold text-amber-800">
                    💡 Messages scraped but confidence is low. Toggle "Show all" below to see every parsed message regardless of confidence score.
                  </div>
                )}
              </div>
            )}

            {/* Filter bar — always visible once mounted; options come from /api/listings/filters */}
            <FilterBar
              options={filterOptions}
              active={activeFilters}
              activeCount={activeFilterCount}
              onUpdate={updateFilter}
              onUpdateMany={updateFilters}
              onClear={clearAllFilters}
            />

            {/* Table toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                Listings ({filtered.length}
                {filtered.length < listings.length ? ` of ${listings.length} loaded` : ''}
                {total > listings.length ? `, ${total - listings.length} more available` : ''}
                {activeFilterCount > 0 ? ` · filtered` : ''})
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNonProperty(v => !v)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-xl border transition-colors ${
                    showNonProperty
                      ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                  title="Bikes, services, classifieds — anything mis-classified as a flat"
                >
                  {showNonProperty ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {showNonProperty ? 'Hiding non-property' : 'Show non-property too'}
                </button>
                <button
                  onClick={() => setShowLowConfidence(v => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                  title="Toggle to include low-confidence parsed messages"
                >
                  {showLowConfidence ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showLowConfidence ? 'Hide low-confidence' : 'Show all scraped'}
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              {loading ? (
                <div className="py-20 flex items-center justify-center text-slate-400 font-bold text-sm">Loading listings…</div>
              ) : filtered.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center text-slate-400 font-bold text-sm gap-2">
                  <span>No listings match the current filter.</span>
                  {!showLowConfidence && scrapeStats && scrapeStats.listingsTotal > 0 && (
                    <button
                      onClick={() => setShowLowConfidence(true)}
                      className="text-blue-600 underline text-xs font-bold"
                    >
                      Show all {scrapeStats.listingsTotal} scraped messages →
                    </button>
                  )}
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      {['Property', 'Type / Config', 'Sender', 'Pricing', 'Action'].map((h, i) => (
                        <th key={h} className={`px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map(l => {
                      const conf = parseFloat(String(l.extraction_confidence ?? 0));
                      const confClass = conf >= 0.7 ? 'bg-green-100 text-green-700' : conf >= 0.3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
                      const badge = intentBadge(l.intent);
                      const senderPhone = sanitizePhone(l.sender_wa_id);
                      const contactPhone = sanitizePhone(l.agent_phone) || senderPhone;
                      const displayName = toDisplayName(l.agent_name) || toDisplayName(l.sender_name);
                      const title = listingTitle(l);
                      const reposts = parseInt(String(l.repost_count ?? 1), 10) || 1;

                      return (
                        <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer" onClick={() => navigate(`/listing/${l.id}`)}>
                          {/* Property — location only; property type is in the next column */}
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 font-black text-xs uppercase shrink-0">
                                {(l.property_type || '?').charAt(0)}
                              </div>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {title
                                    ? <div className="font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight text-sm">{title}</div>
                                    : <div className="font-medium text-slate-300 dark:text-slate-500 text-sm italic">No location</div>
                                  }
                                  <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${confClass}`}>
                                    {Math.round(conf * 100)}%
                                  </span>
                                  {reposts > 1 && (
                                    <span
                                      title={`Re-posted ${reposts}× by this sender — likely an eager seller`}
                                      className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300"
                                    >
                                      ↻ {reposts}×
                                    </span>
                                  )}
                                  {l.has_media && (
                                    <span title="Has photos/videos" className="text-[10px] text-slate-400">📷</span>
                                  )}
                                </div>
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{l.group_name}</div>
                              </div>
                            </div>
                          </td>

                          {/* Type / Config */}
                          <td className="px-6 py-5">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                                {l.property_type && (
                                  <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-500 capitalize">{l.property_type}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-sm font-bold text-slate-700 dark:text-slate-200">
                                {fmtBeds(l.bedrooms, l.unit_type)
                                  ? <span className="flex items-center gap-1"><Bed className="w-3.5 h-3.5 text-slate-300" /> {fmtBeds(l.bedrooms, l.unit_type)}</span>
                                  : <span className="text-slate-300">—</span>
                                }
                                {l.area_sqft != null
                                  ? <span className="flex items-center gap-1"><Ruler className="w-3.5 h-3.5 text-slate-300" /> {parseFloat(String(l.area_sqft)).toLocaleString()} ft²</span>
                                  : null
                                }
                              </div>
                            </div>
                          </td>

                          {/* Sender */}
                          <td className="px-6 py-5">
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-relaxed">
                              {displayName && (
                                <div className="flex items-center gap-1"><User className="w-3 h-3 text-slate-300" /> {displayName}</div>
                              )}
                              {contactPhone
                                ? <div className="text-slate-400 mt-0.5">{formatPhone(contactPhone)}</div>
                                : <div className="text-slate-300">—</div>
                              }
                            </div>
                          </td>

                          {/* Price */}
                          <td className="px-6 py-5">
                            <div className="text-lg font-black text-blue-600 tracking-tighter">{fmt(l.price, l.currency)}</div>
                            {l.rent_period && <div className="text-[10px] text-slate-400 font-bold uppercase">/{l.rent_period}</div>}
                          </td>

                          {/* Action */}
                          <td className="px-6 py-5 text-right" onClick={e => e.stopPropagation()}>
                            <Link
                              to={`/listing/${l.id}`}
                              className="bg-slate-100 text-slate-900 px-4 py-2 rounded-xl text-xs font-black hover:bg-blue-600 hover:text-white transition-all"
                            >
                              VIEW
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Load more — only when the server has additional rows beyond
                what's currently in state. Append (don't replace) so the user
                doesn't lose their scroll position. */}
            {total > listings.length && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => fetchListings(true)}
                  disabled={loading}
                  className="px-6 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Loading…' : `Load ${Math.min(250, total - listings.length)} more (${total - listings.length} remaining)`}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </Layout>
  );
}
