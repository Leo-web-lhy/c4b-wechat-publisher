// Inline-styled HTML renderer. Every element carries its own style attribute
// because the WeChat editor strips <style>, <link> and class attributes.
import { inline, escapeHtml, escapeAttr, plainText, cjkCount } from './markdown.mjs';

const S = {
  body: 'font-size:16px;line-height:1.85;color:#2b2b2b;letter-spacing:0.4px;word-break:break-word;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;',
  p: 'margin:0 0 18px 0;font-size:16px;line-height:1.85;color:#2b2b2b;text-align:justify;',
  h2: 'margin:34px 0 16px 0;padding-left:12px;border-left:4px solid #1f6feb;font-size:18px;font-weight:600;line-height:1.5;color:#111;',
  h3: 'margin:26px 0 12px 0;font-size:16px;font-weight:600;line-height:1.5;color:#1f6feb;',
  h4: 'margin:22px 0 10px 0;font-size:15px;font-weight:600;color:#333;',
  quote: 'margin:0 0 18px 0;padding:14px 16px;background:#f6f8fa;border-left:3px solid #d0d7de;color:#57606a;font-size:15px;line-height:1.8;',
  ul: 'margin:0 0 18px 0;padding-left:22px;',
  ol: 'margin:0 0 18px 0;padding-left:22px;',
  li: 'margin:0 0 8px 0;font-size:16px;line-height:1.8;color:#2b2b2b;',
  hr: 'border:none;border-top:1px solid #eaeef2;margin:30px 0;',
  codeBlock: 'margin:0 0 18px 0;padding:14px 16px;background:#0d1117;border-radius:6px;overflow-x:auto;font-size:13px;line-height:1.7;color:#e6edf3;font-family:Menlo,Consolas,"Courier New",monospace;white-space:pre;',
  img: 'max-width:100%;height:auto;display:block;margin:14px auto;border-radius:4px;',
  table: 'width:100%;border-collapse:collapse;margin:0 0 18px 0;font-size:14px;',
  th: 'padding:8px 10px;border:1px solid #d0d7de;background:#f6f8fa;font-weight:600;text-align:left;color:#111;',
  td: 'padding:8px 10px;border:1px solid #d0d7de;color:#2b2b2b;',
  strong: 'font-weight:600;',
};

export function renderBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const level = Math.min(Math.max(b.level, 2), 4);
        const st = level === 2 ? S.h2 : level === 3 ? S.h3 : S.h4;
        out.push(`<h${level} style="${st}">${inline(b.text)}</h${level}>`);
        break;
      }
      case 'paragraph':
        out.push(`<p style="${S.p}">${inline(b.text)}</p>`);
        break;
      case 'blockquote':
        out.push(`<blockquote style="${S.quote}"><p style="margin:0;">${inline(b.text)}</p></blockquote>`);
        break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const st = b.ordered ? S.ol : S.ul;
        const items = b.items.map((it) => `<li style="${S.li}">${inline(it.text)}</li>`).join('');
        out.push(`<${tag} style="${st}">${items}</${tag}>`);
        break;
      }
      case 'hr':
        out.push(`<hr style="${S.hr}" />`);
        break;
      case 'code': {
        const cls = b.lang ? ` data-lang="${escapeAttr(b.lang)}"` : '';
        out.push(`<pre${cls} style="${S.codeBlock}"><code style="font-family:inherit;color:inherit;background:none;padding:0;">${escapeHtml(b.text)}</code></pre>`);
        break;
      }
      case 'image':
        out.push(`<img src="${escapeAttr(b.src)}" alt="${escapeAttr(b.alt || '')}" style="${S.img}" />`);
        break;
      case 'table': {
        const head = b.headers.map((h) => `<th style="${S.th}">${inline(h)}</th>`).join('');
        const rows = b.rows
          .map((r) => `<tr>${r.map((c) => `<td style="${S.td}">${inline(c)}</td>`).join('')}</tr>`)
          .join('');
        out.push(`<table style="${S.table}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
        break;
      }
      default:
        break;
    }
  }
  return out.join('\n');
}

export function renderDocument(parsed, meta) {
  const title = meta.title || parsed.title || '未命名文章';
  const author = meta.author || '';
  const digest = meta.digest || '';
  const body = renderBlocks(parsed.blocks);
  const text = plainText(parsed.blocks);

  const article = `<section id="wechat-article" style="${S.body}">
${body}
</section>`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
${digest ? `<meta name="description" content="${escapeAttr(digest)}" />` : ''}
${author ? `<meta name="author" content="${escapeAttr(author)}" />` : ''}
</head>
<body style="margin:0;padding:0;background:#fff;">
<main style="max-width:677px;margin:0 auto;padding:24px 20px 60px 20px;">
<article style="margin:0;">
<h1 style="margin:0 0 8px 0;font-size:24px;line-height:1.4;font-weight:700;color:#111;">${escapeHtml(title)}</h1>
<p style="margin:0 0 26px 0;font-size:13px;color:#8b949e;">${escapeHtml(author || '')}</p>
${article}
</article>
</main>
</body>
</html>
`;

  const stats = computeStats(parsed, text, title, digest);
  return { html, article, stats };
}

export function computeStats(parsed, text, title, digest) {
  const cjk = cjkCount(text);
  const latinWords = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  const headings = parsed.blocks.filter((b) => b.type === 'heading').length;
  const paragraphs = parsed.blocks.filter((b) => b.type === 'paragraph');
  const longest = paragraphs.reduce((m, p) => Math.max(m, cjkCount(p.text) + (p.text.match(/[A-Za-z0-9]+/g) || []).length), 0);
  return {
    title,
    titleChars: [...title].length,
    digest,
    digestChars: [...(digest || '')].length,
    cjk,
    latinWords,
    totalUnits: cjk + latinWords,
    headings,
    blocks: parsed.blocks.length,
    paragraphs: paragraphs.length,
    longestParagraph: longest,
    readMinutes: Math.max(1, Math.round((cjk + latinWords) / 400)),
  };
}
