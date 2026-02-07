import { requireAdmin, createReviewLink } from "../_lib/blog-handlers.js";


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

  const draftid = String(body.draft_id || "").trim();
  const clientemail = String(body.client_email || "").trim() || null;

  if (!draftid) {
    return new Response(JSON.stringify({ ok: false, error: "draft_id required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const result = await createReviewLink(context, draftid, clientemail);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, ...result }, null, 2), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}