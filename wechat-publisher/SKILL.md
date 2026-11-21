---
name: wechat-publisher
description: 把一份 Markdown 长文变成可直接粘贴进微信公众号编辑器的内联样式 HTML，并跑完「选题→结构→写作→排版→自检→发布→数据回收」整条流水线。用于公众号文章生产、排版规范化、发布前合规与质量自检、发布后渠道数据复盘。
version: 1.0.0
license: MIT
entry: ./cli.mjs
runtime: node >= 18（无第三方依赖）
---

# wechat-publisher

一条命令级别的公众号文章流水线。核心解决的问题不是"会不会写字"，而是**公众号排版与发布这一段脏活**：微信编辑器会吃掉 `<style>`、`class`、外链样式，只有内联样式能存活；手动排版一小时，改一个字又要重排。本技能把这段固化成可重复执行的代码。

## 何时使用

- 有一篇 Markdown 文章，想 30 秒内得到可粘贴进公众号的 HTML。
- 想在上线前拦住"排版崩了 / 有 script / 外链图片 / 敏感承诺词 / 段落太长手机上挤成一坨"这类事故。
- 想给一篇文章配齐发布包：标题候选、摘要、封面、投放计划、回收表。
- 发布后拿到后台导出数据，想按渠道算出打开率、转发率、涨粉效率。

不要用于：需要账号授权的自动群发（本技能只推**草稿箱**，不替你点发送）；需要图片自动生成的封面设计（只做封面合成与裁剪）。

## 输入

| 输入 | 必填 | 说明 |
| --- | --- | --- |
| `article.md` | 是 | 正文。首个 `# ` 视为标题（不渲染进正文），`##`/`###` 为小节，`---` 为分隔 |
| front matter | 否 | `title / digest / author / cover / source_url` 五个字段，写在文件顶部 `---` 之间 |
| `brief.json` | 否 | 选题单：目标读者、核心主张、证据清单、禁止表述、渠道计划 |
| `tracking.csv` | 否 | 发布后回收数据，表头固定见 `dist/指标定义.md` |
| 环境变量 `WECHAT_APPID` / `WECHAT_APPSECRET` | 推草稿时必填 | 公众号后台「设置与开发 → 基本配置」获取；缺失时命令**显式失败**，不伪造成功 |

## 工作流

1. **定选题**：`node cli.mjs new <slug>` 生成 `brief.json` 骨架。先写"读者是谁、他现在卡在哪、我凭什么说他没听过"，再写标题。
2. **写正文**：先写 Markdown，不要在写作阶段想排版。每个 `##` 小节只承担一个论点，段落控制在 3 行内（手机满屏约 180 字）。
3. **渲染**：`node cli.mjs render <article.md>` → 生成 `<slug>.html` + `<slug>.meta.json`。所有块级元素带内联样式，无 `class`、无 `<style>`、无 `<script>`。
4. **自检**：`node cli.mjs check <article.html>` → `report.json` / `report.md`，硬错误返回非 0，直接拦住发布。
5. **打包发布**：`node cli.mjs static <article.html>` 生成可静态托管版本（拿到公网链接）；`node cli.mjs wechat <article.html>` 推公众号草稿箱。
6. **回收**：后台导出数据填进 `dist/数据回收表.csv`，`node cli.mjs track <csv>` 输出渠道对比报告。

## 命令速查

```bash
node cli.mjs new    my-post              # 生成 brief.json 骨架
node cli.mjs render posts/my-post.md      # Markdown -> 内联样式 HTML
node cli.mjs check  posts/my-post.html    # 排版/合规自检，硬错误 exit 1
node cli.mjs static posts/my-post.html    # 生成 site/ 静态站 + 首页索引
node cli.mjs wechat posts/my-post.html    # 推草稿箱（需凭据）
node cli.mjs track  dist/数据回收表.csv    # 渠道数据复盘
node cli.mjs all    posts/my-post.md      # render + check 一步到位
```

## 输出

```
posts/<slug>.html        公众号正文 HTML（内联样式，可直接全选粘贴）
posts/<slug>.meta.json   title / digest / author / cover / 字数 / 小节数
posts/<slug>.report.json 自检结构化结果（errors / warnings / metrics）
posts/<slug>.report.md   自检人读版（含每条问题的定位与修复建议）
site/index.html          静态首页（文章列表）
site/<slug>.html         公网可访问的文章页（同一份公众号 HTML）
```

## 硬错误 vs 警告

**硬错误（阻断发布）**：出现 `<script>`；出现 `<style>` 或外链 `<link rel=stylesheet>`；出现 `class=`；正文 CJK 字数 < 600；无任何 `##` 小节；无标题。

**警告（人工判断）**：单段 > 180 字（手机阅读体验）；使用表格（公众号表格窄屏易错位）；图片缺 `alt`；标题 > 64 字（公众号标题上限）；摘要 > 120 字；命中承诺类/诱导类词表（"第一""保证""100%""转发到朋友圈"等）；正文出现小于 12px 的字号。

## 失败处理

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `E_NO_CREDENTIALS` | 未设置 `WECHAT_APPID`/`WECHAT_APPSECRET` | 去公众号后台取凭据；本技能不会用占位符假装成功 |
| `E_TOKEN` (40164/40001) | IP 未加白名单或 secret 错 | 后台「基本配置 → IP 白名单」加上出口 IP |
| `E_NO_THUMB` | 草稿必须有封面 `thumb_media_id` | 先 `material/add_material` 上传封面图，或用 `--cover` 指定本地图片自动上传 |
| 粘贴后样式全丢 | 用了 `class` 或 `<style>` | 跑 `check`，硬错误会直接指出行号 |

## 自检（提交前跑一遍）

```bash
node wechat-publisher/tests/self_test.mjs
```

覆盖：内联样式覆盖率、script/style/class 拦截、超长段落检出、敏感词检出、空正文拒绝、重复渲染幂等（同输入两次输出 sha256 相同）。

## 设计边界

- 只做**单篇**文章；不做矩阵号批量分发。
- 不替你编数据。文章里的每个数字要么来自 brief 的 `evidence` 字段，要么标注来源；`check` 会统计"数字密度"，但不会替你核实真伪。
- 群发是人工动作：草稿推上去后仍需人在后台点发送，这是刻意保留的人工闸门。
