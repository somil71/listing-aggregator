import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '@clerk/react';
import {
  ArrowLeft, MapPin, Phone, MessageCircle, User, Sparkles, Loader2,
  CheckCircle2, Image as ImageIcon, FileText, Calendar, Tag, X, Flag,
} from 'lucide-react';
import AuthenticatedMedia from '../components/AuthenticatedMedia';
import Layout from '../components/Layout';
import { sanitizePhone, formatPhone, toDisplayName } from '../utils/phone';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ListingDetail {
  id: string;
  intent: string | null;
  property_type: string | null;
  bedrooms: number | string | null;
  bathrooms: number | string | null;
  unit_type: string | null;
  community: string | null;
  area_text: string | null;
  price: number | string | null;
  currency: string | null;
  rent_period: string | null;
  furnished: string | null;
  area_sqft: number | string | null;
  area_sqm: number | string | null;
  amenities: string[] | null;
  vacant: boolean | null;
  parking: number | null;
  agent_name: string | null;
  agent_phone: string | null;
  group_name: string;
  wa_group_id: string | null;
  description: string | null;
  raw_message: string | null;
  confidence: number | string | null;
  ts_listed: string;
  extracted_by: string | null;
  raw_llm_json: any;
  has_media: boolean | null;
  media_keys: string[] | null;
  sender_wa_id: string | null;
  sender_name: string | null;
}

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmt = (price: number | string | null, currency?: string | null): string => {
  const p = price === null || price === undefined ? NaN : parseFloat(String(price));
  if (!p || isNaN(p)) return '—';
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
  const prefix = currency === 'AED' ? 'AED ' : currency ? `${currency} ` : '';
  if (p >= 1_000_000) return `${prefix}${(p / 1_000_000).toFixed(2)}M`;
  if (p >= 1_000)     return `${prefix}${k(p)}`;
  return `${prefix}${p.toLocaleString()}`;
};

const fmtBeds = (bedrooms: number | string | null, unit_type: string | null): string | null => {
  const n = bedrooms === null || bedrooms === undefined ? null : parseFloat(String(bedrooms));
  if (n === null || isNaN(n)) return null;
  if (n === 0) return 'Studio';
  return `${n % 1 === 0 ? n : n.toFixed(1)} ${unit_type ? unit_type.toUpperCase() : 'BR'}`;
};

// Tone for the intent badge — same look across light + dark themes
const intentBadge = (intent: string | null) => {
  switch ((intent || '').toLowerCase()) {
    case 'rent':     return { label: 'For Rent',   cls: 'bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300 ring-1 ring-blue-500/20' };
    case 'sale':     return { label: 'For Sale',   cls: 'bg-purple-500/15 text-purple-600 dark:bg-purple-400/15 dark:text-purple-300 ring-1 ring-purple-500/20' };
    case 'wanted':   return { label: 'Wanted',     cls: 'bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300 ring-1 ring-amber-500/20' };
    case 'roommate': return { label: 'Roommate',   cls: 'bg-pink-500/15 text-pink-600 dark:bg-pink-400/15 dark:text-pink-300 ring-1 ring-pink-500/20' };
    default:         return { label: 'Listing',    cls: 'bg-slate-500/15 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300 ring-1 ring-slate-500/20' };
  }
};

const furnishedLabel = (f: string | null): string => {
  if (!f) return '—';
  return ({ furnished: 'Fully furnished', 'semi-furnished': 'Semi-furnished', unfurnished: 'Unfurnished' } as Record<string, string>)[f] ?? f;
};

