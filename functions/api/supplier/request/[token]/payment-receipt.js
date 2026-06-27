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

function imageTypeFromBytes(bytes) {
  const view = new Uint8Array(bytes || new ArrayBuffer(0));
  if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "image/jpeg";
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) return "image/png";
  if (
    view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 &&
    view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50
  ) return "image/webp";
  if (view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70) return "image/heic";
  return "";
}

function imageTypeFromPath(filePath) {
  const path = text(filePath).toLowerCase();
  if (/\.(jpe?g)$/i.test(path)) return "image/jpeg";
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.(heic|heif)$/i.test(path)) return "image/heic";
  return "";
}

function imageExtension(contentType) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
  }[text(contentType).toLowerCase()] || "jpg";
}

function receiptFilename(bundle, contentType) {
  const requestNumber = text(bundle?.request?.public_number).replace(/[^a-z0-9_-]/gi, "") || "request";
  const paymentNumber = text(bundle?.payment?.payment_number).replace(/[^a-z0-9_-]/gi, "") || "payment";
  return `evline-${requestNumber}-${paymentNumber}-receipt.${imageExtension(contentType)}`;
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
  const bytes = await receipt.arrayBuffer();
  const contentType = imageTypeFromBytes(bytes)
    || imageTypeFromPath(filePath)
    || text(receipt.headers.get("content-type"))
    || "image/jpeg";

  return new Response(bytes, {
    headers: {
      "content-type": contentType,
      "content-disposition": `inline; filename="${receiptFilename(bundle, contentType)}"`,
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}
