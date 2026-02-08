import { requireAdmin, runAutoCadence } from "../../blog-handlers.js";

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

  const limit = parseInt(body.limit) || 25;

  const result = await runAutoCadence(context, limit);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({
    ok: true,
    ...result,
    ui_hints: {
      do_not_navigate: true,
      message: "Run completed. Stay on Admin page; open review links manually if needed."
    }
  }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

}