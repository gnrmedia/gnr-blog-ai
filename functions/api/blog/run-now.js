export async function onRequest({ request, env, ctx }) {
  // ---- Safety: method guard
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" }
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
        detail: "Cloudflare Access identity missing"
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  // ---- Fire-and-forget orchestration
  ctx.waitUntil((async () => {
    try {
      // This is intentionally minimal for Step 1
      // Later this will call:
      // - draft creation
      // - AI generation
      // - visuals
      // - review issuance
      console.log("RUN_NOW_TRIGGERED", {
        by: email,
        at: new Date().toISOString(),
        payload: body
      });
    } catch (e) {
      console.log("RUN_NOW_BACKGROUND_ERROR", String(e?.message || e));
    }
  })());

  // ---- Immediate response (UX-safe)
  return new Response(
    JSON.stringify({
      ok: true,
      route: "/api/blog/run-now",
      note: "Pages Function confirmed",
      triggered_by: email
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}
