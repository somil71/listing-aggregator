-- ============================================================================
-- Seed runtime configuration (replaces every hardcoded value in the codebase).
-- All keys are JSONB so we can update them at runtime via Settings UI.
-- ============================================================================

INSERT INTO app_config (key, value, description) VALUES

-- Parser
('parser.min_confidence',           '0.5'::jsonb,
 'Dashboard filter — only listings ≥ this score are shown by default'),
('parser.backfill_target',          '1000'::jsonb,
 'How many historical messages per group to attempt to backfill'),
('parser.scroll_load_attempts',     '50'::jsonb,
 'Max loadEarlierMessages calls when backfilling'),
('parser.scroll_wait_ms',           '600'::jsonb,
 'Delay between loadEarlierMessages calls'),
('parser.use_llm',                  'true'::jsonb,
 'Use Groq/Ollama for parsing; falls back to regex if false or no API key'),
('parser.llm_provider',             '"groq"'::jsonb,
 'Either "groq", "ollama", or "none"'),
('parser.llm_max_tokens',           '512'::jsonb,
 'Output token cap for the LLM call'),

-- Market defaults
('market.default',                  '"dubai"'::jsonb,
 'Default market for new users'),
('market.dubai.currency',           '"AED"'::jsonb, 'Dubai currency'),
('market.dubai.area_unit',          '"sqft"'::jsonb, 'Dubai area unit preference'),
('market.dubai.rent_period',        '"yearly"'::jsonb,
 'Dubai rents are typically quoted annually'),

-- Dubai communities seed (this is no longer the source of truth for parsing —
-- it''s only used for autocomplete & normalisation suggestions to the LLM).
('market.dubai.communities',
 '["Dubai Marina","JBR","Palm Jumeirah","Downtown Dubai","Business Bay",
   "JLT","DIFC","Dubai Hills Estate","Arabian Ranches","Emirates Hills",
   "Meadows","Springs","Lakes","JVC","JVT","Damac Hills","Damac Hills 2",
   "Mira","Mira Oasis","Reem","Town Square","Akoya","Dubai Silicon Oasis",
   "Dubai Sports City","Motor City","Studio City","Tecom","Internet City",
   "Media City","Knowledge Park","Al Barsha","Al Quoz","Al Wasl","Al Safa",
   "Jumeirah","Umm Suqeim","Sufouh","Marina","Bluewaters","Creek Harbour",
   "Dubai Creek Harbour","City Walk","La Mer","Al Furjan","Discovery Gardens",
   "International City","Mirdif","Dubai South","Expo City","Al Nahda",
   "Deira","Bur Dubai","Karama","Satwa","Oud Metha","Healthcare City",
   "Festival City","Mudon","Remraam","The Greens","The Views",
   "Emirates Living","Tilal Al Ghaf","Dubai Hills","DLRC","DLD"]'::jsonb,
 'Dubai community names for autocomplete + LLM context'),

-- Bridge / scraper
('bridge.health_check_interval_s',  '60'::jsonb,
 'How often to ping the bridge subprocess'),
('bridge.idle_shutdown_minutes',    '30'::jsonb,
 'Shut bridge down after N minutes of no activity to save Chrome RAM'),

-- Notification
('notifications.enabled',           'false'::jsonb, 'Master switch'),
('notifications.web_push_vapid_pub','""'::jsonb,    'VAPID public key for Web Push'),

-- UI defaults
('ui.listings_per_page',            '100'::jsonb, 'Pagination'),
('ui.charts.timeframe_days',        '30'::jsonb,  'Default chart window'),
('ui.show_low_confidence',          'false'::jsonb, 'Default toggle state')

ON CONFLICT (key, user_id) DO NOTHING;
