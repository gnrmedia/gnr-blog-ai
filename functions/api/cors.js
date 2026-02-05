export function withCors(request, response) {
    const origin = request.headers.get("Origin");

  // Only allow your admin UI
  const allowedOrigins = [
        "https://admin.gnrmedia.global"
      ];

  const headers = new Headers(response.headers);

  if (allowedOrigins.includes(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Credentials", "true");
        headers.set("Vary", "Origin");
  }

  return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
  });
}

export function handleOptions(request) {
    const origin = request.headers.get("Origin");

  const headers = new Headers();
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Credentials", "true");

  if (origin === "https://admin.gnrmedia.global") {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
  }

  return new Response(null, { status: 204, headers });
}
