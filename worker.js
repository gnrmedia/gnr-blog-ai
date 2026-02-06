// Repo: gnr-blog-ai
// File: worker.js

import { requireAdmin, removeProgram, addProgram } from "./functions/api/blog-handlers.js";
import { handleOptions, withCors } from "./functions/api/cors.js";
import { businessesList } from "./functions/api/blog/businesses/list.js";

import { onRequest as programMode } from "./functions/api/blog/program/mode.js";
import { onRequest as programModeBulk } from "./functions/api/blog/program/mode-bulk.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    console.log("[WORKER HIT]", request.method, pathname);

    // ------------------------------------------------------------
    // CORS preflight
    // ------------------------------------------------------------
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    const context = { request, env, ctx };

    // ------------------------------------------------------------
    // GET /api/blog/businesses/list
    // ------------------------------------------------------------
    if (request.method === "GET" && pathname === "/api/blog/businesses/list") {
      const admin = await requireAdmin(context);
      if (admin instanceof Response) return withCors(request, admin);

      const res = await businessesList(request, env);
      return withCors(request, res);
    }

        // ------------------------------------------------------------
    // GET /api/blog/drafts/list  (Draft history per location)
    // ------------------------------------------------------------
    if (request.method === "GET" && pathname === "/api/blog/drafts/list") {
      const admin = await requireAdmin(context);
      if (admin instanceof Response) return withCors(request, admin);

      const { listDraftsForLocation } = await import(
        "./functions/api/blog-handlers.js"
      );

      const res = await listDraftsForLocation(context);
      return withCors(request, res);
    }

    // ------------------------------------------------------------
    // POST /api/blog/program/add
    // ------------------------------------------------------------
    if (request.method === "POST" && pathname === "/api/blog/program/add") {
      return withCors(request, await addProgram({ request, env }));
    }

    // ------------------------------------------------------------
    // POST /api/blog/program/remove
    // ------------------------------------------------------------
    if (request.method === "POST" && pathname === "/api/blog/program/remove") {
      return withCors(request, await removeProgram({ request, env }));
    }

    // ------------------------------------------------------------
    // POST /api/blog/program/mode (SINGLE)
    // ------------------------------------------------------------
    if (request.method === "POST" && pathname.startsWith("/api/blog/program/mode") && !pathname.endsWith("/bulk")) {
      console.log("[ROUTE] program/mode");
      return withCors(request, await programMode(context));
    }

    // ------------------------------------------------------------
    // POST /api/blog/program/mode/bulk
    // ------------------------------------------------------------
    if (request.method === "POST" && pathname === "/api/blog/program/mode/bulk") {
      console.log("[ROUTE] program/mode/bulk");
      return withCors(request, await programModeBulk(context));
    }

    // ------------------------------------------------------------
    // 404
    // ------------------------------------------------------------
    console.log("[ROUTE MISS]", request.method, pathname);

    return withCors(
      request,
      new Response(
        JSON.stringify({ ok: false, error: "Not found", path: pathname }, null, 2),
        { status: 404, headers: { "content-type": "application/json; charset=utf-8" } }
      )
    );
  },
};
