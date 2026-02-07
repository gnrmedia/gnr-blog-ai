// functions/api/blog/draft/generate-ai.js
import { requireAdmin, generateAiForDraft } from "../_lib/blog-handlers.js";


// POST handler (Pages Functions expects method-specific exports)
export async function onRequestPost(context) {
  const { request } = context;

  // Admin guard (Cloudflare Access)
  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;

  // Body
  let body = {};
  try { body = await request.json(); } catch (_) {}

  const draft_id = String(body.draft_id || "").trim();
  if (!draft_id) {
    return new Response(JSON.stringify({ ok: false, error: "draft_id required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // Options
  const forceRaw = body.force;
  const force =
    forceRaw === true ||
    String(forceRaw || "").trim().toLowerCase() === "true" ||
    String(forceRaw || "").trim() === "1";

  const override_prompt = String(body.override_prompt || "").trim() || null;

  // Call shared handler
  const result = await generateAiForDraft(context, draft_id, { force, override_prompt });

  // Allow handler to return a Response OR a plain object
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, ...result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Optional: explicit GET handler (helps debugging in-browser)
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: false, error: "Use POST" }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
