import { json } from '../../../_lib/http.js';
import { getDocumentContext, documentPayload, saveDocument } from '../../../_lib/order-documents.js';

export async function onRequestGet({ env, params, request }) {
  const paramsUrl = new URL(request.url).searchParams;
  return json(await getDocumentContext(env, params.id, paramsUrl.get('version') || '', true, paramsUrl.get('copy_invoice') || ''));
}
export async function onRequestPost({ env, params, request }) {
  return json(await saveDocument(env, request, params.id, await documentPayload(request), true));
}
