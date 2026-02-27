// Repo: gnr-blog-ai
// Path: functions/publish/confirm/page.js

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const t = String(url.searchParams.get("t") || "").trim();
  if (!t) return html("<h1>Missing token</h1>", 400);

  const apiBase = "https://api.admin.gnrmedia.global";

  const page = `
  <html>
  <head><title>Confirm Published</title></head>
  <body style="font-family:Arial;max-width:720px;margin:40px auto;">
    <h2>Confirm your article is live</h2>
    <p>Paste the live URL of your published article.</p>
    <input id="live_url" style="width:100%;padding:10px;" placeholder="https://..." />
    <br/><br/>
    <button onclick="submit()">Confirm</button>
    <div id="msg"></div>
    <script>
      async function submit() {
        const live_url = document.getElementById("live_url").value.trim();
        const res = await fetch("${apiBase}/api/blog/publish/confirm", {
          method:"POST",
          headers: {"content-type":"application/json"},
          body: JSON.stringify({ t: "${t}", live_url })
        });
        const out = await res.json();
        document.getElementById("msg").innerText =
          out.ok ? "Confirmed. Thank you." : ("Error: " + out.error);
      }
    </script>
  </body>
  </html>
  `;

  return html(page, 200);
}

function html(body, status=200){
  return new Response(body,{
    status,
    headers:{ "content-type":"text/html; charset=utf-8" }
  });
}
