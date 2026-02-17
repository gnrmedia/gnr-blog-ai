// Repo: gnr-blog-ai
// File: functions/api/blog/businesses/backfill-passports.js
import { requireAdmin } from "../_lib/blog-handlers.js";

// POST /api/blog/businesses/backfill-passports
// Body (optional):
// { limit: 50, dry_run: true, only_missing: true }
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const admin = requireAdmin(context);
  if (admin instanceof Response) return admin;

  let body = {};
  try { body = await request.json(); } catch (_) {}

  const limit = Number(body.limit || 50);
  const dryRun = body.dry_run === true || String(body.dry_run || "").toLowerCase() === "true";
  const onlyMissing = body.only_missing !== false; // default true

  const ghlKey = typeof env.GHL_GNR_API_KEY?.get === "function"
    ? await env.GHL_GNR_API_KEY.get()
    : env.GHL_GNR_API_KEY;

  if (!ghlKey) {
    return new Response(JSON.stringify({ ok: false, error: "Missing GHL_GNR_API_KEY" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const rows = await env.GNR_MEDIA_BUSINESS_DB.prepare(`
    SELECT location_id, business_name_raw, abn, marketing_passport
    FROM businesses
    WHERE location_id IS NOT NULL
      AND length(location_id) > 5
      ${onlyMissing ? "AND (marketing_passport IS NULL OR trim(marketing_passport) = '')" : ""}
    ORDER BY datetime(updated_at) DESC
    LIMIT ?
  `).bind(limit).all();

  const businesses = rows?.results || [];

  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const extRank = (name) => {
    const n = String(name || "").toLowerCase();
    if (n.endsWith(".txt")) return 1;
    if (n.endsWith(".md")) return 2;
    if (n.endsWith(".html") || n.endsWith(".htm")) return 3;
    if (n.endsWith(".pdf")) return 9;
    return 5;
  };

  const updated = [];
  const skipped = [];
  const failed = [];

  for (const b of businesses) {
    const location_id = String(b.location_id || "").trim();
    const abnNorm = norm(b.abn).replace(/^0+/, ""); // safe
    const nameNorm = norm(b.business_name_raw);

    try {
      const url = `https://services.leadconnectorhq.com/medias/files?locationId=${encodeURIComponent(location_id)}&limit=1000`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${ghlKey}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        failed.push({ location_id, status: res.status });
        continue;
      }

      const data = await res.json();
      const items =
        (Array.isArray(data?.files) && data.files) ||
        (Array.isArray(data?.data?.files) && data.data.files) ||
        (Array.isArray(data?.items) && data.items) ||
        [];

      const candidates = items
        .map((m) => {
          const name = m?.name || m?.fileName || "";
          const n = norm(name);
          const abnHit = abnNorm && n.includes(abnNorm);
          const nameHit = nameNorm && n.includes(nameNorm);
          return { m, name, abnHit, nameHit };
        })
        .filter((x) => x.abnHit || x.nameHit)
        .sort((a, b) => extRank(a.name) - extRank(b.name));

      const pick = candidates[0]?.m;
      if (!pick) {
        skipped.push({ location_id, reason: "no_match" });
        continue;
      }

      const fileUrl =
        pick?.url ||
        pick?.publicUrl ||
        pick?.downloadUrl ||
        pick?.fileUrl ||
        pick?.hostedUrl ||
        null;

      if (!fileUrl) {
        skipped.push({ location_id, reason: "match_no_url", name: candidates[0]?.name || "" });
        continue;
      }

      if (!dryRun) {
        await env.GNR_MEDIA_BUSINESS_DB.prepare(`
          UPDATE businesses
          SET marketing_passport = ?, updated_at = datetime('now')
          WHERE location_id = ?
        `).bind(String(fileUrl), location_id).run();
      }

      updated.push({
        location_id,
        marketing_passport: fileUrl,
        matched_name: candidates[0]?.name || "",
        basis: candidates[0]?.abnHit ? "abn" : "business_name",
      });
    } catch (e) {
      failed.push({ location_id, error: String(e?.message || e) });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    only_missing: onlyMissing,
    scanned: businesses.length,
    updated_count: updated.length,
    skipped_count: skipped.length,
    failed_count: failed.length,
    updated,
    skipped,
    failed,
  }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
