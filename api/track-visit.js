import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mjjxqhgxoafgjhyukvpm.supabase.co";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function serverKey() {
  const environment = globalThis.process?.env || {};
  return environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY || "";
}

export function GET() {
  return json({ configured: Boolean(serverKey()) });
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ error: "Origen no permitido." }, 403);
  }

  if (!serverKey()) {
    return json({ error: "El registro de visitas no está configurado." }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1024) return json({ error: "Solicitud demasiado grande." }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitud no válida." }, 400);
  }

  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    return json({ error: "Identificador de sesión no válido." }, 400);
  }

  const countryHeader = request.headers.get("x-vercel-ip-country") || "";
  const countryCode = /^[A-Z]{2}$/.test(countryHeader.toUpperCase())
    ? countryHeader.toUpperCase()
    : "XX";
  const sessionHash = createHash("sha256").update(sessionId).digest("hex");
  const supabaseAdmin = createClient(SUPABASE_URL, serverKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabaseAdmin.from("site_visit_sessions").insert({
    session_hash: sessionHash,
    country_code: countryCode,
  });

  if (error && error.code !== "23505") {
    return json({ error: "No se pudo registrar la visita." }, 500);
  }

  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
