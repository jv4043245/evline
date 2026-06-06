CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'parts',
  status TEXT NOT NULL DEFAULT 'new',
  quality TEXT NOT NULL DEFAULT 'unknown',
  name TEXT,
  phone TEXT,
  email TEXT,
  telegram TEXT,
  car TEXT,
  vin TEXT,
  message TEXT,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  term TEXT,
  content TEXT,
  gclid TEXT,
  fbclid TEXT,
  landing_page TEXT,
  referrer TEXT,
  user_agent TEXT,
  ip_country TEXT,
  revenue_uah REAL NOT NULL DEFAULT 0,
  cost_uah REAL NOT NULL DEFAULT 0,
  processing_cost_uah REAL NOT NULL DEFAULT 0,
  manager_notes TEXT,
  loss_reason TEXT,
  next_action_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign);
CREATE INDEX IF NOT EXISTS idx_leads_type ON leads(type);

CREATE TABLE IF NOT EXISTS ad_costs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cost_date TEXT NOT NULL,
  platform TEXT NOT NULL,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  spend_uah REAL NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_ad_costs_cost_date ON ad_costs(cost_date);
CREATE INDEX IF NOT EXISTS idx_ad_costs_source ON ad_costs(source);
CREATE INDEX IF NOT EXISTS idx_ad_costs_campaign ON ad_costs(campaign);
