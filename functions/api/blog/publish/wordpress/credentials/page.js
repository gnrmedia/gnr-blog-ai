// Repo: gnr-blog-ai
// Path: functions/api/blog/publish/wordpress/credentials/page.js
//
// ADMIN: GET /api/blog/publish/wordpress/credentials?t=<token>

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const t = String(url.searchParams.get("t") || "").trim();
  if (!t) return html("<h1>Missing token</h1>", 400);

  const apiBase = "https://api.admin.gnrmedia.global";

  const page = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Save WordPress Credential</title>
  <style>
    body{font-family:Arial,sans-serif;line-height:1.55;max-width:760px;margin:24px auto;padding:0 16px}
    .card{border:1px solid #e6e6e6;border-radius:10px;padding:16px;margin:14px 0}
    .btn{display:inline-block;background:#301b7f;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;border:none;cursor:pointer}
    input{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px}
    .muted{color:#666;font-size:12px}
  </style>
</head>
<body>
  <h1>WordPress credential</h1>

  <div class="card">
    <p>
      Save the WordPress <b>Application Password</b> for:
      <b>admin@gnrmedia.global</b>
    </p>

    <label><b>Application Password</b></label><br/>
    <input id="pw" type="password" placeholder="xxxx xxxx xxxx xxxx" />

    <p class="muted">
      This is encrypted in D1 (never emailed/stored in plain text).
    </p>

    <button class="btn" id="btnSave">Save credential</button>
    <div id="msg" class="muted"></div>
  </div>

<script>
const token = ${JSON.stringify(t)};
const apiBase = ${JSON.stringify(apiBase)};

document.getElementById("btnSave").addEventListener("click", async () => {
  const pw = String(document.getElementById("pw").value || "").trim();
  const res = await fetch(apiBase + "/api/blog/publish/wordpress/credentials/save", {
    method:"POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify({ t: token, wp_app_password: pw })
  });
  const out = await res.json().catch(() => ({}));
  document.getElementById("msg").textContent = out?.ok
    ? "Saved. WordPress publishing is now ready for this location."
    : ("Error: " + (out?.error || "save_failed"));
});
</script>
</body>
</html>`;

  return html(page, 200);
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      pragma: "no-cache",
    },
  });
}
