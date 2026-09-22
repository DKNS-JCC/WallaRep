// Builds peers.json: a small statistical model of how many reports
// (reports_received) a Wallapop seller usually has given their activity, so
// the app can say "normal for this profile" or "above normal" instead of
// showing a bare number.
//
// Usage:
//   node scripts/build-peers.mjs            sample Wallapop, then fit
//   node scripts/build-peers.mjs --refit    fit again from the cached sample
//   node scripts/build-peers.mjs --extend   add sellers found with PRO_KEYWORDS
//                                           to the cached sample, then fit
//
// Model: ordinary least squares on log(1 + reports) with
//   log(1 + sells), log(1 + reviews), is_professional, account age in years.
// Buys and active listings were tested and add nothing once sells are in.
// The residuals are kept as percentiles, split by predicted activity level
// (their spread is not constant), so the app can place a seller among peers.
// 20% of sellers is held out to check the percentiles are calibrated.
//
// The raw sample (with user IDs) stays in .cache/, which is not committed.
// peers.json only holds coefficients and percentiles.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const KEYWORDS = [
  "iphone", "samsung", "movil", "portatil", "tablet", "ps5", "nintendo switch",
  "camara", "auriculares", "reloj", "bicicleta", "patinete", "coche", "moto",
  "sofa", "mesa", "silla", "lampara", "zapatillas", "chaqueta", "vestido",
  "bolso", "perfume", "ropa bebe", "carrito bebe", "lego", "cromos", "libro",
  "vinilo", "guitarra", "taladro", "entradas concierto", "tarjeta grafica",
  "cafetera", "raqueta padel",
];
// Categories where professional sellers are common. Professionals are a
// minority in general searches, which made their estimates the least precise.
const PRO_KEYWORDS = [
  "iphone reacondicionado", "movil reacondicionado", "portatil reacondicionado",
  "pantalla movil", "reparacion movil", "funda movil", "cargador",
  "recambios coche", "neumaticos", "llantas", "faros coche", "piezas moto",
  "coche segunda mano", "furgoneta", "moto segunda mano", "bicicleta electrica",
  "patinete electrico", "lavadora", "frigorifico", "televisor", "aire acondicionado",
  "colchon nuevo", "muebles", "lote ropa", "zapatillas originales", "sneakers",
  "cartas pokemon", "joyas oro", "reloj lujo", "herramientas profesionales",
  "maquinaria", "material oficina", "impresora 3d", "componentes pc",
  "videojuegos retro",
];
const CITIES = [
  [40.4168, -3.7038], // Madrid
  [41.3874, 2.1686], // Barcelona
  [39.4699, -0.3763], // Valencia
  [37.3891, -5.9845], // Sevilla
  [43.263, -2.935], // Bilbao
];
const BANDS = 3;
const HOLDOUT = 0.2;

const API = "https://api.wallapop.com/api/v3";
const CACHE = new URL("../.cache/peers-sample.json", import.meta.url);
const OUT = new URL("../peers.json", import.meta.url);
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "X-DeviceOS": "0", Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function sample(keywords, known = new Set()) {
  const userIds = new Set();
  for (const keyword of keywords) {
    for (const [lat, lon] of CITIES) {
      try {
        const data = await getJson(
          `${API}/search?keywords=${encodeURIComponent(keyword)}` +
            `&latitude=${lat}&longitude=${lon}&source=search_box`
        );
        for (const item of data?.data?.section?.payload?.items ?? []) {
          if (!known.has(item.user_id)) userIds.add(item.user_id);
        }
      } catch (err) {
        console.error("search failed:", err.message);
      }
      await sleep(100);
    }
  }
  console.error(`new sellers found: ${userIds.size}`);

  const queue = [...userIds];
  const sellers = [];
  async function worker() {
    while (queue.length) {
      const id = queue.pop();
      try {
        const [profile, stats] = await Promise.all([
          getJson(`${API}/users/${id}`),
          getJson(`${API}/users/${id}/stats`),
        ]);
        const c = Object.fromEntries(
          (stats.counters ?? []).map((x) => [x.type, x.value])
        );
        if (typeof c.reports_received !== "number" || !profile.register_date) {
          continue;
        }
        const type = profile.seller_type?.type;
        sellers.push({
          id,
          pro: Boolean(type && type !== "Private"),
          sells: c.sells ?? 0,
          reviews: c.reviews ?? 0,
          registerDate: profile.register_date,
          reports: c.reports_received,
        });
        if (sellers.length % 200 === 0) console.error(`profiles: ${sellers.length}`);
      } catch (err) {
        console.error("user failed:", err.message);
      }
      await sleep(80);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  return sellers;
}

// Must match featuresOf() in app.js.
function features(s, now) {
  return [
    1,
    Math.log1p(s.sells),
    Math.log1p(s.reviews),
    s.pro ? 1 : 0,
    Math.max(0, (now - s.registerDate) / YEAR_MS),
  ];
}
const FEATURE_NAMES = ["const", "log1p_sells", "log1p_reviews", "pro", "years"];

function ols(X, y) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => Array(k + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      A[a][k] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) A[a][b] += X[i][a] * X[i][b];
    }
  }
  // Gauss-Jordan on the normal equations.
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    const v = A[i][i];
    for (let j = i; j <= k; j++) A[i][j] /= v;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r][i];
      for (let j = i; j <= k; j++) A[r][j] -= f * A[i][j];
    }
  }
  return A.map((row) => row[k]);
}

