(function () {
  "use strict";
  const form = document.getElementById("zeekr-9x-8x-form");
  const dialog = document.getElementById("contact-dialog");
  const success = document.getElementById("form-success");
  const status = document.getElementById("form-status");
  const submit = form.querySelector('[type="submit"]');
  let busy = false;
  let pending = null;
  let opener = null;

  // Keep this page on the same attribution and Meta hooks as existing programming forms.
  window.trackingPayload = function () {
    const params = new URLSearchParams(location.search);
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem("evline_attribution_v1") || "{}");
      if (saved.expires_at && saved.expires_at < Date.now()) saved = {};
    } catch (_) {}
    const payload = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid"]) {
      payload[key] = params.get(key) || saved[key] || "";
    }
    if (params.get("fbclid")) payload.gclid = payload.gbraid = payload.wbraid = "";
    else if (params.get("gclid") || params.get("gbraid") || params.get("wbraid")) payload.fbclid = "";
    return Object.assign(payload, {
      page_url: location.href, landing_page: saved.landing_page || location.href,
      referrer: saved.referrer || document.referrer, submitted_at: new Date().toISOString(),
      form_id: form.id, form_name: form.dataset.formName,
    });
  };
  window.trackLeadSubmit = function (payload) {
    if (typeof window.gtag === "function") window.gtag("event", "generate_lead", {form_id: payload.form_id, lead_type: payload.type});
  };

  document.querySelectorAll("[data-open-contact]").forEach(button => {
    button.addEventListener("click", () => {
      opener = button;
      if (form.hidden) {
        form.reset();
        form.hidden = false;
        success.hidden = true;
        status.textContent = "";
      }
      if (button.dataset.model) form.elements.model.value = button.dataset.model;
      if (button.dataset.service) form.elements.service.value = button.dataset.service;
      dialog.showModal();
      document.body.classList.add("modal-open");
    });
  });
  document.getElementById("close-contact").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener("close", () => {
    document.body.classList.remove("modal-open");
    opener?.focus();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(form));
    if (fields.contact.replace(/\D/g, "").length < 8) {
      status.textContent = "Проверьте номер телефона: в нём должно быть не менее 8 цифр.";
      form.elements.contact.focus();
      return;
    }
    const fingerprint = JSON.stringify(fields);
    // A network retry keeps its event ID so the CRM can avoid duplicate orders.
    if (!pending || pending.fingerprint !== fingerprint) {
      pending = {fingerprint, payload: Object.assign(window.trackingPayload(), {
        type: "byd", topic: "programming-zeekr-9x-8x", name: fields.name.trim(),
        phone: fields.contact.trim(), car: fields.model, vin: fields.vin.trim().toUpperCase(),
        message: ["Настройка " + fields.model, fields.service, fields.message.trim()].filter(Boolean).join("\n"),
      })};
      pending.payload.meta_event_id ||= "evline-lead-" + crypto.randomUUID();
    }
    const payload = pending.payload;
    busy = true;
    submit.disabled = true;
    submit.textContent = "Отправляем…";
    status.textContent = "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/leads", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload), signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error("lead_not_saved");
      form.hidden = true;
      success.hidden = false;
      pending = null;
      try { window.trackLeadSubmit(payload); } catch (_) {}
      success.querySelector("a").focus();
    } catch (_) {
      status.textContent = "Не удалось подтвердить отправку. Данные сохранены в форме. Попробуйте ещё раз или свяжитесь с нами: +38 (063) 063-03-04.";
    } finally {
      clearTimeout(timeout);
      busy = false;
      submit.disabled = false;
      submit.textContent = "Отправить заявку";
    }
  });
})();
