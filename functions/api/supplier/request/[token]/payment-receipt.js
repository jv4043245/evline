import { text } from "../../../../_lib/http.js";
import { loadSupplierRequestByToken } from "../../../../_lib/supplier-portal.js";

async function telegramFilePath(env, fileId) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.result?.file_path) return "";
  return text(data.result.file_path);
}

export async function onRequestGet({ params, env }) {
  if (!env.TELEGRAM_BOT_TOKEN) return new Response("Not configured", { status: 404 });

  const bundle = await loadSupplierRequestByToken(env, params.token, { markViewed: false });
  const fileId = text(bundle?.payment?.receipt_telegram_file_id);
  if (!bundle || !fileId) return new Response("Receipt not found", { status: 404 });

  const filePath = await telegramFilePath(env, fileId);
  if (!filePath) return new Response("Receipt not found", { status: 404 });

  const receipt = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!receipt.ok) return new Response("Receipt not found", { status: 404 });

  return new Response(await receipt.arrayBuffer(), {
    headers: {
      "content-type": receipt.headers.get("content-type") || "image/jpeg",
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}
