"""运行期站点配置注入。

背景：前端配置原本只能在 `pnpm build` 时烘焙进产物，于是"想用真实配置"就必须把
`site.config.local.json` 放进构建上下文 —— 构建出的镜像就带上真实域名/品牌、不能公开。
改成**后端在响应 index.html 时注入**之后，镜像永远是通用版，换部署只是换挂载的配置文件。

钉三件容易错的事：

1. 注入位置在 `</head>` 之前 —— 页面里的模块脚本是 defer 的，正常都会在它之后执行，
   但把配置放前面才不依赖"defer 一定晚于 head 里的脚本"这种隐含假设
2. JSON 里的 `</` 必须转义 —— 配置值一旦含 `</script>` 就会把脚本截断
3. 有构建产物才注入，且注入过的 HTML **不能缓存**（它带着配置）
"""

from __future__ import annotations

import json
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import main

INDEX_HTML = (
    "<html><head><title>t</title></head><body><div id='root'></div></body></html>"
)


def _extract(html: str) -> dict:
    """从 HTML 里把注入的配置取回来（顺便证明它是合法 JSON）。"""
    match = re.search(r"window\.__SITE_CONFIG__=(.*?)</script>", html)
    assert match, "index.html 里没有注入配置"
    return json.loads(match.group(1).replace("<\\/", "</"))


def test_inject_puts_script_before_head_close():
    out = main.inject_site_config(INDEX_HTML, {"a": 1})

    assert out.index("__SITE_CONFIG__") < out.index("</head>")
    assert _extract(out) == {"a": 1}


def test_inject_escapes_closing_script_tag():
    value = "</script><script>alert(1)</script>"
    out = main.inject_site_config(INDEX_HTML, {"x": value})

    # 只剩我们自己那一个收尾标签 —— 配置值没能把脚本截断
    assert out.count("</script>") == 1
    assert _extract(out) == {"x": value}


def test_inject_without_head_prepends():
    out = main.inject_site_config("<body>hi</body>", {"a": 1})

    assert out.startswith("<script>")
    assert _extract(out) == {"a": 1}


def test_inject_keeps_text_outside_script():
    out = main.inject_site_config(INDEX_HTML, {"a": 1})

    assert '<div id="root">' in out.replace("'", '"')


class _FakeSiteConfig:
    """只用到 `.raw`，用假的避免依赖真实配置内容。"""

    def __init__(self, raw: dict) -> None:
        self.raw = raw


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """独立挂一个小 app：不依赖仓库里有没有构建产物（CI 上就没有）。"""
    (tmp_path / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log(1)\n", encoding="utf-8")

    monkeypatch.setattr(main, "_frontend_dist", tmp_path)
    monkeypatch.setattr(
        main, "site_config", _FakeSiteConfig({"brand": {"name": "注入品牌"}})
    )

    app = FastAPI()
    app.mount("/", main.SpaStaticFiles(directory=str(tmp_path), html=True), name="frontend")
    return TestClient(app)


def test_root_serves_injected_config_and_is_not_cached(client):
    response = client.get("/")

    assert response.status_code == 200
    assert _extract(response.text) == {"brand": {"name": "注入品牌"}}
    assert response.headers["cache-control"] == "no-store"


def test_spa_fallback_is_also_injected(client):
    """客户端路由直接打开时磁盘上没有这个文件，回落页同样要带配置。"""
    response = client.get("/channels/community-post")

    assert response.status_code == 200
    assert _extract(response.text)["brand"]["name"] == "注入品牌"


def test_static_asset_is_served_untouched(client):
    response = client.get("/assets/app.js")

    assert response.status_code == 200
    assert "__SITE_CONFIG__" not in response.text


def test_no_dist_means_no_injection(monkeypatch):
    monkeypatch.setattr(main, "_frontend_dist", None)

    assert main._runtime_index_html() is None


def test_title_replaced_from_config():
    """浏览器标题也要跟着配置走，否则标签页还显示占位名。"""
    out = main.inject_site_config(
        INDEX_HTML, {"brand": {"name": "真实品牌", "subtitle": "店铺副标题"}}
    )

    assert "<title>真实品牌 · 店铺副标题</title>" in out
    assert "<title>t</title>" not in out


def test_title_without_subtitle_is_just_brand():
    out = main.inject_site_config(INDEX_HTML, {"brand": {"name": "真实品牌"}})

    assert "<title>真实品牌</title>" in out


def test_title_keeps_placeholder_when_no_brand():
    out = main.inject_site_config(INDEX_HTML, {"brand": {}})

    assert "<title>t</title>" in out


def test_title_is_html_escaped():
    out = main.inject_site_config(INDEX_HTML, {"brand": {"name": "<script>x</script>"}})

    assert "<title>&lt;script&gt;x&lt;/script&gt;</title>" in out
