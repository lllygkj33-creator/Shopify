"""本地存储层（SQLite）。

## 为什么本地存，而不是每次去 Shopify 拉

实测确认 Shopify 侧能读到排期（`articles` / `pages` 的 `published_at` +
`isPublished` + `templateSuffix`，日期筛选与游标分页都可用），但**不能当唯一数据源**：

| 需求 | 为什么必须本地存 |
|---|---|
| 发布失败 | Shopify 里根本不存在这条记录；PRD §5 要「失败可重试并记录原因」 |
| 草稿 vs 已排期 | 都是 `isPublished:false`；本地有明确 status |
| 来源追溯 | 哪个 JSON 文件、哪个候选、`publish_key` —— Shopify 不知道 |
| 6 个月甘特图 | 按栏目分组走 API 要几百分页请求；本地一次 SQL |

Shopify 侧留作**事实校验与回填**（见 `docs/ui-actions.md` 的数据流说明）：
导入既有内容、定时对账（到点后 Shopify 自己把 isPublished 翻成 true）。

## 幂等

`publish_key` 上有唯一索引，写入用 upsert。所以同一篇文章重复提交不会产生多行，
失败重试也是更新同一行 —— 这与发布器里的 `publish_key` 去重逻辑一致。
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from . import config as app_config

def _resolve_db_path() -> Path:
    """数据库路径。

    默认 `data/zima_shopify.db`；可用环境变量 `DATABASE_PATH` 覆盖
    （`.env.example` 里已经声明了这个变量，测试也用它指向临时文件）。
    """
    configured = os.environ.get("DATABASE_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()
    return app_config.DATA_DIR / "zima_shopify.db"


DB_PATH = _resolve_db_path()

SCHEMA = """
CREATE TABLE IF NOT EXISTS content (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id        TEXT    NOT NULL,
  content_type      TEXT    NOT NULL,
  title             TEXT    NOT NULL DEFAULT '',
  handle            TEXT    NOT NULL DEFAULT '',
  blog_name         TEXT,
  template          TEXT,
  body_html         TEXT    NOT NULL DEFAULT '',
  summary           TEXT,
  meta_title        TEXT,
  meta_description  TEXT,
  author            TEXT,
  reviewer          TEXT,
  related_products  TEXT,
  tags              TEXT,
  status            TEXT    NOT NULL,
  scheduled_at      TEXT,
  published_at      TEXT,
  published_url     TEXT,
  shopify_gid       TEXT,
  shopify_kind      TEXT,
  error             TEXT,
  publish_key       TEXT    UNIQUE,
  source_file       TEXT,
  source_index      INTEGER,
  mode              TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_channel   ON content(channel_id);
CREATE INDEX IF NOT EXISTS idx_content_status    ON content(status);
CREATE INDEX IF NOT EXISTS idx_content_scheduled ON content(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_content_published ON content(published_at);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ContentStore:
    """`content` 表的读写。

    用一把进程内锁 + 每次操作独立连接：本地单机、并发很低，
    这样比维护连接池简单且不会有跨线程问题。
    """

    def __init__(self, path: Path = DB_PATH) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._initialised = False

    # ---------------- 基础设施 ----------------

    @property
    def path(self) -> Path:
        return self._path

    def _connect(self) -> sqlite3.Connection:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self._path, timeout=15)
        connection.row_factory = sqlite3.Row
        # WAL 让读写不互相阻塞（读时间轴的同时还能写新发布结果）
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @contextmanager
    def _cursor(self) -> Iterator[sqlite3.Cursor]:
        with self._lock:
            connection = self._connect()
            try:
                if not self._initialised:
                    connection.executescript(SCHEMA)
                    connection.commit()
                    self._initialised = True
                cursor = connection.cursor()
                yield cursor
                connection.commit()
            finally:
                connection.close()

    # ---------------- 写入 ----------------

    def upsert(self, record: dict[str, Any]) -> dict[str, Any]:
        """按 publish_key 幂等写入。

        `publish_key` 缺失时用 `channel_id|handle` 兜底，保证仍有唯一约束保护。
        """
        now = _now()

        publish_key = str(record.get("publish_key") or "").strip()
        if not publish_key:
            publish_key = f"{record.get('channel_id', '')}|{record.get('handle', '')}"

        payload = {
            "channel_id": record.get("channel_id") or "",
            "content_type": record.get("content_type") or "blog_article",
            "title": record.get("title") or "",
            "handle": record.get("handle") or "",
            "blog_name": record.get("blog_name"),
            "template": record.get("template"),
            "body_html": record.get("body_html") or "",
            "summary": record.get("summary"),
            "meta_title": record.get("meta_title"),
            "meta_description": record.get("meta_description"),
            "author": record.get("author"),
            "reviewer": record.get("reviewer"),
            "related_products": _dump_list(record.get("related_products")),
            "tags": _dump_list(record.get("tags")),
            "status": record.get("status") or "draft",
            "scheduled_at": record.get("scheduled_at"),
            "published_at": record.get("published_at"),
            "published_url": record.get("published_url"),
            "shopify_gid": record.get("shopify_gid"),
            "shopify_kind": record.get("shopify_kind"),
            "error": record.get("error"),
            "publish_key": publish_key,
            "source_file": record.get("source_file"),
            "source_index": record.get("source_index"),
            "mode": record.get("mode"),
            "created_at": now,
            "updated_at": now,
        }

        columns = ", ".join(payload.keys())
        placeholders = ", ".join(f":{key}" for key in payload)
        # 冲突时更新业务字段，保留原 created_at
        updates = ", ".join(
            f"{key} = :{key}"
            for key in payload
            if key not in ("publish_key", "created_at")
        )

        with self._cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO content ({columns}) VALUES ({placeholders})
                ON CONFLICT(publish_key) DO UPDATE SET {updates}
                """,
                payload,
            )
            cursor.execute(
                "SELECT * FROM content WHERE publish_key = ?", (publish_key,)
            )
            row = cursor.fetchone()

        return _row_to_dict(row) if row else {}

    def update_schedule(
        self,
        content_id: int,
        scheduled_at: str,
        *,
        mark_scheduled: bool = True,
    ) -> dict[str, Any] | None:
        """改排期时间。

        `mark_scheduled=False` 时**保持原状态**：用于「本地有记录但 Shopify 上
        还没有对象」的条目（例如发布失败过的）。那种情况下若把它标成 scheduled，
        仪表盘会显示成「待发布」，但实际上没有任何东西会去发布它 —— 状态就成了谎话。
        """
        if mark_scheduled:
            assignment = "scheduled_at = ?, status = 'scheduled', error = NULL"
            params: tuple[Any, ...] = (scheduled_at, _now(), content_id)
        else:
            assignment = "scheduled_at = ?"
            params = (scheduled_at, _now(), content_id)

        with self._cursor() as cursor:
            cursor.execute(
                f"""
                UPDATE content
                   SET {assignment}, updated_at = ?
                 WHERE id = ?
                """,
                params,
            )
            if cursor.rowcount == 0:
                return None
            cursor.execute("SELECT * FROM content WHERE id = ?", (content_id,))
            row = cursor.fetchone()
        return _row_to_dict(row) if row else None

    def cancel_schedule(self, content_id: int) -> dict[str, Any] | None:
        """取消排期：退回草稿。

        **不删除内容**：Shopify 上已经创建的对象仍然存在，只是本地状态回到草稿、
        排期时间清空。这样用户还能重新排期，而不是丢失记录。
        """
        with self._cursor() as cursor:
            cursor.execute(
                """
                UPDATE content
                   SET scheduled_at = NULL, status = 'draft', updated_at = ?
                 WHERE id = ?
                """,
                (_now(), content_id),
            )
            if cursor.rowcount == 0:
                return None
            cursor.execute("SELECT * FROM content WHERE id = ?", (content_id,))
            row = cursor.fetchone()
        return _row_to_dict(row) if row else None

    # ---------------- 读取 ----------------

    def get(self, content_id: int) -> dict[str, Any] | None:
        with self._cursor() as cursor:
            cursor.execute("SELECT * FROM content WHERE id = ?", (content_id,))
            row = cursor.fetchone()
        return _row_to_dict(row) if row else None

    def list_contents(
        self, channel_id: str | None = None, limit: int = 500
    ) -> list[dict[str, Any]]:
        query = "SELECT * FROM content"
        params: list[Any] = []
        if channel_id:
            query += " WHERE channel_id = ?"
            params.append(channel_id)
        query += " ORDER BY COALESCE(scheduled_at, published_at, updated_at) DESC LIMIT ?"
        params.append(limit)

        with self._cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        return [_row_to_dict(row) for row in rows]

    def timeline(
        self, start: str | None = None, end: str | None = None
    ) -> list[dict[str, Any]]:
        """时间轴用：只取有排期或发布时间的条目，按时间排序。"""
        query = """
            SELECT * FROM content
             WHERE COALESCE(scheduled_at, published_at) IS NOT NULL
        """
        params: list[Any] = []
        if start:
            query += " AND COALESCE(scheduled_at, published_at) >= ?"
            params.append(start)
        if end:
            query += " AND COALESCE(scheduled_at, published_at) < ?"
            params.append(end)
        query += " ORDER BY COALESCE(scheduled_at, published_at) ASC"

        with self._cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        return [_row_to_dict(row) for row in rows]

    def stats(self) -> dict[str, int]:
        with self._cursor() as cursor:
            cursor.execute("SELECT status, COUNT(*) AS total FROM content GROUP BY status")
            rows = cursor.fetchall()

        counts = {row["status"]: row["total"] for row in rows}
        return {
            "scheduledCount": counts.get("scheduled", 0),
            "publishedCount": counts.get("published", 0),
            "failedCount": counts.get("failed", 0),
            "draftCount": counts.get("draft", 0),
        }

    def history(
        self, channel_id: str | None = None, limit: int = 200
    ) -> list[dict[str, Any]]:
        """发布历史：排除纯草稿（草稿还没"发布"过）。"""
        query = "SELECT * FROM content WHERE status != 'draft'"
        params: list[Any] = []
        if channel_id:
            query += " AND channel_id = ?"
            params.append(channel_id)
        query += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)

        with self._cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        return [_row_to_dict(row) for row in rows]


def _dump_list(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(list(value), ensure_ascii=False)
    except TypeError:
        return None


def _load_list(value: Any) -> list[Any]:
    if not value:
        return []
    if isinstance(value, list):
        return value
    try:
        loaded = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []
    return loaded if isinstance(loaded, list) else []


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["related_products"] = _load_list(data.get("related_products"))
    data["tags"] = _load_list(data.get("tags"))
    return data


store = ContentStore()

__all__ = ["DB_PATH", "ContentStore", "SCHEMA", "store"]
