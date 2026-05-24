import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Search, MapPin, IndianRupee, Bed, Phone, ExternalLink, Filter, Home, LayoutDashboard, Car, Sofa, Ruler, TrendingUp } from 'lucide-react';

interface Listing {
  id: string;
  price: number | null;
  location: string | null;
  bedrooms: number | null;
  property_type: string;
  area_sqft: number | null;
  furnished: number | null;
  parking: number | null;
  description: string;
  agent_phone: string | null;
  agent_name: string | null;
  group_name: string;
  created_at: string;
  extraction_confidence: number | null;
}

interface Statistics {
  avg_price?: number;
  min_price?: number;
  max_price?: number;
  avg_bedrooms?: number;
  avg_area?: number;
}

function App() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<Statistics>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);

  useEffect(() => {
    fetchListings();
  }, []);

  const fetchListings = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/listings/today');
      setListings(response.data.data.listings);
      setStats(response.data.data.statistics || {});
    } catch (error) {
      console.error('Error fetching listings:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredListings = listings.filter(l =>
    l.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.location && l.location.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (l.group_name && l.group_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const formatPrice = (price: number | undefined | null) => {
    if (price === undefined || price === null) return 'N/A';
    if (price >= 10000000) return `₹${(price / 10000000).toFixed(2)} Cr`;
    if (price >= 100000) return `₹${(price / 100000).toFixed(2)} L`;
    return `₹${price.toLocaleString()}`;
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-r p-6 hidden md:block">
        <div className="flex items-center gap-2 font-bold text-xl mb-8 text-blue-600">
          <Home className="w-6 h-6" />
          <span>PropDigest</span>
        </div>

        <nav className="space-y-2">
          <button className="flex items-center gap-3 w-full p-2 rounded-lg bg-blue-50 text-blue-600 font-medium text-left">
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </button>
          <div className="pt-4 pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Filters
          </div>
          <div className="space-y-4">
             <div className="text-sm text-slate-600">Confidence Score &gt; 50%</div>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b px-6 flex items-center justify-between sticky top-0 z-10">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by area, description, or group..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
             <span className="text-sm text-slate-500 hidden sm:inline">Updated just now</span>
             <button onClick={fetchListings} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <LayoutDashboard className="w-5 h-5 text-slate-600" />
             </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <h1 className="text-2xl font-bold text-slate-900">Today's Real Estate Digest</h1>
              <div className="flex gap-2">
                <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-semibold border border-blue-200">
                  {filteredListings.length} Active Listings
                </span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
                <div className="text-slate-500 text-sm font-medium">Avg Market Price</div>
                <div className="text-3xl font-bold mt-1 text-slate-900">{formatPrice(stats.avg_price)}</div>
                <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                   <TrendingUp className="w-3 h-3 text-green-500" /> From {listings.length} listings today
                </div>
              </div>
              <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
                <div className="text-slate-500 text-sm font-medium">Avg Configuration</div>
                <div className="text-3xl font-bold mt-1 text-green-600">{stats.avg_bedrooms?.toFixed(1) || '0.0'} BHK</div>
                <div className="text-xs text-slate-400 mt-2">Typical property size</div>
              </div>
              <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
                <div className="text-slate-500 text-sm font-medium">Avg Area</div>
                <div className="text-3xl font-bold mt-1 text-blue-600">{stats.avg_area?.toFixed(0) || '0'} sqft</div>
                <div className="text-xs text-slate-400 mt-2">Space efficiency</div>
              </div>
            </div>

            {/* List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Price</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Details</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Group & Agent</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {loading ? (
                      <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                        <div className="flex flex-col items-center gap-2">
                           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                           <span>Fetching today's market...</span>
                        </div>
                      </td></tr>
                    ) : filteredListings.length === 0 ? (
                      <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-500">No listings found today. Try adjusting your search.</td></tr>
                    ) : filteredListings.map(listing => (
                      <tr
                        key={listing.id}
                        className="hover:bg-blue-50/50 cursor-pointer transition-colors group"
                        onClick={() => setSelectedListing(listing)}
                      >
                        <td className="px-6 py-5">
                          <div className="font-extrabold text-blue-600 text-lg">{formatPrice(listing.price)}</div>
                          <div className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-tighter">
                            {listing.property_type}
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                              <MapPin className="w-4 h-4 text-slate-400" />
                              {listing.location || 'Location Not Specified'}
                            </div>
                            <div className="flex items-center gap-3 text-sm text-slate-500">
                              <span className="flex items-center gap-1">
                                <Bed className="w-4 h-4" /> {listing.bedrooms ? `${listing.bedrooms} BHK` : 'N/A'}
                              </span>
                              {listing.area_sqft && (
                                <span className="flex items-center gap-1">
                                  <Ruler className="w-4 h-4" /> {listing.area_sqft} sqft
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col gap-1.5">
                            <span className="inline-flex w-fit px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold border uppercase">
                              {listing.group_name}
                            </span>
                            <div className="text-sm text-slate-600 flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {listing.agent_phone || 'Private Number'}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <button className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-50 hover:border-blue-300 hover:text-blue-600 transition-all shadow-sm">
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Detail Modal */}
      {selectedListing && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="p-6 border-b flex justify-between items-start bg-white">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                   <h2 className="text-2xl font-black text-slate-900">{formatPrice(selectedListing.price)}</h2>
                   <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold uppercase border border-blue-200">
                     {selectedListing.property_type}
                   </span>
                </div>
                <div className="flex items-center gap-1 text-slate-500 font-medium">
                  <MapPin className="w-4 h-4" />
                  {selectedListing.location || 'Details from WhatsApp'}
                </div>
              </div>
              <button
                onClick={() => setSelectedListing(null)}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-8 overflow-y-auto space-y-8">
              {/* Feature Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase font-black mb-1">Configuration</div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Bed className="w-4 h-4 text-blue-500" /> {selectedListing.bedrooms || 'N/A'} BHK
                  </div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase font-black mb-1">Area</div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Ruler className="w-4 h-4 text-blue-500" /> {selectedListing.area_sqft || 'N/A'} sqft
                  </div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase font-black mb-1">Furnishing</div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Sofa className="w-4 h-4 text-blue-500" /> {selectedListing.furnished === 1 ? 'Furnished' : selectedListing.furnished === 0 ? 'Unfurnished' : 'N/A'}
                  </div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase font-black mb-1">Parking</div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Car className="w-4 h-4 text-blue-500" /> {selectedListing.parking ? 'Available' : 'No'}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <div className="text-[10px] text-slate-400 uppercase font-black mb-3">WhatsApp Message Extract</div>
                <div className="text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 p-6 rounded-2xl border border-slate-100 text-sm italic">
                  "{selectedListing.description}"
                </div>
              </div>

              {/* Source Info */}
              <div className="flex items-center justify-between p-4 bg-blue-50/50 rounded-xl border border-blue-100/50">
                <div className="text-xs text-blue-600 font-bold uppercase">
                  Source: {selectedListing.group_name}
                </div>
                <div className="text-[10px] text-slate-400 font-bold">
                  Extracted with {(selectedListing.extraction_confidence || 0) * 100}% confidence
                </div>
              </div>

              {/* Actions */}
              {selectedListing.agent_phone && (
                <div className="pt-4 flex flex-col sm:flex-row gap-4">
                  <a
                    href={`tel:${selectedListing.agent_phone}`}
                    className="flex-1 flex items-center justify-center gap-3 bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95"
                  >
                    <Phone className="w-5 h-5" />
                    Call Agent
                  </a>
                  <a
                    href={`https://wa.me/91${selectedListing.agent_phone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-3 bg-green-600 text-white py-4 rounded-xl font-bold hover:bg-green-700 transition-all shadow-lg active:scale-95"
                  >
                    <ExternalLink className="w-5 h-5" />
                    WhatsApp
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
