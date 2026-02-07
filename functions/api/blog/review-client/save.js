import { jsonResponse, saveReviewEdits } from "../blog-handlers.js";

// POST /api/blog/review-client/save
// body: { token, content_markdown }
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
  const content = String(body.content_markdown || "").trim();

  if (!token || !content) {
    return jsonResponse(context, { ok: false, error: "token and content_markdown required" }, 400);
  }

  // Token auth should be enforced inside saveReviewEdits via lookup+expiry checks
  const result = await saveReviewEdits(context, token, content, body.follow || {});
  if (result instanceof Response) return result;

  return jsonResponse(context, { ok: true, ...result }, 200);
}
