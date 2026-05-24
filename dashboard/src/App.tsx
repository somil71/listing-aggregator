import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Search, MapPin, Bed, Phone, ExternalLink, Home, LayoutDashboard, Car, Sofa, Ruler, TrendingUp } from 'lucide-react';

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
      // In development, the proxy forwards /api to backend
      const response = await axios.get('/api/v1/listings/today');
      setListings(response.data.data.listings || []);
      setStats(response.data.data.statistics || {});
    } catch (error) {
      console.error('Error fetching listings:', error);
      // Fallback for dev mode without backend
      setListings([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredListings = listings.filter(l =>
    l.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
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
    <div className="pd-layout">
      {/* Sidebar */}
      <aside className="pd-sidebar">
        <div className="pd-sidebar-brand">
          <Home size={28} />
          <span>PropDigest</span>
        </div>

        <nav>
          <button className="pd-nav-item active">
            <LayoutDashboard size={20} />
            Dashboard
          </button>
          <div className="pd-nav-section-title">Filters</div>
          <div className="pd-nav-item" style={{ fontSize: '0.85rem' }}>
            Confidence &gt; 50%
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="pd-main">
        {/* Header */}
        <header className="pd-header">
          <div className="pd-search-container">
            <Search className="pd-search-icon" size={18} />
            <input
              type="text"
              placeholder="Search by area, description, or group..."
              className="pd-search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="pd-header-actions">
            <span className="pd-header-status">Updated just now</span>
            <button onClick={fetchListings} className="pd-icon-btn">
              <LayoutDashboard size={20} />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="pd-content">
          <div className="pd-page-header">
            <h1 className="pd-page-title">Today's Real Estate Digest</h1>
            <div className="pd-badge primary">
              {filteredListings.length} Active Listings
            </div>
          </div>

          {/* Stats Grid */}
          <div className="pd-stats-grid">
            <div className="pd-stat-card">
              <div className="pd-stat-label">Avg Market Price</div>
              <div className="pd-stat-value">{formatPrice(stats.avg_price)}</div>
              <div className="pd-stat-context">
                <TrendingUp size={14} style={{ color: 'var(--color-success)' }} /> 
                From {listings.length} listings today
              </div>
            </div>
            <div className="pd-stat-card">
              <div className="pd-stat-label">Avg Configuration</div>
              <div className="pd-stat-value green">{stats.avg_bedrooms?.toFixed(1) || '0.0'} BHK</div>
              <div className="pd-stat-context">Typical property size</div>
            </div>
            <div className="pd-stat-card">
              <div className="pd-stat-label">Avg Area</div>
              <div className="pd-stat-value blue">{stats.avg_area?.toFixed(0) || '0'} sqft</div>
              <div className="pd-stat-context">Space efficiency</div>
            </div>
          </div>

          {/* Table */}
          <div className="pd-table-container">
            <table className="pd-table">
              <thead>
                <tr>
                  <th>Price & Type</th>
                  <th>Details</th>
                  <th>Source & Agent</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="pd-empty-state">
                        <div className="pd-spinner"></div>
                        <span>Fetching today's market...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredListings.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="pd-empty-state">
                        No listings found today. Try adjusting your search.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredListings.map((listing) => (
                    <tr key={listing.id} onClick={() => setSelectedListing(listing)}>
                      <td>
                        <div className="pd-price-display">{formatPrice(listing.price)}</div>
                        <div className="pd-prop-type">{listing.property_type}</div>
                      </td>
                      <td>
                        <div className="pd-details-group">
                          <div className="pd-detail-item">
                            <MapPin size={16} style={{ color: 'var(--color-text-light)' }} />
                            {listing.location || 'Location Not Specified'}
                          </div>
                          <div className="pd-detail-sub">
                            <span className="pd-detail-sub-item">
                              <Bed size={14} /> {listing.bedrooms ? `${listing.bedrooms} BHK` : 'N/A'}
                            </span>
                            {listing.area_sqft && (
                              <span className="pd-detail-sub-item">
                                <Ruler size={14} /> {listing.area_sqft} sqft
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="pd-details-group">
                          <div><span className="pd-tag">{listing.group_name}</span></div>
                          <div className="pd-agent-info">
                            <Phone size={12} /> {listing.agent_phone || 'Private Number'}
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="pd-btn-outline">View Details</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Detail Modal */}
      {selectedListing && (
        <div className="pd-modal-overlay">
          <div className="pd-modal">
            <div className="pd-modal-header">
              <div className="pd-modal-title-group">
                <div className="pd-modal-price-row">
                  <div className="pd-modal-price">{formatPrice(selectedListing.price)}</div>
                  <span className="pd-badge primary">{selectedListing.property_type}</span>
                </div>
                <div className="pd-detail-item" style={{ marginTop: '8px', color: 'var(--color-text-muted)' }}>
                  <MapPin size={16} />
                  {selectedListing.location || 'Details extracted from WhatsApp'}
                </div>
              </div>
              <button 
                className="pd-modal-close"
                onClick={() => setSelectedListing(null)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            
            <div className="pd-modal-body">
              <div className="pd-feature-grid">
                <div className="pd-feature-card">
                  <div className="pd-feature-label">Configuration</div>
                  <div className="pd-feature-value">
                    <Bed size={18} className="pd-feature-icon" /> {selectedListing.bedrooms || 'N/A'} BHK
                  </div>
                </div>
                <div className="pd-feature-card">
                  <div className="pd-feature-label">Area</div>
                  <div className="pd-feature-value">
                    <Ruler size={18} className="pd-feature-icon" /> {selectedListing.area_sqft || 'N/A'} sqft
                  </div>
                </div>
                <div className="pd-feature-card">
                  <div className="pd-feature-label">Furnishing</div>
                  <div className="pd-feature-value">
                    <Sofa size={18} className="pd-feature-icon" /> {selectedListing.furnished === 1 ? 'Furnished' : selectedListing.furnished === 0 ? 'Unfurnished' : 'N/A'}
                  </div>
                </div>
                <div className="pd-feature-card">
                  <div className="pd-feature-label">Parking</div>
                  <div className="pd-feature-value">
                    <Car size={18} className="pd-feature-icon" /> {selectedListing.parking ? 'Available' : 'No'}
                  </div>
                </div>
              </div>

              <div className="pd-desc-box">
                <div className="pd-feature-label" style={{ marginBottom: '12px' }}>WhatsApp Message Extract</div>
                <div className="pd-desc-text">"{selectedListing.description}"</div>
              </div>

              <div className="pd-source-bar">
                <div className="pd-source-name">Source: {selectedListing.group_name}</div>
                <div className="pd-source-conf">Extracted with {(selectedListing.extraction_confidence || 0) * 100}% confidence</div>
              </div>

              {selectedListing.agent_phone && (
                <div className="pd-action-bar">
                  <a href={`tel:${selectedListing.agent_phone}`} className="pd-btn-solid dark">
                    <Phone size={20} />
                    Call Agent
                  </a>
                  <a href={`https://wa.me/91${selectedListing.agent_phone}`} target="_blank" rel="noopener noreferrer" className="pd-btn-solid green">
                    <ExternalLink size={20} />
                    WhatsApp Message
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