// ─── Detail cell ─────────────────────────────────────────────────────────────
function DetailCell({ label, value, icon: Icon }: {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  if (!value || value === '—') return null;
  return (
    <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon className="w-3 h-3 text-slate-400 dark:text-slate-500" />}
        <div className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</div>
      </div>
      <div className="font-black text-slate-900 dark:text-white text-base">{value}</div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();

  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string>('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [flagState, setFlagState] = useState<'idle' | 'sending' | 'done'>('idle');

  const authHeaders = async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  };

  // "Report wrong" — the human detection channel. Tells the backend this
  // extraction is bad: it's counted (health.js shows the flag rate) and the
  // listing is immediately hidden so the bad data stops showing.
  const handleFlag = async () => {
    if (flagState !== 'idle') return;
    setFlagState('sending');
    try {
      const headers = await authHeaders();
      await axios.post(`/api/listings/${id}/flag`, {}, { headers });
      setFlagState('done');
    } catch (err) {
      console.error(err);
      setFlagState('idle');
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await axios.get(`/api/listings/${id}`, { headers });
        setListing(res.data.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!listing) return;
    setSummaryLoading(true);
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await axios.get(`/api/listings/${id}/summary`, { headers });
        setSummary(res.data.data?.summary || '');
      } catch {
        setSummary('');
      } finally {
        setSummaryLoading(false);
      }
    })();
  }, [listing?.id]);

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-400" />
        </div>
      </Layout>
    );
  }

  if (!listing) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center flex-col gap-4">
          <p className="font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Listing not found</p>
          <Link to="/dashboard" className="text-blue-600 dark:text-blue-400 font-bold text-sm underline">← Back to Dashboard</Link>
        </div>
      </Layout>
    );
  }

  // ─── Derived values (logic preserved verbatim from previous version) ────
  const badge       = intentBadge(listing.intent);
  const conf        = parseFloat(String(listing.confidence ?? 0));
  const confCls     = conf >= 0.7
    ? 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300 ring-1 ring-emerald-500/20'
    : conf >= 0.3
    ? 'bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300 ring-1 ring-amber-500/20'
    : 'bg-slate-500/15 text-slate-500 dark:bg-slate-400/15 dark:text-slate-400 ring-1 ring-slate-500/20';

  // Fallback: if the LLM missed the location, infer from description/raw_message.
  const guessLocationFromText = (text: string | null): string | null => {
    if (!text) return null;
    const stopRe = /\b(?:independent|semi[\s-]?furnished|furnished|unfurnished|available|vacant|for\s+(?:rent|sale)|rent|sale|lease|only|\d+\s*(?:bhk|rk|bk|br|bedroom|bath|sqft|sqm)|flats?|studio|apartment|house|room|pg\b|bachelor|single|double|triple|looking|wanted)\b/i;
    const m = text.match(stopRe);
    if (m && typeof m.index === 'number' && m.index > 0) {
      const before = text.slice(0, m.index).trim().replace(/[^\w\s]/g, '').trim();
      if (before.length >= 2 && before.length <= 50 && /[a-zA-Z]/.test(before)) return before;
    }
    const lines = text.split(/\n/).map((l: string) => l.trim()).filter(Boolean);
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
  const isLikelyLocation = (str: string | null): boolean => {
    if (!str) return false;
    const nonLocRe = /\b(?:furnished|unfurnished|owner|story|storey|available|vacant|with\s+owner)\b/i;
    return !nonLocRe.test(str);
  };
  const dbLoc = (listing.community && isLikelyLocation(listing.community)) ? listing.community
    : (listing.area_text && isLikelyLocation(listing.area_text)) ? listing.area_text : null;
  const location = dbLoc || guessLocationFromText(listing.raw_message || listing.description) || null;

  const contactPhone = sanitizePhone(listing.agent_phone) || sanitizePhone(listing.sender_wa_id);
  const displayName  = toDisplayName(listing.agent_name) || toDisplayName(listing.sender_name);
  const hasContact   = !!contactPhone;
  const mediaKeys    = (listing.media_keys || []).filter(Boolean);
  const formattedPrice = fmt(listing.price, listing.currency);

  return (
    <Layout>
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Back link */}
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
          </Link>

          {/* ── Hero card ───────────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-200/70 dark:border-slate-800 overflow-hidden">
            <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1fr,260px] gap-6">

              {/* Left: badges + price + location */}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-4">
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${confCls}`}>
                    {Math.round(conf * 100)}% confidence
                  </span>
                  {listing.vacant === true && (
                    <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300 ring-1 ring-emerald-500/20 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Vacant
                    </span>
                  )}
                  {listing.property_type && (
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 capitalize">
                      {listing.property_type}
                    </span>
                  )}
                  <button
                    onClick={handleFlag}
                    disabled={flagState !== 'idle'}
                    title="Report this listing's details as wrong"
                    className={`ml-auto text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full inline-flex items-center gap-1 transition-colors ${
                      flagState === 'done'
                        ? 'bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300 cursor-default'
                        : 'bg-slate-100 text-slate-500 hover:bg-rose-500/15 hover:text-rose-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-rose-400/15 dark:hover:text-rose-300'
                    }`}
                  >
                    <Flag className="w-3 h-3" />
                    {flagState === 'done' ? 'Reported' : flagState === 'sending' ? '…' : 'Report wrong'}
                  </button>
                </div>

                {/* Price — large, bold, dark-mode safe */}
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-5xl sm:text-6xl font-black tracking-tighter text-slate-900 dark:text-white">
                    {formattedPrice}
                  </span>
                  {listing.rent_period && (
                    <span className="text-lg sm:text-xl text-slate-400 dark:text-slate-500 font-bold">
                      / {listing.rent_period}
                    </span>
                  )}
                </div>

                {/* Location */}
                {location && (
                  <div className="flex items-center gap-2 mt-4">
                    <MapPin className="w-5 h-5 text-blue-500 dark:text-blue-400 shrink-0" />
                    <span className="font-black text-slate-800 dark:text-slate-100 tracking-tight text-xl">{location}</span>
                  </div>
                )}

                {/* Group + date */}
                <div className="mt-3 flex items-center gap-3 flex-wrap text-xs text-slate-500 dark:text-slate-400 font-bold">
                  <span className="inline-flex items-center gap-1.5">
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="truncate max-w-[280px]">{listing.group_name}</span>
                  </span>
                  {listing.ts_listed && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(listing.ts_listed).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Right: contact card */}
              {(displayName || hasContact) ? (
                <aside className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-200/60 dark:border-slate-700/60 self-start">
                  <div className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Contact</div>
                  {displayName && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-8 h-8 rounded-full bg-blue-500/15 dark:bg-blue-400/15 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <span className="text-sm font-black text-slate-900 dark:text-white truncate">{displayName}</span>
                    </div>
                  )}
                  {contactPhone && (
                    <div className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400 mb-4 ml-10">
                      {formatPhone(contactPhone)}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <a
                      href={hasContact ? `tel:+${contactPhone!.replace(/\D/g, '')}` : undefined}
                      onClick={!hasContact ? e => e.preventDefault() : undefined}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-center flex items-center justify-center gap-1.5 transition-colors ${
                        hasContact
                          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      <Phone className="w-3 h-3" /> Call
                    </a>
                    <a
                      href={hasContact ? `https://wa.me/${contactPhone!.replace(/\D/g, '')}` : undefined}
                      target={hasContact ? '_blank' : undefined}
                      rel="noreferrer"
                      onClick={!hasContact ? e => e.preventDefault() : undefined}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-center flex items-center justify-center gap-1.5 transition-colors ${
                        hasContact
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      <MessageCircle className="w-3 h-3" /> WhatsApp
                    </a>
                  </div>
                </aside>
              ) : (
                <aside className="bg-slate-50 dark:bg-slate-800/40 rounded-2xl p-5 border border-dashed border-slate-200 dark:border-slate-700/60 self-start text-center">
                  <div className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Contact</div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">No contact details extracted from this message.</p>
                </aside>
              )}
            </div>
          </div>

          {/* ── AI Summary ──────────────────────────────────────────────────── */}
          <div className="relative bg-gradient-to-br from-blue-50 to-slate-50 dark:from-blue-950/30 dark:to-slate-900/60 rounded-3xl p-6 border border-blue-200/60 dark:border-blue-500/15 overflow-hidden">
            <div className="absolute -top-12 -right-12 w-48 h-48 bg-blue-500/10 dark:bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <div className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">AI-Generated Summary</div>
              </div>
              {summaryLoading ? (
                <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating summary…</span>
                </div>
              ) : summary ? (
                <p className="text-slate-700 dark:text-slate-200 font-medium leading-relaxed">{summary}</p>
              ) : (
                <p className="text-slate-400 dark:text-slate-500 text-sm italic">No summary available.</p>
              )}
            </div>
          </div>

          {/* ── Media gallery ───────────────────────────────────────────────── */}
          {listing.has_media && mediaKeys.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <ImageIcon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                  Photos & Videos ({mediaKeys.length})
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {mediaKeys.map((key, idx) => {
                  const filename = key.split(/[\\/]/).pop();
                  const src = `/api/media/${filename}`;
                  const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(filename || '');
                  return (
                    <div
                      key={src}
                      className="relative aspect-square overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 group"
                    >
                      <AuthenticatedMedia
                        src={src}
                        isVideo={isVideo}
                        alt={`Property photo ${idx + 1}`}
                        className={isVideo
                          ? 'w-full h-full object-cover bg-black'
                          : 'w-full h-full object-cover cursor-zoom-in transition-transform group-hover:scale-105'}
                        onClick={isVideo ? undefined : setLightbox}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Details grid ────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Property Details</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <DetailCell label="Configuration" value={fmtBeds(listing.bedrooms, listing.unit_type) ?? '—'} />
              <DetailCell label="Furnished"     value={furnishedLabel(listing.furnished)} />
              <DetailCell label="Area" value={
                listing.area_sqft != null ? `${parseFloat(String(listing.area_sqft)).toLocaleString()} ft²`
                : listing.area_sqm  != null ? `${parseFloat(String(listing.area_sqm)).toLocaleString()} m²`
                : null
              } />
              <DetailCell label="Bathrooms"  value={listing.bathrooms != null ? String(listing.bathrooms) : null} />
              <DetailCell label="Parking"    value={listing.parking != null ? (listing.parking ? 'Included' : 'Not available') : null} />
              <DetailCell label="Vacancy"    value={listing.vacant != null ? (listing.vacant ? 'Available now' : 'Not immediately') : null} />
            </div>
          </section>

          {/* ── Amenities ───────────────────────────────────────────────────── */}
          {listing.amenities && listing.amenities.length > 0 && (
            <section>
              <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Amenities</div>
              <div className="flex flex-wrap gap-2">
                {listing.amenities.map(a => (
                  <span
                    key={a}
                    className="px-3 py-1.5 bg-blue-500/10 text-blue-700 dark:text-blue-300 rounded-full text-xs font-bold capitalize border border-blue-500/15"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ── Raw WhatsApp message ───────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Original WhatsApp Message</div>
            </div>
            <div className="bg-[#ECE5DD] dark:bg-[#0b1413] rounded-3xl p-5 sm:p-6 relative overflow-hidden">
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
                   style={{ backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '10px 10px' }} />
              <div className="relative bg-white dark:bg-[#202c33] rounded-2xl px-5 py-4 shadow-sm max-w-lg">
                <p className="text-slate-800 dark:text-slate-100 leading-relaxed font-medium whitespace-pre-wrap text-sm">
                  {listing.raw_message || listing.description || '(No message text)'}
                </p>
                <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500 font-bold text-right">
                  {listing.group_name}
                  {listing.ts_listed ? ` · ${new Date(listing.ts_listed).toLocaleString()}` : ''}
                </div>
              </div>
            </div>
          </section>

          {/* ── Parser metadata ────────────────────────────────────────────── */}
          <div className="bg-slate-100 dark:bg-slate-900/60 rounded-2xl px-5 py-3 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400 font-bold border border-slate-200/60 dark:border-slate-800">
            <span>Extracted by: <span className="text-slate-700 dark:text-slate-200">{listing.extracted_by || 'unknown'}</span></span>
            <span>Confidence: <span className="text-slate-700 dark:text-slate-200">{Math.round(conf * 100)}%</span></span>
            <span>ID: <span className="text-slate-700 dark:text-slate-200 font-mono text-[10px]">{listing.id}</span></span>
          </div>

        </div>
      </main>

      {/* ── Lightbox ──────────────────────────────────────────────────────── */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-8"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Full size"
            className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 sm:top-6 right-4 sm:right-6 w-10 h-10 bg-white/10 hover:bg-white/20 backdrop-blur rounded-full flex items-center justify-center text-white transition-colors"
            onClick={() => setLightbox(null)}
            aria-label="Close lightbox"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </Layout>
  );
}
