import { requireAdmin, getDraftById } from "../../../blog-handlers.js";

export async function onRequest(context) {
    const { request, params } = context;

  if (request.method !== "GET") {
        return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
                status: 405,
                headers: { "content-type": "application/json; charset=utf-8" },
        });
  }

  const admin = requireAdmin(context);
    if (admin instanceof Response) return admin;

  const draftid = String(params.draft_id || "").trim();
    if (!draftid) {
          return new Response(JSON.stringify({ ok: false, error: "draft_id required" }), {
                  status: 400,
                  headers: { "content-type": "application/json; charset=utf-8" },
          });
    }

  // IMPORTANT:
  // getDraftById() already returns a Response via jsonResponse().
  // Do NOT wrap it again, or the UI will get nested JSON / wrong shape.
  return await getDraftById(context, draftid);
}
