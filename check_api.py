import json, urllib.request, sys

BASE = "http://localhost:3000"

def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.loads(r.read().decode("utf-8"))

def post(path, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))

cfg = get("/api/config")
print("config: platforms=%d parsers=%d dramaSites=%d" % (
    len(cfg["platforms"]), len(cfg["parsers"]), len(cfg["dramaSites"])))

# 关键：中文参数（虾米视频解析）走 POST /api/parse
res = post("/api/parse", {"url": "https://www.iqiyi.com/v_test.html", "api": "虾米视频解析"})
print("parse(ok=%s) -> %s" % (res.get("ok"), res.get("parseUrl")))

# 默认解析器（不传 api）
res2 = post("/api/parse", {"url": "https://v.qq.com/x/cover/xyz.html"})
print("parse default -> %s" % res2.get("parseUrl"))

# 影视导航
drama = post("/api/drama", {})
print("drama -> %s" % drama.get("navigateUrl"))
