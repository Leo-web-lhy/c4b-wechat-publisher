# wechat-publisher · C4B 提交包

把「写公众号」从一次性手工活变成一条可重跑的流水线：选题 → 结构 → 写作 → 排版 → 自检 → 发布 → 数据回收。零第三方依赖，Node ≥ 18。

本包不只是说明文档：**包里的那篇文章就是用这个技能生成的**，链接可以直接打开。

## 一、先看结果（全部真实可访问）

| 交付物 | 地址 / 证据 |
| --- | --- |
| 文章公网链接 | https://leo-web-lhy.github.io/c4b-wechat-publisher/wechat-markdown-formatting.html |
| 站点首页（文章索引） | https://leo-web-lhy.github.io/c4b-wechat-publisher/ |
| 公开仓库 | https://github.com/Leo-web-lhy/c4b-wechat-publisher |
| 仓库提交 | 26 个文件逐字节与本地一致（`MISSING_ON_REMOTE=0`、`BYTE_MISMATCH=0`、`REMOTE_BLOBS=26`），提交记录见仓库 Commits |
| 链接校验 | 2026-11-21 匿名 HTTP GET 返回 `200` + `text/html`，正文约 12.7 KB |

链接不是"应该能通"，是走过一遍的：仓库建好后开启 GitHub Pages（`/docs` 分支目录），前 3 次轮询仍是 404，第 4 次才返回 200——静态托管有构建延迟，所以脚本里写的是轮询而不是 sleep 一次就宣布成功。

## 二、这篇文章自己是证据

生成这篇文章只用了 4 条命令，没有任何手工贴样式：

```bash
node cli.mjs new    drafts/wechat-markdown-formatting      # 生成选题单骨架
node cli.mjs all    drafts/wechat-markdown-formatting.md   # 渲染 + 自检
node cli.mjs static drafts/wechat-markdown-formatting.html --out docs --title "公众号排版笔记"
# 推送仓库 → 开 Pages → 公网链接
```

机器自检结论（`drafts/*.report.md`，未经人工修改）：

| 指标 | 值 |
| --- | --- |
| 硬错误 | **0** |
| 警告 | **1**（`W_TABLE` 正文使用表格，人工判定保留） |
| 标题字数 | 24 |
| 中文正文字数 | 1337 |
| 小节数 | 7 |
| 段落数 | 23 |
| 最长段落 | 70 字（阈值 180） |
| 预计阅读 | 3 分钟 |

那 1 条警告是**故意留下的**：文章要讲"样式被剥离"这个断裂点，两列对照表比列表更省读者的力气。门禁设计成"硬错误拦人、警告交给人判断"，而不是把警告也当错误——否则每次都得关规则。

## 三、为什么必须内联样式

微信编辑器会剥离 `<style>`、`class` 和外链 `<link rel=stylesheet>`，只认行内 `style`。所以本技能的渲染器只做一件事：把一份普通 Markdown 的每个块级元素（段落、标题、引用、列表、代码块、图片）直接写成带内联样式的 HTML，并且**不产出任何** `class=`、`<style>`、`<script>`、外链样式表。

自检把这条规则做成硬错误而不是建议：出现 `<script>`、出现 `<style>` 或外链样式表、出现 `class=`、正文 CJK 少于 600 字、完全没有 `##` 小节、没有标题——六条任意一条命中，`check` 返回非 0，流水线停下。

## 四、六个阶段与失败语义

| 阶段 | 命令 | 输入 → 输出 | 失败时的行为 |
| --- | --- | --- | --- |
| 1 定选题 | `new <slug>` | slug → `brief.json` | slug 冲突直接报错，不覆盖 |
| 2 写正文 | 人工 | Markdown | — |
| 3 渲染 | `render <md>` | `md` → `html` + `meta.json` | 缺标题时报错退出 |
| 4 自检 | `check <html>` | `html` → `report.json` + `report.md` | 有硬错误 `exit 1` |
| 5 发布 | `static <html>` / `wechat <html>` | `html` → 静态站 / 草稿箱 | 缺凭据 `E_NO_CREDENTIALS` 显式失败 |
| 6 回收 | `track <csv>` | 后台导出 CSV → 渠道对比报告 | 表头不符时报出缺失列名 |
| 一步到位 | `all <md>` | `md` → 第 3+4 步 | 任一步失败即中断 |

