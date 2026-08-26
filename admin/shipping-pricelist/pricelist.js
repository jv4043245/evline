const usd = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const decimal = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const date = new Intl.DateTimeFormat("uk-UA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Kyiv",
});

let pricelist;

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function appendOptions(select, rows) {
  if (!select) return;
  select.replaceChildren();
  for (const row of rows) {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = row.name;
    select.append(option);
  }
}

function renderMetadata(data) {
  const effectiveRate = data.source.freight_usd / data.source.packed_volume_m3;
  setText("[data-version]", data.version);
  setText("[data-updated]", date.format(new Date(`${data.updated_at}T12:00:00Z`)));
  setText("[data-base-rate]", `${usd.format(data.base_rate_per_m3)}/м³`);
  setText("[data-quote-rate]", `${usd.format(data.quote_rate_per_m3)}/м³`);
  setText("[data-insurance-rate]", `${decimal.format(data.insurance_percent)}%`);
  setText("[data-route]", data.route);
  setText("[data-source-label]", data.source.label);
  setText("[data-source-volume]", `${decimal.format(data.source.packed_volume_m3)} м³`);
  setText("[data-source-weight]", `${decimal.format(data.source.gross_weight_kg)} кг`);
  setText("[data-source-freight]", usd.format(data.source.freight_usd));
  setText("[data-source-insurance]", usd.format(data.source.insurance_usd));
  setText("[data-source-china-costs]", `${decimal.format(data.source.china_local_delivery_cny + data.source.wooden_crate_cny)} CNY`);
  setText("[data-source-effective-rate]", `${usd.format(effectiveRate)}/м³`);
}

function renderProfiles(data) {
  const body = document.querySelector("[data-pricelist-rows]");
  if (!body) return;
  body.replaceChildren();

  for (const profile of data.profiles) {
    const row = document.createElement("tr");
    const cells = [
      profile.name,
      decimal.format(profile.packed_volume_m3),
      usd.format(profile.calculated_cost_usd),
      usd.format(profile.working_quote_usd),
      `${usd.format(profile.working_range_usd[0])}–${usd.format(profile.working_range_usd[1])}`,
      profile.note,
    ];

    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      if (index === 3) {
        const strong = document.createElement("strong");
        strong.textContent = value;
        cell.append(strong);
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    });

    body.append(row);
  }
}

function renderRules(data) {
  const list = document.querySelector("[data-pricelist-rules]");
  if (!list) return;
  list.replaceChildren();
  for (const rule of data.rules) {
    const item = document.createElement("li");
    item.textContent = rule;
    list.append(item);
  }
}

function selectedRow(rows, selector) {
  const value = document.querySelector(selector)?.value;
  return rows.find((row) => row.id === value) || rows[0];
}

function renderCalculator() {
  if (!pricelist) return;
  const profile = selectedRow(pricelist.profiles, "[data-profile]");
  const vehicle = selectedRow(pricelist.vehicle_size_factors, "[data-vehicle-size]");
  const packing = selectedRow(pricelist.packing_factors, "[data-packing]");
  const purchasePrice = Math.max(Number(document.querySelector("[data-purchase-price]")?.value) || 0, 0);
  const adjustedVolume = profile.packed_volume_m3 * vehicle.factor * packing.factor;
  const freight = adjustedVolume * pricelist.quote_rate_per_m3;
  const insurance = purchasePrice * (pricelist.insurance_percent / 100);

  setText("[data-result-volume]", `${decimal.format(adjustedVolume)} м³`);
  setText("[data-result-freight]", usd.format(freight));
  setText("[data-result-insurance]", usd.format(insurance));
  setText("[data-result-total]", usd.format(freight + insurance));
  setText("[data-result-note]", profile.note);
}

async function loadPricelist() {
  const response = await fetch("/admin/shipping-pricelist/pricelist.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Не вдалося завантажити прайс (${response.status})`);
  pricelist = await response.json();
  renderMetadata(pricelist);
  renderProfiles(pricelist);
  renderRules(pricelist);
  appendOptions(document.querySelector("[data-profile]"), pricelist.profiles);
  appendOptions(document.querySelector("[data-vehicle-size]"), pricelist.vehicle_size_factors);
  appendOptions(document.querySelector("[data-packing]"), pricelist.packing_factors);
  document.querySelector("[data-vehicle-size]").value = "standard";
  document.querySelector("[data-packing]").value = "shared";
  renderCalculator();
}

document.querySelector("[data-shipping-calculator]")?.addEventListener("input", renderCalculator);
document.querySelector("[data-shipping-calculator]")?.addEventListener("change", renderCalculator);

loadPricelist().catch((error) => {
  setText("[data-pricelist-status]", error.message);
});
