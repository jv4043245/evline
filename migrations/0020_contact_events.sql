CREATE TABLE IF NOT EXISTS contact_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'contact_click',
  channel TEXT NOT NULL,
  intent_type TEXT NOT NULL DEFAULT 'parts',
  cta_id TEXT,
  cta_text TEXT,
  destination TEXT,
  visitor_id TEXT,
  session_id TEXT,
  is_unique INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  term TEXT,
  content TEXT,
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  fbclid TEXT,
  landing_page TEXT,
  page_url TEXT,
  referrer TEXT,
  attribution_type TEXT,
  language TEXT,
  user_agent TEXT,
  ip_country TEXT,
  lead_id TEXT,
  order_id TEXT,
  converted_at TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_contact_events_created_at ON contact_events(created_at);
CREATE INDEX IF NOT EXISTS idx_contact_events_visitor ON contact_events(visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_events_session ON contact_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_events_channel ON contact_events(channel, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_events_intent ON contact_events(intent_type, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_events_lead ON contact_events(lead_id);

ALTER TABLE leads ADD COLUMN visitor_id TEXT;
ALTER TABLE leads ADD COLUMN session_id TEXT;
ALTER TABLE orders ADD COLUMN visitor_id TEXT;
ALTER TABLE orders ADD COLUMN session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_visitor_id ON leads(visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_session_id ON leads(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_visitor_id ON orders(visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_session_id ON orders(session_id, created_at);
