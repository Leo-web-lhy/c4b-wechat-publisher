// Static site builder: turns rendered articles into a self-contained, hostable
// site/ directory (index.html + one page per article). Used to obtain a real
// public URL (GitHub Pages / any static host) without handing the article to a
// third-party editor.
import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml, escapeAttr } from './markdown.mjs';

export function buildSite(opts) {
  const { pages, outDir, siteTitle = 'wechat-publisher', baseUrl = '', indexNote = '' } = opts;
  fs.mkdirSync(outDir, { recursive: true });

  const cards = pages
    .map((p) => {
      const meta = p.meta || {};
      const href = `./${p.slug}.html`;
      return `    <li style="list-style:none;margin:0 0 14px 0;padding:16px 18px;border:1px solid #eaeef2;border-radius:8px;">
      <a href="${escapeAttr(href)}" style="font-size:17px;font-weight:600;color:#111;text-decoration:none;">${escapeHtml(meta.title || p.slug)}</a>
      <p style="margin:8px 0 0 0;font-size:13px;line-height:1.7;color:#57606a;">${escapeHtml(meta.digest || '')}</p>
      <p style="margin:6px 0 0 0;font-size:12px;color:#8b949e;">${escapeHtml(meta.date || '')} · ${meta.units || 0} 字 · 约 ${meta.readMinutes || 1} 分钟</p>
    </li>`;
    })
    .join('\n');

  const index = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(siteTitle)}</title>
<meta name="description" content="${escapeAttr(indexNote || siteTitle)}" />
</head>
<body style="margin:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">
<main style="max-width:720px;margin:0 auto;padding:48px 20px 80px 20px;">
  <h1 style="margin:0 0 10px 0;font-size:26px;color:#111;">${escapeHtml(siteTitle)}</h1>
  ${indexNote ? `<p style="margin:0 0 32px 0;font-size:14px;line-height:1.8;color:#57606a;">${escapeHtml(indexNote)}</p>` : ''}
  <ul style="margin:0;padding:0;">
${cards}
  </ul>
  <p style="margin:40px 0 0 0;font-size:12px;color:#8b949e;">由 wechat-publisher 生成${baseUrl ? ` · ${escapeHtml(baseUrl)}` : ''}</p>
</main>
</body>
</html>
`;

  fs.writeFileSync(path.join(outDir, 'index.html'), index, 'utf8');
  for (const p of pages) {
    fs.writeFileSync(path.join(outDir, `${p.slug}.html`), p.html, 'utf8');
  }
  // GitHub Pages: serve files verbatim, skip Jekyll processing.
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');

  return { indexPath: path.join(outDir, 'index.html'), pages: pages.length };
}
