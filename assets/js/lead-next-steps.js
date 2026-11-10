// Text shown after a lead is confirmed by the CRM: what happens next and when.
// Working hours: Mon–Fri 10:00–18:00 Kyiv time. Outside them we promise
// the next working day, but say we may answer earlier.
(function () {
  "use strict";

  var HOURS = { start: 10, end: 18 };

  function kyivNow(date) {
    var parts = {};
    try {
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Kyiv",
        weekday: "short",
        hour: "numeric",
        hourCycle: "h23",
      }).formatToParts(date || new Date()).forEach(function (part) {
        parts[part.type] = part.value;
      });
    } catch (_) {
      var local = date || new Date();
      return { day: local.getDay(), hour: local.getHours() };
    }
    var days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { day: days[parts.weekday], hour: Number(parts.hour) };
  }

  function isWorkingDay(day) {
    return day >= 1 && day <= 5;
  }

  // "today" (before opening), "tomorrow" or "monday".
  function nextOpening(now) {
    if (isWorkingDay(now.day) && now.hour < HOURS.start) return "today";
    if (now.day === 5 || now.day === 6) return "monday";
    return "tomorrow";
  }

  var COPY = {
    uk: {
      open: "Заявку отримали ✅ Менеджер зв’яжеться з вами протягом 30 хвилин.",
      closed: "Заявку отримали ✅ Зараз неробочий час (Пн–Пт 10:00–18:00). Постараємося відповісти раніше, але не пізніше ніж {when} після 10:00.",
      when: { today: "сьогодні", tomorrow: "завтра", monday: "у понеділок" },
      photo: "Щоб пришвидшити підбір, надішліть фото деталі або техпаспорта в Telegram:",
      telegram: "Надіслати фото в Telegram",
    },
    ru: {
      open: "Заявку получили ✅ Менеджер свяжется с вами в течение 30 минут.",
      closed: "Заявку получили ✅ Сейчас нерабочее время (Пн–Пт 10:00–18:00). Постараемся ответить раньше, но не позже чем {when} после 10:00.",
      when: { today: "сегодня", tomorrow: "завтра", monday: "в понедельник" },
      photo: "Чтобы ускорить подбор, отправьте фото детали или техпаспорта в Telegram:",
      telegram: "Отправить фото в Telegram",
    },
  };

  function language(lang) {
    return String(lang || document.documentElement.lang || "").toLowerCase().startsWith("ru") ? "ru" : "uk";
  }

  function text(lang, date) {
    var copy = COPY[language(lang)];
    var now = kyivNow(date);
    var open = isWorkingDay(now.day) && now.hour >= HOURS.start && now.hour < HOURS.end;
    return open ? copy.open : copy.closed.replace("{when}", copy.when[nextOpening(now)]);
  }

  // Fills a status node with the next-steps text and a Telegram link.
  function render(node, options) {
    options = options || {};
    var copy = COPY[language(options.lang)];
    var username = options.type === "byd" ? "evline_tech" : "evline_support";
    node.textContent = text(options.lang, options.date) + " " + copy.photo + " ";
    var link = document.createElement("a");
    link.href = "https://t.me/" + username;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = copy.telegram;
    link.dataset.contactIntent = options.type === "byd" ? "byd" : "parts";
    link.dataset.contactId = "lead-saved-telegram";
    link.style.cssText = "color:inherit;text-decoration:underline;font-weight:700;display:inline-block;padding:4px 0";
    node.appendChild(link);
    return node;
  }

  window.EVLineLeadNextSteps = { text: text, render: render };
})();
