// Pre-publish validation. Hard errors block publishing; warnings need human judgement.
const PROMISE_WORDS = [
  '100%', '百分百', '保证有效', '保证成功', '包治', '稳赚', '暴富', '躺赚',
  '第一品牌', '全网最低', '永久有效', '绝对', '零风险',
];
const INDUCE_WORDS = ['转发到朋友圈', '集赞', '不转不是', '分享给三个群', '截图领奖'];

const MIN_CJK = 600;
const MAX_PARAGRAPH = 180;
const MAX_TITLE = 64;
const MAX_DIGEST = 120;

export function checkDocument(html, articleHtml, stats, opts = {}) {
  const errors = [];
  const warnings = [];
  const metrics = { ...stats };

  const push = (list, code, message, hint, loc) => list.push({ code, message, hint, loc: loc || null });

  // --- structural hard errors -------------------------------------------------
  if (/<script[\s>]/i.test(html)) {
    push(errors, 'E_SCRIPT', '正文含 <script> 标签', '公众号会直接丢弃脚本，且后台审核可能判违规；删掉或用纯 HTML 表达');
  }
  if (/<style[\s>]/i.test(html)) {
    push(errors, 'E_STYLE_TAG', '含 <style> 标签', '微信编辑器会剥离 <style>，样式必须写在元素 style 属性上');
  }
  if (/<link[^>]+rel=["']?stylesheet/i.test(html)) {
    push(errors, 'E_EXTERNAL_CSS', '引用外部样式表', '外链 CSS 不生效，改成内联 style');
  }
  const classHits = articleHtml.match(/class=["'][^"']*["']/gi) || [];
  if (classHits.length) {
    push(errors, 'E_CLASS_ATTR', `正文含 ${classHits.length} 处 class 属性`, 'class 会被剥离，导致样式失效；改用内联 style');
  }
  if (!stats.title || !String(stats.title).trim()) {
    push(errors, 'E_NO_TITLE', '缺少标题', '在 front matter 或首个 # 标题中给出标题');
  }
  if (stats.cjk < MIN_CJK) {
    push(errors, 'E_TOO_SHORT', `正文中文字数 ${stats.cjk}，低于下限 ${MIN_CJK}`, '公众号长文低于 600 字通常不足以支撑一个论点，补证据或扩写');
  }
  if (stats.headings < 1) {
    push(errors, 'E_NO_SECTION', '没有任何小节标题', '至少用一个 ## 划出结构，手机端没有锚点会很难读');
  }

  // --- readability warnings --------------------------------------------------
  const paragraphs = (articleHtml.match(/<p style="margin:0 0 18px 0[^>]*>[\s\S]*?<\/p>/g) || []);
  let longest = 0;
  paragraphs.forEach((p, idx) => {
    const text = p.replace(/<[^>]+>/g, '');
    const units = (text.match(/[\u4e00-\u9fa5]/g) || []).length + (text.match(/[A-Za-z0-9]+/g) || []).length;
    longest = Math.max(longest, units);
    if (units > MAX_PARAGRAPH) {
      push(warnings, 'W_LONG_PARAGRAPH', `第 ${idx + 1} 段约 ${units} 字，超过 ${MAX_PARAGRAPH} 字`, '手机满屏约 180 字，拆成 2–3 段');
    }
  });
  metrics.longestParagraph = longest;

  if (stats.titleChars > MAX_TITLE) {
    push(warnings, 'W_TITLE_LONG', `标题 ${stats.titleChars} 字，超过 ${MAX_TITLE}`, '公众号列表页标题过长会被截断');
  }
  if (stats.digestChars > MAX_DIGEST) {
    push(warnings, 'W_DIGEST_LONG', `摘要 ${stats.digestChars} 字，超过 ${MAX_DIGEST}`, '摘要过长在转发卡片中被截断');
  }
  if (/<table[\s>]/i.test(articleHtml)) {
    push(warnings, 'W_TABLE', '正文使用表格', '公众号窄屏表格易错位；能改成列表就改，必须保留时控制列数');
  }
  const imgs = articleHtml.match(/<img[^>]*>/gi) || [];
  imgs.forEach((tag, i) => {
    if (!/alt=["'][^"']+["']/i.test(tag)) {
      push(warnings, 'W_IMG_NO_ALT', `第 ${i + 1} 张图片缺少 alt`, '补 alt 有利于无障碍与转载可读性');
    }
  });
  const tiny = /font-size:\s*(\d+(?:\.\d+)?)px/g;
  let m;
  while ((m = tiny.exec(articleHtml))) {
    if (Number(m[1]) < 12) {
      push(warnings, 'W_TINY_FONT', `出现 ${m[1]}px 字号`, '手机端小于 12px 会难以阅读');
      break;
    }
  }

  // --- compliance wording ----------------------------------------------------
  const textOnly = articleHtml.replace(/<[^>]+>/g, '');
  for (const w of PROMISE_WORDS) {
    if (textOnly.includes(w)) {
      push(warnings, 'W_PROMISE_WORD', `命中承诺类表述「${w}」`, '广告法对绝对化用语敏感，改成可量化的描述');
    }
  }
  for (const w of INDUCE_WORDS) {
    if (textOnly.includes(w)) {
      push(warnings, 'W_INDUCE_WORD', `命中诱导分享表述「${w}」`, '微信明确禁止诱导分享，删除或改为自然邀请');
    }
  }

  // --- numeric density (informational) ---------------------------------------
  const nums = textOnly.match(/\d+(?:\.\d+)?%?/g) || [];
  metrics.numberTokens = nums.length;
  metrics.numberDensity = stats.totalUnits ? Number((nums.length / stats.totalUnits * 100).toFixed(2)) : 0;
  if (nums.length === 0) {
    push(warnings, 'W_NO_NUMBERS', '正文没有任何数字', '有数字的长文可信度更高；若确实无数据，请明确说明来源边界');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics,
    checkedAt: new Date().toISOString(),
    ...(opts.extra || {}),
  };
}

export function renderReportMarkdown(report, name) {
  const line = (i) => `- **[${i.code}]** ${i.message}\n  - 修复：${i.hint}${i.loc ? `\n  - 位置：${i.loc}` : ''}`;
  return `# 自检报告 · ${name}

结论：**${report.ok ? '通过（可发布）' : '未通过（已阻断）'}**
生成时间：${report.checkedAt}

## 指标

| 指标 | 值 |
| --- | --- |
| 标题字数 | ${report.metrics.titleChars} |
| 中文正文字数 | ${report.metrics.cjk} |
| 小节数 | ${report.metrics.headings} |
| 段落数 | ${report.metrics.paragraphs} |
| 最长段落（字） | ${report.metrics.longestParagraph} |
| 预计阅读 | ${report.metrics.readMinutes} 分钟 |
| 数字出现次数 | ${report.metrics.numberTokens} |
| 数字密度（每百字） | ${report.metrics.numberDensity} |

## 硬错误（${report.errors.length}）

${report.errors.length ? report.errors.map(line).join('\n') : '无'}

## 警告（${report.warnings.length}）

${report.warnings.length ? report.warnings.map(line).join('\n') : '无'}
`;
}
