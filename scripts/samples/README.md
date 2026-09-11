# 真实生产样本（原样保存，勿修改）

这里放的是**从实际内容流程拿到的原始文件**，用于对照字段结构与本平台的校验行为。
与 `scripts/fixtures/` 的区别：

| 目录 | 用途 | 是否会被冒烟检查上传 |
|---|---|---|
| `scripts/samples/` | 真实生产样本，原样保存作为参考依据 | ❌ 不会（冒烟检查只上传 `fixtures/`） |
| `scripts/fixtures/` | 冒烟检查的输入，必须是**可发布**的合规数据 | ✅ 会 |

## user-story-example-user-raw.json ⚠️ 当前会被拒

这份真实用户故事文件**过不了参考脚本自己的 preflight**：

```
user_info.handle       = ""   → 脚本 raise 'user_info.handle cannot be empty'
user_info.profile_url  = ""   → 脚本 raise 'user_info.profile_url must be a complete URL'
```

它不是本平台规则太严 —— `publish_user_stories.py` 里写死了
`for field in ("name", "handle", "profile_url")` 三个都必须非空。

另外它带了脚本不认识的字段（`user_info.platform` / `user_info.profile_cta`），
并且同时携带了一个 `community_source`。

**需要确认**：是文件需要补全这三个字段，还是新流程已经改成别的必填项
（例如只需要 `name`，其余由模板填充）？确认后我会对齐规则。
