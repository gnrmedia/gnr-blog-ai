// Repo: gnr-blog-ai
// File: functions/api/blog/program/mode-bulk.js

import { requireAdmin, setProgramModeBulk } from "../_lib/blog-handlers.js";
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

function asIdList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(x => String(x || "").trim()).filter(Boolean);
  // allow comma-separated string
  if (typeof v === "string") return v.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

// ------------------------------------------------------------
// POST /api/blog/program/mode/bulk
// Accepted bodies:
//   1) { updates: { [location_id]: "auto"|"manual" } }   (canonical)
//   2) { run_mode|mode|program_run_mode: "auto"|"manual", location_ids|program_ids: [...] }
// ------------------------------------------------------------
export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const admin = await requireAdmin(context);
  if (admin instanceof Response) return admin;

  // Parse JSON body
  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  const updates = {};

  // ------------------------------------------------------------
  // Path A — Canonical: { updates: { id: mode } }
  // ------------------------------------------------------------
  if (body && typeof body.updates === "object" && body.updates && !Array.isArray(body.updates)) {
    for (const [programId, modeVal] of Object.entries(body.updates)) {
      const id = String(programId || "").trim();
      const m = normalizeMode(modeVal);
      if (id && m) updates[id] = m;
    }
  }

  // ------------------------------------------------------------
  // Path B — Bulk intent: { run_mode, location_ids: [...] }
  // ------------------------------------------------------------
  if (Object.keys(updates).length === 0) {
    const mode = normalizeMode(body.run_mode || body.mode || body.program_run_mode);
    const ids =
      asIdList(body.location_ids) ||
      asIdList(body.program_ids) ||
      asIdList(body.location_id_list) ||
      asIdList(body.program_id_list);

    if (mode && ids.length) {
      for (const id of ids) updates[id] = mode;
    }
  }

  // ------------------------------------------------------------
  // Guardrails
  // ------------------------------------------------------------
  if (Object.keys(updates).length === 0) {
    return json(
      {
        ok: false,
        error:
          "No valid updates. Use { updates: { [location_id]: 'auto'|'manual' } } or { run_mode: 'auto'|'manual', location_ids: [...] }",
        received_keys: Object.keys(body || {}),
      },
      400
    );
  }

  // Persist
  const result = await setProgramModeBulk(context, updates);
  if (result instanceof Response) return result;

  // Return canonical echo
  return json(
    {
      ok: true,
      updated_count: Object.keys(updates).length,
      updates,
      ...result, // if your handler returns extra info, preserve it
    },
    200
  );
}
