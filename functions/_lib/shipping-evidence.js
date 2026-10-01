// Private reference lives in D1, never in this public repository or static assets.
export async function loadShippingEvidence(env) {
  try {
    const row=await env.DB.prepare('SELECT payload_json FROM shipping_recommendation_reference WHERE id = ?').bind('ukr-china-2026-09-30').first();
    const value=row?.payload_json ? JSON.parse(row.payload_json) : null;
    if(!value || !Array.isArray(value.quotes) || !value.quotes.length) return null;
    return value;
  } catch {
    // Missing reference or migration must never block the immediate fallback.
    return null;
  }
}
