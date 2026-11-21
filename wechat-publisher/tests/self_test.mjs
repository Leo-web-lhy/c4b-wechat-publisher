// Self-test: asserts the guarantees the SKILL.md promises.
// Run: node tests/self_test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from '../lib/markdown.mjs';
import { renderDocument } from '../lib/theme.mjs';
import { checkDocument } from '../lib/check.mjs';
import { analyze, parseCsv } from '../lib/track.mjs';
import { buildSite } from '../lib/site.mjs';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

const LONG_BODY = '这是一段用来测试的正文内容。'.repeat(40);

function mdDoc(extra = '') {
  return `---
title: 测试标题
digest: 测试摘要
author: 测试作者
date: 2026-11-21
---

# 测试标题

${LONG_BODY}

## 第一节

${LONG_BODY}

- 列表项一
- 列表项二

## 第二节

${LONG_BODY}
${extra}
`;
}

function render(src) {
  const parsed = parse(src);
  const meta = { title: parsed.meta.title || parsed.title, digest: parsed.meta.digest, author: parsed.meta.author };
  return { parsed, out: renderDocument(parsed, meta) };
}

// 1. inline style coverage: every block element carries a style attribute
test('所有块级元素都带内联 style', () => {
  const { out } = render(mdDoc());
  const tags = out.article.match(/<(h[1-6]|p|ul|ol|li|blockquote|table|pre|img|hr)(\s[^>]*)?>/g) || [];
  assert.ok(tags.length > 5, '样本元素太少，用例无效');
  for (const tag of tags) {
    assert.ok(/style="/.test(tag), `缺少 style：${tag.slice(0, 60)}`);
  }
});

// 2. no class / no style tag in rendered output
test('渲染结果不含 class 与 <style>', () => {
  const { out } = render(mdDoc());
  assert.equal(/class=/.test(out.article), false);
  assert.equal(/<style/.test(out.html), false);
});

// 3. checker blocks script injection
test('自检拦截 <script>', () => {
  const { out } = render(mdDoc());
  const report = checkDocument(out.html + '<script>alert(1)</script>', out.article, out.stats);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === 'E_SCRIPT'));
});

// 4. checker blocks class attribute
test('自检拦截 class 属性', () => {
  const { out } = render(mdDoc());
  const report = checkDocument(out.html, out.article.replace('<p ', '<p class="x" '), out.stats);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === 'E_CLASS_ATTR'));
});

// 5. too-short article rejected
test('过短正文被拒绝', () => {
  const parsed = parse('# 短\n\n只有一句话。\n');
  const out = renderDocument(parsed, { title: '短' });
  const report = checkDocument(out.html, out.article, out.stats);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.code === 'E_TOO_SHORT'));
});

// 6. no section rejected
test('无小节标题被拒绝', () => {
  const parsed = parse(`# 标题\n\n${LONG_BODY}\n`);
  const out = renderDocument(parsed, { title: '标题' });
  const report = checkDocument(out.html, out.article, out.stats);
  assert.ok(report.errors.some((e) => e.code === 'E_NO_SECTION'));
});

// 7. long paragraph warning
test('超长段落产生警告', () => {
  const src = mdDoc().replace('## 第一节', `${'很长的一段。'.repeat(30)}\n\n## 第一节`);
  const { out } = render(src);
  const report = checkDocument(out.html, out.article, out.stats);
  assert.ok(report.warnings.some((w) => w.code === 'W_LONG_PARAGRAPH'));
});

// 8. sensitive promise word warning
test('承诺类表述产生警告', () => {
  const { out } = render(mdDoc('这家店全网最低，保证有效。'));
  const report = checkDocument(out.html, out.article, out.stats);
  assert.ok(report.warnings.some((w) => w.code === 'W_PROMISE_WORD'));
});

// 9. inducement word warning
test('诱导分享表述产生警告', () => {
  const { out } = render(mdDoc('看完记得转发到朋友圈。'));
  const report = checkDocument(out.html, out.article, out.stats);
  assert.ok(report.warnings.some((w) => w.code === 'W_INDUCE_WORD'));
});

// 10. idempotence: same input twice -> identical sha256
test('重复渲染幂等（同输入同输出）', () => {
  const a = render(mdDoc()).out.html;
  const b = render(mdDoc()).out.html;
  const ha = crypto.createHash('sha256').update(a).digest('hex');
  const hb = crypto.createHash('sha256').update(b).digest('hex');
  assert.equal(ha, hb);
  assert.ok(a.length > 1000);
});

// 11. clean article passes
test('干净长文通过自检', () => {
  const { out } = render(mdDoc());
  const report = checkDocument(out.html, out.article, out.stats);
  assert.equal(report.ok, true, `仍有硬错误：${JSON.stringify(report.errors)}`);
});

// 12. front matter parsed, H1 promoted to title
test('front matter 与首个 H1 正确处理', () => {
  const parsed = parse(mdDoc());
  assert.equal(parsed.meta.title, '测试标题');
  assert.equal(parsed.title, '测试标题');
  assert.ok(!parsed.blocks.some((b) => b.type === 'heading' && b.level === 1), 'H1 不应进入正文');
});

// 13. table + code block render
test('表格与代码块渲染', () => {
  const src = mdDoc(`
| 指标 | 值 |
| --- | --- |
| 阅读 | 1200 |

\`\`\`bash
node cli.mjs check a.html
\`\`\`
`);
  const { out } = render(src);
  assert.ok(out.article.includes('<table'));
  assert.ok(out.article.includes('<pre'));
  assert.ok(out.article.includes('<th'));
});

// 14. channel analytics math
test('渠道数据计算正确', () => {
  const csv = 'channel,impressions,reads,shares,new_followers\n公众号,1000,100,5,3\n朋友圈,500,250,20,10\n';
  const { result } = { result: analyze(parseCsv(csv)) };
  assert.equal(result.total.reads, 350);
  assert.equal(result.channels[0].channel, '朋友圈');
  assert.ok(Math.abs(result.channels[0].openRate - 0.5) < 1e-9);
  assert.ok(Math.abs(result.total.openRate - 350 / 1500) < 1e-9);
  assert.ok(result.insights.length >= 2);
});

// 15. static site build
test('静态站生成 index 与文章页', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-site-'));
  const { out } = render(mdDoc());
  const res = buildSite({ pages: [{ slug: 'x', html: out.html, meta: { title: '测试标题', digest: 'd', date: '2026-11-21', units: 100, readMinutes: 2 } }], outDir: dir, siteTitle: 'T' });
  assert.ok(fs.existsSync(res.indexPath));
  assert.ok(fs.existsSync(path.join(dir, 'x.html')));
  assert.ok(fs.existsSync(path.join(dir, '.nojekyll')));
  const idx = fs.readFileSync(res.indexPath, 'utf8');
  assert.ok(idx.includes('测试标题'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// 16. link href survives escaping
test('内联链接正确转义并保留 href', () => {
  const { out } = render(mdDoc('参考 [文档](https://example.com/a?b=1&c=2)。'));
  assert.ok(out.article.includes('href="https://example.com/a?b=1&amp;c=2"'));
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(` - ${f.name}: ${f.error}`);
  process.exit(1);
}
