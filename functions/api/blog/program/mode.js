import { requireAdmin, setProgramMode } from "../../blog-handlers.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const programid = String(body.program_id || "").trim();

  // Normalize mode to canonical lowercase
  const modeRaw = String(body.mode || "").trim().toLowerCase();
  const mode = (modeRaw === "auto" || modeRaw === "manual") ? modeRaw : "";

  if (!programid || !mode) {
    return new Response(JSON.stringify({ ok: false, error: "program_id and mode required (mode must be 'auto' or 'manual')" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const result = await setProgramMode(context, programid, mode);

  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, ...result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}