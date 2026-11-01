# Sandbox-only: the sandbox proxy rejects browser fetches to Hugging Face (405), so tests fetch HF files server-side
# and fulfil the browser request (real users hit HF directly). Cached in memory per process.
import os, ssl, urllib.request, urllib.error
_ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE")) if os.environ.get("SSL_CERT_FILE") else None
_cache = {}
def hf_route(route):
    url = route.request.url
    try:
        if url not in _cache:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120, context=_ctx) as r:
                _cache[url] = (r.status, r.read(), r.headers.get("Content-Type", "application/octet-stream"))
        st, body, ct = _cache[url]
        route.fulfill(status=st, body=body, headers={"Content-Type": ct, "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin"})
    except urllib.error.HTTPError as e: route.fulfill(status=e.code, body=e.read(), headers={"Access-Control-Allow-Origin": "*"})
