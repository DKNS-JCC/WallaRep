const API = "https://api.wallapop.com/api/v3";
const REVIEWS_PAGE_SIZE = 40;
const MAX_REVIEW_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15000;
const BAD_REVIEW_MAX_STARS = 3;

const $ = (id) => document.getElementById(id);
const form = $("lookup-form");
const input = $("url-input");
const submitBtn = $("submit-btn");
const pasteBtn = $("paste-btn");
const statusEl = $("status");
const resultEl = $("result");

// Incremented on every lookup so a slow earlier lookup can't overwrite the
// results of a newer one.
let currentLookup = 0;

// ---------- helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status-error", isError);
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "Consultando…" : "Consultar";
}

const numberFmt = new Intl.NumberFormat("es-ES");
const fmtNumber = (n) => numberFmt.format(n);

function fmtMonthYear(ms) {
  return new Date(ms).toLocaleDateString("es-ES", {
    month: "short",
    year: "numeric",
  });
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function yearsSince(ms) {
  return Math.floor((Date.now() - ms) / (365.25 * 24 * 3600 * 1000));
}

function plural(n, one, many) {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}

function stars(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function timeoutSignal() {
  return typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

class LookupError extends Error {}

async function request(url, notFoundMessage) {
  let response;
  try {
    response = await fetch(url, { signal: timeoutSignal() });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new LookupError("Wallapop tarda demasiado en responder. Prueba otra vez.");
    }
    throw new LookupError("No hay conexión con Wallapop. Revisa tu conexión a internet.");
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body; handled below.
  }
  if (response.status === 404 && notFoundMessage) {
    throw new LookupError(notFoundMessage);
  }
  if (response.status === 429) {
    throw new LookupError("Wallapop está limitando las consultas. Espera un minuto.");
  }
  if (!response.ok) {
    throw new LookupError(
      body?.error || `Wallapop ha respondido con un error (${response.status}).`
    );
  }
  if (body == null) {
    throw new LookupError("Wallapop ha devuelto una respuesta que no se entiende.");
  }
  return { body, headers: response.headers };
}

// Accepts a bare link or the text the Wallapop app puts on the clipboard
// when you share ("Mira lo que he encontrado en Wallapop: https://...").
function extractWallapopUrl(text) {
  const match = text.match(
    /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*wallapop\.com\/[^\s"'<>]*/i
  );
  if (!match) return null;
  let url = match[0];
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    return /\/(item|user)\/[^/]+/i.test(parsed.pathname) ? parsed.href : null;
  } catch {
    return null;
  }
}

// ---------- rendering ----------

function renderItem(item) {
  const card = $("item-card");
  if (!item?.title) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  card.href = item.url || "#";
  const img = $("item-image");
  img.hidden = !item.image;
  if (item.image) img.src = item.image;
  $("item-title").textContent = item.title;

  const meta = [];
  if (item.price) {
    meta.push(
      new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: item.price.currency,
      }).format(item.price.amount)
    );
  }
  if (item.sold) meta.push("Vendido");
  else if (item.reserved) meta.push("Reservado");
  $("item-meta").textContent = meta.join(" · ");
}

function renderSeller(profile) {
  const name = profile.micro_name || "Usuario sin nombre";
  const avatar = $("seller-avatar");
  avatar.replaceChildren();
  const avatarUrl = profile.image?.urls_by_size?.small;
  if (avatarUrl) {
    const img = el("img");
    img.src = avatarUrl;
    img.alt = "";
    img.addEventListener("error", () => img.replaceWith(name[0]));
    avatar.append(img);
  } else {
    avatar.textContent = name[0];
  }

  const link = $("seller-link");
  link.textContent = name;
  if (profile.web_slug) {
    link.href = `https://es.wallapop.com/user/${profile.web_slug}`;
    link.title = "Abrir perfil en Wallapop";
  } else {
    link.removeAttribute("href");
  }

  const meta = [];
  const type = profile.seller_type?.type;
  if (type === "Private") meta.push("Particular");
  else if (type) meta.push("Profesional");
  if (profile.seller_type?.verified) meta.push("Verificado");
  if (profile.location?.city) meta.push(profile.location.city);
  if (profile.register_date) {
    const years = yearsSince(profile.register_date);
    meta.push(
      `En Wallapop desde ${fmtMonthYear(profile.register_date)}` +
        (years >= 1 ? ` (${plural(years, "año", "años")})` : " (menos de 1 año)")
    );
  }
  $("seller-meta").textContent = meta.join(" · ");
}

