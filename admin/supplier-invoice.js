import { icon } from './documents/icons.js';
import { internalInvoicePrefix, invoiceDefinition, invoiceInput, sharedTemplateFields, templateFields } from './supplier-invoice-model.js?v=20261122';
import { suggestInvoicePart } from './supplier-invoice-terms.js?v=20261122';

const pdfPath = '/admin/documents/vendor/';
let pdfLoading;
function loadPdf() {
  if (window.pdfMake?.createPdf) return Promise.resolve();
  if (!pdfLoading) pdfLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = pdfPath + 'pdfmake.min.js';
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      pdfLoading = null;
      reject(new Error('Не вдалося завантажити модуль PDF.'));
    };
    document.head.append(script);
  });
  return pdfLoading;
}

async function makePdf(template, data, reference, print = false) {
  await loadPdf();
  const font = new URL(pdfPath + 'NotoSansSC-Regular.otf',window.location.origin).href;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Створення PDF триває надто довго. Спробуйте ще раз.')), 30000);
    try {
      const pdf = window.pdfMake.createPdf(invoiceDefinition(template, data, reference), undefined, {
        SupplierSC: { normal: font, bold: font, italics: font, bolditalics: font },
      });
      pdf.getBlob(blob => {
        clearTimeout(timer);
        resolve(new File([blob], reference + '.pdf', { type: 'application/pdf' }));
      }, { autoPrint: print });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export function openSupplierInvoice({ order, request, download, onSaved, host }) {
  const dialog = document.createElement(host ? 'section' : 'dialog');
  dialog.className = 'sd-invoice';
  if (host) dialog.classList.add('sd-invoice--page');
  dialog.setAttribute('aria-label', 'Внутрішній інвойс');
  dialog.innerHTML = `
    <header>${host ? '<h1>Інвойс постачальника</h1>' : '<h3>Внутрішній інвойс</h3><span data-inv-order></span>'}
      <button class="admin-btn admin-btn--small" type="button" data-inv-settings hidden>Шаблон</button>
      ${host ? '' : '<button class="admin-btn admin-btn--small" type="button" data-inv-close>Закрити</button>'}
    </header>
    <p class="sd-notice" data-inv-status role="status" aria-live="polite">Завантажуємо шаблон…</p>
    <form data-inv-editor hidden>
      <div class="sd-invoice-fields">
        <label class="sd-invoice-wide">Запчастина<input name="part" required maxlength="180"></label>
        <label>Дата<input name="date" type="date" required min="2000-01-01" max="2099-12-31"></label>
        <label>Сума, CNY<input name="amount" inputmode="decimal" required maxlength="12"></label>
      </div>
      <details data-inv-translations>
        <summary>Назва китайською та англійською</summary>
        <div class="sd-invoice-fields">
          <label>中文<input name="partZh" maxlength="180" lang="zh-CN"></label>
          <label>English<input name="partEn" maxlength="180" lang="en"></label>
        </div>
      </details>
      <div class="sd-toolbar">
        <button class="admin-btn admin-btn--primary" type="submit">${icon('Eye')} Передперегляд</button>
        <button class="admin-btn" type="button" data-inv-action="download">${icon('Download')} PDF</button>
        <button class="admin-btn" type="button" data-inv-action="print">${icon('Printer')} Друк</button>
        ${order?.id ? `<button class="admin-btn" type="button" data-inv-action="save">${icon('Save')} Зберегти в замовленні</button>` : ''}
      </div>
    </form>
    <form data-inv-template hidden>
      <label class="sd-invoice-import">Імпортувати шаблон JSON<input type="file" accept="application/json,.json" data-inv-import></label>
      <div class="sd-invoice-fields" data-inv-config-fields></div>
      <div class="sd-toolbar">
        <button class="admin-btn admin-btn--primary" type="submit">${icon('Save')} Зберегти шаблон</button>
        <button class="admin-btn" type="button" data-inv-back>Назад до інвойсу</button>
      </div>
    </form>
    <iframe data-inv-preview title="Передперегляд інвойсу" hidden></iframe>`;
  const q = selector => dialog.querySelector(selector);
  const editor = q('[data-inv-editor]'), config = q('[data-inv-template]');
  const preview = q('[data-inv-preview]'), settings = q('[data-inv-settings]');
  const status = q('[data-inv-status]');
  let template = null, mounted = true, busy = false, cache = null, previewUrl;
  const notice = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('sd-error', error);
  };
  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.removeAttribute('src');
    preview.hidden = true;
  }
  function mode(configuring) {
    clearPreview();
    editor.hidden = configuring || !template;
    config.hidden = !configuring;
    settings.disabled = configuring;
    q('[data-inv-back]').hidden = !template;
    if (!configuring && template && !host) editor.elements.part.focus();
  }
  if (!host) q('[data-inv-order]').textContent = order?.order_number || '';
  const name = String(order?.item_name || '').trim();
  if (name.length <= 180) editor.elements.part.value = name;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year:'numeric',month:'2-digit',day:'2-digit' });
  editor.elements.date.value = today.format(new Date());
  for (const [key, label] of Object.entries(templateFields)) for (const english of [false,true]) {
    if (english && sharedTemplateFields.includes(key)) continue;
    const long = ['note','address','terms'].includes(key), field = document.createElement('label');
    const input = document.createElement(long ? 'textarea' : 'input');
    if (long) input.rows = 2;
    if (sharedTemplateFields.includes(key)) field.className = 'sd-invoice-wide';
    input.name = english ? 'en-' + key : key;
    input.maxLength = (long ? 220 : 48) * (english ? 2 : 1);
    input.required = ['supplier','buyer'].includes(key);
    field.append(label + (sharedTemplateFields.includes(key) ? '' : english ? ' · EN' : ' · 中文'),input);
    q('[data-inv-config-fields]').append(field);
  }
  function populateTemplate(values) {
    for (const key of Object.keys(templateFields)) {
      config.elements[key].value = values?.[key] || '';
      if (!sharedTemplateFields.includes(key)) config.elements['en-'+key].value = values?.english?.[key] || '';
    }
  }
  q('[data-inv-import]').onchange = async event=>{
    const input = event.target, file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 16000) throw new Error();
      const values = JSON.parse(await file.text());
      if (!values || typeof values !== 'object' || !values.supplier || !values.english) throw new Error();
      populateTemplate(values);
      notice('Перевірте реквізити й збережіть шаблон.');
    } catch { notice('Не вдалося прочитати шаблон JSON.',true); }
    finally { input.value=''; }
  };
  if (!host) q('[data-inv-close]').onclick = () => dialog.close();
  settings.onclick = () => { notice(''); mode(true); };
  q('[data-inv-back]').onclick = () => { notice(''); mode(false); };
  dialog.addEventListener('close', () => { mounted = false; clearPreview(); dialog.remove(); }, { once:true });
  editor.addEventListener('input', event => {
    cache = null; clearPreview(); notice('');
    if (event.target.name==='part') editor.elements.partZh.value = editor.elements.partEn.value = '';
  });
  function setBusy(value) {
    busy = value;
    for (const field of dialog.querySelectorAll('form input, form textarea, form button')) field.disabled = value;
    settings.disabled = value || !config.hidden;
  }
  async function process(action, popup = null) {
    if (busy || !template || !editor.reportValidity()) { popup?.close(); return; }
    setBusy(true);
    notice('Створюємо PDF…');
    try {
      const data = invoiceInput(Object.fromEntries([...editor.elements].filter(e=>e.name).map(e=>[e.name,e.value])));
      const zh=editor.elements.partZh, en=editor.elements.partEn;
      const terms=suggestInvoicePart(data.part);
      zh.value ||= terms.partZh;
      en.value ||= terms.partEn;
      const han=/\p{Script=Han}/u, cyrillic=/\p{Script=Cyrillic}/u;
      data.partZh=zh.value.trim();data.partEn=en.value.trim();
      if (!han.test(data.partZh) || cyrillic.test(data.partZh) || !data.partEn || han.test(data.partEn) || cyrillic.test(data.partEn)) {
        q('[data-inv-translations]').open=true;
        throw new Error('Перевірте переклад і заповніть назву китайською та англійською.');
      }
      if (!cache) {
        const orderCode = String(order?.order_number || '').replace(/[^A-Za-z0-9-]/g,'') || (order ? 'ORDER' : 'DIRECT');
        cache = { reference: `${internalInvoicePrefix}${orderCode}-${data.date.replaceAll('-','')}-${crypto.randomUUID().slice(0,8)}` };
      }
      const current = cache;
      const file = action==='print' ? await makePdf(template,data,current.reference,true)
        : (current.file ||= await makePdf(template,data,current.reference));
      if (!mounted) { popup?.close(); return; }
      if (action==='preview') {
        q('[data-inv-translations]').open=true;
        clearPreview();
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        preview.hidden = false;
        preview.scrollIntoView({ block:'nearest' });
      } else if (action==='download') download(file,file.name);
      else if (action==='print') {
        const url = URL.createObjectURL(file);
        popup.location.replace(url);
        setTimeout(()=>URL.revokeObjectURL(url), 60000);
      } else if (action==='save' && order?.id) {
        if (!current.saved) {
          const form = new FormData();
          form.set('order_id',order.id);
          form.set('reference',current.reference);
          form.set('file',file);
          await request('save-internal-invoice',{data:form});
          current.saved = true;
        }
        await onSaved();
      }
      notice(action==='save' ? 'Інвойс збережено в замовленні.' : '');
    } catch(error) { popup?.close(); if (mounted) notice(error.message || 'Не вдалося створити інвойс.',true); }
    finally { if (mounted) setBusy(false); }
  }
  editor.addEventListener('submit', event=>{event.preventDefault();void process('preview');});
  editor.addEventListener('click',event=>{
    const action = event.target.closest('[data-inv-action]')?.dataset.invAction;
    if (!action || busy) return;
    let popup;
    if (action==='print') {
      if (!editor.reportValidity()) return;
      popup = window.open('about:blank','_blank');
      if (!popup) { notice('Дозвольте нову вкладку для друку або завантажте PDF.',true); return; }
      popup.opener = null;
    }
    void process(action,popup);
  });
  config.addEventListener('submit',async event=>{
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(config), data = {english:{}};
    for (const key of Object.keys(templateFields)) {
      data[key] = fields.get(key);
      if (!sharedTemplateFields.includes(key)) data.english[key] = fields.get('en-'+key);
    }
    setBusy(true);
    try {
      template = (await request('invoice-template',{data})).template;
      if (mounted) { cache = null; mode(false); notice('Шаблон збережено.'); }
    } catch(error) { if (mounted) notice(error.message,true); }
    finally { if (mounted) setBusy(false); }
  });
  (host || document.body).append(dialog);
  if (!host) dialog.showModal();
  request('invoice-template').then(data=>{
    if (!mounted) return;
    template = data.template;
    settings.hidden = !data.can_configure;
    populateTemplate(template);
    mode(!template && data.can_configure);
    notice(template || data.can_configure ? '' : 'Власник ще не налаштував шаблон інвойсу.');
  }).catch(error=>{if (mounted) notice(error.message,true);});
  return dialog;
}
