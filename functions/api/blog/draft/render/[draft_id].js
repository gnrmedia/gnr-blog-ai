// Repo: gnr-blog-ai
// File: functions/api/blog/draft/render/[draft_id].js

import { requireAdmin, renderDraftHtml } from "../../_lib/blog-handlers.js";

function stripBannedSummaryBlocks(html) {
  if (!html || typeof html !== "string") return html;

  const bannedHeadings = ["tl;dr", "summary", "key takeaways", "recap", "in summary"];

  let output = html;

  for (const h of bannedHeadings) {
    // Remove a heading section until the next heading (defensive)
    const re = new RegExp(
      `<h[1-6][^>]*>\\s*${h}\\s*<\\/h[1-6]>[\\s\\S]*?(?=<h[1-6][^>]*>|$)`,
      "gi"
    );
    output = output.replace(re, "");
  }

  return output;
}

export async function onRequest(context) {
  const { request, params } = context;

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

// PUBLIC RENDER — DO NOT REQUIRE ADMIN AUTH
// This endpoint is rendered inside an iframe and cannot send headers.


  const draftid = String(params?.draft_id || "").trim();
  if (!draftid) {
    return new Response(JSON.stringify({ ok: false, error: "draft_id required" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // renderDraftHtml() returns a Response with HTML
  const res = await renderDraftHtml(context, draftid);
  if (!(res instanceof Response)) return res;

  const html = await res.text();
  const cleaned = stripBannedSummaryBlocks(html);

  // Return HTML (NOT JSON)
  const headers = new Headers(res.headers);
  headers.set("content-type", "text/html; charset=utf-8");

  return new Response(cleaned, { status: res.status, headers });
}