const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return Array.from({ length: 101 }, (_, p) => {
    const pos = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  });
}

function fit(sellers, now) {
  const X = sellers.map((s) => features(s, now));
  const y = sellers.map((s) => Math.log1p(s.reports));
  const coef = ols(X, y);
  const pred = X.map((x) => dot(coef, x));
  const resid = y.map((v, i) => v - pred[i]);

  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const r2 =
    1 -
    resid.reduce((s, r) => s + r * r, 0) /
      y.reduce((s, v) => s + (v - mean) ** 2, 0);

  // Split by predicted value into bands of equal size.
  const order = pred.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const bands = [];
  for (let b = 0; b < BANDS; b++) {
    const slice = order.slice(
      Math.floor((b * order.length) / BANDS),
      Math.floor(((b + 1) * order.length) / BANDS)
    );
    bands.push({
      maxPred: b === BANDS - 1 ? null : slice[slice.length - 1][0],
      n: slice.length,
      residuals: percentiles(slice.map(([, i]) => resid[i])).map(
        (v) => Math.round(v * 1000) / 1000
      ),
    });
  }
  return { coef, r2, bands };
}

// Same logic as the app (assessReports): the share of similar sellers with
// fewer reports than this one, counting ties as half.
function percentileOf(model, s, now) {
  const pred = dot(model.coef, features(s, now));
  const band = model.bands.find((b) => b.maxPred == null || pred <= b.maxPred);
  const q = band.residuals;
  const resid = Math.log1p(s.reports) - pred;
  const below = q.filter((v) => v < resid).length;
  const equal = q.filter((v) => v === resid).length;
  return {
    percentile: (100 * (below + equal / 2)) / q.length,
    typical: Math.max(0, Math.round(Math.expm1(pred + q[50]))),
  };
}

// Same rule as reportsVerdict() in app.js.
const MIN_REPORTS_GAP = 3;
function verdict({ percentile, typical }, reports) {
  const gap = reports - typical;
  if (percentile > 75 && gap >= MIN_REPORTS_GAP) return percentile > 90 ? "high" : "above";
  if (percentile < 25 && -gap >= MIN_REPORTS_GAP) return "below";
  return "normal";
}

let data;
if (process.argv.includes("--refit")) {
  data = JSON.parse(readFileSync(CACHE, "utf8"));
} else {
  const cached = process.argv.includes("--extend")
    ? JSON.parse(readFileSync(CACHE, "utf8"))
    : { sellers: [] };
  const known = new Set(cached.sellers.map((s) => s.id));
  const found = await sample(
    cached.sellers.length ? PRO_KEYWORDS : [...KEYWORDS, ...PRO_KEYWORDS],
    known
  );
  data = { sampledAt: Date.now(), sellers: [...cached.sellers, ...found] };
  mkdirSync(new URL("../.cache/", import.meta.url), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(data));
}
const now = data.sampledAt;
const sellers = data.sellers;
console.error(
  `professionals: ${sellers.filter((s) => s.pro).length} of ${sellers.length}`
);

// Deterministic holdout split by ID so refits are comparable.
const hash = (str) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const test = sellers.filter((s) => hash(s.id) % 100 < HOLDOUT * 100);
const train = sellers.filter((s) => hash(s.id) % 100 >= HOLDOUT * 100);

const trial = fit(train, now);
const placed = test.map((s) => percentileOf(trial, s, now));
const pcts = placed.map((p) => p.percentile);
const verdicts = placed.map((p, i) => verdict(p, test[i].reports));
const share = (f) => `${((100 * pcts.filter(f).length) / pcts.length).toFixed(0)}%`;
const vshare = (v) =>
  `${((100 * verdicts.filter((x) => x === v).length) / verdicts.length).toFixed(0)}%`;

const model = fit(sellers, now);
console.error(`sellers: ${sellers.length}, R² = ${model.r2.toFixed(2)}`);
FEATURE_NAMES.forEach((n, i) => console.error(`  ${n.padEnd(14)} ${model.coef[i].toFixed(3)}`));
console.error(
  `holdout (${test.length}), ideal 25/50/15/10: ` +
    `<p25 ${share((p) => p < 25)}, p25–75 ${share((p) => p >= 25 && p <= 75)}, ` +
    `p75–90 ${share((p) => p > 75 && p <= 90)}, >p90 ${share((p) => p > 90)}`
);
console.error(
  `verdicts shown (min gap ${MIN_REPORTS_GAP}): below ${vshare("below")}, ` +
    `normal ${vshare("normal")}, above ${vshare("above")}, high ${vshare("high")}`
);
for (const b of model.bands) {
  console.error(`  band ≤${b.maxPred?.toFixed(2) ?? "∞"}: n=${b.n}`);
}

writeFileSync(
  OUT,
  JSON.stringify({
    generated: new Date(now).toISOString().slice(0, 10),
    sellers: sellers.length,
    r2: Math.round(model.r2 * 100) / 100,
    features: FEATURE_NAMES,
    coef: model.coef.map((v) => Math.round(v * 10000) / 10000),
    bands: model.bands,
  })
);
