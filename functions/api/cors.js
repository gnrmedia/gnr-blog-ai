export function withCors(request, response) {
  const origin = request.headers.get("Origin");

  const allowedOrigins = [
    "https://admin.gnrmedia.global"
  ];

  const headers = new Headers(response.headers);

  if (allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, CF-Access-Jwt-Assertion, X-Requested-With, x-admin-key"
    );
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

  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, CF-Access-Jwt-Assertion, X-Requested-With, x-admin-key"
  );
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Max-Age", "86400");

  if (origin === "https://admin.gnrmedia.global") {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  return new Response(null, { status: 204, headers });
}

