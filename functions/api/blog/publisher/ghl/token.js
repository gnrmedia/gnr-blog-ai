// Repo: gnr-blog-ai
// Path: functions/api/blog/publisher/ghl/token.js
//
// POST /api/blog/publisher/ghl/token
// Body: { location_id: "...", target_id?: "...", token_id: "eyJ..." }
//
// Stores token-id encrypted into publish_targets.config_json as token_id_enc
// so token rotation can occur without redeploys.

import { requireAdmin, jsonResponse, errorResponse, corsHeaders } from "../../_lib/blog-handlers.js";

function base64UrlEncode(bytes) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importAesKeyFromEnv(env) {
  const k = env.PUBLISHER_TOKEN_KEY;
  const raw = (k && typeof k.get === "function") ? await k.get() : k;
  const keyStr = String(raw || "").trim();
  if (!keyStr) throw new Error("missing_env_PUBLISHER_TOKEN_KEY");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyStr));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
}

async function encryptTokenId(env, token) {
  const key = await importAesKeyFromEnv(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(String(token || "").trim());
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);

  // store iv||ct
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return base64UrlEncode(out);
}

export async function onRequest(context) {
  const { env, request } = context;

  // CORS (must run BEFORE auth for preflight)
  const cors = corsHeaders(context);

  // Preflight must bypass auth
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...(cors || {}) },
    });
  }

  // Admin auth (POST only)
  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;


  if (request.method !== "POST") {
    return jsonResponse(context, { ok: false, error: "Method not allowed" }, 405);
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const location_id = String(body.location_id || "").trim();
  const token_id = String(body.token_id || "").trim();
  const target_id_in = String(body.target_id || "").trim();

  if (!location_id) return errorResponse(context, "location_id required", 400);
  if (!token_id) return errorResponse(context, "token_id required", 400);

  // Deterministic default target id used in your system
  const target_id = target_id_in || `${location_id}:ghl_blog`;

  let token_id_enc = null;
  try {
    token_id_enc = await encryptTokenId(env, token_id);
  } catch (e) {
    return errorResponse(context, "token_encrypt_failed", 500, { detail: String(e?.message || e) });
  }

  // Write into publish_targets.config_json
  try {
const result = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
  UPDATE publish_targets
     SET config_json = json_set(COALESCE(config_json,'{}'), '$.token_id_enc', ?),
         updated_at = datetime('now')
   WHERE target_id = ?
`).bind(token_id_enc, target_id).run();

if (!result?.success || (result?.meta?.changes ?? 0) === 0) {
  return errorResponse(context, "token_update_failed_no_matching_target", 404, {
    target_id,
    location_id
  });
}


  } catch (e) {
    return errorResponse(context, "db_update_failed", 500, { detail: String(e?.message || e) });
  }

  return jsonResponse(context, {
    ok: true,
    action: "token_saved",
    location_id,
    target_id,
    saved: true
  });
}
