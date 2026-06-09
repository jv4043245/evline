CREATE TABLE IF NOT EXISTS crm_counters (
  scope TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

ALTER TABLE leads ADD COLUMN lead_number TEXT;
ALTER TABLE customers ADD COLUMN customer_number TEXT;
ALTER TABLE orders ADD COLUMN order_number TEXT;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS number_value
  FROM leads
  WHERE lead_number IS NULL OR lead_number = ''
)
UPDATE leads
SET lead_number = (
  SELECT 'L-' || printf('%06d', number_value)
  FROM ranked
  WHERE ranked.id = leads.id
)
WHERE id IN (SELECT id FROM ranked);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS number_value
  FROM customers
  WHERE customer_number IS NULL OR customer_number = ''
)
UPDATE customers
SET customer_number = (
  SELECT 'C-' || printf('%06d', number_value)
  FROM ranked
  WHERE ranked.id = customers.id
)
WHERE id IN (SELECT id FROM ranked);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS number_value
  FROM orders
  WHERE order_number IS NULL OR order_number = ''
)
UPDATE orders
SET order_number = (
  SELECT 'O-' || printf('%06d', number_value)
  FROM ranked
  WHERE ranked.id = orders.id
)
WHERE id IN (SELECT id FROM ranked);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_lead_number ON leads(lead_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_number ON customers(customer_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

INSERT INTO crm_counters (scope, value, updated_at)
VALUES
  ('lead', (SELECT COALESCE(MAX(CAST(substr(lead_number, 3) AS INTEGER)), 0) FROM leads), datetime('now')),
  ('customer', (SELECT COALESCE(MAX(CAST(substr(customer_number, 3) AS INTEGER)), 0) FROM customers), datetime('now')),
  ('order', (SELECT COALESCE(MAX(CAST(substr(order_number, 3) AS INTEGER)), 0) FROM orders), datetime('now'))
ON CONFLICT(scope) DO UPDATE SET
  value = CASE WHEN excluded.value > crm_counters.value THEN excluded.value ELSE crm_counters.value END,
  updated_at = excluded.updated_at;
