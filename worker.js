import { requireAdmin, removeProgram } from "./functions/api/blog-handlers.js";
import { handleOptions, withCors } from "./functions/api/cors.js";
import { businessesList } from "./functions/api/blog/businesses/list.js";

export default {
  async fetch(request, env, ctx) {
    console.log("LIVE API WORKER FROM GIT");

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/blog/businesses/list") {
      const admin = requireAdmin({ request, env, ctx });
      if (admin instanceof Response) return withCors(request, admin);

      const res = await businessesList(request, env);
      return withCors(request, res);
    }

    // 🔴 THIS IS THE MISSING LIVE ROUTE
    if (pathname === "/api/blog/program/remove" && request.method === "POST") {
      const res = await removeProgram({ request, env, ctx });
      return withCors(request, res);
    }

    return withCors(
      request,
      new Response(
        JSON.stringify({ ok: false, error: "Not found", path: pathname }),
        { status: 404, headers: { "content-type": "application/json" } }
      )
    );
  },
};

