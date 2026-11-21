// Post-publish channel analytics from a后台导出 CSV.
// Expected header (any order, extra columns ignored):
// channel,impressions,reads,shares,new_followers,date
import fs from 'node:fs';

export function parseCsv(text) {
  const rows = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return rows;
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => (row[h] = (cells[idx] || '').trim()));
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function analyze(rows) {
  const byChannel = new Map();
  for (const r of rows) {
    const ch = r.channel || '未标注';
    const acc = byChannel.get(ch) || { channel: ch, impressions: 0, reads: 0, shares: 0, new_followers: 0, rows: 0 };
    acc.impressions += num(r.impressions);
    acc.reads += num(r.reads);
    acc.shares += num(r.shares);
    acc.new_followers += num(r.new_followers);
    acc.rows += 1;
    byChannel.set(ch, acc);
  }
  const list = [...byChannel.values()].map((c) => ({
    ...c,
    openRate: c.impressions ? c.reads / c.impressions : 0,
    shareRate: c.reads ? c.shares / c.reads : 0,
    followRate: c.reads ? c.new_followers / c.reads : 0,
  }));
  list.sort((a, b) => b.reads - a.reads);

  const total = list.reduce(
    (t, c) => ({ impressions: t.impressions + c.impressions, reads: t.reads + c.reads, shares: t.shares + c.shares, new_followers: t.new_followers + c.new_followers }),
    { impressions: 0, reads: 0, shares: 0, new_followers: 0 }
  );
  total.openRate = total.impressions ? total.reads / total.impressions : 0;
  total.shareRate = total.reads ? total.shares / total.reads : 0;
  total.followRate = total.reads ? total.new_followers / total.reads : 0;

  const insights = [];
  if (list.length >= 2) {
    const [a, b] = list;
    insights.push(`阅读量最高渠道：${a.channel}（${a.reads}），是最低渠道 ${b.channel}（${b.reads}）的 ${b.reads ? (a.reads / b.reads).toFixed(1) : '∞'} 倍。`);
    const bestOpen = [...list].sort((x, y) => y.openRate - x.openRate)[0];
    insights.push(`打开率最高渠道：${bestOpen.channel}（${pct(bestOpen.openRate)}）；打开率反映标题 + 渠道匹配度，优先在这里复用选题。`);
  }
  if (total.openRate && total.openRate < 0.05) {
    insights.push(`整体打开率 ${pct(total.openRate)} 偏低，先改标题与首图，再谈内容。`);
  }
  if (total.shareRate > 0.01) {
    insights.push(`转发率 ${pct(total.shareRate)} 已过 1% 门槛，说明内容有社交货币，下篇可以强化"可转述的结论句"。`);
  } else {
    insights.push(`转发率 ${pct(total.shareRate)} 低于 1%，缺"值得转给同事"的抓手：补清单、模板或反直觉数据。`);
  }
  if (total.followRate && total.followRate < 0.005) {
    insights.push(`涨粉率 ${pct(total.followRate)} 偏低：文末需要有明确的下一次关注理由。`);
  }
  return { total, channels: list, insights };
}

export function pct(v) {
  return `${(v * 100).toFixed(2)}%`;
}

export function renderMarkdownReport(result, sourceFile) {
  const head = ['渠道', '曝光', '阅读', '打开率', '转发率', '涨粉率'];
  const rows = result.channels.map((c) => `| ${c.channel} | ${c.impressions} | ${c.reads} | ${pct(c.openRate)} | ${pct(c.shareRate)} | ${pct(c.followRate)} |`);
  return `# 渠道数据复盘

数据源：\`${sourceFile}\`

## 汇总

| 指标 | 值 |
| --- | --- |
| 曝光 | ${result.total.impressions} |
| 阅读 | ${result.total.reads} |
| 打开率 | ${pct(result.total.openRate)} |
| 分享 | ${result.total.shares} |
| 转发率 | ${pct(result.total.shareRate)} |
| 新增关注 | ${result.total.new_followers} |
| 涨粉率 | ${pct(result.total.followRate)} |

## 分渠道

| ${head.join(' | ')} |
| ${head.map(() => '---').join(' | ')} |
${rows.join('\n')}

## 结论

${result.insights.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`;
}

export function loadAndAnalyze(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8');
  return { rows: parseCsv(text), result: analyze(parseCsv(text)) };
}
