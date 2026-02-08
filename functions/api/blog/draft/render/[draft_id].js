// Repo: gnr-blog-ai
// File: functions/api/blog/draft/render/[draft_id].js

import { renderDraftHtml } from "../../_lib/blog-handlers.js";

function stripBannedSummaryBlocks(html) {
  if (!html || typeof html !== "string") return html;

  const bannedHeadings = ["tl;dr", "summary", "key takeaways", "recap", "in summary"];
  let output = html;

  for (const h of bannedHeadings) {
    const re = new RegExp(
      `<h[1-6][^>]*>\\s*${h}\\s*<\\/h[1-6]>[\\s\\S]*?(?=<h[1-6][^>]*>|$)`,
      "gi"
    );
    output = output.replace(re, "");
  }

  return output;
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // PUBLIC RENDER — DO NOT REQUIRE ADMIN AUTH
  // Worker router does NOT populate context.params
  // Expected path: /api/blog/draft/render/<draft_id>
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const draftid = String(parts[parts.length - 1] || "").trim();
  const token = String(url.searchParams.get("t") || "").trim();
  if (!draftid) {
    return new Response(JSON.stringify({ ok: false, error: "draft_id required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // renderDraftHtml returns a Response containing HTML
  const res = await renderDraftHtml(context, draftid, token);
  if (!(res instanceof Response)) return res;

  const html = await res.text();
  const cleaned = stripBannedSummaryBlocks(html);

  const headers = new Headers(res.headers);
  headers.set("content-type", "text/html; charset=utf-8");

  return new Response(cleaned, { status: res.status, headers });
}

