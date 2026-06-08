ALTER TABLE orders ADD COLUMN shipping_carrier_id TEXT;
ALTER TABLE orders ADD COLUMN shipping_rate_id TEXT;
ALTER TABLE orders ADD COLUMN shipping_mode TEXT;
ALTER TABLE orders ADD COLUMN shipping_weight_kg REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN shipping_volume_m3 REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN shipping_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN shipping_rate_currency TEXT;
ALTER TABLE orders ADD COLUMN shipping_rate_unit TEXT;
ALTER TABLE orders ADD COLUMN shipping_exchange_rate_uah REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS shipping_carriers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  tracking_url_template TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_shipping_carriers_active ON shipping_carriers(active);

CREATE TABLE IF NOT EXISTS shipping_rates (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'UAH',
  rate REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  min_charge REAL NOT NULL DEFAULT 0,
  min_weight_kg REAL NOT NULL DEFAULT 0,
  min_volume_m3 REAL NOT NULL DEFAULT 0,
  exchange_rate_uah REAL NOT NULL DEFAULT 0,
  estimated_days_min INTEGER NOT NULL DEFAULT 0,
  estimated_days_max INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  FOREIGN KEY (carrier_id) REFERENCES shipping_carriers(id)
);

CREATE INDEX IF NOT EXISTS idx_shipping_rates_carrier_id ON shipping_rates(carrier_id);
CREATE INDEX IF NOT EXISTS idx_shipping_rates_mode ON shipping_rates(mode);

INSERT OR IGNORE INTO shipping_carriers (
  id, created_at, updated_at, name, code, active, tracking_url_template, notes
) VALUES (
  'mist-china',
  datetime('now'),
  datetime('now'),
  'MIST China',
  'mist-china',
  1,
  '',
  'Базовий перевізник. Тарифи уточнити перед бойовим використанням.'
);

INSERT OR IGNORE INTO shipping_rates (
  id, created_at, updated_at, carrier_id, mode, currency, rate, unit, min_charge,
  min_weight_kg, min_volume_m3, exchange_rate_uah, estimated_days_min, estimated_days_max, active, notes
) VALUES
(
  'mist-china-air',
  datetime('now'),
  datetime('now'),
  'mist-china',
  'air',
  'USD',
  12,
  'kg',
  0,
  1,
  0,
  42,
  12,
  18,
  1,
  'Тестовий тариф для авіа. Перевірити актуальність.'
),
(
  'mist-china-sea',
  datetime('now'),
  datetime('now'),
  'mist-china',
  'sea',
  'USD',
  450,
  'm3',
  0,
  0,
  0.1,
  42,
  55,
  70,
  1,
  'Тестовий тариф для моря. Перевірити актуальність.'
);
