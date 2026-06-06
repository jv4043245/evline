CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  telegram_username TEXT,
  telegram_chat_id TEXT,
  preferred_channel TEXT NOT NULL DEFAULT 'telegram',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_telegram_chat_id ON customers(telegram_chat_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  lead_id TEXT,
  customer_id TEXT,
  type TEXT NOT NULL DEFAULT 'parts',
  status TEXT NOT NULL DEFAULT 'new',
  manager_contact TEXT NOT NULL DEFAULT '@evline_support',
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  customer_telegram TEXT,
  telegram_chat_id TEXT,
  car TEXT,
  vin TEXT,
  item_name TEXT,
  service_name TEXT,
  request_text TEXT,
  tracking_carrier TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  china_warehouse TEXT,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  term TEXT,
  content TEXT,
  gclid TEXT,
  fbclid TEXT,
  landing_page TEXT,
  referrer TEXT,
  revenue_uah REAL NOT NULL DEFAULT 0,
  purchase_cost_uah REAL NOT NULL DEFAULT 0,
  delivery_cost_uah REAL NOT NULL DEFAULT 0,
  customs_cost_uah REAL NOT NULL DEFAULT 0,
  processing_cost_uah REAL NOT NULL DEFAULT 0,
  ad_cost_uah REAL NOT NULL DEFAULT 0,
  other_cost_uah REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unknown',
  paid_at TEXT,
  ordered_at TEXT,
  delivered_at TEXT,
  completed_at TEXT,
  canceled_at TEXT,
  manager_notes TEXT,
  client_notes TEXT,
  loss_reason TEXT,
  next_action_at TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_type ON orders(type);
CREATE INDEX IF NOT EXISTS idx_orders_lead_id ON orders(lead_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);
CREATE INDEX IF NOT EXISTS idx_orders_campaign ON orders(campaign);
CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  order_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_uah REAL NOT NULL DEFAULT 0,
  unit_cost_uah REAL NOT NULL DEFAULT 0,
  notes TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_status_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  order_id TEXT NOT NULL,
  previous_status TEXT,
  status TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'manager',
  comment TEXT,
  notify_customer INTEGER NOT NULL DEFAULT 0,
  notification_status TEXT NOT NULL DEFAULT 'not_queued',
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_order_status_events_order_id ON order_status_events(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_events_created_at ON order_status_events(created_at);

CREATE TABLE IF NOT EXISTS notification_queue (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  order_id TEXT NOT NULL,
  event_id TEXT,
  channel TEXT NOT NULL DEFAULT 'telegram',
  recipient_chat_id TEXT,
  recipient_contact TEXT,
  template_key TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  telegram_message_id TEXT,
  error TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (event_id) REFERENCES order_status_events(id)
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_status ON notification_queue(status);
CREATE INDEX IF NOT EXISTS idx_notification_queue_order_id ON notification_queue(order_id);

CREATE TABLE IF NOT EXISTS message_templates (
  template_key TEXT PRIMARY KEY,
  status TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO message_templates (template_key, status, title, body, updated_at) VALUES
('order_new', 'new', 'Заявку отримано', 'Добрий день! Ми отримали вашу заявку EVLine і вже передали її менеджеру. Найближчим часом уточнимо деталі.', datetime('now')),
('order_accepted', 'accepted', 'Замовлення прийнято', 'Добрий день! Ваше замовлення EVLine прийнято в роботу. Менеджер перевіряє дані авто, VIN і потрібну позицію.', datetime('now')),
('order_proposal_sent', 'proposal_sent', 'Пропозицію підготовлено', 'Ми підготували пропозицію по вашому запиту. Перевірте, будь ласка, деталі у чаті з менеджером.', datetime('now')),
('order_paid', 'paid', 'Оплату отримано', 'Оплату отримано. Замовлення зафіксовано, починаємо роботу з постачальником.', datetime('now')),
('order_sourcing_china', 'sourcing_china', 'Замовляємо в Китаї', 'Ваше замовлення в роботі: погоджуємо або замовляємо позицію у Китаї та перевіряємо сумісність.', datetime('now')),
('order_china_warehouse', 'china_warehouse', 'На складі в Китаї', 'Ваше замовлення вже на складі в Китаї. Далі перевірка, пакування і підготовка до відправки.', datetime('now')),
('order_left_china', 'left_china', 'Виїхало з Китаю', 'Ваше замовлення виїхало з Китаю. Якщо є трек-номер, ми додамо його до повідомлення.', datetime('now')),
('order_in_ukraine', 'in_ukraine', 'В Україні', 'Ваше замовлення вже в Україні. Далі проходить локальний етап доставки/оформлення.', datetime('now')),
('order_ready_for_pickup', 'ready_for_pickup', 'Готово до видачі', 'Ваше замовлення готове до видачі або відправки по Україні. Менеджер узгодить фінальні деталі.', datetime('now')),
('order_completed', 'completed', 'Замовлення завершено', 'Дякуємо! Замовлення EVLine завершено. Якщо потрібні ще запчастини або програмування BYD — ми на звʼязку.', datetime('now')),
('order_canceled', 'canceled', 'Замовлення скасовано', 'Замовлення скасовано. Якщо питання ще актуальне, напишіть менеджеру — підберемо інший варіант.', datetime('now'));

INSERT OR IGNORE INTO customers (
  id, created_at, updated_at, name, phone, email, telegram_username, preferred_channel
)
SELECT
  'customer_' || id,
  created_at,
  updated_at,
  name,
  phone,
  email,
  telegram,
  'telegram'
FROM leads;

INSERT OR IGNORE INTO orders (
  id, created_at, updated_at, lead_id, customer_id, type, status, manager_contact, customer_name, customer_phone,
  customer_email, customer_telegram, car, vin, item_name, request_text, source, medium, campaign,
  term, content, gclid, fbclid, landing_page, referrer, revenue_uah, purchase_cost_uah,
  processing_cost_uah, manager_notes, loss_reason, next_action_at
)
SELECT
  'order_' || id,
  created_at,
  updated_at,
  id,
  'customer_' || id,
  type,
  CASE status
    WHEN 'in_progress' THEN 'accepted'
    WHEN 'quoted' THEN 'proposal_sent'
    WHEN 'ordered' THEN 'sourcing_china'
    WHEN 'won' THEN 'completed'
    WHEN 'lost' THEN 'canceled'
    WHEN 'spam' THEN 'canceled'
    ELSE 'new'
  END,
  CASE WHEN type = 'byd' THEN '@evline_tech' ELSE '@evline_support' END,
  name,
  phone,
  email,
  telegram,
  car,
  vin,
  CASE
    WHEN instr(message, 'Запчастина:') = 1 THEN trim(substr(message, 11, instr(message || char(10), char(10)) - 11))
    ELSE ''
  END,
  message,
  source,
  medium,
  campaign,
  term,
  content,
  gclid,
  fbclid,
  landing_page,
  referrer,
  revenue_uah,
  cost_uah,
  processing_cost_uah,
  manager_notes,
  loss_reason,
  next_action_at
FROM leads;

INSERT OR IGNORE INTO order_status_events (
  id, created_at, order_id, previous_status, status, actor, comment, notify_customer, notification_status
)
SELECT
  'event_' || id,
  created_at,
  'order_' || id,
  NULL,
  CASE status
    WHEN 'in_progress' THEN 'accepted'
    WHEN 'quoted' THEN 'proposal_sent'
    WHEN 'ordered' THEN 'sourcing_china'
    WHEN 'won' THEN 'completed'
    WHEN 'lost' THEN 'canceled'
    WHEN 'spam' THEN 'canceled'
    ELSE 'new'
  END,
  'migration',
  'Створено з попередньої заявки',
  0,
  'not_queued'
FROM leads;
