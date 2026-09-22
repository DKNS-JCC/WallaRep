const form = document.getElementById("lookup-form");
const input = document.getElementById("url-input");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const statsGrid = document.getElementById("stats-grid");
const sellerAvatar = document.getElementById("seller-avatar");
const sellerName = document.getElementById("seller-name");
const sellerMeta = document.getElementById("seller-meta");
const itemContext = document.getElementById("item-context");

const STAT_LABELS = {
  reports_received: "Denuncias recibidas",
  sells: "Ventas",
  buys: "Compras",
  reviews: "Valoraciones",
  sold: "Artículos vendidos",
  publish: "Anuncios publicados",
};

// Order matters: reports_received first, it's the whole point of the tool.
const STAT_ORDER = [
  "reports_received",
  "reviews",
  "sells",
  "buys",
  "sold",
  "publish",
];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status-error", isError);
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  input.disabled = isLoading;
}

function formatDate(timestampMs) {
  if (!timestampMs) return null;
  try {
    return new Date(timestampMs).toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
    });
  } catch {
    return null;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // ignore, handled below
  }
  if (!response.ok) {
    const message = body?.error || `Error ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function addStat(key, label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "stat";
  if (key === "reports_received") wrapper.classList.add("stat-highlight");

  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;

  wrapper.append(dt, dd);
  statsGrid.append(wrapper);
}

function renderStats(statsBody) {
  statsGrid.innerHTML = "";

  const counters = Object.fromEntries(
    (statsBody?.counters ?? []).map((c) => [c.type, c.value])
  );

  for (const key of STAT_ORDER) {
    if (!(key in counters)) continue;
    addStat(key, STAT_LABELS[key] ?? key, String(counters[key]));
  }

  if (typeof statsBody?.rating_average === "number") {
    addStat(
      "rating_average",
      "Valoración media",
      `${statsBody.rating_average.toFixed(1)} / 5`
    );
  }
}

function renderSeller(profile, itemTitle) {
  const avatarUrl =
    profile?.image?.urls_by_size?.small ?? profile?.image?.urls_by_size?.original;
  sellerAvatar.src = avatarUrl || "";
  sellerAvatar.alt = profile?.micro_name
    ? `Foto de perfil de ${profile.micro_name}`
    : "";

  sellerName.textContent = profile?.micro_name || "Vendedor";

  const metaParts = [];
  if (profile?.seller_type?.type) {
    metaParts.push(
      profile.seller_type.type === "Private"
        ? "Particular"
        : profile.seller_type.type
    );
  }
  if (profile?.seller_type?.verified) metaParts.push("Verificado");
  if (profile?.location?.city) metaParts.push(profile.location.city);
  const memberSince = formatDate(profile?.register_date);
  if (memberSince) metaParts.push(`En Wallapop desde ${memberSince}`);
  sellerMeta.textContent = metaParts.join(" · ");

  itemContext.textContent = itemTitle
    ? `Anuncio consultado: "${itemTitle}"`
    : "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = input.value.trim();

  if (!/wallapop\.com\/item\//i.test(url)) {
    setStatus(
      "Pega un enlace de un anuncio de Wallapop (con /item/ en la URL).",
      true
    );
    return;
  }

  resultEl.hidden = true;
  setLoading(true);
  setStatus("Buscando el anuncio…");

  try {
    const resolved = await fetchJson(
      `/api/resolve?url=${encodeURIComponent(url)}`
    );
    const sellerId = resolved.sellerId;

    setStatus("Obteniendo datos públicos del vendedor…");

    const [profile, stats] = await Promise.all([
      fetchJson(`https://api.wallapop.com/api/v3/users/${sellerId}`),
      fetchJson(`https://api.wallapop.com/api/v3/users/${sellerId}/stats`),
    ]);

    renderSeller(profile, resolved.itemTitle);
    renderStats(stats);

    resultEl.hidden = false;
    setStatus("");
  } catch (err) {
    setStatus(err.message || "Algo ha fallado. Inténtalo de nuevo.", true);
  } finally {
    setLoading(false);
  }
});
