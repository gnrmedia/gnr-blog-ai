export async function onRequest({ request, env, ctx }) {
  return new Response(
    JSON.stringify({
      ok: true,
      route: "/api/blog/run-now",
      note: "Inline handler confirmed",
    }),
    {
      headers: { "content-type": "application/json" },
    }
  );
}
