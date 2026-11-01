import os, urllib.parse
def proxy_cfg():
    px = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if not px: return None
    u = urllib.parse.urlparse(px)
    cfg = {"server": f"{u.scheme}://{u.hostname}:{u.port}"}
    if u.username: cfg["username"] = urllib.parse.unquote(u.username); cfg["password"] = urllib.parse.unquote(u.password or "")
    return cfg
# Use the system Chromium when Playwright's own download is unavailable (sandbox).
import shutil
CHROME = os.environ.get("CHROME") or shutil.which("chromium") or None
def launch_kw(): return {"executable_path": CHROME} if CHROME else {}
