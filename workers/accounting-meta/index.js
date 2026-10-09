import { fetchMetaAdSpendSnapshot, metaCompletedWindow, safeMetaErrorCode } from "../../functions/_lib/accounting-meta.js";
import { persistAdSpendSnapshot, recordAdSpendImportFailure } from "../../functions/_lib/accounting.js";

export async function runAccountingMetaSync(env, {
  now = new Date(), fetchSnapshot = fetchMetaAdSpendSnapshot,
  persist = persistAdSpendSnapshot, recordFailure = recordAdSpendImportFailure,
} = {}) {
  // An undeployed/unconfigured collector must not turn missing access into zero spend.
  try {
    const snapshot = await fetchSnapshot(env, { now });
    return await persist(env.DB, snapshot, { now });
  } catch (error) {
    const errorCode = safeMetaErrorCode(error);
    try {
      await recordFailure(env.DB, {
        provider: "meta", ...metaCompletedWindow(now), source: "meta_insights", error_code: errorCode,
      }, { now });
    } catch {
      // Failure to record is surfaced, without exposing a database or API error payload.
      console.error(JSON.stringify({ event: "accounting_meta_failure", error_code: "receipt_unavailable" }));
      throw new Error("accounting_meta_receipt_unavailable");
    }
    console.error(JSON.stringify({ event: "accounting_meta_failure", error_code: errorCode }));
    throw new Error(errorCode);
  }
}

export default {
  // No fetch handler and no public/manual trigger. Cron is the sole entry point.
  async scheduled(_event, env, ctx) {
    const task = runAccountingMetaSync(env);
    if (ctx?.waitUntil) ctx.waitUntil(task);
    else await task;
  },
};
