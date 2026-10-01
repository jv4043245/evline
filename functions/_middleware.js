// Never publish source/tests/research artifacts as static files. This protects
// private shipping evidence even if a static asset copier includes helper files.
export function onRequest(context) {
  let pathname;
  try { pathname=decodeURIComponent(new URL(context.request.url).pathname); }
  catch { return new Response('Not found',{status:404}); }
  const segments=pathname.split('/').filter(Boolean);
  if (segments.some(s=>s.startsWith('.') && s!=='.well-known') || /^(?:functions|tests|scripts|node_modules|workers|migrations)$/i.test(segments[0] || '') || /\.(?:md|patch|toml|sql)$/i.test(pathname)) {
    return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});
  }
  return context.next();
}
