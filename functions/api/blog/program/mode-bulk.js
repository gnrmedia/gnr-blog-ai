import { requireAdmin, setProgramModeBulk } from "../../blog-handlers.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;

  let body = {};
  try { body = await request.json(); } catch (_) {}

  // Normalize incoming bulk updates to canonical lowercase 'auto'|'manual'
  const updatesIn = body.updates || {};
  const updates = {};

  for (const [programId, modeVal] of Object.entries(updatesIn)) {
    const m = String(modeVal || "").trim().toLowerCase();
    if (m === "auto" || m === "manual") updates[String(programId).trim()] = m;
  }

  if (Object.keys(updates).length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "No valid updates (must be 'auto' or 'manual')" }, null, 2), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const result = await setProgramModeBulk(context, updates);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, ...result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
