import { json } from '../../_lib/http.js';
import { ensureDocuments, documentPayload } from '../../_lib/order-documents.js';
import { invoiceNumberingState, advanceInvoiceNumbering } from '../../_lib/invoice-numbering.js';

export async function onRequestGet({ env }) {
  await ensureDocuments(env);
  return json(await invoiceNumberingState(env));
}

export async function onRequestPost({ env, request }) {
  const payload = await documentPayload(request);
  await ensureDocuments(env);
  return json(await advanceInvoiceNumbering(env, request, payload));
}
