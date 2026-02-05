// ============================================================
// CORS MIDDLEWARE — runs before every /api/* handler
// ============================================================

// ── FIX 1: CORS PREFLIGHT (MUST RUN FIRST) ──────────────────
// If OPTIONS hits auth gate → 403 → buttons die.
// This must run before Access validation, admin allowlists,
// auth checks, and any routing logic.

// ── FIX 2: CORS headers on ALL real responses ────────────────
// withCors() wraps every downstream response so the browser
// never sees a response without the required CORS headers.

function withCors(res) {
    const h = new Headers(res.headers);
    h.set("Access-Control-Allow-Origin", "https://admin.gnrmedia.global");
    h.set("Access-Control-Allow-Credentials", "true");
    return new Response(res.body, { ...res, headers: h });
}

export async function onRequest(context) {
    const { request } = context;

  // ── FIX 1: handle preflight immediately ──
  if (request.method === "OPTIONS") {
        return new Response(null, {
                status: 204,
                headers: {
                          "Access-Control-Allow-Origin": "https://admin.gnrmedia.global",
                          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                          "Access-Control-Allow-Headers": "Content-Type, Authorization",
                          "Access-Control-Max-Age": "86400",
                },
        });
  }

  // ── FIX 2: run downstream handler, then attach CORS headers ──
  const response = await context.next();
    return withCors(response);
}
