// Repo: gnr-blog-ai
// File path: /worker.js

import { requireAdmin, removeProgram, addProgram } from "./functions/api/blog-handlers.js";
import { handleOptions, withCors } from "./functions/api/cors.js";

import { businessesList } from "./functions/api/blog/businesses/list.js";

// NOTE: These two handlers are Pages-style (onRequest).
// In a Worker router, we call their exported onRequest(context) directly.
import { onRequest as programMode } from "./functions/api/blog/program/mode.js";
import { onRequest as programModeBulk } from "./functions/api/blog/program/mode-bulk.js";

export default {
  async fetch(request, env, ctx) {
    console.log("LIVE API WORKER FROM GIT");

    // ============================================================
    // CORS preflight
    // ============================================================
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const { pathname } = url;

    // Helper: Worker-style context object for Pages-style handlers
    const context = { request, env, ctx };

    // ============================================================
    // GET /api/blog/businesses/list  (Admin)
    // ============================================================
    if (pathname === "/api/blog/businesses/list") {
      const admin = await requireAdmin(context);
      if (admin instanceof Response) return withCors(request, admin);

      const res = await businessesList(request, env);
      return withCors(request, res);
    }

    // ============================================================
    // POST /api/blog/program/add   (Enable)
    // ============================================================
    if (pathname === "/api/blog/program/add" && request.method === "POST") {
      const res = await addProgram({ request, env });
      return withCors(request, res);
    }

    // ============================================================
    // POST /api/blog/program/remove   (Disable)
    // ============================================================
    if (pathname === "/api/blog/program/remove" && request.method === "POST") {
      const res = await removeProgram({ request, env });
      return withCors(request, res);
    }

    // ============================================================
    // POST /api/blog/program/mode   (AUTO/MANUAL single)
    // ============================================================
    if (pathname === "/api/blog/program/mode" && request.method === "POST") {
      const res = await programMode(context);
      return withCors(request, res);
    }

    // ============================================================
    // POST /api/blog/program/mode/bulk   (AUTO/MANUAL bulk)
    // ============================================================
    if (pathname === "/api/blog/program/mode/bulk" && request.method === "POST") {
      const res = await programModeBulk(context);
      return withCors(request, res);
    }

    // ============================================================
    // Not found
    // ============================================================
    return withCors(
      request,
      new Response(
        JSON.stringify({ ok: false, error: "Not found", path: pathname }, null, 2),
        { status: 404, headers: { "content-type": "application/json; charset=utf-8" } }
      )
    );
  },
};
