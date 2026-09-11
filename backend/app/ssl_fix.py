"""macOS 上的 CA 证书修复。

python.org 的官方 Python 安装包不会配置任何可信 CA 根证书，
导致 `ssl.create_default_context()` 里 **0 个 CA**（可以自己验证），
于是 urllib / requests 这类走标准上下文的库会报
CERTIFICATE_VERIFY_FAILED。

httpx 默认用 certifi，不受影响；但为了不让后续模块踩坑
（以及和 GEO/geo_app/ssl_fix.py 的处理保持一致），这里统一兜底：
把 SSL_CERT_FILE 指向一个可用的 CA 包。

优先 certifi，其次 macOS 常见的 /etc/ssl/cert.pem。
"""

from __future__ import annotations

import os
import ssl
from pathlib import Path


def _find_ca_file() -> str | None:
    candidates: list[str] = []

    try:
        import certifi  # type: ignore

        candidates.append(certifi.where())
    except Exception:  # pragma: no cover - certifi 一定随 httpx 安装
        pass

    candidates.extend(
        [
            "/etc/ssl/cert.pem",
            "/etc/ssl/certs/ca-certificates.crt",
        ]
    )

    for cafile in candidates:
        try:
            if not os.path.exists(cafile):
                continue
            ssl.create_default_context(cafile=cafile)
            return cafile
        except Exception:
            continue

    return None


def apply_ssl_fix() -> str | None:
    """设置 SSL_CERT_FILE（仅当当前未设置时）。返回生效的 CA 文件路径。"""
    cafile = _find_ca_file()
    if not cafile:
        return None

    os.environ.setdefault("SSL_CERT_FILE", cafile)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", cafile)
    return cafile


APPLIED_CAFILE = apply_ssl_fix()


def describe() -> dict[str, object]:
    """供 /api/health 展示，便于排查环境问题。"""
    context = ssl.create_default_context()
    return {
        "ca_file": APPLIED_CAFILE,
        "default_context_ca_count": len(context.get_ca_certs()),
        "python": os.sys.version.split()[0],
        "project_root": str(Path(__file__).resolve().parents[2]),
    }
