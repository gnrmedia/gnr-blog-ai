import { requireAdmin } from "./functions/api/blog-handlers.js";
import { handleOptions, withCors } from "./functions/api/cors.js";

import { businessesList } from "./functions/api/blog/businesses/list.js";
import { removeProgram } from "./functions/api/blog-handlers.js";

export default {
  async fetch(request, env, ctx) {
    console.log("LIVE API WORKER FROM GIT");

    // ------------------------------------------------------------
    // CORS preflight (global)
    // ------------------------------------------------------------
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const { pathname } = url;

    // ------------------------------------------------------------
    // Route: list businesses (Admin UI)
    // GET /api/blog/businesses/list
    // ------------------------------------------------------------
    if (pathname === "/api/blog/businesses/list") {
      const admin = requireAdmin({ request, env, ctx });
      if (admin instanceof Response) return admin;

      const res = await businessesList(request, env);
      return withCors(request, res);
    }

    // ------------------------------------------------------------
    // Route: disable blog program for a business
    // POST /api/blog/program/remove
    // ------------------------------------------------------------
    if (pathname === "/api/blog/program/remove" && request.method === "POST") {
      const res = await removeProgram({ request, env, ctx });
      return withCors(request, res);
    }

    // ------------------------------------------------------------
    // Fallback: not found
    // ------------------------------------------------------------
    return new Response(
      JSON.stringify(
        { ok: false, error: "Not found", path: pathname },
        null,
        2
      ),
      {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  },
};
