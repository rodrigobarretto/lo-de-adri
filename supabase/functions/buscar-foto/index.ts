// =====================================================================
//  LO DE ADRI — función "buscar-foto"
//  Busca en internet tapas y una descripción breve de una publicación,
//  y trae la foto elegida para que la app la achique y la guarde.
//  Solo la puede usar la cuenta del puesto (cuenta autorizada).
//  Necesita el secreto SERPAPI_KEY (SerpApi, plan gratis sin tarjeta)
//  o, como alternativa, BRAVE_API_KEY.
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Saca etiquetas HTML y entidades de los textos de Brave
function limpiar(texto: string): string {
  return String(texto || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Recorta a ~240 caracteres terminando en una oración si se puede
function resumir(texto: string, max = 240): string {
  const t = limpiar(texto);
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const punto = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("! "), corte.lastIndexOf("? "));
  return (punto > 80 ? corte.slice(0, punto + 1) : corte.replace(/\s+\S*$/, "") + "…").trim();
}

// Evita que se use para entrar a direcciones internas
function urlPermitida(u: string): URL | null {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const h = url.hostname;
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h)) return null;
    if (h.includes(":")) return null; // IPv6 literal
    return url;
  } catch {
    return null;
  }
}

// Sitios de editoriales, tiendas y medios: sus descripciones suelen ser mejores
const PREFERIDOS = [
  "mercadolibre", "clarin", "lanacion", "editorialatlantida", "atlantida", "perfil", "panini",
  "planeta", "salvat", "rba", "disney", "cuspide", "yenny", "elateneo", "tematika", "buscalibre",
  "ivrea", "edicionesdelaflor", "billiken", "kioscoclarin", "kiosco", "editorial",
];

