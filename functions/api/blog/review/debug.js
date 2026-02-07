import { getReviewDebug, jsonResponse } from "../_lib/blog-handlers.js";

// GET /api/blog/review/debug?t=<token>
export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    // CORS preflight handled by framework; return OK
    return jsonResponse(context, { ok: true }, 200);
  }

  if (request.method !== "GET") {
    return jsonResponse(context, { ok: false, error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const t = String(url.searchParams.get("t") || "").trim();

  return getReviewDebug(context, t);
}
