import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Search, MapPin, Bed, Phone, ExternalLink, Home, LayoutDashboard, Car, Sofa, Ruler, TrendingUp, Lock, LogOut, User, QrCode, AlertCircle } from 'lucide-react';
import QRCode from 'qrcode';

// Set axios defaults for credentials
axios.defaults.withCredentials = true;

interface Listing {
  id: string; price: number | null; location: string | null; bedrooms: number | null;
  property_type: string; area_sqft: number | null; furnished: number | null;
  parking: number | null; description: string; agent_phone: string | null;
  group_name: string; created_at: string; extraction_confidence: number | null;
}

function App() {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [view, setView] = useState<'login' | 'dashboard' | 'scraper'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [scraperStatus, setScraperStatus] = useState<any>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await axios.get('/api/auth/me');
      setUser(res.data.user);
      setView('dashboard');
      fetchListings();
    } catch {
      setView('login');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post('/api/auth/login', { email, password });
      checkAuth();
    } catch (err) {
      alert('Invalid credentials');
    }
  };

  const handleLogout = async () => {
    await axios.post('/api/auth/logout');
    setUser(null);
    setView('login');
  };

  const fetchListings = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/listings/today');
      setListings(res.data.data.listings);
      setStats(res.data.data.statistics);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchScraperStatus = async () => {
    try {
      const res = await axios.get('/api/scraper/status');
      setScraperStatus(res.data.data);
      if (res.data.data.qr_code) {
        const url = await QRCode.toDataURL(res.data.data.qr_code);
        setQrUrl(url);
      } else {
        setQrUrl(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (view === 'scraper') {
      fetchScraperStatus();
      const interval = setInterval(fetchScraperStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [view]);

  if (view === 'login') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-blue-600 p-3 rounded-xl mb-4">
              <Lock className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Property Digest Secure</h1>
            <p className="text-slate-500 text-sm">Sign in to access daily listings</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg">Login</button>
          </form>
          <p className="text-center text-xs text-slate-400 mt-6 font-medium uppercase tracking-widest">Authorized Access Only</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 p-6 flex flex-col fixed inset-y-0 z-20">
        <div className="flex items-center gap-3 font-black text-2xl mb-12 text-white italic">
          <Home className="w-8 h-8 text-blue-500" />
          <span>PROPDIGEST</span>
        </div>
        <nav className="space-y-2 flex-1">
          <button onClick={() => setView('dashboard')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-all ${view === 'dashboard' ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-slate-800'}`}>
            <LayoutDashboard className="w-5 h-5" /> Dashboard
          </button>
          <button onClick={() => setView('scraper')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-all ${view === 'scraper' ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-slate-800'}`}>
            <QrCode className="w-5 h-5" /> Scraper Status
          </button>
        </nav>
        <div className="pt-6 border-t border-slate-800 space-y-4">
          <div className="flex items-center gap-2 px-2">
            <User className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-bold truncate">{user?.email}</span>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-3 w-full p-3 rounded-xl text-red-400 hover:bg-red-500/10 transition-colors font-bold">
            <LogOut className="w-5 h-5" /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 flex-1 flex flex-col min-h-screen">
        <header className="h-20 bg-white border-b px-8 flex items-center justify-between sticky top-0 z-10">
          <div className="relative w-full max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input type="text" placeholder="Search areas, configs, agents..." className="w-full pl-12 pr-6 py-3 bg-slate-100 border-none rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-medium" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <button onClick={fetchListings} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-sm shadow-lg hover:bg-blue-700 transition-all active:scale-95">REFRESH</button>
        </header>

        <div className="p-8">
          {view === 'dashboard' ? (
            <div className="max-w-7xl mx-auto space-y-8">
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">Market Pulse</h1>
                  <p className="text-slate-500 font-bold mt-1 uppercase text-xs tracking-widest">Real-time property insights for {new Date().toLocaleDateString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                  <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Avg Market Price</div>
                  <div className="text-3xl font-black text-slate-900">₹{(stats.avg_price / 10000000 || 0).toFixed(2)} Cr</div>
                  <div className="mt-4 flex items-center gap-2 text-green-600 font-bold text-xs"><TrendingUp className="w-4 h-4" /> Healthy Volume</div>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                  <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Avg Configuration</div>
                  <div className="text-3xl font-black text-slate-900">{(stats.avg_bedrooms || 0).toFixed(1)} BHK</div>
                  <div className="mt-4 text-slate-400 font-bold text-xs">Standard Luxury Segment</div>
                </div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                  <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Total Listings</div>
                  <div className="text-3xl font-black text-blue-600">{listings.length}</div>
                  <div className="mt-4 text-slate-400 font-bold text-xs">Across 15+ Premium Groups</div>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-left">Property Details</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-left">Configuration</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-left">Pricing</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {listings.filter(l => l.description.toLowerCase().includes(searchTerm.toLowerCase())).map(l => (
                      <tr key={l.id} className="hover:bg-slate-50 transition-colors cursor-pointer group" onClick={() => setSelectedListing(l)}>
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 font-black text-xs uppercase">{l.property_type.charAt(0)}</div>
                            <div>
                              <div className="font-black text-slate-900 uppercase tracking-tight">{l.location || 'Premium Listing'}</div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{l.group_name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4 text-sm font-bold text-slate-700">
                            <span className="flex items-center gap-1.5"><Bed className="w-4 h-4 text-slate-300" /> {l.bedrooms || 'N/A'}</span>
                            <span className="flex items-center gap-1.5"><Ruler className="w-4 h-4 text-slate-300" /> {l.area_sqft || 'N/A'}</span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="text-xl font-black text-blue-600 tracking-tighter">₹{(l.price || 0) >= 10000000 ? `${((l.price || 0)/10000000).toFixed(2)} Cr` : `${((l.price || 0)/100000).toFixed(2)} L`}</div>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <button className="bg-slate-100 text-slate-900 px-5 py-2 rounded-xl text-xs font-black hover:bg-blue-600 hover:text-white transition-all">VIEW</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-8 py-12">
              <div className="text-center">
                <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">Scraper Terminal</h1>
                <p className="text-slate-500 font-bold mt-2 uppercase text-xs tracking-widest">Connection Status: <span className={scraperStatus?.status === 'authenticated' ? 'text-green-600' : 'text-orange-500'}>{scraperStatus?.status}</span></p>
              </div>

              {scraperStatus?.status === 'qr_ready' && qrUrl && (
                <div className="bg-white p-12 rounded-[40px] shadow-2xl border-4 border-blue-600 flex flex-col items-center">
                  <img src={qrUrl} alt="WhatsApp QR" className="w-64 h-64 mb-8" />
                  <div className="bg-blue-50 p-6 rounded-2xl flex items-start gap-4">
                    <AlertCircle className="text-blue-600 w-6 h-6 shrink-0" />
                    <div>
                      <h3 className="font-black text-blue-900 uppercase text-sm mb-1">Action Required</h3>
                      <p className="text-blue-700 text-xs leading-relaxed">Scan this QR code with your dedicated WhatsApp account to start scraping listings. <strong>Note:</strong> This session will expire in 1 minute.</p>
                    </div>
                  </div>
                </div>
              )}

              {scraperStatus?.status === 'authenticated' && (
                <div className="bg-white p-12 rounded-[40px] shadow-xl border border-slate-200 text-center">
                  <div className="w-20 h-20 bg-green-100 text-green-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <User className="w-10 h-10" />
                  </div>
                  <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">System Authenticated</h2>
                  <p className="text-slate-500 text-sm mt-2">The scraper is active and listening for new property messages.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Detail Modal - same as before but restyled */}
      {selectedListing && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-auto" onClick={() => setSelectedListing(null)}>
          <div className="bg-white rounded-[40px] w-full max-w-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-10 space-y-8">
              <div className="flex justify-between items-start">
                <div>
                   <h2 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">₹{(selectedListing.price || 0) >= 10000000 ? `${((selectedListing.price || 0)/10000000).toFixed(2)} Cr` : `${((selectedListing.price || 0)/100000).toFixed(2)} L`}</h2>
                   <div className="flex items-center gap-2 mt-2 text-slate-500 font-bold uppercase text-xs tracking-widest"><MapPin className="w-4 h-4 text-blue-500" /> {selectedListing.location}</div>
                </div>
                <button onClick={() => setSelectedListing(null)} className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-200">✕</button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Configuration</div>
                  <div className="font-black text-slate-900 flex items-center gap-2 text-xl"><Bed className="w-5 h-5 text-blue-600" /> {selectedListing.bedrooms} BHK</div>
                </div>
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  <div className="text-[10px] font-black text-slate-400 uppercase mb-1">Area</div>
                  <div className="font-black text-slate-900 flex items-center gap-2 text-xl"><Ruler className="w-5 h-5 text-blue-600" /> {selectedListing.area_sqft} SQFT</div>
                </div>
              </div>

              <div className="bg-slate-50 p-8 rounded-[32px] border border-slate-100">
                <div className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">WhatsApp Intelligence</div>
                <p className="text-slate-700 leading-relaxed font-medium italic text-lg">"{selectedListing.description}"</p>
              </div>

              <div className="flex gap-4">
                <a href={`tel:${selectedListing.agent_phone}`} className="flex-1 bg-slate-900 text-white py-5 rounded-3xl font-black uppercase text-sm tracking-widest text-center shadow-xl hover:bg-slate-800">Call Agent</a>
                <a href={`https://wa.me/91${selectedListing.agent_phone}`} target="_blank" className="flex-1 bg-green-600 text-white py-5 rounded-3xl font-black uppercase text-sm tracking-widest text-center shadow-xl hover:bg-green-700">WhatsApp</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
