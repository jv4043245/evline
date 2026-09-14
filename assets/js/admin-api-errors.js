export async function adminApiError(response) {
  if (response.status === 401) return "Немає доступу. Перевірте особистий токен.";
  const text = (await response.text()).slice(0, 20000);
  const html = /<!doctype|<html|<body|<head[\s>]/i.test(text);
  const resourceLimit = html && /Worker exceeded resource limits|cf-error-code[^>]*>\s*1102/i.test(text);
  let message;
  if (resourceLimit) {
    message = "Пошук перевищив ліміт ресурсів сервера. Спробуйте одну деталь або артикул. Розрахунок доставки доступний окремо.";
  } else if (response.status === 403) {
    message = "Доступ заборонено. Перевірте авторизацію в адмінці.";
  } else if (response.status === 429) {
    message = "Забагато запитів. Зачекайте хвилину та повторіть спробу.";
  } else if (html) {
    message = "Сервер тимчасово недоступний. Повторіть спробу пізніше.";
  } else {
    try {
      const body = JSON.parse(text);
      if (typeof body.error === "string" && !/<[^>]+>/.test(body.error)) message = body.error.slice(0, 400);
    } catch { /* Only structured application errors may be shown verbatim. */ }
  }
  message ||= `Не вдалося виконати запит (HTTP ${response.status}). Повторіть спробу.`;
  const ray = response.headers.get("cf-ray") || (html ? text.match(/Ray ID:\s*(?:<[^>]+>)*\s*([a-f0-9]{16}(?:-[A-Z]{3})?)/i)?.[1] : "");
  return message + (/^[a-f0-9]{16}(?:-[A-Z]{3})?$/i.test(ray || "") ? ` Код: ${ray}.` : "");
}
