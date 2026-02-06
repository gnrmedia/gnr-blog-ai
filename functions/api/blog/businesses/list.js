import { requireAdmin } from "../../blog-handlers.js";
import { withCors, handleOptions } from "../../cors.js";

export async function businessesList(request, env) {
  // 1) CORS preflight
  if (request.method === "OPTIONS") return handleOptions(request);

  // 2) Admin guard (returns Response on failure)
  const admin = requireAdmin({ env, request });
  if (admin instanceof Response) return withCors(request, admin);

  // 3) Params
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit")) || 200;
  const limit = Math.min(Math.max(limitRaw, 1), 500);
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  // 4) Query
let sql = `
  SELECT
      b.location_id,
          b.business_name_raw,
              b.abn,
                  b.is_active,
                      -- Blog program state (history)
                          COALESCE(p.enabled, 0)     AS program_enabled,
                              COALESCE(p.run_mode, '')   AS run_mode,
                                  p.added_at                 AS program_added_at,
                                      p.added_by                 AS program_added_by,
                                          p.notes                    AS program_notes
                                            FROM businesses b
                                              LEFT JOIN blog_program_locations p
                                                  ON p.location_id = b.location_id
                                                  `;
  if (!includeInactive) sql += ` WHERE b.is_active = 1`;
  sql += ` ORDER BY b.business_name_raw LIMIT ?`;

  const res = await env.GNR_MEDIA_BUSINESS_DB.prepare(sql).bind(limit).all();
  const rows = res?.results || [];

  // 5) Response
  return withCors(
    request,
    new Response(JSON.stringify({ ok: true, rows }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    })
  );
}
