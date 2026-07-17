(() => {
  const form = document.getElementById("parts-test-form");
  if (!form) return;

  const brandInput = document.getElementById("lead-brand");
  const modelInput = document.getElementById("lead-model");
  const modelOptions = document.getElementById("model-options");
  const partInput = document.getElementById("lead-part");
  const yearInput = document.getElementById("lead-year");
  const vinInput = document.getElementById("lead-vin");
  const contactInput = document.getElementById("lead-contact");
  const contactLabel = document.getElementById("contact-label");
  const photoInput = document.getElementById("lead-photos");
  const photoDropzone = document.getElementById("photo-dropzone");
  const photoPreviews = document.getElementById("photo-previews");
  const continueButton = document.getElementById("quote-continue");
  const backButton = document.getElementById("quote-back");
  const secondStep = document.getElementById("quote-second-step");
  const stepOneError = document.getElementById("step-one-error");
  const submitError = document.getElementById("submit-error");
  const dialog = document.getElementById("demo-dialog");
  const dialogClose = document.getElementById("dialog-close");
  const dialogDone = document.getElementById("dialog-done");
  const demoSummary = document.getElementById("demo-summary");
  const copyButton = document.getElementById("copy-demo-request");
  const toast = document.getElementById("toast");
  const catalogBrand = document.getElementById("catalog-brand");
  const catalogCount = document.getElementById("catalog-count");
  const catalogEmpty = document.getElementById("catalog-empty");
  const resetCatalog = document.getElementById("reset-catalog");
  const catalogCards = [...document.querySelectorAll(".part-card")];
  const categoryButtons = [...document.querySelectorAll("[data-category]")];
  const mobileActions = document.querySelector(".mobile-actions");

  const modelMap = {
    BYD: ["Song Plus", "Song L", "Seal", "Han", "Tang", "Dolphin", "Yuan Plus", "Sea Lion 07", "Qin Plus"],
    ZEEKR: ["001", "7X", "X", "009", "Mix"],
    Xiaomi: ["SU7", "YU7"],
    "Li Auto": ["L6", "L7", "L8", "L9", "Mega"],
    Denza: ["D9", "N7", "N9", "Z9"],
    "Fang Cheng Bao": ["Leopard 3", "Leopard 5", "Leopard 8"],
    AVATR: ["06", "07", "11", "12"],
    NIO: ["ES6", "ES8", "ET5", "ET7", "EL6"],
    XPeng: ["G6", "G9", "P7", "X9"],
  };

  const channelConfig = {
    telegram: {
      label: "Telegram або телефон",
      placeholder: "@username або +380...",
      type: "text",
      autocomplete: "tel",
      title: "Telegram",
    },
    call: {
      label: "Телефон для дзвінка",
      placeholder: "+380...",
      type: "tel",
      autocomplete: "tel",
      title: "Дзвінок",
    },
    email: {
      label: "Email для відповіді",
      placeholder: "name@example.com",
      type: "email",
      autocomplete: "email",
      title: "Email",
    },
  };

  const maxFiles = 5;
  const maxFileSize = 8 * 1024 * 1024;
  const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
  let selectedFiles = [];
  let previewUrls = [];
  let activeCategory = "all";
  let demoRequestText = "";
  let toastTimer = 0;

  function refreshIcons() {
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  function showError(element, message) {
    element.textContent = message;
    element.hidden = false;
  }

  function clearError(element) {
    element.textContent = "";
    element.hidden = true;
  }

  function markInvalid(input, invalid) {
    input.setAttribute("aria-invalid", invalid ? "true" : "false");
  }

  function updateModelOptions() {
    const models = modelMap[brandInput.value] || [];
    modelOptions.replaceChildren();
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      modelOptions.appendChild(option);
    });
  }

  function validateStepOne() {
    clearError(stepOneError);
    const missing = [];
    const brandMissing = !brandInput.value;
    const partMissing = !partInput.value.trim();

    markInvalid(brandInput, brandMissing);
    markInvalid(partInput, partMissing);

    if (brandMissing) missing.push("марку авто");
    if (partMissing) missing.push("потрібну деталь");

    if (missing.length) {
      showError(stepOneError, `Вкажіть ${missing.join(" та ")}.`);
      (brandMissing ? brandInput : partInput).focus();
      return false;
    }
    return true;
  }

  function revealSecondStep({ scroll = true, focus = true } = {}) {
    if (!validateStepOne()) return false;
    secondStep.hidden = false;
    continueButton.setAttribute("aria-expanded", "true");
    if (scroll) secondStep.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focus) window.setTimeout(() => contactInput.focus({ preventScroll: true }), 350);
    return true;
  }

  function updateChannel() {
    const selected = form.querySelector('input[name="channel"]:checked')?.value || "telegram";
    const config = channelConfig[selected];
    contactLabel.textContent = config.label;
    contactInput.type = config.type;
    contactInput.placeholder = config.placeholder;
    contactInput.autocomplete = config.autocomplete;
    contactInput.value = "";
    markInvalid(contactInput, false);
    clearError(submitError);
  }

  function fileKey(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }

  function addFiles(fileList) {
    clearError(stepOneError);
    const errors = [];
    const known = new Set(selectedFiles.map(fileKey));

    for (const file of fileList) {
      if (selectedFiles.length >= maxFiles) {
        errors.push(`Можна додати не більше ${maxFiles} фото.`);
        break;
      }
      if (!acceptedTypes.has(file.type)) {
        errors.push(`Файл «${file.name}» має непідтримуваний формат.`);
        continue;
      }
      if (file.size > maxFileSize) {
        errors.push(`Файл «${file.name}» більший за 8 МБ.`);
        continue;
      }
      if (known.has(fileKey(file))) continue;
      selectedFiles.push(file);
      known.add(fileKey(file));
    }

    renderPhotoPreviews();
    if (errors.length) showError(stepOneError, errors[0]);
  }

  function clearPreviewUrls() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
  }

  function renderPhotoPreviews() {
    clearPreviewUrls();
    photoPreviews.replaceChildren();

    selectedFiles.forEach((file, index) => {
      const item = document.createElement("div");
      item.className = "photo-preview";
      item.title = file.name;

      const image = document.createElement("img");
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      image.src = url;
      image.alt = `Додане фото ${index + 1}`;
      image.addEventListener("error", () => {
        image.removeAttribute("src");
        image.alt = `Фото ${index + 1}: попередній перегляд недоступний`;
      }, { once: true });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.title = `Видалити ${file.name}`;
      remove.setAttribute("aria-label", `Видалити фото ${index + 1}`);
      remove.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      remove.addEventListener("click", () => {
        selectedFiles.splice(index, 1);
        renderPhotoPreviews();
      });

      item.append(image, remove);
      photoPreviews.appendChild(item);
    });

    const small = photoDropzone.querySelector("small");
    small.textContent = selectedFiles.length ? `${selectedFiles.length} з ${maxFiles} додано` : `до ${maxFiles} файлів`;
    refreshIcons();
  }

  function selectedChannel() {
    return form.querySelector('input[name="channel"]:checked')?.value || "telegram";
  }

  function appendSummaryRow(term, value) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value || "Не вказано";
    row.append(dt, dd);
    demoSummary.appendChild(row);
  }

  function openDemoDialog(data) {
    demoSummary.replaceChildren();
    appendSummaryRow("Авто", [data.brand, data.model, data.year].filter(Boolean).join(" "));
    appendSummaryRow("Деталь", data.part);
    appendSummaryRow("VIN", data.vin || "Буде уточнено пізніше");
    appendSummaryRow("Фото", data.photos ? `${data.photos} файл(и)` : "Не додано");
    appendSummaryRow("Відповідь", `${data.channel}: ${data.contact}`);

    demoRequestText = [
      "Тестова заявка EVLine",
      `Авто: ${[data.brand, data.model, data.year].filter(Boolean).join(" ")}`,
      `Деталь: ${data.part}`,
      `VIN: ${data.vin || "буде уточнено пізніше"}`,
      `Фото: ${data.photos || 0}`,
      `Канал: ${data.channel}`,
      `Контакт: ${data.contact}`,
    ].join("\n");

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      document.body.classList.add("dialog-open");
    } else {
      dialog.setAttribute("open", "");
    }
    refreshIcons();
  }

  function closeDialog() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    document.body.classList.remove("dialog-open");
  }

  function scrollToForm({ focus = true } = {}) {
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    if (focus) window.setTimeout(() => brandInput.focus({ preventScroll: true }), 450);
  }

  function updateCatalog() {
    const brand = catalogBrand.value;
    let visible = 0;
    catalogCards.forEach((card) => {
      const matchesBrand = brand === "all" || card.dataset.brand === brand;
      const matchesCategory = activeCategory === "all" || card.dataset.category === activeCategory;
      card.hidden = !(matchesBrand && matchesCategory);
      if (!card.hidden) visible += 1;
    });

    catalogCount.textContent = `${visible} ${visible === 1 ? "позиція" : visible >= 2 && visible <= 4 ? "позиції" : "позицій"}`;
    catalogEmpty.hidden = visible !== 0;
  }

  function resetCatalogFilters() {
    catalogBrand.value = "all";
    activeCategory = "all";
    categoryButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.category === "all"));
    updateCatalog();
  }

  if (mobileActions) {
    const setMobileActionsVisible = (visible) => {
      mobileActions.classList.toggle("is-visible", visible);
      mobileActions.setAttribute("aria-hidden", visible ? "false" : "true");
    };

    setMobileActionsVisible(false);
    if ("IntersectionObserver" in window) {
      const mobileActionsObserver = new IntersectionObserver(([entry]) => {
        const formHasPassed = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
        setMobileActionsVisible(formHasPassed);
      });
      mobileActionsObserver.observe(form);
    }
  }

  brandInput.addEventListener("change", () => {
    updateModelOptions();
    markInvalid(brandInput, false);
    clearError(stepOneError);
  });

  partInput.addEventListener("input", () => {
    markInvalid(partInput, false);
    clearError(stepOneError);
  });

  vinInput.addEventListener("input", () => {
    vinInput.value = vinInput.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
  });

  photoInput.addEventListener("change", () => {
    addFiles([...photoInput.files]);
    photoInput.value = "";
  });

  photoDropzone.addEventListener("click", () => photoInput.click());

  ["dragenter", "dragover"].forEach((eventName) => {
    photoDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      photoDropzone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    photoDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      photoDropzone.classList.remove("is-dragging");
    });
  });

  photoDropzone.addEventListener("drop", (event) => addFiles([...event.dataTransfer.files]));

  continueButton.addEventListener("click", () => revealSecondStep());

  backButton.addEventListener("click", () => {
    secondStep.hidden = true;
    continueButton.setAttribute("aria-expanded", "false");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  form.querySelectorAll('input[name="channel"]').forEach((radio) => radio.addEventListener("change", updateChannel));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError(submitError);

    if (!validateStepOne()) return;
    if (secondStep.hidden) {
      revealSecondStep();
      return;
    }

    const contactMissing = !contactInput.value.trim();
    const consent = form.querySelector('input[name="consent"]');
    markInvalid(contactInput, contactMissing);

    if (contactMissing) {
      showError(submitError, `Вкажіть контакт для каналу «${channelConfig[selectedChannel()].title}».`);
      contactInput.focus();
      return;
    }
    if (!contactInput.checkValidity()) {
      showError(submitError, "Перевірте формат контактних даних.");
      contactInput.focus();
      return;
    }
    if (!consent.checked) {
      showError(submitError, "Потрібна згода на обробку даних для підбору.");
      consent.focus();
      return;
    }

    const channel = selectedChannel();
    const data = {
      brand: brandInput.value,
      model: modelInput.value.trim(),
      year: yearInput.value,
      vin: vinInput.value.trim(),
      part: partInput.value.trim(),
      photos: selectedFiles.length,
      channel: channelConfig[channel].title,
      contact: contactInput.value.trim(),
    };

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "evline_test_lead_preview",
      channel,
      brand: data.brand,
      has_vin: Boolean(data.vin),
      photo_count: data.photos,
    });

    openDemoDialog(data);
  });

  contactInput.addEventListener("input", () => {
    markInvalid(contactInput, false);
    clearError(submitError);
  });

  catalogBrand.addEventListener("change", updateCatalog);
  categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      categoryButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      updateCatalog();
    });
  });
  resetCatalog.addEventListener("click", resetCatalogFilters);

  document.querySelectorAll("[data-part-action]").forEach((button) => {
    button.addEventListener("click", () => {
      brandInput.value = button.dataset.brandValue || "";
      updateModelOptions();
      modelInput.value = button.dataset.modelValue || "";
      partInput.value = button.dataset.partValue || "";
      markInvalid(brandInput, false);
      markInvalid(partInput, false);
      clearError(stepOneError);
      revealSecondStep({ scroll: false, focus: false });
      scrollToForm({ focus: false });
      window.setTimeout(() => contactInput.focus({ preventScroll: true }), 500);
    });
  });

  document.querySelectorAll("[data-scroll-to-form]").forEach((button) => {
    button.addEventListener("click", () => scrollToForm());
  });

  [dialogClose, dialogDone].forEach((button) => button.addEventListener("click", closeDialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
  dialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(demoRequestText);
      showToast("Заявку скопійовано");
    } catch {
      showToast("Не вдалося скопіювати автоматично");
    }
  });

  updateModelOptions();
  updateChannel();
  updateCatalog();
  refreshIcons();
})();
