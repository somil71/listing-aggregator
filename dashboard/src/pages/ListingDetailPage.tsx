import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '@clerk/react';
import {
  ArrowLeft, MapPin, Bed, Ruler, Phone, MessageCircle, User, Sparkles, Loader2, Tag,
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

// Phone helpers imported from utils/phone — single source of truth.

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

const intentBadge = (intent: string | null) => {
  switch ((intent || '').toLowerCase()) {
    case 'rent':     return { label: 'RENT',     cls: 'bg-blue-100 text-blue-700' };
    case 'sale':     return { label: 'SALE',     cls: 'bg-purple-100 text-purple-700' };
    case 'wanted':   return { label: 'WANTED',   cls: 'bg-amber-100 text-amber-700' };
    case 'roommate': return { label: 'ROOMMATE', cls: 'bg-pink-100 text-pink-700' };
    default:         return { label: 'LISTING',  cls: 'bg-slate-100 text-slate-500' };
  }
};

const furnishedLabel = (f: string | null): string => {
  if (!f) return '—';
  return { furnished: '✓ Furnished', 'semi-furnished': '◑ Semi-furnished', unfurnished: '✗ Unfurnished' }[f] ?? f;
};

// ─── Detail cell ─────────────────────────────────────────────────────────────
function DetailCell({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value || value === '—') return null;
  return (
    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
      <div className="font-black text-slate-900 text-base">{value}</div>
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

  const authHeaders = async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 flex-col gap-4">
        <p className="font-black text-slate-400 uppercase tracking-widest">Listing not found</p>
        <Link to="/dashboard" className="text-blue-600 font-bold text-sm underline">← Back to Dashboard</Link>
      </div>
    );
  }

  const badge       = intentBadge(listing.intent);
  const conf        = parseFloat(String(listing.confidence ?? 0));
  const confCls     = conf >= 0.7 ? 'bg-green-100 text-green-700' : conf >= 0.3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
  // Fallback: if the LLM missed the location, infer from description/raw_message.
  // Stop-token approach works on both multiline and whitespace-collapsed text.
  const guessLocationFromText = (text: string | null): string | null => {
    if (!text) return null;
    const stopRe = /\b(?:independent|semi[\s-]?furnished|furnished|unfurnished|available|vacant|for\s+(?:rent|sale)|rent|sale|lease|only|\d+\s*(?:bhk|rk|bk|br|bedroom|bath|sqft|sqm)|flats?|studio|apartment|house|room|pg\b|bachelor|single|double|triple|looking|wanted)\b/i;
    const m = text.match(stopRe);
    if (m && typeof m.index === 'number' && m.index > 0) {
      const before = text.slice(0, m.index).trim().replace(/[^\w\s]/g, '').trim();
      if (before.length >= 2 && before.length <= 50 && /[a-zA-Z]/.test(before)) return before;
    }
    // Multiline fallback
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
  // Reject DB values that are property attributes, not locations ("Fully Furnished", "With Owner", etc.)
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

  return (
    <Layout>
      <main className="flex-1 p-8 bg-slate-50 dark:bg-slate-950">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Back + breadcrumb */}
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-blue-600 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
          </Link>

          {/* Hero card */}
          <div className="bg-white dark:bg-slate-900 rounded-[40px] p-8 shadow-sm border border-slate-200 dark:border-slate-800">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                {/* Badges */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${confCls}`}>
                    {Math.round(conf * 100)}% confidence
                  </span>
                  {listing.vacant === true && (
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-green-100 text-green-700">VACANT</span>
                  )}
                  {listing.property_type && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-500 capitalize">
                      {listing.property_type}
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="text-5xl font-black text-slate-900 tracking-tighter">
                  {fmt(listing.price, listing.currency)}
                  {listing.rent_period && (
                    <span className="text-lg text-slate-400 font-bold ml-2">/ {listing.rent_period}</span>
                  )}
                </div>

                {/* Location */}
                {location && (
                  <div className="flex items-center gap-2 mt-2">
                    <MapPin className="w-4 h-4 text-blue-500 shrink-0" />
                    <span className="font-black text-slate-700 uppercase tracking-tight text-lg">{location}</span>
                  </div>
                )}

                {/* Group */}
                <div className="mt-2 text-xs text-slate-400 font-bold uppercase tracking-widest">
                  From: {listing.group_name}
                  {listing.ts_listed && ` · ${new Date(listing.ts_listed).toLocaleDateString()}`}
                </div>
              </div>

              {/* Contact block */}
              {(displayName || hasContact) && (
                <div className="bg-slate-50 rounded-3xl p-4 min-w-[180px] border border-slate-100">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Contact</div>
                  {displayName && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-sm font-bold text-slate-900">{displayName}</span>
                    </div>
                  )}
                  {contactPhone && (
                    <div className="text-sm font-bold text-slate-500 mb-3">{formatPhone(contactPhone)}</div>
                  )}
                  <div className="flex gap-2">
                    <a
                      href={hasContact ? `tel:+${contactPhone!.replace(/\D/g, '')}` : undefined}
                      onClick={!hasContact ? e => e.preventDefault() : undefined}
                      className={`flex-1 py-2 rounded-xl text-xs font-black uppercase text-center flex items-center justify-center gap-1
                        ${hasContact ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}
                    >
                      <Phone className="w-3 h-3" /> Call
                    </a>
                    <a
                      href={hasContact ? `https://wa.me/${contactPhone!.replace(/\D/g, '')}` : undefined}
                      target={hasContact ? '_blank' : undefined}
                      rel="noreferrer"
                      onClick={!hasContact ? e => e.preventDefault() : undefined}
                      className={`flex-1 py-2 rounded-xl text-xs font-black uppercase text-center flex items-center justify-center gap-1
                        ${hasContact ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-slate-50 text-slate-300 cursor-not-allowed'}`}
                    >
                      <MessageCircle className="w-3 h-3" /> WA
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* AI Summary */}
          <div className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-3xl p-6 border border-blue-100">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest">AI-Generated Summary</div>
            </div>
            {summaryLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating summary…</span>
              </div>
            ) : summary ? (
              <p className="text-slate-700 font-medium leading-relaxed">{summary}</p>
            ) : (
              <p className="text-slate-400 text-sm italic">No summary available.</p>
            )}
          </div>

          {/* Media gallery — AuthenticatedMedia fetches each file with the
              Clerk JWT so the auth-gated /api/media endpoint accepts it.
              Plain <img src> / <video src> don't carry custom headers → 401. */}
          {listing.has_media && mediaKeys.length > 0 && (
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                Photos & Videos ({mediaKeys.length})
              </div>
              <div className="flex flex-wrap gap-3">
                {mediaKeys.map((key, idx) => {
                  const filename = key.split(/[\\/]/).pop();
                  const src = `/api/media/${filename}`;
                  const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(filename || '');
                  return (
                    <AuthenticatedMedia
                      key={src}
                      src={src}
                      isVideo={isVideo}
                      alt={`Property photo ${idx + 1}`}
                      className={isVideo
                        ? 'rounded-2xl max-h-64 border border-slate-200 bg-black'
                        : 'rounded-2xl max-h-64 object-cover border border-slate-200 cursor-zoom-in hover:opacity-90 transition-opacity'}
                      onClick={isVideo ? undefined : setLightbox}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Details grid */}
          <div>
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Property Details</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <DetailCell label="Configuration" value={fmtBeds(listing.bedrooms, listing.unit_type) ?? '—'} />
              <DetailCell label="Furnished"     value={furnishedLabel(listing.furnished)} />
              <DetailCell label="Area"          value={
                listing.area_sqft != null ? `${parseFloat(String(listing.area_sqft)).toLocaleString()} ft²`
                : listing.area_sqm  != null ? `${parseFloat(String(listing.area_sqm)).toLocaleString()} m²`
                : null
              } />
              <DetailCell label="Bathrooms"  value={listing.bathrooms != null ? String(listing.bathrooms) : null} />
              <DetailCell label="Parking"    value={listing.parking != null ? (listing.parking ? '✓ Included' : '✗ No parking') : null} />
              <DetailCell label="Vacant"     value={listing.vacant != null ? (listing.vacant ? '✓ Available now' : 'Not immediately') : null} />
            </div>
          </div>

          {/* Amenities */}
          {listing.amenities && listing.amenities.length > 0 && (
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Amenities</div>
              <div className="flex flex-wrap gap-2">
                {listing.amenities.map(a => (
                  <span key={a} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-bold capitalize">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Raw WhatsApp message */}
          <div className="bg-[#ECE5DD] rounded-3xl p-6">
            <div className="text-[10px] font-black text-[#6b7280] uppercase tracking-widest mb-3 flex items-center gap-2">
              <MessageCircle className="w-3.5 h-3.5 text-green-600" /> Original WhatsApp Message
            </div>
            <div className="bg-white rounded-2xl px-5 py-4 shadow-sm max-w-lg">
              <p className="text-slate-800 leading-relaxed font-medium whitespace-pre-wrap text-sm">
                {listing.raw_message || listing.description || '(No message text)'}
              </p>
              <div className="mt-2 text-[10px] text-slate-400 font-bold text-right">
                {listing.group_name}
                {listing.ts_listed ? ` · ${new Date(listing.ts_listed).toLocaleString()}` : ''}
              </div>
            </div>
          </div>

          {/* Parser metadata */}
          <div className="bg-slate-100 rounded-2xl px-5 py-3 flex flex-wrap items-center gap-4 text-xs text-slate-400 font-bold">
            <span>Extracted by: <span className="text-slate-600">{listing.extracted_by || 'unknown'}</span></span>
            <span>Confidence: <span className="text-slate-600">{Math.round(conf * 100)}%</span></span>
            <span>ID: <span className="text-slate-600 font-mono text-[10px]">{listing.id}</span></span>
          </div>

        </div>
      </main>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-8"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Full size"
            className="max-w-full max-h-full rounded-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-6 right-6 w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30"
            onClick={() => setLightbox(null)}
          >✕</button>
        </div>
      )}
    </Layout>
  );
}
