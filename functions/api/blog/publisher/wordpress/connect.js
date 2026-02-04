import { requireAdmin, wordpressConnect } from "../../../blog-handlers.js";

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

  if (!body.site_url || !body.username || !body.password) {
    return new Response(
      JSON.stringify({ ok: false, error: "site_url, username, and password required" }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  const result = await wordpressConnect(context, body);
  if (result instanceof Response) return result;

  return new Response(JSON.stringify({ ok: true, ...result }, null, 2), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}