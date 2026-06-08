UPDATE shipping_carriers
SET
  updated_at = datetime('now'),
  name = 'Meest China',
  code = 'meest-china',
  active = 1,
  tracking_url_template = 'https://cab.meest.cn/',
  notes = 'Комерційне карго з Китаю: авіа від 11.3 USD/кг, море від 2.5 USD/кг. Партії від 150 EUR та 30 кг.'
WHERE id = 'mist-china';

UPDATE shipping_rates
SET
  updated_at = datetime('now'),
  currency = 'USD',
  rate = 11.3,
  unit = 'kg',
  min_charge = 0,
  min_weight_kg = 30,
  min_volume_m3 = 0,
  exchange_rate_uah = 42,
  estimated_days_min = 12,
  estimated_days_max = 15,
  active = 1,
  notes = 'Meest China: авіа комерційних збірних вантажів, від 11.3 USD/кг, 12-15 днів.'
WHERE id = 'mist-china-air';

UPDATE shipping_rates
SET
  updated_at = datetime('now'),
  currency = 'USD',
  rate = 2.5,
  unit = 'kg',
  min_charge = 0,
  min_weight_kg = 0,
  min_volume_m3 = 0,
  exchange_rate_uah = 42,
  estimated_days_min = 60,
  estimated_days_max = 65,
  active = 1,
  notes = 'Meest China: море комерційних збірних вантажів, від 2.5 USD/кг, 60-65 днів.'
WHERE id = 'mist-china-sea';

INSERT OR IGNORE INTO shipping_carriers (
  id, created_at, updated_at, name, code, active, tracking_url_template, notes
) VALUES (
  'ukr-china',
  datetime('now'),
  datetime('now'),
  'Ukr-China',
  'ukr-china',
  1,
  'https://ukr-china.com',
  'Вартість розраховується менеджером під конкретний вантаж. Сроки: авіа від 14 днів, море 55-60 днів.'
);

UPDATE shipping_carriers
SET
  updated_at = datetime('now'),
  name = 'Ukr-China',
  code = 'ukr-china',
  active = 1,
  tracking_url_template = 'https://ukr-china.com',
  notes = 'Вартість розраховується менеджером під конкретний вантаж. Сроки: авіа від 14 днів, море 55-60 днів.'
WHERE id = 'ukr-china';

INSERT OR IGNORE INTO shipping_rates (
  id, created_at, updated_at, carrier_id, mode, currency, rate, unit, min_charge,
  min_weight_kg, min_volume_m3, exchange_rate_uah, estimated_days_min, estimated_days_max, active, notes
) VALUES (
  'ukr-china-air',
  datetime('now'),
  datetime('now'),
  'ukr-china',
  'air',
  'UAH',
  0,
  'kg',
  0,
  0,
  0,
  0,
  14,
  14,
  1,
  'Ukr-China: точна вартість розраховується менеджером, авіа від 14 днів.'
);

UPDATE shipping_rates
SET
  updated_at = datetime('now'),
  carrier_id = 'ukr-china',
  mode = 'air',
  currency = 'UAH',
  rate = 0,
  unit = 'kg',
  min_charge = 0,
  min_weight_kg = 0,
  min_volume_m3 = 0,
  exchange_rate_uah = 0,
  estimated_days_min = 14,
  estimated_days_max = 14,
  active = 1,
  notes = 'Ukr-China: точна вартість розраховується менеджером, авіа від 14 днів.'
WHERE id = 'ukr-china-air';

INSERT OR IGNORE INTO shipping_rates (
  id, created_at, updated_at, carrier_id, mode, currency, rate, unit, min_charge,
  min_weight_kg, min_volume_m3, exchange_rate_uah, estimated_days_min, estimated_days_max, active, notes
) VALUES (
  'ukr-china-sea',
  datetime('now'),
  datetime('now'),
  'ukr-china',
  'sea',
  'UAH',
  0,
  'kg',
  0,
  0,
  0,
  0,
  55,
  60,
  1,
  'Ukr-China: точна вартість розраховується менеджером, море 55-60 днів.'
);

UPDATE shipping_rates
SET
  updated_at = datetime('now'),
  carrier_id = 'ukr-china',
  mode = 'sea',
  currency = 'UAH',
  rate = 0,
  unit = 'kg',
  min_charge = 0,
  min_weight_kg = 0,
  min_volume_m3 = 0,
  exchange_rate_uah = 0,
  estimated_days_min = 55,
  estimated_days_max = 60,
  active = 1,
  notes = 'Ukr-China: точна вартість розраховується менеджером, море 55-60 днів.'
WHERE id = 'ukr-china-sea';
