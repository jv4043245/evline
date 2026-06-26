import { json, readPayload } from "../../../_lib/http.js";
import {
  createSupplierMessageByToken,
  createSupplierQuoteByToken,
  loadSupplierRequestByToken,
  publicSupplierBundle,
  updateSupplierRequestByToken,
} from "../../../_lib/supplier-portal.js";

export async function onRequestGet({ params, env }) {
  try {
    const bundle = await loadSupplierRequestByToken(env, params.token, { markViewed: false });
    if (!bundle) return json({ error: "Supplier request not found" }, { status: 404 });
    return json({ ok: true, ...publicSupplierBundle(bundle) });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}

export async function onRequestPost({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const action = String(payload.action || "quote").trim();
    let bundle = null;
    if (action === "quote") {
      bundle = await createSupplierQuoteByToken(env, params.token, payload, { requestUrl: request.url });
    } else if (action === "message") {
      bundle = await createSupplierMessageByToken(env, params.token, payload, { requestUrl: request.url });
    } else if (action === "no_stock" || action === "needs_info") {
      bundle = await updateSupplierRequestByToken(env, params.token, {
          status: action,
          tracking_number: payload.tracking_number,
          comment_cn: payload.comment_cn,
          comment_translated: payload.comment_translated,
        }, { requestUrl: request.url });
    } else {
      return json({ error: "Unsupported supplier action" }, { status: 400 });
    }

    return json({ ok: true, ...publicSupplierBundle(bundle) });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}

export async function onRequestPatch({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const bundle = await updateSupplierRequestByToken(env, params.token, payload, { requestUrl: request.url });
    return json({ ok: true, ...publicSupplierBundle(bundle) });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
