// functions/api/blog/businesses/list.js
import { requireAdmin, listBusinesses } from "../../../../blog-handlers.js";

export async function onRequest(context) {
  const { request } = context;

  // Allow CORS preflight (Pages Functions still receives OPTIONS)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, CF-Access-Jwt-Assertion, X-Requested-With, x-provision-shared-secret",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  // Admin guard (Cloudflare Access or shared secret fallback, depending on your implementation)
  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;

  // Delegate to canonical handler in blog-handlers.js.
  // listBusinesses(ctx) is expected to return a jsonResponse(...) Response.
  //
  // It should read query params from context.request.url:
  //  - q
  //  - limit
  //  - include_inactive
  //
  return await listBusinesses(context);
}

