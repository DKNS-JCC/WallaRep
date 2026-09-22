// Cloudflare Pages Function: GET /api/resolve?url=<wallapop item url>
//
// The only job of this function is to turn a Wallapop item URL into the
// seller's public user ID. Wallapop's item page is server-rendered and
// embeds that ID in a __NEXT_DATA__ JSON blob, but the HTML page itself
// has no CORS headers, so the browser can't read it cross-origin. Every
// other call (seller profile, seller stats) has open CORS and is made
// directly by the browser against api.wallapop.com — this function never
// sees or returns reputation data, only the opaque seller ID.
//
// Stateless: nothing is logged, cached, or persisted.

const ALLOWED_HOST = /(^|\.)wallapop\.com$/i;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const target = requestUrl.searchParams.get("url");

  if (!target) {
    return jsonResponse({ error: "Falta el parámetro 'url'." }, 400);
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return jsonResponse({ error: "La URL no es válida." }, 400);
  }

  if (parsed.protocol !== "https:" || !ALLOWED_HOST.test(parsed.hostname)) {
    return jsonResponse(
      { error: "Solo se admiten enlaces de wallapop.com." },
      400
    );
  }

  if (!/^\/item\//i.test(parsed.pathname)) {
    return jsonResponse(
      { error: "El enlace no parece ser el de un anuncio (falta /item/)." },
      400
    );
  }

  let pageResponse;
  try {
    pageResponse = await fetch(parsed.toString(), {
      headers: {
        "user-agent":
          "WallaRepBot/1.0 (+https://github.com/; herramienta de consulta de reputacion publica de Wallapop)",
        accept: "text/html",
      },
      redirect: "follow",
    });
  } catch {
    return jsonResponse(
      { error: "No se ha podido contactar con Wallapop." },
      502
    );
  }

  if (pageResponse.status === 404) {
    return jsonResponse(
      { error: "El anuncio no existe o ya no está disponible." },
      404
    );
  }

  if (!pageResponse.ok) {
    return jsonResponse(
      { error: "Wallapop ha devuelto un error al pedir el anuncio." },
      502
    );
  }

  const html = await pageResponse.text();
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );

  if (!match) {
    return jsonResponse(
      { error: "No se ha podido leer la información del anuncio." },
      502
    );
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return jsonResponse(
      { error: "La información del anuncio tiene un formato inesperado." },
      502
    );
  }

  const pageProps = data?.props?.pageProps;
  const sellerId = pageProps?.itemSeller?.id;
  const itemTitle =
    pageProps?.item?.title?.original ?? pageProps?.item?.title ?? null;

  if (!sellerId) {
    return jsonResponse(
      { error: "No se ha encontrado al vendedor de este anuncio." },
      404
    );
  }

  return jsonResponse({ sellerId, itemTitle: itemTitle ?? null });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
