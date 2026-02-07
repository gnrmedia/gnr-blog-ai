// Repo: gnr-blog-ai
// File: functions/api/blog/draft/get/[draft_id].js

import { requireAdmin, getDraftById } from "../../_lib/blog-handlers.js";

export async function onRequest(context) {
  const { request, params } = context;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // Worker router does NOT populate context.params. Extract draft_id from URL path.
  // Expected path: /api/blog/draft/get/<draft_id>
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const draftid = String(parts[parts.length - 1] || "").trim();

  if (!draftid) {
    return new Response(JSON.stringify({ ok: false, error: "draft_id required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }


  // IMPORTANT: getDraftById() already returns a Response (jsonResponse).
  // Do NOT wrap it again.
  return await getDraftById(context, draftid);
}
