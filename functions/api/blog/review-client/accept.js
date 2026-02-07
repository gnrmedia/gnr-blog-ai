import { jsonResponse, acceptReview } from "../blog-handlers.js";

// POST /api/blog/review-client/accept
// body: { token }
export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return jsonResponse(context, { ok: true }, 200);
  }

  if (request.method !== "POST") {
    return jsonResponse(context, { ok: false, error: "Method not allowed" }, 405);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const token = String(body.token || "").trim();
  if (!token) {
    return jsonResponse(context, { ok: false, error: "token required" }, 400);
  }

  const result = await acceptReview(context, token, body.follow || {});
  if (result instanceof Response) return result;

  return jsonResponse(context, { ok: true, ...result }, 200);
}
