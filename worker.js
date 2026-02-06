import { requireAdmin } from "./functions/api/blog-handlers.js";
import { handleOptions, withCors } from "./functions/api/cors.js";
import { businessesList } from "./functions/api/blog/businesses/list.js";

export default {
  async fetch(request, env, ctx) {
    console.log("LIVE API WORKER FROM GIT");

    // CORS preflight
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    const url = new URL(request.url);

    // Route: businesses list
    if (url.pathname === "/api/blog/businesses/list") {
      requireAdmin({ request, env, ctx });
      const res = await businessesList(request, env);
      return withCors(request, res);
    }

    return new Response(
      JSON.stringify({ error: "Not found", path: url.pathname }, null, 2),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  },
};
