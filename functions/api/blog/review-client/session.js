import { jsonResponse, getReviewDebug } from "../blog-handlers.js";

// GET /api/blog/review-client/session?t=<token>
export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return jsonResponse(context, { ok: true }, 200);
  }

  if (request.method !== "GET") {
    return jsonResponse(context, { ok: false, error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const token = String(url.searchParams.get("t") || "").trim();
  if (!token) return jsonResponse(context, { ok: false, error: "token (t) required" }, 400);

  // Reuse your existing debug/session-style loader (should validate token + expiry)
  return getReviewDebug(context, token);
}
