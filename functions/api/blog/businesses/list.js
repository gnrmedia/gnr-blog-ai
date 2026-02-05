// functions/api/blog/businesses/list.js
import { requireAdmin } from "../../blog-handlers.js";

export async function onRequestGet({ env, request, context }) {
  // Admin guard
  const admin = requireAdmin({ env, request });
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 500);
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  let sql = `
    SELECT
      location_id,
      business_name_raw,
      abn,
      is_active
    FROM businesses
  `;
  if (!includeInactive) sql += ` WHERE is_active = 1`;
  sql += ` ORDER BY business_name_raw LIMIT ?`;

  const rows = await env.GNR_MEDIA_BUSINESS_DB
    .prepare(sql)
    .bind(limit)
    .all();

  return new Response(
    JSON.stringify({ ok: true, rows: rows.results || [] }),
    { headers: { "content-type": "application/json; charset=utf-8" } }
  );
}
