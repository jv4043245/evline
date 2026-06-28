function supplierPageHtml(token) {
  const safeToken = String(token || "").replace(/[^a-z0-9]/gi, "");
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>EVLine · Запрос поставщику</title>
    <link rel="stylesheet" href="/supplier/supplier.css?v=20260628-dashboard-tracking">
    <script src="/supplier/supplier.js?v=20260628-dashboard-tracking" defer></script>
  </head>
  <body class="supplier-shell" data-supplier-page="request" data-token="${safeToken}">
    <main class="supplier-app" data-app>
      <section class="supplier-loading">
        <span>EVLine · Запрос поставщику</span>
        <strong>Загрузка...</strong>
      </section>
    </main>
  </body>
</html>`;
}

export function onRequestGet({ params }) {
  return new Response(supplierPageHtml(params.token), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
