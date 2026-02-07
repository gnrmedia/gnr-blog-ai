// Repo: gnr-blog-ai
// File: functions/api/blog/program/mode.js

import { requireAdmin, setProgramMode } from "../_lib/blog-handlers.js";
// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeMode(v) {
  const m = String(v || "").trim().toLowerCase();
  return m === "auto" || m === "manual" ? m : "";
}

export async function onRequest(context) {
  const { request } = context;

  // ------------------------------------------------------------
  // Method guard
  // ------------------------------------------------------------
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // ------------------------------------------------------------
  // Admin auth
  // ------------------------------------------------------------
  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;

  // ------------------------------------------------------------
  // Parse JSON body
  // ------------------------------------------------------------
  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  // ------------------------------------------------------------
  // Accept identifiers
  // ------------------------------------------------------------
  const locationId = String(body.location_id || body.program_id || "").trim();

  // ------------------------------------------------------------
  // Accept mode fields
  // ------------------------------------------------------------
  const runMode = normalizeMode(body.run_mode || body.mode || body.program_run_mode);

  if (!locationId || !runMode) {
    return json(
      {
        ok: false,
        error: "location_id and run_mode required (run_mode must be 'auto' or 'manual')",
        received_keys: Object.keys(body || {}),
        received: {
          location_id: body.location_id ?? null,
          program_id: body.program_id ?? null,
          run_mode: body.run_mode ?? null,
          mode: body.mode ?? null,
          program_run_mode: body.program_run_mode ?? null,
        },
      },
      400
    );
  }

  // ------------------------------------------------------------
  // Persist
  // ------------------------------------------------------------
  const result = await setProgramMode(context, locationId, runMode);
  if (result instanceof Response) return result;

  // Canonical echo (what UI should rely on)
  return json({ ok: true, location_id: locationId, run_mode: runMode }, 200);
}
