-- Per-user WhatsApp session state
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  status    TEXT DEFAULT 'pending',   -- pending | qr_ready | ready | disconnected
  phone     TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- Groups each user chose to monitor
CREATE TABLE IF NOT EXISTS selected_groups (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  group_id   TEXT NOT NULL,
  group_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON whatsapp_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_groups_user   ON selected_groups(user_id);
