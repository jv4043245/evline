const contactFields = ['customer_name', 'customer_phone', 'customer_email', 'customer_telegram', 'car', 'vin', 'manager_contact'];
const clean = value => String(value ?? '').trim();

export function repeatOrderDraft(order) {
  return {
    repeat_order_id: order.id,
    type: ['parts', 'byd', 'other'].includes(order.type) ? order.type : 'parts',
    ...Object.fromEntries(contactFields.map(key => [key, clean(order[key])])),
    item_name: clean(order.item_name || order.service_name),
    request_text: clean(order.request_text),
    revenue_uah: Number(order.revenue_uah) > 0 ? String(order.revenue_uah) : '',
    medium: 'repeat',
  };
}

// A repeat carries the customer and editable quote, never payment, fulfilment or ad attribution.
export function repeatOrderPayload(order, edits) {
  const draft = repeatOrderDraft(order);
  const fields = [...contactFields, 'type', 'item_name', 'request_text', 'revenue_uah'];
  for (const key of fields) if (Object.hasOwn(edits, key)) draft[key] = clean(edits[key]);
  if (!['parts', 'byd', 'other'].includes(draft.type)) draft.type = 'parts';
  if (draft.type === 'byd') { draft.service_name = clean(edits.service_name ?? draft.item_name); draft.item_name = ''; }
  return { ...draft, status: 'new', payment_status: 'unknown', source: 'manual', attribution_type: 'manual',
    form_id: 'admin-repeat-order', form_name: 'Повторне замовлення' };
}
