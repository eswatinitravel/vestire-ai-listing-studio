// Cloudflare Pages advanced mode (_worker.js): /api/* -> proxy, everything else -> inlined static files.
import { handleApi } from "./api.js";
import { ASSETS } from "./_assets.gen.js";

const decoded = new Map();
function asset(path) {
  const a = ASSETS[path]; if (!a) return null;
  if (!decoded.has(path)) decoded.set(path, a.b64 ? Uint8Array.from(atob(a.body), (c) => c.charCodeAt(0)) : a.body);
  return { type: a.type, body: decoded.get(path) };
}
const SEC = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "camera=(self)" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(request, env); } catch (e) { return new Response(JSON.stringify({ error: e.message || "Server error" }), { status: 500, headers: { "Content-Type": "application/json" } }); }
    }
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const a = asset(p);
    if (!a) return new Response("Not found", { status: 404 });
    const cache = p === "/index.html" ? "no-cache" : "public, max-age=3600";
    return new Response(a.body, { headers: { "Content-Type": a.type, "Cache-Control": cache, ...SEC } });
  },
};
