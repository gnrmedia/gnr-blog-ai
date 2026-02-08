// Repo: gnr-blog-ai
// Path: functions/review/page.js

// PUBLIC: GET /review?t=<token>
// Bold WOW client review page (premium SaaS feel).
//
// NOTE: This page assumes these PUBLIC endpoints already exist in your deployed Worker:
// - GET  /api/blog/review/debug?t=...
// - POST /api/blog/review/save
// - POST /api/blog/review/accept
// - POST /api/blog/review/suggestions/save
// - POST /api/blog/review/visuals/save
//
// If you want me to wire/implement those endpoints in the modular router next,
// say: “Next: wire public review API endpoints”.

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const t = String(url.searchParams.get("t") || "").trim();
  if (!t) return html("<h1>Missing token</h1>", 400);

  // We do NOT read the token server-side here (keeps this page lightweight + safe).
  // We rely on /api/blog/review/debug to validate and return status.
  // The JS will call debug immediately and render state appropriately.

  const page = buildWowReviewHtml({ token: t });

  return html(page, 200);
}

// --------------------------------------------
// HTML response helper (Bold WOW CSP)
// --------------------------------------------
function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      pragma: "no-cache",
      "Content-Security-Policy": [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "script-src 'self'",
        "connect-src 'self'",
        "img-src 'self' data: https: blob:",
      ].join("; "),
    },
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildWowReviewHtml({ token }) {
  const tokenSafe = escapeHtml(token);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="cf-beacon" content='{"token": ""}'>

  <meta name="viewport" content="width=device-width,initial-scale=1" />

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">

  <title>Review your draft</title>

  <style>
    :root{
      --bg0:#05060a;
      --bg1:#0b0f1a;
      --panel: rgba(255,255,255,0.06);
      --panel2: rgba(255,255,255,0.08);
      --line: rgba(255,255,255,0.12);
      --txt: rgba(255,255,255,0.92);
      --muted: rgba(255,255,255,0.68);
      --faint: rgba(255,255,255,0.45);
      --ink:#0b0f1a;
      --paper:#ffffff;
      --wash:#f5f6f8;
      --good:#22c55e;
      --warn:#f59e0b;
      --bad:#ef4444;
      --accent:#7c3aed;
      --accent2:#22c55e;
      --radius: 22px;
      --shadow: 0 24px 80px rgba(0,0,0,.45);
      --shadow2: 0 18px 55px rgba(0,0,0,.18);
    }

    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0;
      color:var(--txt);
      background:
        radial-gradient(1000px 600px at 70% 10%, rgba(34,197,94,.18), transparent 60%),
        radial-gradient(900px 560px at 30% 20%, rgba(124,58,237,.22), transparent 60%),
        linear-gradient(180deg, var(--bg0), var(--bg1));
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      overflow-x:hidden;
    }

    /* subtle animated grain */
    body:before{
      content:"";
      position:fixed; inset:0;
      pointer-events:none;
      background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='.12'/%3E%3C/svg%3E");
      opacity:.22;
      mix-blend-mode:overlay;
      animation: grain 10s steps(6,end) infinite;
    }
    @keyframes grain{
      0%{transform:translate3d(0,0,0)}
      25%{transform:translate3d(-2%,1%,0)}
      50%{transform:translate3d(1%,-2%,0)}
      75%{transform:translate3d(2%,2%,0)}
      100%{transform:translate3d(0,0,0)}
    }

    .wrap{
      max-width: 1100px;
      margin: 0 auto;
      padding: 36px 18px 140px;
      position:relative;
    }

    .topbar{
      display:flex;
      gap:14px;
      align-items:center;
      justify-content:space-between;
      flex-wrap:wrap;
      margin-bottom: 18px;
      opacity:0;
      transform: translateY(10px);
      animation: enter .55s ease-out forwards;
    }
    @keyframes enter{
      to{opacity:1; transform:translateY(0)}
    }

    .brand{
      display:flex; gap:12px; align-items:center;
    }
    .mark{
      width:44px; height:44px;
      border-radius:14px;
      background:
        radial-gradient(60% 60% at 35% 25%, rgba(34,197,94,.45), transparent 60%),
        radial-gradient(70% 70% at 75% 65%, rgba(124,58,237,.55), transparent 55%),
        linear-gradient(135deg, rgba(255,255,255,.12), rgba(255,255,255,.04));
      border:1px solid var(--line);
      box-shadow: 0 14px 40px rgba(0,0,0,.35);
    }
    .brand h1{
      margin:0;
      font-family:"Playfair Display", Georgia, serif;
      font-size: 22px;
      letter-spacing:-.01em;
      line-height:1.05;
    }
    .brand .sub{
      margin:3px 0 0;
      font-size: 12px;
      letter-spacing:.16em;
      text-transform:uppercase;
      color: var(--muted);
    }

    .statusPill{
      display:flex; align-items:center; gap:10px;
      padding:10px 12px;
      border-radius: 999px;
      border:1px solid rgba(0,0,0,.10);
      background: rgba(255,255,255,.82);
      box-shadow: 0 12px 30px rgba(0,0,0,.06);
      backdrop-filter: blur(10px);
      min-width: 260px;
      justify-content:space-between;
    }
    .statusLeft{display:flex; gap:10px; align-items:center;}
    .dot{
      width:10px; height:10px; border-radius:999px;
      background: var(--warn);
      box-shadow: 0 0 0 6px rgba(245,158,11,.18);
      animation: pulse 1.7s ease-in-out infinite;
    }
    @keyframes pulse{
      50%{transform:scale(1.05); box-shadow:0 0 0 10px rgba(245,158,11,.12)}
    }
    .statusTxt{
      font-size: 12px;
      letter-spacing:.14em;
      text-transform:uppercase;
      color: rgba(11,15,26,.88);
      font-weight:700;
    }
    .statusMeta{
      font-size: 12px;
      color: rgba(11,15,26,.58);
      margin-left:8px;
    }

    .grid{
      display:grid;
      grid-template-columns: 1.15fr .85fr;
      gap:16px;
      align-items:start;
    }
    @media (max-width: 980px){
      .grid{grid-template-columns: 1fr;}
      .statusPill{min-width: unset; width:100%;}
    }

    .panel{
      border:1px solid var(--line);
      background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03));
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow:hidden;
      position:relative;
    }
    .panelHeader{
      padding:18px 18px 12px;
      border-bottom:1px solid rgba(255,255,255,.10);
      display:flex;
      gap:10px;
      align-items:flex-start;
      justify-content:space-between;
    }
