// Shared by the order list and CSV export: filters always run on the server.
export function readOrderFilters(root, range) {
  const pressed = (group) => root.querySelector(`[data-order-filter="${group}"][aria-pressed="true"]`)?.value || "all";
  return {
    range,
    work: root.querySelector('[data-work-filter][aria-pressed="true"]')?.dataset.workFilter || "all",
    status: root.querySelector("#status-filter")?.value || "all",
    type: root.querySelector("#type-filter")?.value || "all",
    q: root.querySelector("#search")?.value || "",
    payment_status: pressed("payment"),
    shipping_mode: pressed("shipping"),
    shipped_only: root.querySelector("[data-shipped-only]")?.checked ? "1" : "0",
  };
}

export function orderQuery(filters, { csv = false, offset = 0 } = {}) {
  return new URLSearchParams({ ...filters, ...(csv ? { format: "csv" } : { limit: "100", offset: String(offset) }) });
}

export function selectOrderFilter(root, button) {
  root.querySelectorAll(`[data-order-filter="${button.dataset.orderFilter}"]`).forEach((item) => {
    item.setAttribute("aria-pressed", String(item === button));
  });
}

export function resetOrderFilters(root) {
  root.querySelectorAll("[data-order-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item.value === "all")));
  root.querySelectorAll("[data-work-filter]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.workFilter === "all")));
  for (const id of ["status-filter", "type-filter"]) root.querySelector(`#${id}`).value = "all";
  root.querySelector("#search").value = "";
  root.querySelector("[data-shipped-only]").checked = false;
  // The visible global period also applies to other admin tabs; leave it unchanged.
}

export function createOrderLoader({ fetchPage, readFilters, onUpdate }) {
  let version = 0;
  let snapshot = { orders: [], total: 0, loading: false, error: null };
  let loadedKey = "";
  return async function load({ append = false } = {}) {
    const filters = readFilters();
    const key = String(orderQuery(filters));
    if (append && snapshot.loading) return;
    append = append && key === loadedKey;
    const request = ++version;
    const previous = append ? snapshot.orders : [];
    snapshot = { orders: previous, total: append ? snapshot.total : null, loading: true, error: null };
    onUpdate(snapshot);
    try {
      const data = await fetchPage(orderQuery(filters, { offset: previous.length }));
      if (request !== version || key !== String(orderQuery(readFilters()))) return;
      loadedKey = key;
      snapshot = { orders: [...previous, ...(data.orders || [])], total: Number(data.total ?? data.orders?.length ?? 0), loading: false, error: null };
      onUpdate(snapshot);
      return data;
    } catch (error) {
      if (request !== version || key !== String(orderQuery(readFilters()))) return;
      snapshot = { ...snapshot, loading: false, error };
      onUpdate(snapshot);
      throw error;
    }
  };
}
