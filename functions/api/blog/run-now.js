import { handleRunNow } from "../../_lib/blog-handlers.js";

export async function onRequest(context) {
  // context = { request, env, params, waitUntil, next, data }
  return handleRunNow(context);
}
