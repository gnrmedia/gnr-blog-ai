import { jsonResponse, errorResponse } from "../_lib/blog-handlers.js";

// GET /api/blog/review/debug?t=<token>
export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "GET") {
    return jsonResponse(context, { ok: false, error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const t = String(url.searchParams.get("t") || "").trim();
  if (!t) return errorResponse(context, "token (t) required", 400);

  // IMPORTANT:
  // - blog-handlers.js getReviewRowByToken() already does:
  //   - hash compat (pepper/plain)
  //   - expiry check
  // We just reuse it via a tiny internal call.

  // Reuse the internal helper by calling saveReviewEdits(...) with no-op? No.
  // Instead, we call the internal helper by importing a dedicated export.
  // If you don't have an export yet, see NOTE below.

  return errorResponse(context, "debug handler not wired: export getReviewRowByTokenForDebug()", 500);
}
