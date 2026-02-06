import { requireAdmin, setProgramMode } from "../../blog-handlers.js";

export async function onRequest(context) {
  const { request } = context;

  // ------------------------------------------------------------
  // Method guard
  // ------------------------------------------------------------
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }, null, 2), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // ------------------------------------------------------------
  // Admin auth (Access or x-provision-shared-secret fallback)
  // ------------------------------------------------------------
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;

  // ------------------------------------------------------------
  // Parse JSON body
  // ------------------------------------------------------------
  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  // ------------------------------------------------------------
  // Accept BOTH identifiers:
  // - location_id (Admin UI canonical)
  // - program_id  (legacy / internal)
  // ------------------------------------------------------------
  const programId = String(body.location_id || body.program_id || "").trim();

  // Normalize mode to canonical lowercase
  const modeRaw = String(body.mode || "").trim().toLowerCase();
  const mode = modeRaw === "auto" || modeRaw === "manual" ? modeRaw : "";

  if (!programId || !mode) {
    return new Response(
      JSON.stringify(
        { ok: false, error: "location_id (or program_id) and mode required (mode must be 'auto' or 'manual')" },
        null,
        2
      ),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  // ------------------------------------------------------------
  // Persist mode
  // ------------------------------------------------------------
  const result = await setProgramMode(context, programId, mode);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, ...result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
