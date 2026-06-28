ALTER TABLE supplier_requests ADD COLUMN item_name_ru TEXT;
ALTER TABLE supplier_requests ADD COLUMN item_name_cn TEXT;

UPDATE supplier_requests
SET item_name_ru = COALESCE(NULLIF(item_name_ru, ''), item_name),
    item_name_cn = COALESCE(NULLIF(item_name_cn, ''), item_name)
WHERE COALESCE(item_name, '') <> ''
  AND (COALESCE(item_name_ru, '') = '' OR COALESCE(item_name_cn, '') = '');
