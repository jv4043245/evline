import { json } from "../../_lib/http.js";
import { supplierTelegramSettingsStatus } from "../../_lib/supplier-portal.js";

export async function onRequestGet({ env }) {
  const settings = await supplierTelegramSettingsStatus(env);
  return json({ ok: true, settings });
}
