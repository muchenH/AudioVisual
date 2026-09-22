# -*- coding: utf-8 -*-
"""AudioVisual Web 版（Docker）后端 API 自检脚本。

用法：
    python check_api.py [base_url]
默认 base_url = http://localhost:3000

覆盖：健康检查、配置、解析、影视导航、设置持久化、反向代理与 SSRF 防护。
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")

_passed = 0
_failed = 0


def check(name, cond, extra=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print("PASS %s" % name)
    else:
        _failed += 1
        print("FAIL %s %s" % (name, extra))


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def post(path, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE + path, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def http_status(path):
    """返回状态码（不抛异常）。"""
    try:
        with urllib.request.urlopen(BASE + path, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def main():
    # 先恢复默认设置，保证断言稳定。
    post("/api/settings/reset", {})

    check("health", get("/api/health").get("ok") is True)

    cfg = get("/api/config")
    check("config.platforms >= 5", len(cfg["platforms"]) >= 5)
    check("config.parsers >= 15", len(cfg["parsers"]) >= 15)
    check("config.dramaSites >= 4", len(cfg["dramaSites"]) >= 4)

    # 默认解析器（不传 api）。
    p = post("/api/parse", {"url": "https://v.qq.com/x/cover/xyz.html"})
    check("parse default ok", p.get("ok") is True)
    check("parse default isVideoPage", p.get("isVideoPage") is True)
    check("parse default playUrl proxied", str(p.get("playUrl", "")).startswith("/proxy?url="))

    # 中文 label 传参。
    p2 = post("/api/parse", {"url": "https://www.iqiyi.com/v_test.html", "api": "虾米视频解析"})
    check("parse by label ok", p2.get("ok") is True)
    check("parse by label uses given parser", "jx.xmflv.com" in str(p2.get("parseUrl", "")))

    # 影视导航。
    drama = post("/api/drama", {})
    check("drama ok", drama.get("ok") is True and bool(drama.get("navigateUrl")))

    # 设置持久化（自定义解析器应立即可用）。
    custom = [{"label": "自检接口", "value": "https://jx.selftest.example/?url="}]
    post("/api/settings", {"parsers": custom, "dramaSites": None})
    p3 = post("/api/parse", {"url": "https://www.iqiyi.com/v_x.html", "api": "自检接口"})
    check("custom parser usable", p3.get("ok") is True and "jx.selftest.example" in str(p3.get("parseUrl", "")))
    check("custom parser in config", len(get("/api/config")["parsers"]) == 1)

    # 反向代理：SSRF 防护（内网/元数据地址必须被拒）。
    check("proxy rejects 127.0.0.1",
          http_status("/proxy?url=" + urllib.parse.quote("http://127.0.0.1:3000/")) == 400)
    check("proxy rejects metadata",
          http_status("/proxy?url=" + urllib.parse.quote("http://169.254.169.254/")) == 400)
    check("proxy rejects file:",
          http_status("/proxy?url=" + urllib.parse.quote("file:///etc/passwd")) == 400)

    # 还原。
    post("/api/settings/reset", {})
    check("settings reset", get("/api/config")["parsers"] and len(get("/api/config")["parsers"]) >= 15)

    print("\nRESULT: pass=%d fail=%d" % (_passed, _failed))
    return 1 if _failed else 0


if __name__ == "__main__":
    sys.exit(main())
