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
  // Admin auth
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
  // Accept canonical identifiers
  // ------------------------------------------------------------
  const programId = String(
    body.location_id || body.program_id || ""
  ).trim();

  // ------------------------------------------------------------
  // Accept canonical mode fields
  // ------------------------------------------------------------
  const modeRaw = String(
    body.run_mode || body.mode || body.program_run_mode || ""
  ).trim().toLowerCase();

  const mode = (modeRaw === "auto" || modeRaw === "manual") ? modeRaw : "";

  if (!programId || !mode) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error: "location_id and run_mode required (run_mode must be 'auto' or 'manual')",
          received: Object.keys(body)
        },
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

  return new Response(JSON.stringify({ ok: true, location_id: programId, run_mode: mode }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

