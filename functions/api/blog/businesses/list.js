import { requireAdmin } from "../../blog-handlers.js";
import { withCors, handleOptions } from "../../cors.js";

export async function businessesList(request, env) {
      if (request.method === "OPTIONS") {
              return handleOptions(request);
      }

  // Admin guard
  const admin = requireAdmin({ env, request });
      if (admin instanceof Response) {
              return withCors(request, admin);
      }

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

  return withCors(
          request,
          new Response(JSON.stringify({ ok: true, rows: rows.results || [] }), {
                    headers: { "content-type": "application/json; charset=utf-8" },
          })
        );
}