function puntaje(host: string): number {
  const h = (host || "").toLowerCase();
  let p = 0;
  if (h.endsWith(".ar") || h.includes(".com.ar")) p += 2;
  if (PREFERIDOS.some((x) => h.includes(x))) p += 3;
  if (h.includes("wikipedia")) p += 1;
  if (h.includes("pinterest") || h.includes("facebook") || h.includes("instagram") || h.includes("tiktok")) p -= 3;
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "METODO" }, 405);

  // 1) Solo la cuenta del puesto
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: autorizado } = await sb.rpc("es_autorizado");
  if (!autorizado) return json({ error: "SIN_PERMISO" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* vacío */ }

  // 2) Traer la foto elegida (la app la achica y la guarda)
  if (typeof body.descargar === "string") {
    const url = urlPermitida(body.descargar);
    if (!url) return json({ error: "URL_INVALIDA" }, 400);
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LoDeAdri/1.0)", "Accept": "image/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      const tipo = r.headers.get("content-type") || "";
      if (!r.ok || !tipo.startsWith("image/")) return json({ error: "NO_ES_IMAGEN" }, 422);
      const datos = new Uint8Array(await r.arrayBuffer());
      if (datos.byteLength > 10 * 1024 * 1024) return json({ error: "MUY_PESADA" }, 413);
      return new Response(datos, { headers: { ...CORS, "Content-Type": "application/octet-stream" } });
    } catch {
      return json({ error: "NO_SE_PUDO_DESCARGAR" }, 502);
    }
  }

  // 3) Buscar tapas y descripciones
  //    Usa SerpApi (plan gratis, sin tarjeta) si está SERPAPI_KEY; si no, Brave (BRAVE_API_KEY).
  const q = String(body.q || "").trim().slice(0, 150);
  if (q.length < 2) return json({ error: "FALTA_TITULO" }, 400);
  const claveSerp = Deno.env.get("SERPAPI_KEY");
  const claveBrave = Deno.env.get("BRAVE_API_KEY");
  if (!claveSerp && !claveBrave) return json({ error: "FALTA_CLAVE_BUSQUEDA" }, 500);

  // deno-lint-ignore no-explicit-any
  let crudasImg: any[] = [];
  // deno-lint-ignore no-explicit-any
  let crudasWeb: any[] = [];

  if (claveSerp) {
    // Una sola búsqueda de Google trae descripciones y algunas fotos;
    // solo si trae pocas fotos se hace una segunda búsqueda de imágenes (cuida el cupo gratis).
    const base = { api_key: claveSerp, gl: "ar", hl: "es", google_domain: "google.com.ar" };
    const pedir = (p: Record<string, string>) =>
      fetch("https://serpapi.com/search.json?" + new URLSearchParams({ ...base, ...p }), { signal: AbortSignal.timeout(15000) })
        .then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const g: any = await pedir({ engine: "google", q, num: "10" });
    crudasWeb = (g.organic_results || []).map((r: { snippet?: string; displayed_link?: string; link?: string }) => ({
      description: r.snippet || "",
      meta_url: { hostname: (() => { try { return new URL(r.link || "").hostname; } catch { return r.displayed_link || ""; } })() },
    }));
    // deno-lint-ignore no-explicit-any
    const enLinea = (g.inline_images || []).map((im: any) => ({
      properties: { url: im.original || "", width: im.original_width, height: im.original_height },
      thumbnail: { src: im.thumbnail || "" },
      meta_url: { hostname: im.source_name || im.source || "" },
      title: im.title || "",
    })).filter((x: { properties: { url: string } }) => x.properties.url);
    crudasImg = enLinea;
    if (enLinea.length < 6) {
      // deno-lint-ignore no-explicit-any
      const gi: any = await pedir({ engine: "google_images", q: q + " tapa" });
      // deno-lint-ignore no-explicit-any
      crudasImg = enLinea.concat((gi.images_results || []).slice(0, 16).map((im: any) => ({
        properties: { url: im.original || "", width: im.original_width, height: im.original_height },
        thumbnail: { src: im.thumbnail || "" },
        meta_url: { hostname: (() => { try { return new URL(im.link || "").hostname; } catch { return im.source || ""; } })() },
        title: im.title || "",
      })));
    }
  } else {
    const cabeceras = { "Accept": "application/json", "X-Subscription-Token": claveBrave! };
    const [img, web] = await Promise.all([
      fetch(
        "https://api.search.brave.com/res/v1/images/search?" +
          new URLSearchParams({ q: q + " tapa", country: "AR", search_lang: "es", count: "16", safesearch: "strict" }),
        { headers: cabeceras, signal: AbortSignal.timeout(12000) },
      ).then((r) => (r.ok ? r.json() : { results: [] })).catch(() => ({ results: [] })),
      fetch(
        "https://api.search.brave.com/res/v1/web/search?" +
          new URLSearchParams({ q, country: "AR", search_lang: "es", count: "10", safesearch: "moderate" }),
        { headers: cabeceras, signal: AbortSignal.timeout(12000) },
      ).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    // deno-lint-ignore no-explicit-any
    crudasImg = (img as any).results || [];
    // deno-lint-ignore no-explicit-any
    crudasWeb = ((web as any).web || {}).results || [];
  }

  // Imágenes: preferimos tapas verticales y de buen tamaño
  const imagenes = crudasImg
    // deno-lint-ignore no-explicit-any
    .map((r: any) => ({
      url: r?.properties?.url || "",
      miniatura: r?.thumbnail?.src || r?.properties?.url || "",
      fuente: r?.meta_url?.hostname || r?.source || "",
      titulo: limpiar(r?.title || ""),
      ancho: Number(r?.properties?.width) || 0,
      alto: Number(r?.properties?.height) || 0,
    }))
    // deno-lint-ignore no-explicit-any
    .filter((x: any) => x.url && x.miniatura && urlPermitida(x.url))
    // deno-lint-ignore no-explicit-any
    .map((x: any) => {
      const vertical = x.alto && x.ancho ? x.alto / x.ancho : 1;
      let p = puntaje(x.fuente);
      if (vertical > 1.15 && vertical < 1.7) p += 2; // forma de tapa
      if (x.ancho && x.ancho < 300) p -= 2; // muy chica
      return { ...x, p };
    })
    // deno-lint-ignore no-explicit-any
    .sort((a: any, b: any) => b.p - a.p)
    .slice(0, 9)
    // deno-lint-ignore no-explicit-any
    .map(({ p: _p, ...x }: any) => x);

  // Descripciones: textos cortos de editoriales, tiendas y medios
  // deno-lint-ignore no-explicit-any
  const vistos = new Set<string>();
  // deno-lint-ignore no-explicit-any
  const descripciones = crudasWeb
    // deno-lint-ignore no-explicit-any
    .map((r: any) => {
      const host = r?.meta_url?.hostname || "";
      const extra = Array.isArray(r?.extra_snippets) ? r.extra_snippets.join(" ") : "";
      const largo = limpiar(r?.description || "").length > 60 ? r.description : (r?.description || "") + " " + extra;
      return { texto: resumir(largo), fuente: host, p: puntaje(host) };
    })
    // deno-lint-ignore no-explicit-any
    .filter((d: any) => {
      if (d.texto.length < 40 || vistos.has(d.texto)) return false;
      vistos.add(d.texto);
      return true;
    })
    // deno-lint-ignore no-explicit-any
    .sort((a: any, b: any) => b.p - a.p)
    .slice(0, 4)
    // deno-lint-ignore no-explicit-any
    .map(({ p: _p, ...d }: any) => d);

  return json({ imagenes, descripciones });
});
