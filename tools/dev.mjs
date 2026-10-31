// Local server running the exact built _worker.js on Node (for headless tests). Env: MODEL_API_KEY, META_BASE_URL, PORT.
import http from "node:http";
const worker = (await import("../pages-dist/_worker.js?" + Date.now())).default;
const env = { MODEL_API_KEY: process.env.MODEL_API_KEY, META_BASE_URL: process.env.META_BASE_URL, ALLOW_INSECURE_STORE: process.env.ALLOW_INSECURE_STORE };
const port = +process.env.PORT || 8788;
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log("dev on", port, env.MODEL_API_KEY ? "LIVE" : "DEMO"));
