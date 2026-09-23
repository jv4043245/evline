import { json } from '../../../../_lib/http.js';
import { getDocumentContext, documentPayload, saveDocument } from '../../../../_lib/order-documents.js';

export async function onRequestGet({ env, params, request }) {
  return json(await getDocumentContext(env, params.id, new URL(request.url).searchParams.get('version') || ''));
}
export async function onRequestPost({ env, params, request }) {
  return json(await saveDocument(env, request, params.id, await documentPayload(request)));
}
