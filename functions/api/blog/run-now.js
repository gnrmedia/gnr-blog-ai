export async function onRequest(context) {
  const { request, env } = context;

  // Pages Functions uses context.waitUntil (NOT ctx.waitUntil)
  const waitUntil =
    (context && typeof context.waitUntil === "function")
      ? (p) => context.waitUntil(p)
      : (p) => p;

  // ---- Safety: method guard
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  // ---- Parse request
  let body = {};
  try {
    body = await request.json();
  } catch (_) {}

  // ---- Admin guard (Cloudflare Access)
  const email =
    request.headers.get("cf-access-authenticated-user-email") ||
    request.headers.get("Cf-Access-Authenticated-User-Email") ||
    "";

  if (!email) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        detail: "Cloudflare Access identity missing",
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  // ---- Fire-and-forget orchestration (safe placeholder)
  waitUntil(
    (async () => {
      try {
        console.log("RUN_NOW_TRIGGERED", {
          by: email,
          at: new Date().toISOString(),
          payload: body,
        });
      } catch (e) {
        console.log("RUN_NOW_BACKGROUND_ERROR", String((e && e.message) || e));
      }
    })()
  );

  // ---- Immediate response (UX-safe)
  return new Response(
    JSON.stringify(
      {
        ok: true,
        route: "/api/blog/run-now",
        note: "Pages Function confirmed",
        triggered_by: email,
      },
      null,
      2
    ),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}
