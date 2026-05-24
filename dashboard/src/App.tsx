import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Search, MapPin, IndianRupee, Bed, Phone, ExternalLink, Filter, Home, LayoutDashboard } from 'lucide-react';

interface Listing {
  id: string;
  price: number | null;
  location: string | null;
  bedrooms: number | null;
  description: string;
  agent_phone: string | null;
  group_name: string;
  created_at: string;
}

function App() {
  const [listings, setListings] = useState<Listing[]>([]);
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
      setListings(response.data.listings);
    } catch (error) {
      console.error('Error fetching listings:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredListings = listings.filter(l =>
    l.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (l.location && l.location.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const formatPrice = (price: number | null) => {
    if (!price) return 'N/A';
    if (price >= 10000000) return `₹${(price / 10000000).toFixed(2)} Cr`;
    if (price >= 100000) return `₹${(price / 100000).toFixed(2)} L`;
    return `₹${price.toLocaleString()}`;
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-r p-6 hidden md:block">
        <div className="flex items-center gap-2 font-bold text-xl mb-8 text-blue-600">
          <Home className="w-6 h-6" />
          <span>PropDigest</span>
        </div>

        <nav className="space-y-2">
          <button className="flex items-center gap-3 w-full p-2 rounded-lg bg-blue-50 text-blue-600 font-medium">
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </button>
          <button className="flex items-center gap-3 w-full p-2 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors">
            <Filter className="w-5 h-5" />
            Filters
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b px-6 flex items-center justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search properties..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
             <span className="text-sm text-slate-500">Updated just now</span>
             <button onClick={fetchListings} className="p-2 hover:bg-slate-100 rounded-full">
                <LayoutDashboard className="w-5 h-5 text-slate-600" />
             </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            <h1 className="text-2xl font-bold mb-6">Today's Real Estate Digest</h1>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="text-slate-500 text-sm font-medium">Total Listings</div>
                <div className="text-2xl font-bold">{listings.length}</div>
              </div>
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="text-slate-500 text-sm font-medium">New Matches</div>
                <div className="text-2xl font-bold text-green-600">{filteredListings.length}</div>
              </div>
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="text-slate-500 text-sm font-medium">Source Groups</div>
                <div className="text-2xl font-bold text-blue-600">15+</div>
              </div>
            </div>

            {/* List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Price</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Location</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">BHK</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Group</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr><td colSpan={5} className="px-6 py-10 text-center text-slate-500">Loading listings...</td></tr>
                  ) : filteredListings.length === 0 ? (
                    <tr><td colSpan={5} className="px-6 py-10 text-center text-slate-500">No listings found today.</td></tr>
                  ) : filteredListings.map(listing => (
                    <tr
                      key={listing.id}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedListing(listing)}
                    >
                      <td className="px-6 py-4 font-bold text-blue-600">{formatPrice(listing.price)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-slate-700">
                          <MapPin className="w-3 h-3" />
                          {listing.location || 'Unknown'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-slate-700">
                          <Bed className="w-3 h-3" />
                          {listing.bedrooms ? `${listing.bedrooms} BHK` : 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium border">
                          {listing.group_name}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-blue-600 hover:text-blue-800 font-medium text-sm">View Details</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* Detail Modal */}
      {selectedListing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="p-6 border-b flex justify-between items-start sticky top-0 bg-white">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{formatPrice(selectedListing.price)} • {selectedListing.location || 'Listing'}</h2>
                <p className="text-slate-500 text-sm mt-1">{selectedListing.group_name}</p>
              </div>
              <button
                onClick={() => setSelectedListing(null)}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="text-xs text-slate-500 uppercase font-bold mb-1">Price</div>
                  <div className="font-bold">{formatPrice(selectedListing.price)}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="text-xs text-slate-500 uppercase font-bold mb-1">BHK</div>
                  <div className="font-bold">{selectedListing.bedrooms || 'N/A'} BHK</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500 uppercase font-bold mb-2">Description</div>
                <div className="text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 p-4 rounded-xl">
                  {selectedListing.description}
                </div>
              </div>

              {selectedListing.agent_phone && (
                <div className="pt-6 border-t flex flex-col sm:flex-row gap-3">
                  <a
                    href={`tel:${selectedListing.agent_phone}`}
                    className="flex-1 flex items-center justify-center gap-2 bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    Call Agent
                  </a>
                  <a
                    href={`https://wa.me/91${selectedListing.agent_phone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
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
