// functions/api/blog/draft/generate-ai.js
import { requireAdmin, generateAiForDraft } from "../blog-handlers.js";

export async function onRequest(context) {
  const { request } = context;

  // Only POST
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

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
