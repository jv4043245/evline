// Text shown after a lead is confirmed by the CRM: what happens next and when.
// Working hours: Mon–Fri 10:00–18:00 Kyiv time. Reply times are an estimate,
// not a guarantee of the manager's availability.
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
      open: "Заявку отримали. Зазвичай відповідаємо протягом 30 хвилин у робочий час (Пн–Пт 10:00–18:00).",
      closed: "Заявку отримали. Зараз неробочий час (Пн–Пт 10:00–18:00). Менеджер зможе відповісти {when} після 10:00.",
      when: { today: "сьогодні", tomorrow: "завтра", monday: "у понеділок" },
      followup: {
        parts: ["Для підбору можете надіслати фото деталі або її маркування.", "Надіслати фото в Telegram"],
        byd: ["Можете надіслати VIN, фото помилки або версію програмного забезпечення.", "Написати майстру в Telegram"],
        sto: ["Менеджер уточнить ваші потреби та умови співпраці.", "Написати менеджеру в Telegram"],
        general: ["Додаткові подробиці звернення можна надіслати менеджеру.", "Написати менеджеру в Telegram"],
      },
    },
    ru: {
      open: "Заявку получили. Обычно отвечаем в течение 30 минут в рабочее время (Пн–Пт 10:00–18:00).",
      closed: "Заявку получили. Сейчас нерабочее время (Пн–Пт 10:00–18:00). Менеджер сможет ответить {when} после 10:00.",
      when: { today: "сегодня", tomorrow: "завтра", monday: "в понедельник" },
      followup: {
        parts: ["Для подбора можете отправить фото детали или её маркировки.", "Отправить фото в Telegram"],
        byd: ["Можете отправить VIN, фото ошибки или версию программного обеспечения.", "Написать мастеру в Telegram"],
        sto: ["Менеджер уточнит ваши потребности и условия сотрудничества.", "Написать менеджеру в Telegram"],
        general: ["Дополнительные подробности обращения можно отправить менеджеру.", "Написать менеджеру в Telegram"],
      },
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
    var type = Object.hasOwn(copy.followup, options.type) ? options.type : "general";
    var followup = copy.followup[type];
    var username = type === "byd" ? "evline_tech" : "evline_support";
    node.textContent = text(options.lang, options.date) + " " + followup[0] + " ";
    var link = document.createElement("a");
    link.href = "https://t.me/" + username;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = followup[1];
    link.dataset.contactIntent = type;
    link.dataset.contactId = "lead-saved-telegram";
    link.style.cssText = "color:inherit;text-decoration:underline;font-weight:700;display:inline-block;padding:4px 0";
    node.appendChild(link);
    return node;
  }

  window.EVLineLeadNextSteps = { text: text, render: render };
})();
