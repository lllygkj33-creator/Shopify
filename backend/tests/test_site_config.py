"""站点配置加载器。

这是「通用化」的地基：所有部署信息（域名、品牌、产品名、栏目表）都从这里读。
加载器本身有三件容易错的事，各钉一条：

1. 深合并：字典逐层合并，**数组整体替换**（合并数组会把本地覆盖和默认值混在一起）
2. `${a.b}` 展开：避免同一个域名写两遍
3. 两级文件：base（提交） + local（gitignore）覆盖
"""

from __future__ import annotations

import json

import pytest

from app.site_config import SiteConfig, _deep_merge


def test_deep_merge_merges_dicts_but_replaces_lists():
    base = {"a": {"x": 1, "y": 2}, "list": [1, 2, 3], "keep": "base"}
    override = {"a": {"y": 9}, "list": [7]}

    merged = _deep_merge(base, override)

    assert merged["a"] == {"x": 1, "y": 9}
    # 数组整体替换：合并会得到 [1,2,3,7]，那不是「覆盖」的意思
    assert merged["list"] == [7]
    assert merged["keep"] == "base"


def test_token_expansion_pulls_values_from_the_same_config():
    config = SiteConfig(
        {
            "community": {"threadPrefix": "https://forum.example.org/t/"},
            "channels": [
                {"id": "c", "page": {"sourceFieldPrefixes": {"url": "${community.threadPrefix}"}}}
            ],
        }
    )

    prefixes = config.page_spec("c")["sourceFieldPrefixes"]

    assert prefixes["url"] == "https://forum.example.org/t/"


def test_token_pointing_nowhere_raises_with_the_path():
    with pytest.raises(KeyError, match="community.threadPrefix"):
        SiteConfig({"channels": [{"id": "c", "page": {"u": "${community.threadPrefix}"}}]})


def test_local_values_win_over_base(tmp_path, monkeypatch):
    base = tmp_path / "site.config.json"
    local = tmp_path / "site.config.local.json"
    base.write_text(
        json.dumps({"storefront": {"domain": "shop.example.com"}, "brand": {"name": "A"}}),
        encoding="utf-8",
    )
    local.write_text(
        json.dumps({"storefront": {"domain": "shop.mine.test"}}), encoding="utf-8"
    )

    import app.site_config as module

    monkeypatch.setattr(module, "BASE_FILE", base)
    monkeypatch.setattr(module, "LOCAL_FILE", local)

    loaded = module._load()

    assert loaded.storefront_domain == "shop.mine.test"
    # 本地没提的项保持默认
    assert loaded.brand_name == "A"


def test_repository_config_ships_generic_placeholders():
    """提交进仓库的那份必须是通用占位值 —— 这是「不带自己店铺信息」的保证。"""
    from app.site_config import BASE_FILE

    raw = json.loads(BASE_FILE.read_text(encoding="utf-8"))

    assert raw["storefront"]["domain"].endswith("example.com")
    assert raw["firstPartySuffixes"] == ["example.com"]
    blob = BASE_FILE.read_text(encoding="utf-8")
    for leaked in ("zimaspace", "zimaboard", "ZimaCube", "ZimaBoard"):
        assert leaked.lower() not in blob.lower(), f"仓库配置里不该出现 {leaked}"
