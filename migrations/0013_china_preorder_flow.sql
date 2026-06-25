ALTER TABLE supplier_requests ADD COLUMN request_text_ru TEXT;
ALTER TABLE supplier_requests ADD COLUMN request_text_cn TEXT;
ALTER TABLE supplier_requests ADD COLUMN payment_id TEXT;
ALTER TABLE supplier_requests ADD COLUMN selected_quote_id TEXT;

ALTER TABLE supplier_quotes ADD COLUMN comment_ru TEXT;

ALTER TABLE supplier_payments ADD COLUMN supplier_request_id TEXT;
ALTER TABLE supplier_payments ADD COLUMN supplier_quote_id TEXT;

CREATE INDEX IF NOT EXISTS idx_supplier_requests_payment_id ON supplier_requests(payment_id);
CREATE INDEX IF NOT EXISTS idx_supplier_requests_selected_quote_id ON supplier_requests(selected_quote_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_request_id ON supplier_payments(supplier_request_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_quote_id ON supplier_payments(supplier_quote_id);

UPDATE supplier_requests
SET request_text_ru = COALESCE(NULLIF(request_text_ru, ''), request_text),
    request_text_cn = COALESCE(NULLIF(request_text_cn, ''), request_text)
WHERE COALESCE(request_text_ru, '') = '' OR COALESCE(request_text_cn, '') = '';

UPDATE supplier_quotes
SET comment_ru = COALESCE(NULLIF(comment_ru, ''), comment_translated)
WHERE COALESCE(comment_ru, '') = '' AND COALESCE(comment_translated, '') <> '';
