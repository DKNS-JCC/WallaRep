// Cloudflare Pages Function: GET /api/resolve?url=<wallapop item or profile url>
//
// Turns a Wallapop item URL (/item/...) or profile URL (/user/...) into the
// seller's public user ID. Both pages are server-rendered and embed that ID
// in a __NEXT_DATA__ JSON blob, but the HTML has no CORS headers, so the
// browser can't read it cross-origin. Every other call (profile, stats,
// reviews) has open CORS and is made directly by the browser against
// api.wallapop.com — this function never sees reputation data.
//
// Stateless: nothing is logged, cached, or persisted.

const ALLOWED_HOST = /(^|\.)wallapop\.com$/i;
const PAGE_PATH = /\/(item|user)\/[^/?#]+/i;
const FETCH_TIMEOUT_MS = 10000;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function error(message, status) {
  return jsonResponse({ error: message }, status);
}

function parseTarget(raw) {
  let text = raw.trim();
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (!ALLOWED_HOST.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(PAGE_PATH);
  if (!match) return null;
  // Rebuild the URL ourselves: fixed host and scheme, no query string.
  return {
    kind: match[1].toLowerCase(),
    url: `https://es.wallapop.com${match[0]}`,
  };
}

function itemSummary(item) {
  if (!item) return null;
  const title = item.title?.original ?? item.title ?? null;
  const cash = item.price?.cash;
  return {
    title: typeof title === "string" ? title : null,
    price:
      cash && typeof cash.amount === "number"
        ? { amount: cash.amount, currency: cash.currency || "EUR" }
        : null,
    image: item.images?.[0]?.urls?.small ?? null,
    url: item.slug ? `https://es.wallapop.com/item/${item.slug}` : null,
    sold: Boolean(item.flags?.sold),
    reserved: Boolean(item.flags?.reserved),
  };
}

export async function onRequestGet(context) {
  const raw = new URL(context.request.url).searchParams.get("url");
  if (!raw) return error("Falta el enlace.", 400);

  const target = parseTarget(raw);
  if (!target) {
    return error(
      "Ese enlace no es de un anuncio ni de un perfil de Wallapop.",
      400
    );
  }

  let page;
  try {
    page = await fetch(target.url, {
      headers: { "user-agent": "WallaRep/1.0", accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return error("Wallapop no responde. Prueba otra vez en un momento.", 504);
  }

  if (page.status === 404 || page.status === 410) {
    return error(
      target.kind === "item"
        ? "Ese anuncio no existe o ya se ha borrado."
        : "Ese perfil no existe o se ha dado de baja.",
      404
    );
  }
  if (page.status === 429 || page.status === 403) {
    return error(
      "Wallapop está limitando las consultas. Espera un poco y vuelve a probar.",
      503
    );
  }
  if (!page.ok) {
    return error(`Wallapop ha respondido con un error (${page.status}).`, 502);
  }

  const html = await page.text();
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  let pageProps;
  try {
    pageProps = JSON.parse(match[1])?.props?.pageProps;
  } catch {
    pageProps = null;
  }
  if (!pageProps) {
    return error(
      "Wallapop ha cambiado su web y ya no se puede leer. Hay que actualizar WallaRep.",
      502
    );
  }

  const sellerId =
    target.kind === "item" ? pageProps.itemSeller?.id : pageProps.user?.id;
  if (!sellerId) {
    return error(
      target.kind === "item"
        ? "Ese anuncio no existe o ya se ha borrado."
        : "Ese perfil no existe o se ha dado de baja.",
      404
    );
  }

  return jsonResponse({
    sellerId,
    item: target.kind === "item" ? itemSummary(pageProps.item) : null,
  });
}
