import { json } from '../../_lib/http.js';
import { saveSeller, documentPayload } from '../../_lib/order-documents.js';

export async function onRequestPost({ env, request }) {
  return json(await saveSeller(env, request, await documentPayload(request)));
}
