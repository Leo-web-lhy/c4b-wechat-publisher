// Minimal, dependency-free Markdown subset parser.
// Block types: heading, paragraph, list, blockquote, code, hr, table, image
// Inline syntax: **bold**, *italic*, `code`, [text](url), ![alt](src)

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontMatter(text) {
  const m = FM_RE.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    }
    data[key] = val;
  }
  return { data, body: text.slice(m[0].length) };
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Inline renderer: applies emphasis/code/link/image tokens after escaping.
// Uses placeholder slots so escaped text is never re-parsed.
export function inline(text) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = text;

  // images first: ![alt](src)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
    return keep(
      `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" style="max-width:100%;height:auto;display:block;margin:12px auto;border-radius:4px;" />`
    );
  });
  // links [text](url): the whole anchor is built here and kept in a slot, so the
  // global escaping pass can never double-escape the href (& -> &amp;amp;).
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const inner = inline(label);
    return keep(
      `<a href="${escapeAttr(href)}" style="color:#576b95;text-decoration:none;border-bottom:1px solid #dfe3ea;">${inner}</a>`
    );
  });
  // inline code `x`
  s = s.replace(/`([^`]+)`/g, (_, code) => {
    return keep(
      `<code style="font-family:Menlo,Consolas,monospace;font-size:13px;background:#f4f6f8;color:#c7254e;padding:2px 5px;border-radius:3px;">${escapeHtml(code)}</code>`
    );
  });

  s = escapeHtml(s);

  // bold **x** / italic *x* on escaped text
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:600;">$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em style="font-style:italic;">$2</em>');
  // strikethrough ~~x~~
  s = s.replace(/~~([^~]+)~~/g, '<span style="text-decoration:line-through;">$1</span>');

  // restore link placeholders as styled anchors
  s = s.replace(/@@LINK\|([^|]*)\|([^@]*)@@/g, (_, href, label) => {
    return `<a href="${escapeAttr(href)}" style="color:#576b95;text-decoration:none;border-bottom:1px solid #dfe3ea;">${label}</a>`;
  });
  // restore kept slots
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
  return s;
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

export function plainText(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'paragraph') out.push(b.text);
    else if (b.type === 'list') out.push(...b.items.map((i) => i.text));
    else if (b.type === 'blockquote') out.push(b.text);
    else if (b.type === 'code') out.push(b.text);
    else if (b.type === 'table') out.push(...b.rows.flat());
  }
  return out.join('\n');
}

export function parse(src) {
  const { data, body } = parseFrontMatter(src.replace(/\r\n/g, '\n'));
  const lines = body.split('\n');
  const blocks = [];
  let i = 0;
  let title = null;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    // fenced code
    let m = /^```(\w*)\s*$/.exec(line);
    if (m) {
      const lang = m[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      blocks.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }

    // hr
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    // headings
    m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const level = m[1].length;
      const text = m[2].trim();
      if (level === 1 && title === null) title = text;
      else blocks.push({ type: 'heading', level, text });
      i++;
      continue;
    }

    // table: header row + separator row
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const headers = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // image standalone
    m = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (m) { blocks.push({ type: 'image', alt: m[1], src: m[2] }); i++; continue; }

    // blockquote (consecutive > lines)
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', text: buf.join(' ').trim() });
      continue;
    }

    // lists
    if (/^\s*([-*+])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) {
        items.push({ text: lines[i].replace(/^\s*([-*+])\s+/, '').trim() });
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push({ text: lines[i].replace(/^\s*\d+[.)]\s+/, '').trim() });
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // paragraph: gather until blank line or block start
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: buf.join(' ').trim() });
  }

  return { meta: data, title, blocks };
}

function isBlockStart(line) {
  return (
    /^```/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*([-*+])\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s*(---|\*\*\*|___)\s*$/.test(line) ||
    /^\s*!\[[^\]]*\]\([^)\s]+\)\s*$/.test(line)
  );
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

export function cjkCount(text) {
  const m = text.match(/[\u4e00-\u9fa5]/g);
  return m ? m.length : 0;
}
