export function onRequest() {
  return new Response(
    JSON.stringify({ ok: true, route: "/api/blog/ping" }),
    { headers: { "content-type": "application/json" } }
  );
}
