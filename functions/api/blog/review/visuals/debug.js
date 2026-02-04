import { requireAdmin, getReviewVisualsDebug } from "../../../../blog-handlers.js";

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "token query param required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const result = await getReviewVisualsDebug(context, token);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, debug: result }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}