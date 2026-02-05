export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      service: "gnr-blog-ai-pages",
      timestamp: new Date().toISOString(),
      status: "healthy",
    }, null, 2),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    }
  );
}