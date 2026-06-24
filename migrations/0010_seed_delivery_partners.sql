UPDATE shipping_carriers
SET
  updated_at = datetime('now'),
  name = 'Meest',
  code = 'meest',
  active = 1,
  tracking_url_template = 'https://cab.meest.cn/',
  notes = 'Основний перевізник для доставок з Китаю.'
WHERE id = 'mist-china';

UPDATE shipping_carriers
SET
  updated_at = datetime('now'),
  name = 'Ukr China',
  code = 'ukr-china',
  active = 1,
  tracking_url_template = 'https://ukr-china.com',
  notes = 'Додатковий перевізник для доставок з Китаю.'
WHERE id = 'ukr-china';

INSERT OR IGNORE INTO shipping_carriers (
  id, created_at, updated_at, name, code, active, tracking_url_template, notes
) VALUES
(
  'brock-bridge',
  datetime('now'),
  datetime('now'),
  'Brock Bridge',
  'brock-bridge',
  1,
  '',
  'Додатковий перевізник. Тариф і строки менеджер уточнює під вантаж.'
),
(
  'meest-commerce',
  datetime('now'),
  datetime('now'),
  'Meest Commerce',
  'meest-commerce',
  1,
  '',
  'Додатковий канал Meest для комерційних відправлень.'
);

UPDATE shipping_carriers
SET
  updated_at = datetime('now'),
  name = 'Brock Bridge',
  code = 'brock-bridge',
  active = 1,
  notes = 'Додатковий перевізник. Тариф і строки менеджер уточнює під вантаж.'
WHERE id = 'brock-bridge';

UPDATE shipping_carriers
SET
  updated_at = datetime('now'),
  name = 'Meest Commerce',
  code = 'meest-commerce',
  active = 1,
  notes = 'Додатковий канал Meest для комерційних відправлень.'
WHERE id = 'meest-commerce';

INSERT OR IGNORE INTO shipping_rates (
  id, created_at, updated_at, carrier_id, mode, currency, rate, unit, min_charge,
  min_weight_kg, min_volume_m3, exchange_rate_uah, estimated_days_min, estimated_days_max, active, notes
) VALUES
(
  'brock-bridge-air',
  datetime('now'),
  datetime('now'),
  'brock-bridge',
  'air',
  'UAH',
  0,
  'kg',
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  'Brock Bridge: тариф і строки вказуються менеджером під вантаж.'
),
(
  'brock-bridge-sea',
  datetime('now'),
  datetime('now'),
  'brock-bridge',
  'sea',
  'UAH',
  0,
  'kg',
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  'Brock Bridge: тариф і строки вказуються менеджером під вантаж.'
),
(
  'meest-commerce-air',
  datetime('now'),
  datetime('now'),
  'meest-commerce',
  'air',
  'UAH',
  0,
  'kg',
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  'Meest Commerce: тариф і строки вказуються менеджером під вантаж.'
),
(
  'meest-commerce-sea',
  datetime('now'),
  datetime('now'),
  'meest-commerce',
  'sea',
  'UAH',
  0,
  'kg',
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  'Meest Commerce: тариф і строки вказуються менеджером під вантаж.'
);
