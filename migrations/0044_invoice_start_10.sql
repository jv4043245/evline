-- The owner confirmed external invoice 9 is already issued on 2026-10-27.
-- Advance only: never renumber saved documents or rewind a live sequence.
UPDATE invoice_sequence SET next_number=10 WHERE id=1 AND next_number<10;
