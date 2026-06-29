CREATE TABLE IF NOT EXISTS google_ads_keyword_stats (
  id TEXT PRIMARY KEY,
  stat_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  stat_date TEXT NOT NULL,
  google_ads_customer_id TEXT,
  level TEXT NOT NULL DEFAULT 'keyword',
  source TEXT NOT NULL DEFAULT 'google',
  medium TEXT NOT NULL DEFAULT 'cpc',
  campaign TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  ad_group_id TEXT,
  ad_group_name TEXT,
  criterion_id TEXT,
  keyword_text TEXT,
  match_type TEXT,
  search_term TEXT,
  spend_uah REAL NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  google_conversions REAL NOT NULL DEFAULT 0,
  google_conversion_value REAL NOT NULL DEFAULT 0,
  currency_code TEXT NOT NULL DEFAULT 'UAH',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_google_ads_keyword_stats_date
  ON google_ads_keyword_stats(stat_date);

CREATE INDEX IF NOT EXISTS idx_google_ads_keyword_stats_level
  ON google_ads_keyword_stats(level, stat_date);

CREATE INDEX IF NOT EXISTS idx_google_ads_keyword_stats_campaign
  ON google_ads_keyword_stats(campaign_id, campaign_name);

CREATE INDEX IF NOT EXISTS idx_google_ads_keyword_stats_keyword
  ON google_ads_keyword_stats(keyword_text);

CREATE INDEX IF NOT EXISTS idx_google_ads_keyword_stats_search_term
  ON google_ads_keyword_stats(search_term);