.panelHeader h2{
  margin:0;
  font-size:14px;
  letter-spacing:.14em;
  text-transform:uppercase;
  color: rgba(11,15,26,.82); /* was white; now readable on light header */
}

    .panelHeader p{
      margin:6px 0 0;
      font-size:13px;
      color: var(--muted);
      line-height:1.4;
      max-width: 52ch;
    }
    .panelBody{padding:16px 18px 18px;}

    /* Step chips */
    .steps{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      padding:12px 18px 0;
    }
    .chip{
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      border-radius: 999px;
      padding:9px 12px;
      font-size:12px;
      color: rgba(255,255,255,.78);
      display:flex; gap:10px; align-items:center;
      cursor:pointer;
      transition: transform .15s ease, background .15s ease, border-color .15s ease;
      user-select:none;
    }
    .chip:hover{ transform: translateY(-1px); background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.18); }
    .chip b{ color:#fff; font-weight:700; letter-spacing:.06em; }
    .chip .n{
      width:22px; height:22px;
      border-radius:999px;
      display:grid; place-items:center;
      background: rgba(124,58,237,.25);
      border:1px solid rgba(124,58,237,.35);
      color:#fff; font-weight:700;
      font-size:12px;
    }

    /* Published preview shell (WOW moment) */
    .previewShell{
      background: #fff;
      color:#0b0f1a;
      border-radius: 18px;
      border:1px solid rgba(0,0,0,.06);
      box-shadow: var(--shadow2);
      overflow:hidden;
      position:relative;
      transform: translateY(6px);
      opacity:0;
      animation: pop .6s ease-out .1s forwards;
    }
    @keyframes pop{
      to{ opacity:1; transform: translateY(0); }
    }
    .previewTop{
      display:flex;
      justify-content:space-between;
      gap:12px;
      padding:12px 14px;
      background: linear-gradient(180deg, #ffffff, #f7f7f9);
      border-bottom:1px solid rgba(0,0,0,.06);
      align-items:center;
      flex-wrap:wrap;
    }
    .previewTop .badge{
      display:inline-flex;
      gap:10px;
      align-items:center;
      padding:8px 10px;
      border-radius:999px;
      background: rgba(11,15,26,.92);
      color:#fff;
      font-size:12px;
      letter-spacing:.12em;
      text-transform:uppercase;
      border:1px solid rgba(0,0,0,.25);
    }
    .previewTop .badge i{
      width:10px;height:10px;border-radius:999px;background: var(--accent2);
      box-shadow: 0 0 0 6px rgba(34,197,94,.14);
    }
    .previewTop .hint{
      font-size:12px;
      color: rgba(0,0,0,.55);
      font-weight:600;
    }
    .previewBody{
      padding: 18px 18px 22px;
    }

    /* ============================================================
       MOBILE PREVIEW FRAME (Published Preview)
       - narrow like a phone
       - fixed height with its own scroll
       ============================================================ */
    .phoneFrame{
      width: 390px;              /* iPhone-ish viewport width */
      max-width: 100%;
      margin: 8px auto 0;
      border-radius: 28px;
      background: #0b0f1a;
      border: 1px solid rgba(0,0,0,.25);
      box-shadow: 0 18px 60px rgba(0,0,0,.25);
      padding: 14px;
      position: relative;
    }

    .phoneNotch{
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      width: 140px;
      height: 18px;
      border-radius: 0 0 14px 14px;
      background: rgba(255,255,255,.10);
      backdrop-filter: blur(6px);
      pointer-events: none;
    }

    .phoneScreen{
      background: #fff;
      border-radius: 18px;
      overflow-y: auto;
      overflow-x: hidden;
      height: min(720px, 70vh);  /* internal scroll like mobile */
      -webkit-overflow-scrolling: touch;
      border: 1px solid rgba(0,0,0,.10);
    }

    /* --- Mobile preview readability overrides (ONLY inside phone) --- */
.phoneScreen{
  font-size: 16px;
  line-height: 1.55;
}

/* Prevent giant headings + force wrapping */
.phoneScreen h1,
.phoneScreen h2,
.phoneScreen h3{
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
  hyphens: auto;
  line-height: 1.12;
  letter-spacing: -0.02em;
  margin-top: 18px;
  margin-bottom: 10px;
}

/* Clamp headings to mobile-friendly sizes */
.phoneScreen h1{ font-size: 32px; }
.phoneScreen h2{ font-size: 24px; }
.phoneScreen h3{ font-size: 20px; }

/* Paragraphs + lists */
.phoneScreen p,
.phoneScreen li{
  font-size: 16px;
  line-height: 1.6;
}

/* Add comfortable padding inside the “screen” */
.phoneScreen .gnr-render-root{
  padding: 18px 16px 22px;
}


    /* Ensure injected render content behaves in a phone viewport */
    .phoneScreen .gnr-render-root{
      max-width: 100%;
      margin: 0 auto;
      padding: 0;
    }
    .phoneScreen img{
      max-width: 100%;
      height: auto;
    }

    /* On small screens, don't force a tall "phone"; just flow normally */
    @media (max-width: 520px){
      .phoneFrame{
        width: 100%;
        border-radius: 20px;
        padding: 12px;
      }
      .phoneNotch{ display:none; }
      .phoneScreen{
        height: auto;
        max-height: none;
      }
    }

    /* Keep injected render content readable inside the preview panel */
    .previewBody .gnr-render-root{
      max-width: 980px;
      margin: 0 auto;
    }
    .previewBody .gnr-render-root img{
      max-width: 100%;
      height: auto;
    }

    /* Editor preview typography */
    .previewBody h1,.previewBody h2{
      font-family:"Playfair Display", Georgia, serif;
      letter-spacing:-.01em;
    }
    .previewBody h2{font-size:26px;margin:18px 0 10px;}
    .previewBody p,.previewBody li{
      font-size:16px; line-height:1.7;
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      font-weight: 400;
    }
    .previewBody p{margin:10px 0;}
    .previewBody blockquote{
      margin:16px 0;
      padding:12px 14px;
      border-left: 4px solid #111;
      background:#fafafa;
      border-radius:14px;
    }
    .previewBody ul, .previewBody ol{
      margin: 8px 0 10px 22px;
      padding: 0;
    }
    .previewBody li{margin:4px 0;}
    .previewBody li > p{display:inline; margin:0;}

    /* Visual blocks */
    .gnr-visual{
      margin:18px 0;
      border:1px solid #e8e8e8;
      border-radius:18px;
      background:linear-gradient(180deg,#fff,#fbfbfb);
      overflow:hidden;
    }
    .gnr-img{width:100%;height:auto;display:block;}
    .gnr-visual-inner{padding:16px;}
    .gnr-visual-label{
      font-weight:800;
      font-size:12px;
      letter-spacing:.14em;
      text-transform:uppercase;
      color:#0b0f1a;
      margin-bottom:6px;
    }
    .gnr-visual-note{font-size:13px;color:#667085}

    /* Hero special */
    .gnr-visual.gnr-hero{
      border:0;
      border-radius:22px;
      overflow:hidden;
      box-shadow: 0 18px 50px rgba(0,0,0,.18);
      background:#0b0f1a;
      position:relative;
    }
    .gnr-visual.gnr-hero:before{
      content:"";
      display:block;
      padding-top:56.25%;
      background:
        radial-gradient(80% 60% at 70% 20%, rgba(34,197,94,.22), rgba(0,0,0,0) 60%),
        linear-gradient(135deg, #0b0f1a, #111827 55%, #7c3aed);
    }
    .gnr-visual.gnr-hero img.gnr-img{
      position:relative;
      margin-top:-56.25%;
    }

    /* Right rail cards */
.railCard{
  border:1px solid rgba(0,0,0,.08);
  border-radius: var(--radius);
  background: rgba(255,255,255,.82);
  box-shadow: 0 16px 50px rgba(0,0,0,.08);
  overflow:hidden;
  color: rgba(11,15,26,.82);
}

    .railCard .hd{
      padding:14px 16px 10px;
      border-bottom:1px solid rgba(0,0,0,.08);
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
    }
.railCard .hd h3{
  margin:0;
  font-size:13px;
  letter-spacing:.14em;
  text-transform:uppercase;
  color: rgba(11,15,26,.88);
}

    .railCard .bd{padding:14px 16px 16px;}
    .railCard p{margin:0 0 10px; color: rgba(11,15,26,.72); font-size:13px; line-height:1.5;}

    textarea, input, select{
      width:100%;
      border-radius: 14px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(0,0,0,.25);
      color: rgba(255,255,255,.92);
      padding: 12px 12px;
      outline:none;
      transition: border-color .15s ease, transform .15s ease;
    }
    textarea:focus, input:focus, select:focus{
      border-color: rgba(124,58,237,.55);
      box-shadow: 0 0 0 6px rgba(124,58,237,.12);
    }
    textarea{min-height: 92px; resize: vertical;}
    .mono{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      min-height: 240px;
    }

    .row{display:flex; gap:10px; flex-wrap:wrap;}
    .row > *{flex:1; min-width: 220px;}
    .small{font-size:12px;color:rgba(255,255,255,.62)}
    .divider{height:1px; background: rgba(255,255,255,.10); margin:12px 0;}

    /* Sticky action bar */
    .actionBar{
      position:fixed;
      left:0; right:0;
      bottom:0;
      padding:14px 14px 16px;
      z-index: 9998;
      background: linear-gradient(180deg, rgba(5,6,10,0), rgba(5,6,10,.82) 30%, rgba(5,6,10,.92));
      backdrop-filter: blur(10px);
    }
    .actionInner{
      max-width: 1100px;
      margin: 0 auto;
      display:flex;
      gap:12px;
      align-items:center;
      justify-content:space-between;
      flex-wrap:wrap;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      border-radius: 18px;
      padding: 12px 12px;
      box-shadow: 0 18px 70px rgba(0,0,0,.45);
    }
    .actionLeft{
      display:flex;
      flex-direction:column;
      gap:3px;
      min-width: 220px;
    }
    .actionLeft .title{
      font-weight:800;
      letter-spacing:.04em;
    }
    .actionLeft .hint{
      font-size:12px;
      color: var(--muted);
    }
    .btns{display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:flex-end;}
    button{
      border-radius: 14px;
      border:1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.06);
      color:#fff;
      padding: 11px 14px;
      font-weight:800;
      letter-spacing:.02em;
      cursor:pointer;
      transition: transform .15s ease, background .15s ease, border-color .15s ease, opacity .15s ease;
      user-select:none;
    }
    button:hover{transform: translateY(-1px); background: rgba(255,255,255,.10); border-color: rgba(255,255,255,.22);}
    button:disabled{opacity:.45; cursor:not-allowed; transform:none;}
    .primary{
      background: linear-gradient(135deg, rgba(124,58,237,.95), rgba(34,197,94,.75));
      border-color: rgba(255,255,255,.22);
      box-shadow: 0 14px 40px rgba(124,58,237,.22);
    }
    .primary:hover{
      background: linear-gradient(135deg, rgba(124,58,237,1), rgba(34,197,94,.9));
    }
    .ghost{
      background: rgba(0,0,0,.25);
    }
/* FIX: Hover contrast for "Enter edit mode" button */
#editToggleBtn{
  color: rgba(11,15,26,.92);
}

#editToggleBtn:hover{
  color: rgba(11,15,26,.92);
  background: rgba(0,0,0,.08);
  border-color: rgba(0,0,0,.18);
}

    /* Toast */
    .toast{
      position:fixed;
      right:16px;
      bottom:96px;
      max-width: 560px;
      padding:12px 14px;
      border-radius: 14px;
      border:1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.55);
      color:#fff;
      font-size:14px;
      line-height:1.35;
      box-shadow: 0 18px 55px rgba(0,0,0,.35);
      display:none;
      z-index: 9999;
      backdrop-filter: blur(10px);
    }

    /* Modal */
    .modalBack{
      position:fixed; inset:0;
      background: rgba(0,0,0,.62);
      display:none;
      align-items:center;
      justify-content:center;
      z-index: 10000;
      padding: 18px;
      backdrop-filter: blur(8px);
    }
    .modal{
      width: min(720px, 100%);
      border-radius: 22px;
      border:1px solid rgba(255,255,255,.14);
      background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04));
      box-shadow: 0 28px 90px rgba(0,0,0,.55);
      overflow:hidden;
    }
    .modalHd{
      padding:16px 18px 12px;
      border-bottom:1px solid rgba(255,255,255,.10);
    }
    .modalHd h3{margin:0; font-size:14px; letter-spacing:.14em; text-transform:uppercase;}
    .modalBd{padding:14px 18px 16px; color: var(--muted); line-height:1.55;}
    .modalBd b{color:#fff;}
    .modalFt{
      padding: 12px 18px 16px;
      display:flex;
      gap:10px;
      justify-content:flex-end;
      border-top:1px solid rgba(255,255,255,.10);
    }

    /* State helpers */
    .hide{display:none !important;}

/* ============================================================
   CONTRAST FIX: Top step chips (Preview / Tweak / Direction)
   ============================================================ */

/* Make chip text readable on light glass */
.chip{
  background: rgba(255,255,255,.72) !important;
  border: 1px solid rgba(0,0,0,.10) !important;
  color: rgba(11,15,26,.92) !important;
  box-shadow: 0 10px 26px rgba(0,0,0,.10) !important;
}

.chip b{
  color: rgba(11,15,26,.92) !important;
}

.chip .small{
  color: rgba(11,15,26,.62) !important;
}

/* Keep active chip clearly highlighted */
.chip.active,
.chip[data-active="1"]{
  background: rgba(11,15,26,.92) !important;
  border-color: rgba(0,0,0,.25) !important;
  color: #fff !important;
}

.chip.active b,
.chip[data-active="1"] b{
  color: #fff !important;
}

.chip.active .small,
.chip[data-active="1"] .small{
  color: rgba(255,255,255,.74) !important;
}

    

/* ============================================================
   CONTRAST FIX: Right-column railCards (Direction / What Happens)
   ============================================================ */
.railCard .small{
  color: rgba(11,15,26,.52);
}
.railCard .bd b{
  color: rgba(11,15,26,.92);
}
.railCard textarea,
.railCard input,
.railCard select{
  background: rgba(0,0,0,.04);
  border-color: rgba(0,0,0,.12);
  color: rgba(11,15,26,.88);
}
.railCard textarea::placeholder,
.railCard input::placeholder{
  color: rgba(11,15,26,.38);
}
.railCard .ghost{
  background: rgba(11,15,26,.08);
  color: rgba(11,15,26,.82);
  border: 1px solid rgba(0,0,0,.10);
}
.railCard .ghost:hover{
  background: rgba(11,15,26,.14);
}


  </style>
</head>

<body>
  <div class="wrap">

    <div class="topbar">
      <div class="brand">
        <div class="mark" aria-hidden="true"></div>
        <div>
          <h1 id="pageTitle">Review your draft</h1>
          <div class="sub">GNR Media • Member Edition</div>
        </div>
      </div>

      <div class="statusPill" role="status" aria-live="polite">
        <div class="statusLeft">
          <div class="dot" id="statusDot"></div>
          <div>
            <div class="statusTxt" id="statusText">LOADING</div>
            <div class="statusMeta" id="statusMeta">Validating link…</div>
          </div>
        </div>
        <div class="statusMeta" id="expiresAt"></div>
      </div>
    </div>

    <div class="panel">
      <div class="steps">
        <div class="chip" data-jump="#step1"><span class="n">1</span><b>Preview</b><span class="small">see it published</span></div>
        <div class="chip" data-jump="#step2"><span class="n">2</span><b>Tweak</b><span class="small">optional edits</span></div>
        <div class="chip" data-jump="#step3"><span class="n">3</span><b>Direction</b><span class="small">future articles</span></div>
      </div>

      <div class="panelHeader">
        <div>
          <h2>Client Review</h2>
          <p>
            This is your draft in <b>published format</b>. If you want changes, you can edit the draft (optional) before accepting.
          </p>
        </div>
        <div class="small" id="linkHint">Secure link</div>
      </div>

      <div class="panelBody">
        <div class="grid">

          <!-- LEFT: Preview -->
          <div>
            <div id="step1"></div>

            <div class="previewShell">
              <div class="previewTop">
                <div class="badge"><i></i> Published preview</div>
                
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                  <a id="openFullPreviewBtn" href="#" target="_blank" rel="noopener"
                     style="
                       display:inline-flex; align-items:center; gap:8px;
                       padding:8px 10px; border-radius:999px;
                       background: rgba(11,15,26,.92);
                       color:#fff; text-decoration:none;
                       font-size:12px; letter-spacing:.12em; text-transform:uppercase;
                       border:1px solid rgba(0,0,0,.25);
                     ">
                    Open full preview ↗
                  </a>
                  <div class="hint">Reader-grade view</div>
                </div>
              </div>
              <div class="previewBody">
                <div class="phoneFrame" aria-label="Mobile preview frame">
                  <div class="phoneNotch" aria-hidden="true"></div>
                  
                  <!-- IMPORTANT: keep this id exactly the same so review-ui.js still finds it -->
                  <div class="phoneScreen" id="publishedPreview">Loading preview...</div>
                </div>
              </div>
            </div>

            <div style="height:16px"></div>

            <!-- EDITOR -->
            <div id="step2"></div>
            <div class="panel" style="margin-top:12px; box-shadow:none;">
              <div class="panelHeader">
                <div>
                  <h2>Optional tweaks</h2>
                  <p>Only open edit mode if you want to adjust wording. Otherwise, accept as-is.</p>
                </div>
              </div>
              <div class="panelBody">

                <div class="row">
                  <button id="editToggleBtn" class="ghost" type="button">Enter edit mode</button>
                  <button id="saveDraftBtn" class="primary hide" type="button">Save changes</button>
                </div>

                <div class="divider"></div>

                <div id="editorWrap" class="hide">
                  <div class="small" style="margin-bottom:8px">
                    Tip: keep changes minimal. We’ll preserve the overall structure.
                    <span id="dirtyState" style="margin-left:10px;color:rgba(255,255,255,.75)"></span>
                  </div>
                  <textarea id="draftText" class="mono" placeholder="Loading draft…"></textarea>
                </div>

                <div style="height:10px"></div>

                <div class="railCard" style="background: rgba(255,255,255,.72); border-color: rgba(0,0,0,.08)">
                  <div class="hd">
                    <h3>Swap images</h3>
                    <span class="small">optional</span>
                  </div>
                  <div class="bd">
                    <p>Paste a public <b>https://</b> image URL to replace an image slot.</p>
                    <div class="row">
                      <div>
                        <label class="small">Image slot</label>
                        <select id="clientVisualKey">
                          <option value="hero">hero (feature image)</option>
                        </select>
                      </div>
                      <div style="flex:2">
                        <label class="small">Image URL</label>
                        <input id="clientImageUrl" placeholder="https://..." />
                        <div class="small" style="margin-top:6px">Use a direct image URL (jpg/png/webp). Some sites block embedding.</div>
                      </div>
                    </div>
                    <div style="margin-top:12px">
                      <label class="small">Or upload from your device</label>
                      <input id="clientImageFile" type="file" accept="image/*"
                             style="margin-top:6px; font-size:13px; color:rgba(11,15,26,.72);" />
                      <div class="small" style="margin-top:6px">Max 2 MB. The image fills the URL field automatically.</div>
                    </div>

                    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px">
                      <button id="clientSaveVisualBtn" class="primary" type="button">Save image</button>
                      <button id="clientPreviewVisualBtn" class="ghost" type="button">Preview</button>
                    </div>

                    <div style="margin-top:12px;border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:10px;background:rgba(0,0,0,.03);">
                      <img id="clientImagePreview" alt="Preview" style="display:none; max-width:100%; height:auto; border-radius:14px; border:1px solid rgba(255,255,255,.10);" />
                      <div id="clientImagePreviewEmpty" class="small">(no preview yet)</div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>

          <!-- RIGHT: Guidance -->
          <div>
            <div id="step3"></div>

            <div class="railCard">
              <div class="hd">
                <h3>Direction for future articles</h3>
                <span class="small" id="guidanceSavedHint">Saved across all future drafts</span>
              </div>
              <div class="bd">
                <p><b>This shapes every future article</b> you receive — not just this one.</p>

                <label class="small">What should we emphasise?</label>
                <textarea id="followEmphasis" placeholder="Example: Practical steps, calm authority, cost transparency."></textarea>

                <div style="height:10px"></div>

                <label class="small">What should we avoid?</label>
                <textarea id="followAvoid" placeholder="Example: No hype, no guarantees, no salesy tone."></textarea>

                <div style="height:10px"></div>

                <label class="small">Future topics / direction</label>
                <textarea id="futureTopics" style="min-height:140px" placeholder="Example: Pricing, common mistakes, how to choose the right option…"></textarea>

                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px">
                  <button id="saveTopicsBtn" class="ghost" type="button">Save direction</button>
                </div>

                <div class="small" style="margin-top:10px;color:rgba(255,255,255,.58)">
                  Your saved guidance helps the next article sound more like you.
                </div>
              </div>
            </div>

            <div style="height:12px"></div>

            <div class="railCard" style="background: rgba(255,255,255,.72)">
              <div class="hd">
                <h3>What happens after accept?</h3>
                <span class="small">automatic</span>
              </div>
              <div class="bd">
                <p>Once accepted:</p>
                <div class="small">
                  • Your draft is locked as approved<br/>
                  • Publishing can trigger automatically (if enabled)<br/>
                  • Your guidance is saved for future articles
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>

  </div>

  <!-- Sticky action bar -->
  <div class="actionBar">
    <div class="actionInner">
      <div class="actionLeft">
        <div class="title" id="actionTitle">Review link loading…</div>
        <div class="hint" id="actionHint">Please wait</div>
      </div>
      <div class="btns">
        <button id="jumpPreviewBtn" class="ghost" type="button">Preview</button>
        <button id="jumpEditBtn" class="ghost" type="button">Tweak</button>
        <button id="acceptBtn" class="primary" type="button">Accept draft</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <!-- Modal -->
  <div class="modalBack" id="modalBack" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal">
      <div class="modalHd">
        <h3 id="modalTitle">Confirm acceptance</h3>
      </div>
      <div class="modalBd">
        You’re about to approve this draft. <b>This locks the article</b> and can trigger publishing automatically (if enabled).
        <div style="height:10px"></div>
        If you want edits, enter edit mode first.
      </div>
      <div class="modalFt">
        <button id="modalCancelBtn" class="ghost" type="button">Cancel</button>
        <button id="modalConfirmBtn" class="primary" type="button">Yes — accept</button>
      </div>
    </div>
  </div>


  <!-- UI controller -->
  <script src="/assets/review-ui.js?v=wow-b1" defer></script>
</body>
</html>`.trim();
}
