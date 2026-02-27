// Repo: gnr-blog-ai
// Path: functions/publish/setup/page.js
//
// PUBLIC: GET /publish/setup?t=<token>

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
  <title>Set up publishing</title>
  <style>
    body{font-family:Arial,sans-serif;line-height:1.55;max-width:760px;margin:24px auto;padding:0 16px}
    .card{border:1px solid #e6e6e6;border-radius:10px;padding:16px;margin:14px 0}
    .btn{display:inline-block;background:#301b7f;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;border:none;cursor:pointer}
    input[type=text]{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px}
    .muted{color:#666;font-size:12px}
  </style>
</head>
<body>
  <h1>Publishing setup</h1>
  <p>
    To keep your content safe and accurate, please choose how you want your approved blog posts uploaded.
  </p>

  <div class="card">
    <h2>Option 1 — GNR uploads it for you</h2>
    <ol>
      <li>Make sure <b>admin@gnrmedia.global</b> has <b>Administrator</b> access to your website.</li>
      <li>Enter your website <b>login page URL</b> below (e.g. https://yourdomain.com/wp-admin/).</li>
      <li>We’ll take care of the upload once our team securely adds the publishing credential.</li>
    </ol>

    <label><b>Website login page URL</b></label><br/>
    <input id="wp_base_url" type="text" placeholder="https://yourdomain.com" />
    <p class="muted">Tip: use the main site URL (we’ll guide staff to the login path). Example: https://clientdomain.com</p>

    <button class="btn" id="btnOption1">Submit (GNR uploads)</button>
    <div id="msg1" class="muted"></div>
  </div>

  <div class="card">
    <h2>Option 2 — I’ll upload it myself</h2>
    <p>
      Choose this if you prefer to manually upload your approved article.
      We’ll show simple step-by-step instructions after you confirm.
    </p>
    <button class="btn" id="btnOption2">I’ll upload it myself</button>
    <div id="msg2" class="muted"></div>
  </div>

<script>
const token = ${JSON.stringify(t)};
const apiBase = ${JSON.stringify(apiBase)};

async function postSubmit(payload){
  const res = await fetch(apiBase + "/api/blog/publish/setup/submit", {
    method:"POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(payload)
  });
  return res.json().catch(() => ({}));
}

document.getElementById("btnOption1").addEventListener("click", async () => {
  const wp_base_url = String(document.getElementById("wp_base_url").value || "").trim();
  const out = await postSubmit({ t: token, mode: "GNR_UPLOADS", wp_base_url });
  document.getElementById("msg1").textContent = out?.ok
    ? "Thanks — we’ve got it. Our team will confirm access and proceed."
    : ("Error: " + (out?.error || "submit_failed"));
});

document.getElementById("btnOption2").addEventListener("click", async () => {
  const out = await postSubmit({ t: token, mode: "CLIENT_UPLOADS" });
  document.getElementById("msg2").innerHTML = out?.ok
    ? (out?.instructions_html || "Confirmed.")
    : ("Error: " + (out?.error || "submit_failed"));
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
