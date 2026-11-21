#!/usr/bin/env node
// wechat-publisher CLI. Dependency-free (node >= 18).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from './lib/markdown.mjs';
import { renderDocument, renderBlocks } from './lib/theme.mjs';
import { checkDocument, renderReportMarkdown } from './lib/check.mjs';
import { buildSite } from './lib/site.mjs';
import { loadAndAnalyze, renderMarkdownReport } from './lib/track.mjs';
import { pushDraft } from './lib/wechat.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);

function arg(name, def) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
}
function flag(name) {
  return rest.includes(`--${name}`);
}

function die(code, msg, hint) {
  console.error(`\n[${code}] ${msg}`);
  if (hint) console.error(`  → ${hint}`);
  process.exit(code === 'E_BAD_USAGE' ? 2 : 1);
}

function slugOf(file) {
  return path.basename(file).replace(/\.(md|html)$/i, '');
}

function metaFrom(parsed, htmlPath) {
  const m = parsed.meta || {};
  const statsTitle = m.title || parsed.title || slugOf(htmlPath);
  return {
    title: statsTitle,
    digest: m.digest || '',
    author: m.author || '',
    cover: m.cover || '',
    source_url: m.source_url || '',
    date: m.date || new Date().toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------- commands ---
function cmdNew() {
  const slug = rest[0];
  if (!slug) die('E_BAD_USAGE', '用法: node cli.mjs new <slug>');
  const dir = 'drafts';
  fs.mkdirSync(dir, { recursive: true });
  const briefPath = path.join(dir, `${slug}.brief.json`);
  if (fs.existsSync(briefPath)) die('E_EXISTS', `已存在：${briefPath}`);
  const brief = {
    slug,
    audience: '',
    painPoint: '',
    coreClaim: '',
    whyNew: '',
    evidence: [{ claim: '', source: '', number: '' }],
    banned: [],
    channels: [{ name: '公众号主页', plan: '' }],
    titleCandidates: ['', '', ''],
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf8');

  const mdPath = path.join(dir, `${slug}.md`);
  fs.writeFileSync(
    mdPath,
    `---
title: 在这里写标题
digest: 一句话摘要，控制在 120 字内
author: 作者名
date: ${new Date().toISOString().slice(0, 10)}
---

# 在这里写标题

第一段：读者是谁、他现在卡在哪。不要写"随着互联网的发展"，直接写具体场景。

## 小节一：只承担一个论点

用证据支撑，不要形容词堆砌。

## 小节二：给出可执行动作

- 动作 1
- 动作 2

## 结尾

一句话收束，给读者一个可转述的结论。
`,
    'utf8'
  );
  console.log(`[ok] 已生成 ${briefPath} 与 ${mdPath}`);
  console.log('     先填 brief 的 audience / painPoint / coreClaim，再写正文。');
}

function doRender(mdPath) {
  if (!fs.existsSync(mdPath)) die('E_NO_FILE', `找不到文件：${mdPath}`);
  const src = fs.readFileSync(mdPath, 'utf8');
  const parsed = parse(src);
  const meta = metaFrom(parsed, mdPath);
  const out = renderDocument(parsed, meta);

  const dir = path.dirname(mdPath);
  const slug = slugOf(mdPath);
  const htmlPath = path.join(dir, `${slug}.html`);
  const metaPath = path.join(dir, `${slug}.meta.json`);
  fs.writeFileSync(htmlPath, out.html, 'utf8');
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ ...meta, stats: out.stats, generatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
  return { htmlPath, metaPath, html: out.html, article: out.article, stats: out.stats, meta };
}

function cmdRender() {
  const mdPath = rest[0];
  if (!mdPath) die('E_BAD_USAGE', '用法: node cli.mjs render <article.md>');
  const r = doRender(mdPath);
  console.log(`[ok] HTML  ${r.htmlPath}`);
  console.log(`[ok] meta  ${r.metaPath}`);
  console.log(
    `[stat] 中文 ${r.stats.cjk} 字 · 小节 ${r.stats.headings} · 段落 ${r.stats.paragraphs} · 最长段 ${r.stats.longestParagraph} 字 · 约 ${r.stats.readMinutes} 分钟`
  );
}

function runCheckOnHtml(htmlPath, articleHtml, stats, slug) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const report = checkDocument(html, articleHtml, stats);
  const dir = path.dirname(htmlPath);
  fs.writeFileSync(path.join(dir, `${slug}.report.json`), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, `${slug}.report.md`), renderReportMarkdown(report, slug), 'utf8');
  return report;
}

function cmdCheck() {
  const target = rest[0];
  if (!target) die('E_BAD_USAGE', '用法: node cli.mjs check <article.html|article.md>');
  let htmlPath = target;
  let articleHtml;
  let stats;

  if (/\.md$/i.test(target)) {
    const r = doRender(target);
    htmlPath = r.htmlPath;
    articleHtml = r.article;
    stats = r.stats;
  } else {
    if (!fs.existsSync(htmlPath)) die('E_NO_FILE', `找不到文件：${htmlPath}`);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const m = /<section id="wechat-article"[\s\S]*?<\/section>/.exec(html);
    articleHtml = m ? m[0] : html;
    const metaPath = htmlPath.replace(/\.html$/i, '.meta.json');
    if (fs.existsSync(metaPath)) {
      stats = JSON.parse(fs.readFileSync(metaPath, 'utf8')).stats;
    } else {
      const title = (/<title>([\s\S]*?)<\/title>/.exec(html) || [, ''])[1];
      const text = articleHtml.replace(/<[^>]+>/g, '');
      const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      stats = { title, titleChars: [...title].length, cjk, headings: (articleHtml.match(/<h[234][\s>]/g) || []).length, paragraphs: (articleHtml.match(/<p[\s>]/g) || []).length, longestParagraph: 0, readMinutes: 1, digest: '', digestChars: 0, totalUnits: cjk };
    }
  }

  const slug = slugOf(htmlPath);
  const report = runCheckOnHtml(htmlPath, articleHtml, stats, slug);
  console.log(`[check] ${report.ok ? 'PASS' : 'FAIL'} errors=${report.errors.length} warnings=${report.warnings.length}`);
  for (const e of report.errors) console.log(`  ✗ ${e.code} ${e.message}`);
  for (const w of report.warnings) console.log(`  ! ${w.code} ${w.message}`);
  console.log(`[report] ${path.join(path.dirname(htmlPath), slug + '.report.md')}`);
  process.exit(report.ok ? 0 : 1);
}

function cmdAll() {
  const mdPath = rest[0];
  if (!mdPath) die('E_BAD_USAGE', '用法: node cli.mjs all <article.md>');
  const r = doRender(mdPath);
  const slug = slugOf(mdPath);
  const report = runCheckOnHtml(r.htmlPath, r.article, r.stats, slug);
  console.log(`[render] ${r.htmlPath}`);
  console.log(`[check] ${report.ok ? 'PASS' : 'FAIL'} errors=${report.errors.length} warnings=${report.warnings.length}`);
  for (const e of report.errors) console.log(`  ✗ ${e.code} ${e.message}`);
  for (const w of report.warnings) console.log(`  ! ${w.code} ${w.message}`);
  process.exit(report.ok ? 0 : 1);
}

function cmdStatic() {
  const htmlPath = rest[0];
  if (!htmlPath) die('E_BAD_USAGE', '用法: node cli.mjs static <article.html> [--out site] [--title xxx]');
  if (!fs.existsSync(htmlPath)) die('E_NO_FILE', `找不到文件：${htmlPath}`);
  const outDir = arg('out', 'site');
  const slug = slugOf(htmlPath);
  const metaPath = htmlPath.replace(/\.html$/i, '.meta.json');
  let meta = {};
  if (fs.existsSync(metaPath)) {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta = { ...parsed, units: parsed.stats ? parsed.stats.totalUnits : 0, readMinutes: parsed.stats ? parsed.stats.readMinutes : 1 };
  }
  const res = buildSite({
    pages: [{ slug, html: fs.readFileSync(htmlPath, 'utf8'), meta }],
    outDir,
    siteTitle: arg('title', '文章归档'),
    indexNote: arg('note', ''),
    baseUrl: arg('base', ''),
  });
  console.log(`[ok] 静态站已生成：${res.indexPath}（${res.pages} 篇）`);
  console.log('     推送到 GitHub 后开启 Pages，即可得到公网可访问链接。');
}

async function cmdWechat() {
  const htmlPath = rest[0];
  if (!htmlPath) die('E_BAD_USAGE', '用法: node cli.mjs wechat <article.html> --thumb-media-id xxx | --cover cover.png');
  if (!fs.existsSync(htmlPath)) die('E_NO_FILE', `找不到文件：${htmlPath}`);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = /<section id="wechat-article"[\s\S]*?<\/section>/.exec(html);
  const content = m ? m[0] : html;
  const metaPath = htmlPath.replace(/\.html$/i, '.meta.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  try {
    const res = await pushDraft({
      title: meta.title || slugOf(htmlPath),
      author: meta.author || '',
      digest: meta.digest || '',
      content,
      coverPath: arg('cover', ''),
      thumbMediaId: arg('thumb-media-id', ''),
      sourceUrl: meta.source_url || '',
    });
    console.log(`[ok] media_id=${res.mediaId}`);
    console.log(`     ${res.note}`);
  } catch (e) {
    die(e.code || 'E_PUSH', e.message, e.detail ? JSON.stringify(e.detail).slice(0, 300) : '');
  }
}

function cmdTrack() {
  const csv = rest[0];
  if (!csv) die('E_BAD_USAGE', '用法: node cli.mjs track <data.csv>');
  if (!fs.existsSync(csv)) die('E_NO_FILE', `找不到文件：${csv}`);
  const { result } = loadAndAnalyze(csv);
  const outMd = csv.replace(/\.csv$/i, '.report.md');
  fs.writeFileSync(outMd, renderMarkdownReport(result, path.basename(csv)), 'utf8');
  console.log(`[ok] ${outMd}`);
  console.log(`[stat] 阅读 ${result.total.reads} · 打开率 ${(result.total.openRate * 100).toFixed(2)}% · 转发率 ${(result.total.shareRate * 100).toFixed(2)}%`);
}

function cmdTest() {
  const r = spawnSync(process.execPath, [path.join(HERE, 'tests', 'self_test.mjs')], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

function usage() {
  console.log(`wechat-publisher v1.0.0

  node cli.mjs new    <slug>                      生成选题单与正文骨架
  node cli.mjs render <article.md>                Markdown -> 内联样式 HTML + meta
  node cli.mjs check  <article.html|article.md>   自检，硬错误 exit 1
  node cli.mjs all    <article.md>                render + check
  node cli.mjs static <article.html> [--out site] [--title T] [--note N] [--base U]
  node cli.mjs wechat <article.html> --thumb-media-id X | --cover p.png
  node cli.mjs track  <data.csv>                  渠道数据复盘
  node cli.mjs test                               跑自检用例

环境变量（仅 wechat 命令需要）：
  WECHAT_APPID / WECHAT_APPSECRET
`);
}

const table = {
  new: cmdNew,
  render: cmdRender,
  check: cmdCheck,
  all: cmdAll,
  static: cmdStatic,
  wechat: cmdWechat,
  track: cmdTrack,
  test: cmdTest,
};

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
  usage();
  process.exit(0);
}
const fn = table[cmd];
if (!fn) die('E_BAD_USAGE', `未知命令：${cmd}`, '运行 node cli.mjs --help 查看用法');
await fn();