function renderStats(stats) {
  const counters = Object.fromEntries(
    (stats.counters ?? []).map((c) => [c.type, c.value])
  );
  const reports = counters.reports_received;
  const deals = (counters.sells ?? 0) + (counters.buys ?? 0);

  const reportsEl = $("reports");
  reportsEl.replaceChildren();
  reportsEl.classList.toggle("reports-some", reports > 0);
  if (typeof reports === "number") {
    reportsEl.append(
      el("span", "reports-value", fmtNumber(reports)),
      el(
        "span",
        "reports-label",
        `${reports === 1 ? "denuncia recibida" : "denuncias recibidas"} de otros usuarios` +
          (deals > 0 ? `, con ${plural(deals, "compraventa", "compraventas")} en total` : "")
      ),
      el("span", "reports-note", "Wallapop no muestra este dato en su app.")
    );
  } else {
    reportsEl.append(
      el("span", "reports-label", "Wallapop no ha devuelto el número de denuncias de este perfil.")
    );
  }

  const grid = $("stats-grid");
  grid.replaceChildren();
  const add = (label, value) => {
    const wrap = el("div", "stat");
    wrap.append(el("dt", null, label), el("dd", null, value));
    grid.append(wrap);
  };

  const reviewCount = counters.reviews ?? 0;
  if (reviewCount > 0 && typeof stats.rating_average === "number") {
    add(
      `Media (${plural(reviewCount, "reseña", "reseñas")})`,
      `${stats.rating_average.toLocaleString("es-ES", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} ★`
    );
  } else {
    add("Media", "Sin reseñas");
  }
  if ("sells" in counters) add("Ventas", fmtNumber(counters.sells));
  if ("buys" in counters) add("Compras", fmtNumber(counters.buys));
  if ("publish" in counters) add("Anuncios en venta", fmtNumber(counters.publish));
}

function reviewStars(entry) {
  const r = entry.review ?? {};
  if (typeof r.rating_over_five === "number") return r.rating_over_five;
  if (typeof r.scoring === "number") return Math.round(r.scoring / 20);
  return null;
}

function reviewNode(entry) {
  const r = entry.review ?? {};
  const n = reviewStars(entry);
  const li = el("li", "review");

  const head = el("div", "review-head");
  if (n != null) {
    const s = el("span", `review-stars stars-${n}`, stars(n));
    s.setAttribute("aria-label", `${n} de 5 estrellas`);
    head.append(s);
  }
  const who = [];
  who.push(entry.type === "buy" ? "Como comprador" : "Como vendedor");
  if (r.date) who.push(fmtDate(r.date));
  head.append(el("span", "muted", who.join(" · ")));
  li.append(head);

  if (r.comments?.trim()) {
    li.append(el("p", "review-text", r.comments.trim()));
  } else {
    li.append(el("p", "review-text muted", "Sin comentario."));
  }

  const ctx = [];
  if (entry.user?.micro_name) ctx.push(`por ${entry.user.micro_name}`);
  if (entry.item?.title) ctx.push(`«${entry.item.title}»`);
  if (ctx.length) li.append(el("p", "review-context", ctx.join(" · ")));
  return li;
}

function renderReviews(reviews, total, truncated) {
  const statusEl = $("reviews-status");
  const dist = $("reviews-dist");
  const bad = $("reviews-bad");
  const allWrap = $("reviews-all-wrap");
  dist.replaceChildren();
  bad.replaceChildren();

  if (reviews.length === 0) {
    statusEl.textContent = "Este usuario no tiene reseñas.";
    allWrap.hidden = true;
    return;
  }

  statusEl.textContent = truncated
    ? `Leídas las ${fmtNumber(reviews.length)} más recientes de ${fmtNumber(total)}.`
    : "";

  const counts = [0, 0, 0, 0, 0, 0];
  for (const entry of reviews) {
    const n = reviewStars(entry);
    if (n != null && n >= 1 && n <= 5) counts[n] += 1;
  }
  const max = Math.max(...counts);
  for (let n = 5; n >= 1; n--) {
    const row = el("div", "dist-row");
    const bar = el("span", "dist-bar");
    const fill = el("span", `dist-fill stars-${n}`);
    fill.style.width = max ? `${(counts[n] / max) * 100}%` : "0";
    bar.append(fill);
    row.append(el("span", "dist-label", `${n} ★`), bar, el("span", "dist-count", fmtNumber(counts[n])));
    dist.append(row);
  }

  const badReviews = reviews.filter((e) => {
    const n = reviewStars(e);
    return n != null && n <= BAD_REVIEW_MAX_STARS;
  });
  bad.append(
    el(
      "h4",
      null,
      badReviews.length
        ? `Reseñas de ${BAD_REVIEW_MAX_STARS} estrellas o menos (${fmtNumber(badReviews.length)})`
        : `Ninguna reseña de ${BAD_REVIEW_MAX_STARS} estrellas o menos`
    )
  );
  if (badReviews.length) {
    const list = el("ol", "review-list");
    for (const entry of badReviews) list.append(reviewNode(entry));
    bad.append(list);
  }

  allWrap.hidden = false;
  allWrap.open = false;
  $("reviews-all-summary").textContent = `Ver todas las reseñas (${fmtNumber(reviews.length)})`;
  const all = $("reviews-all");
  all.replaceChildren(...reviews.map(reviewNode));
}

