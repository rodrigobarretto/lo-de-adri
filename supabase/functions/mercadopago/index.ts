// =====================================================================
//  LO DE ADRI — función "mercadopago"
//  1) {accion:"link", rid}: arma el link de pago de Mercado Pago para una
//     reserva o pedido (seña o lo que falte). El monto lo calcula acá,
//     nunca lo manda el teléfono.
//  2) Aviso de Mercado Pago (?aviso=1): cuando alguien paga, Mercado Pago
//     avisa acá; se consulta el pago a Mercado Pago y, si está aprobado,
//     se anota el cobro solo.
//  Necesita el secreto MP_ACCESS_TOKEN (credencial de producción de la
//  cuenta de Mercado Pago del puesto). Sin eso responde FALTA_MP.
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const APP_URL = "https://rodrigobarretto.github.io/lo-de-adri/";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const token = Deno.env.get("MP_ACCESS_TOKEN");
  const url = new URL(req.url);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* vacío */ }

  // ---------- 2) Aviso de Mercado Pago ----------
  if (url.searchParams.get("aviso") === "1") {
    if (!token) return json({ ok: false });
    const tipo = url.searchParams.get("type") || url.searchParams.get("topic") || String(body.type || body.topic || "");
    // deno-lint-ignore no-explicit-any
    const datos = (body.data || {}) as any;
    const pagoId = url.searchParams.get("data.id") || url.searchParams.get("id") || String(datos.id || "");
    if (tipo !== "payment" || !/^\d+$/.test(pagoId)) return json({ ok: true, ignorado: true });

    const r = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return json({ ok: false }, 502);
    const pago = await r.json();
    const ref = String(pago.external_reference || "");
    const m = ref.match(/^r(\d+)$/);
    if (pago.status === "approved" && m) {
      await admin.rpc("registrar_cobro_mp", {
        rid: Number(m[1]),
        monto: Number(pago.transaction_amount) || 0,
        pago_id: String(pago.id),
      });
    }
    return json({ ok: true });
  }

  // ---------- 1) Crear el link de pago ----------
  if (req.method !== "POST") return json({ error: "METODO" }, 405);
  if (!token) return json({ error: "FALTA_MP" }, 503);
  const rid = Number(body.rid);
  if (!Number.isInteger(rid) || rid <= 0) return json({ error: "NO_EXISTE" }, 400);

  const { data: res } = await admin.from("reservas").select("*").eq("id", rid).maybeSingle();
  if (!res || !["pendiente", "activa"].includes(res.estado)) return json({ error: "NO_EXISTE" }, 404);
  const { data: prod } = await admin.from("productos").select("titulo").eq("id", res.producto_id).maybeSingle();
  const { data: aj } = await admin.from("ajustes").select("nombre").eq("id", 1).maybeSingle();

  const total = Number(res.total) || 0;
  const sena = Number(res.sena) || total;
  const cobrado = Number(res.cobrado) || 0;
  const monto = body.resto || cobrado >= sena ? total - cobrado : sena - cobrado;
  if (monto <= 0) return json({ error: "YA_PAGADO" }, 400);
  const queEs = res.tipo === "solicitud" ? "Pedido" : (cobrado >= sena || monto >= total ? "Reserva" : "Seña");

  const pref = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{
        title: `${queEs}: ${res.cantidad} × ${prod?.titulo || "publicación"}`.slice(0, 250),
        quantity: 1,
        unit_price: Math.round(monto * 100) / 100,
        currency_id: "ARS",
      }],
      payer: { name: res.cliente },
      external_reference: `r${rid}`,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago?aviso=1`,
      back_urls: {
        success: `${APP_URL}?catalogo&pago=ok`,
        pending: `${APP_URL}?catalogo&pago=pendiente`,
        failure: `${APP_URL}?catalogo&pago=error`,
      },
      auto_return: "approved",
      statement_descriptor: String(aj?.nombre || "Lo de Adri").slice(0, 22),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!pref.ok) {
    console.error(await pref.text());
    return json({ error: "MP_ERROR" }, 502);
  }
  const p = await pref.json();
  return json({ link: p.init_point, monto });
});
