// Repo: gnr-blog-ai
// File: worker.js

import { requireAdmin, removeProgram, addProgram, listBusinesses } from "./functions/api/blog/_lib/blog-handlers.js";
import { handleOptions, withCors } from "./functions/api/cors.js";

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

      const res = await listBusinesses(context);
      return withCors(request, res);
    }

    
    // ------------------------------------------------------------
    // GET /api/blog/drafts/list  (Draft history per location)
    // ------------------------------------------------------------
    if (request.method === "GET" && pathname === "/api/blog/drafts/list") {
      const admin = await requireAdmin(context);
      if (admin instanceof Response) return withCors(request, admin);

      const { listDraftsForLocation } = await import(
        "./functions/api/blog/_lib/blog-handlers.js"
      );

      // Accept both keys (compat shim): location_id is canonical; locationid is legacy
      const location_id =
        url.searchParams.get("location_id") ||
        url.searchParams.get("locationid");

      const limit = parseInt(url.searchParams.get("limit") || "20", 10);

      const res = await listDraftsForLocation(context, location_id, limit);
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
    if (
      request.method === "POST" &&
      pathname.startsWith("/api/blog/program/mode") &&
      !pathname.endsWith("/bulk")
    ) {
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
// POST /api/blog/draft/create
// ------------------------------------------------------------
if (request.method === "POST" && pathname === "/api/blog/draft/create") {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return withCors(request, admin);

  const { onRequest } = await import(
    "./functions/api/blog/draft/create.js"
  );
  return withCors(request, await onRequest(context));
}

// ------------------------------------------------------------
// GET /api/blog/draft/get/:draft_id
// ------------------------------------------------------------
if (
  request.method === "GET" &&
  pathname.startsWith("/api/blog/draft/get/")
) {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return withCors(request, admin);

  const { onRequest } = await import(
    "./functions/api/blog/draft/get/[draft_id].js"
  );
  return withCors(request, await onRequest(context));
}

// ------------------------------------------------------------
// POST /api/blog/draft/generate-ai
// ------------------------------------------------------------
if (request.method === "POST" && pathname === "/api/blog/draft/generate-ai") {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return withCors(request, admin);

  const { onRequestPost } = await import(
    "./functions/api/blog/draft/generate-ai.js"
  );
  return withCors(request, await onRequestPost(context));
}


// ------------------------------------------------------------
// GET /api/blog/draft/render/:draft_id
// ------------------------------------------------------------
if (
  request.method === "GET" &&
  pathname.startsWith("/api/blog/draft/render/")
) {
  const { onRequest } = await import(
    "./functions/api/blog/draft/render/[draft_id].js"
  );
  return onRequest(context); // HTML response, do NOT wrap with JSON CORS
}

// ------------------------------------------------------------
// POST /api/blog/draft/asset/upsert
// ------------------------------------------------------------
if (
  request.method === "POST" &&
  pathname === "/api/blog/draft/asset/upsert"
) {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return withCors(request, admin);

  const { onRequest } = await import(
    "./functions/api/blog/draft/asset/upsert.js"
  );
  return withCors(request, await onRequest(context));
}

// ------------------------------------------------------------
// POST /api/blog/review/create
// ------------------------------------------------------------
if (request.method === "POST" && pathname === "/api/blog/review/create") {
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return withCors(request, admin);

  const { onRequest } = await import("./functions/api/blog/review/create.js");
  return withCors(request, await onRequest(context));
}

        // ------------------------------------------------------------
        // GET /api/blog/review/debug
        // ------------------------------------------------------------
        if (request.method === "GET" && pathname === "/api/blog/review/debug") {
                const { onRequest } = await import(
                          "./functions/api/blog/review/debug.js"
                        );
                return withCors(request, await onRequest(context));
        }

        // ------------------------------------------------------------
        // POST /api/blog/review/save
        // ------------------------------------------------------------
        if (request.method === "POST" && pathname === "/api/blog/review/save") {
                const { onRequest } = await import(
                          "./functions/api/blog/review/save.js"
                        );
                return withCors(request, await onRequest(context));
        }

        // ------------------------------------------------------------
        // POST /api/blog/review/accept
        // ------------------------------------------------------------
        if (request.method === "POST" && pathname === "/api/blog/review/accept") {
                const { onRequest } = await import(
                          "./functions/api/blog/review/accept.js"
                        );
                return withCors(request, await onRequest(context));
        }

        // ------------------------------------------------------------
        // POST /api/blog/review/suggestions/save
        // ------------------------------------------------------------
        if (
                request.method === "POST" &&
                pathname === "/api/blog/review/suggestions/save"
              ) {
                const { onRequest } = await import(
                          "./functions/api/blog/review/suggestions/save.js"
                        );
                return withCors(request, await onRequest(context));
        }

        // ------------------------------------------------------------
        // POST /api/blog/review/visuals/save
        // ------------------------------------------------------------
        if (
                request.method === "POST" &&
                pathname === "/api/blog/review/visuals/save"
              ) {
                const { onRequest } = await import(
                          "./functions/api/blog/review/visuals/save.js"
                        );
                return withCors(request, await onRequest(context));
        }

// ------------------------------------------------------------
// GET /review (PUBLIC client review page)
// ------------------------------------------------------------
if (request.method === "GET" && pathname === "/review") {
  const { onRequest } = await import("./functions/review/page.js");
  return onRequest(context); // HTML response (no JSON CORS wrapper)
}

// ------------------------------------------------------------
// GET /assets/review-ui.js (PUBLIC client UI controller)
// ------------------------------------------------------------
if (request.method === "GET" && pathname === "/assets/review-ui.js") {
  const { onRequest } = await import("./functions/assets/review-ui.js");
  return onRequest(context); // JS response
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
