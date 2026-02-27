// Repo: gnr-blog-ai
// Path: functions/api/blog/publish/confirm.js

function json(obj,status=200){
  return new Response(JSON.stringify(obj,null,2),{
    status,
    headers:{ "content-type":"application/json; charset=utf-8" }
  });
}

async function sha256Hex(text){
  const data=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest("SHA-256",data);
  return Array.from(new Uint8Array(digest))
    .map(b=>b.toString(16).padStart(2,"0")).join("");
}

export async function onRequest(context){
  const { request, env } = context;
  if(request.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);

  const body=await request.json().catch(()=>({}));
  const t=String(body.t||"").trim();
  const live_url=String(body.live_url||"").trim();
  if(!t||!live_url) return json({ok:false,error:"missing_fields"},400);

  const pepper=String(env.REVIEW_TOKEN_PEPPER||"");
  const token_hash=await sha256Hex(`v1|publish_setup|${pepper}|${t}`);
  const db=env.GNR_MEDIA_BUSINESS_DB;

  const tok=await db.prepare(`
    SELECT draft_id
      FROM blog_publish_setup_tokens
     WHERE token_hash = ?
     LIMIT 1
  `).bind(token_hash).first();

  if(!tok) return json({ok:false,error:"invalid_token"},404);

  const draft_id=tok.draft_id;

  const draft=await db.prepare(`
    SELECT title, content_markdown
      FROM blog_drafts
     WHERE draft_id = ?
  `).bind(draft_id).first();

  if(!draft) return json({ok:false,error:"draft_not_found"},404);

  const resp=await fetch(live_url);
  if(!resp.ok) return json({ok:false,error:"url_not_reachable"},400);

  const html=await resp.text();

  const titleMatch = html.toLowerCase().includes((draft.title||"").toLowerCase());
  const snippetMatch = html.toLowerCase().includes(
    (draft.content_markdown||"").slice(0,120).toLowerCase()
  );

  if(!titleMatch && !snippetMatch){
    return json({ok:false,error:"content_not_detected"},400);
  }

  await db.prepare(`
    UPDATE blog_drafts
       SET published_url = ?,
           published_at = datetime('now'),
           publish_status = 'PUBLISHED_MANUAL'
     WHERE draft_id = ?
  `).bind(live_url,draft_id).run();

  return json({ok:true});
}