// ---------- data ----------

async function fetchAllReviews(sellerId, expectedTotal, isStale) {
  const reviews = [];
  for (let page = 0; page < MAX_REVIEW_PAGES; page++) {
    if (isStale()) return null;
    const { body } = await request(
      `${API}/users/${sellerId}/reviews?init=${page * REVIEWS_PAGE_SIZE}`
    );
    if (!Array.isArray(body)) break;
    reviews.push(...body);
    if (body.length < REVIEWS_PAGE_SIZE) break;
    if (expectedTotal && reviews.length >= expectedTotal) break;
  }
  const truncated = expectedTotal > reviews.length;
  return { reviews, truncated };
}

async function lookup(rawText) {
  const url = extractWallapopUrl(rawText);
  if (!url) {
    currentLookup++;
    resultEl.hidden = true;
    setLoading(false);
    setStatus(
      "Eso no parece un enlace de Wallapop. Copia el enlace de un anuncio (…/item/…) o de un perfil (…/user/…).",
      true
    );
    input.focus();
    return;
  }

  const lookupId = ++currentLookup;
  const isStale = () => lookupId !== currentLookup;

  const pageUrl = new URL(location.href);
  pageUrl.searchParams.set("url", url);
  history.replaceState(null, "", pageUrl);

  resultEl.hidden = true;
  setLoading(true);
  setStatus("Buscando al vendedor…");

  try {
    const { body: resolved } = await request(
      `/api/resolve?url=${encodeURIComponent(url)}`
    );
    if (isStale()) return;
    if (!resolved?.sellerId) {
      throw new LookupError("No se ha encontrado al vendedor.");
    }
    const id = encodeURIComponent(resolved.sellerId);

    setStatus("Leyendo su perfil…");
    const [{ body: profile }, { body: stats }] = await Promise.all([
      request(`${API}/users/${id}`, "Este usuario ya no existe en Wallapop."),
      request(`${API}/users/${id}/stats`, "Este usuario ya no existe en Wallapop."),
    ]);
    if (isStale()) return;

    renderItem(resolved.item);
    renderSeller(profile);
    renderStats(stats);
    $("reviews-status").textContent = "Cargando reseñas…";
    $("reviews-dist").replaceChildren();
    $("reviews-bad").replaceChildren();
    $("reviews-all-wrap").hidden = true;
    resultEl.hidden = false;
    setStatus("");
    setLoading(false);

    const expected =
      (stats.counters ?? []).find((c) => c.type === "reviews")?.value ?? 0;
    try {
      const result = await fetchAllReviews(id, expected, isStale);
      if (!result || isStale()) return;
      renderReviews(result.reviews, expected, result.truncated);
    } catch (err) {
      if (isStale()) return;
      $("reviews-status").textContent =
        "No se han podido cargar las reseñas: " + (err.message || "error desconocido");
    }
  } catch (err) {
    if (isStale()) return;
    setStatus(
      err instanceof LookupError ? err.message : "Algo ha fallado. Inténtalo otra vez.",
      true
    );
  } finally {
    if (!isStale()) setLoading(false);
  }
}

// ---------- events ----------

form.addEventListener("submit", (event) => {
  event.preventDefault();
  lookup(input.value);
});

// Pasting a link is the whole workflow, so look it up straight away.
input.addEventListener("paste", () => {
  setTimeout(() => {
    if (extractWallapopUrl(input.value)) lookup(input.value);
  }, 0);
});

if (navigator.clipboard?.readText) {
  pasteBtn.hidden = false;
  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      input.value = text.trim();
      lookup(input.value);
    } catch {
      setStatus("El navegador no deja leer el portapapeles. Pega el enlace a mano.", true);
      input.focus();
    }
  });
}

const initialUrl = new URL(location.href).searchParams.get("url");
if (initialUrl) {
  input.value = initialUrl;
  lookup(initialUrl);
}
