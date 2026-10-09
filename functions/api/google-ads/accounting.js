import { json } from "../../_lib/http.js";
import { persistAdSpendSnapshot, recordAdSpendImportFailure } from "../../_lib/accounting.js";

// Separate account-total receipt. Legacy campaign/keyword imports remain unchanged.
export async function onRequestPost({ request, env }) {
  const expected = String(env.GOOGLE_ADS_SYNC_TOKEN || "");
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.text();
  if (body.length > 64000) return json({ error: "Payload too large" }, { status: 413 });
  let snapshot;
  try {
    snapshot = JSON.parse(body);
    if (snapshot.status === "failed" && snapshot.provider === "google" &&
        snapshot.account_id === "4028488894" && snapshot.source === "google_ads_script") {
      await recordAdSpendImportFailure(env.DB, {
        provider: "google", from: snapshot.from, to: snapshot.to,
        source: "google_ads_script", error_code: "google_sync_failed",
      });
      return json({ ok: true, status: "failure_recorded" });
    }
    if (snapshot.provider !== "google" || snapshot.source !== "google_ads_script" ||
        snapshot.scope !== "account" || snapshot.coverage !== "complete") throw new Error();
  } catch {
    return json({ error: "Invalid snapshot" }, { status: 400 });
  }
  try {
    return json(await persistAdSpendSnapshot(env.DB, snapshot));
  } catch (error) {
    // Never reflect payload, credentials, database errors or personal information.
    if (error instanceof TypeError || error instanceof RangeError || error.status === 400) {
      return json({ error: "Invalid accounting snapshot" }, { status: 400 });
    }
    return json({ error: "Accounting import unavailable" }, { status: 503 });
  }
}
