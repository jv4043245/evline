import { contactEmail } from '../../admin/documents/delivery.js';

export const EMAIL_DELIVERY_SCHEMA = `CREATE TABLE IF NOT EXISTS document_email_deliveries (
  id TEXT PRIMARY KEY,
  order_document_id TEXT REFERENCES order_documents(id) ON DELETE CASCADE,
  invoice_document_id TEXT REFERENCES standalone_documents(id) ON DELETE CASCADE,
  mode TEXT NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL,
  recipient TEXT NOT NULL, sender TEXT NOT NULL, status TEXT NOT NULL,
  message_id TEXT, error TEXT,
  CHECK ((order_document_id IS NOT NULL) != (invoice_document_id IS NOT NULL))
)`;

export function emailConfiguration(env) {
  const sender = String(env.GMAIL_SENDER || '').trim().toLowerCase();
  return { sender: contactEmail(sender) === sender ? sender : '', enabled: !!(sender && contactEmail(sender) === sender && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) };
}