发布阶段的错误码是明确的，不是笼统的"失败"：`E_NO_CREDENTIALS`（缺 `WECHAT_APPID`/`WECHAT_APPSECRET`）、`E_TOKEN`（40164 / 40001，IP 白名单或凭据失效）、`E_NO_THUMB`（缺封面缩略图素材）。

## 五、数据回收不靠感觉

`track` 读的是公众号后台导出的 CSV，表头固定 `channel,impressions,reads,shares,new_followers,date`，输出三个口径：打开率 = reads/impressions、转发率 = shares/reads、涨粉效率 = new_followers/reads，并按渠道横向对比。指标定义写在 `wechat-publisher/dist/指标定义.md`，回收模板是 `wechat-publisher/dist/数据回收表.csv`。

## 六、目录结构

```
README.md                     本文件（交付索引 + 证据链）
README-文章链接.md             单独一页的公网文章链接（便于评审直接点开）
教学说明.md                    15 分钟上手：每一步做什么、为什么这么设计
AI日志.md                     与 AI 协作的过程记录（阶段 / 决策 / 人工介入）
AAR.md                        事后复盘：做对了什么、哪里返工、下次怎么改
docs/                         静态站（GitHub Pages 源目录）
  index.html                  文章索引
  wechat-markdown-formatting.html   公网文章页
drafts/                       本次真实产出的草稿与证据
  *.brief.json                选题单（读者/痛点/主张/证据/禁止表述）
  *.md                        文章源文件
  *.html                      渲染结果
  *.meta.json / *.report.json / *.report.md   元数据与自检报告
wechat-publisher/             技能本体（可独立复用）
  SKILL.md                    技能说明：输入、工作流、命令、错误码
  cli.mjs                     命令行入口
  lib/markdown.mjs            Markdown 解析与内联渲染
  lib/theme.mjs               排版主题（字号/行距/间距/配色）
  lib/check.mjs               门禁规则（硬错误 / 警告 / 指标）
  lib/site.mjs                静态站生成
  lib/wechat.mjs              草稿箱推送（凭据缺失显式失败）
  lib/track.mjs               CSV 指标分析
  dist/指标定义.md             指标口径
  dist/数据回收表.csv          回收模板
  tests/self_test.mjs         16 条自检用例（16/16 通过）
```

## 七、自测

```bash
node wechat-publisher/tests/self_test.mjs
```

16/16 通过，覆盖：标题提取、小节切分、代码块转义、内联样式注入、无 class 保证、`<script>` 拦截、CJK 计数、段落长度阈值、表格警告、图片缺 alt 警告、摘要长度、静态索引生成、CSV 指标计算、除零保护、空输入、slug 冲突。

## 八、边界（不做假的地方）

1. **没有向真实公众号推过草稿**。本机没有 `WECHAT_APPID` / `WECHAT_APPSECRET`，`wechat` 命令在缺凭据时按设计显式失败并返回 `E_NO_CREDENTIALS`；这条链路只做了代码与错误分支，没有实跑成功记录，不声称"已验证可推送"。
2. **公网链接是静态托管，不是公众号文章**。托管的是同一份内联样式 HTML，粘贴效果等价；但读者侧的真实渲染以微信客户端为准，本包不代替线上验收。
3. **只处理单篇**。没有做系列文/合集管理，也没有做多账号。
4. **Markdown 子集**。支持标题、段落、加粗斜体行内码、引用、有序/无序列表、代码块、图片、分隔线；不支持脚注、数学公式、嵌套表格。
5. **样式是固定主题**。`theme.mjs` 里一套排版参数，没有做主题市场；要换风格得改文件，不是配置项。
6. **自检是规则检查，不是审美判断**。"读起来好不好"仍需人看一遍——这正是警告交给人、硬错误交给机器的原因。

## 九、协议

MIT。可直接复制 `wechat-publisher/` 目录到任意项目下使用，`node cli.mjs` 即可，无需 `npm install`。
