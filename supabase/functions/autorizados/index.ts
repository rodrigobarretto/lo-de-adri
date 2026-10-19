// =====================================================================
//  LO DE ADRI — función "autorizados"
//  Maneja las personas que pueden usar la app del puesto (vender, dar de
//  baja, cargar, etc.). Cada una entra con su teléfono y una clave.
//  Solo la puede usar alguien que ya está autorizado.
//  Usa la clave de servicio que Supabase pone sola (no va en la app).
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

// Mismo criterio que la app: los últimos 10 dígitos (código de área + número)
function normalizarTelefono(t: unknown): string {
  const d = String(t || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

const correoDe = (tel: string) => `${tel}@tel.lodeadri.app`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "METODO" }, 405);

  // 1) Quién llama: tiene que estar autorizado
  const auth = req.headers.get("Authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: quien } = await comoUsuario.auth.getUser();
  const { data: autorizado } = await comoUsuario.rpc("es_autorizado");
  if (!quien?.user || !autorizado) return json({ error: "SIN_PERMISO" }, 403);
  const yo = quien.user.id;

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const accion = String(body.accion || "listar");

  const listar = async () => {
    const { data, error } = await admin.from("autorizados")
      .select("user_id, nombre, telefono, creado").order("creado", { ascending: true });
    if (error) throw error;
    return (data || []).map((a) => ({ ...a, soyYo: a.user_id === yo }));
  };

  try {
    if (accion === "listar") return json({ personas: await listar() });

    if (accion === "agregar") {
      const nombre = String(body.nombre || "").trim().slice(0, 40);
      const telefono = normalizarTelefono(body.telefono);
      const clave = String(body.clave || "");
      if (!nombre) return json({ error: "FALTA_NOMBRE" }, 400);
      if (telefono.length < 8) return json({ error: "TELEFONO_INVALIDO" }, 400);
      if (clave.length < 6) return json({ error: "CLAVE_CORTA" }, 400);

      const email = correoDe(telefono);
      let userId: string | null = null;
      const creado = await admin.auth.admin.createUser({
        email, password: clave, email_confirm: true, user_metadata: { nombre, telefono },
      });
      if (creado.error) {
        // Si ese teléfono ya tenía cuenta (por ejemplo, la habían quitado), se reutiliza
        if (!/already|registered|exists/i.test(creado.error.message)) throw creado.error;
        const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existente = lista?.users.find((u) => u.email === email);
        if (!existente) throw creado.error;
        userId = existente.id;
        const upd = await admin.auth.admin.updateUserById(userId, { password: clave, user_metadata: { nombre, telefono } });
        if (upd.error) throw upd.error;
      } else {
        userId = creado.data.user!.id;
      }
      const { error } = await admin.from("autorizados")
        .upsert({ user_id: userId, nombre, telefono }, { onConflict: "user_id" });
      if (error) throw error;
      return json({ personas: await listar() });
    }

    if (accion === "clave") {
      const userId = String(body.user_id || "");
      const clave = String(body.clave || "");
      if (clave.length < 6) return json({ error: "CLAVE_CORTA" }, 400);
      const { data: fila } = await admin.from("autorizados").select("user_id, telefono").eq("user_id", userId).maybeSingle();
      if (!fila || !fila.telefono) return json({ error: "NO_EXISTE" }, 404);
      const { error } = await admin.auth.admin.updateUserById(userId, { password: clave });
      if (error) throw error;
      return json({ personas: await listar() });
    }

    if (accion === "quitar") {
      const userId = String(body.user_id || "");
      if (userId === yo) return json({ error: "NO_A_VOS_MISMO" }, 400);
      const personas = await listar();
      const fila = personas.find((p) => p.user_id === userId);
      if (!fila) return json({ error: "NO_EXISTE" }, 404);
      if (personas.length <= 1) return json({ error: "ULTIMO_AUTORIZADO" }, 400);
      const { error } = await admin.from("autorizados").delete().eq("user_id", userId);
      if (error) throw error;
      // Las cuentas por teléfono se borran; la cuenta principal del puesto (con correo) solo pierde el permiso
      if (fila.telefono) await admin.auth.admin.deleteUser(userId).catch(() => {});
      return json({ personas: await listar() });
    }

    return json({ error: "ACCION_INVALIDA" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "ERROR", detalle: String((e as Error)?.message || e) }, 500);
  }
});
