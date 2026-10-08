import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorText } from './model.ts';
import type { BriefMetrics, Metrics } from './run.ts';

/** The rubric's criteria (`rubric.md`), in table order. */
export const CRITERIA = [
  { key: 'fidelity', label: 'Brief fidelity' },
  { key: 'composition', label: 'Composition' },
  { key: 'color', label: 'Color' },
  { key: 'technical', label: 'Technical cleanliness' },
  { key: 'text', label: 'Text correctness' },
] as const;

const MODES = [
  { key: 'tools', label: 'Tools (MCP server)' },
  { key: 'raw', label: 'Raw SVG' },
] as const;

type Scores = Record<string, number | null>;
export type ScoreTemplate = {
  run: string;
  scale: string;
  /** `<model>/<brief>` → scores per mode; fill each with 1 to 5, or leave null where a criterion does not apply. */
  scores: Record<string, Partial<Record<'tools' | 'raw', Scores>>>;
};

type Entry = { model: string; metrics: BriefMetrics };

const subdirs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

/** Every `<run-dir>/<model>/<brief>/metrics.json`, sorted by model then brief. */
function collect(runDir: string): Entry[] {
  const entries: Entry[] = [];
  for (const model of subdirs(runDir)) {
    for (const brief of subdirs(join(runDir, model))) {
      const file = join(runDir, model, brief, 'metrics.json');
      if (!existsSync(file)) continue;
      try {
        entries.push({ model, metrics: JSON.parse(readFileSync(file, 'utf8')) as BriefMetrics });
      } catch (e) {
        throw new Error(`${file}: ${errorText(e)}`, { cause: e });
      }
    }
  }
  if (entries.length === 0) throw new Error(`no runs under ${runDir}: expected <run-dir>/<model>/<brief>/metrics.json (see eval/README.md)`);
  return entries;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const href = (...parts: string[]): string => parts.map(encodeURIComponent).join('/');

const METRIC_ROWS: [label: string, value: (m: Metrics) => string][] = [
  ['finished', (m) => (m.finished ? 'yes' : 'no')],
  ['turns', (m) => String(m.turns)],
  ['tool calls', (m) => String(m.toolCalls)],
  ['tool errors', (m) => String(m.toolErrors)],
  ['ops applied', (m) => String(m.opsApplied)],
  ['tokens in / out', (m) => `${m.promptTokens} / ${m.completionTokens}`],
  ['cost (USD)', (m) => (m.costUsd === undefined ? '-' : m.costUsd.toFixed(3))],
  ['seconds', (m) => (m.ms / 1000).toFixed(1)],
];

const table = (head: string[], rows: string[][], cls = ''): string =>
  `<table${cls ? ` class="${cls}"` : ''}><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${c}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table>`;

function figure(dir: string, rel: string[], mode: (typeof MODES)[number], m: Metrics): string {
  const file = `${mode.key}.png`;
  const image = existsSync(join(dir, file)) ? `<img src="${href(...rel, file)}" alt="${mode.label} drawing" loading="lazy">` : '<div class="none">no image</div>';
  return `<figure><figcaption>${mode.label}</figcaption>${image}${m.error ? `<p class="err">${esc(m.error)}</p>` : ''}</figure>`;
}

function briefSection(runDir: string, { model, metrics }: Entry): string {
  const rel = [model, metrics.brief];
  const dir = join(runDir, ...rel);
  const present = MODES.filter((m) => metrics[m.key]);
  const links = ['transcript.json', 'tools.svg', 'raw.svg']
    .filter((f) => existsSync(join(dir, f)))
    .map((f) => `<a href="${href(...rel, f)}">${f}</a>`)
    .join(' · ');
  const metricRows = METRIC_ROWS.map(([label, value]) => [label, ...present.map((m) => value(metrics[m.key]!))]);
  const scoreRows = CRITERIA.map((c) => [c.label, ...present.map(() => '')]);
  return `<section class="brief" id="${esc(`${model}--${metrics.brief}`)}">
<h3>${esc(metrics.brief)} <small>${esc(metrics.category)}</small></h3>
<p>${esc(metrics.prompt)}</p>
<div class="pair">${present.map((m) => figure(dir, rel, m, metrics[m.key]!)).join('')}</div>
<div class="tables">${table(['metric', ...present.map((m) => m.key)], metricRows, 'metrics')}${table(['score 1-5', ...present.map((m) => m.key)], scoreRows, 'scores')}</div>
<p class="links">${links}</p>
</section>`;
}

function summarySection(entries: Entry[]): string {
  const rows = MODES.flatMap((mode) => {
    const ms = entries.flatMap((e) => (e.metrics[mode.key] ? [e.metrics[mode.key]!] : []));
    if (ms.length === 0) return [];
    const sum = (f: (m: Metrics) => number) => ms.reduce((a, m) => a + f(m), 0);
    return [
      [
        mode.label,
        String(ms.length),
        String(ms.filter((m) => m.finished).length),
        (sum((m) => m.turns) / ms.length).toFixed(1),
        String(sum((m) => m.toolErrors)),
        `${sum((m) => m.promptTokens)} / ${sum((m) => m.completionTokens)}`,
        ms.some((m) => m.costUsd !== undefined) ? sum((m) => m.costUsd ?? 0).toFixed(2) : '-',
        (sum((m) => m.ms) / 1000).toFixed(0),
      ],
    ];
  });
  return table(['mode', 'briefs', 'finished', 'mean turns', 'tool errors', 'tokens in / out', 'cost (USD)', 'seconds'], rows, 'metrics');
}

const CSS = `:root{color-scheme:light dark;--line:#8886}
body{font:14px/1.5 system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:16px}
h1,h2{margin:1.2em 0 .4em}h3{margin:0 0 .3em}small{font-weight:400;opacity:.7}
.brief{border-top:1px solid var(--line);padding:16px 0}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
figure{margin:0}figcaption{font-weight:600;margin-bottom:4px}
img{display:block;max-width:100%;height:auto;background:#fff;border:1px solid var(--line)}
.none{padding:48px 0;text-align:center;border:1px dashed var(--line);opacity:.7}
.err{color:#c0392b;word-break:break-word}
.tables{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px}
table{border-collapse:collapse}th,td{border:1px solid var(--line);padding:2px 10px;text-align:left}
.scores td{min-width:60px;height:22px}`;

/** The report page and the score sheet for a run directory (`<run-dir>/<model>/<brief>/…`). */
export function buildReport(runDir: string): { html: string; template: ScoreTemplate } {
  const run = basename(resolve(runDir));
  const entries = collect(runDir);
  const template: ScoreTemplate = { run, scale: '1 (failed) to 5 (excellent); null where a criterion does not apply, see eval/rubric.md', scores: {} };
  const blank = (): Scores => Object.fromEntries(CRITERIA.map((c) => [c.key, null]));
  const sections = [...new Set(entries.map((e) => e.model))].map((model) => {
    const mine = entries.filter((e) => e.model === model);
    for (const { metrics } of mine) template.scores[`${model}/${metrics.brief}`] = Object.fromEntries(MODES.filter((m) => metrics[m.key]).map((m) => [m.key, blank()]));
    // Runs through a CLI say which client and model; older runs are known by their folder name.
    const { client, model: cliModel } = mine[0]!.metrics;
    const title = client ? `${client} · ${cliModel ?? 'default model'}` : model;
    return `<h2>${esc(title)}</h2>${summarySection(mine)}${mine.map((e) => briefSection(runDir, e)).join('\n')}`;
  });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent-quality run ${esc(run)}</title><style>${CSS}</style></head>
<body><h1>Run ${esc(run)}</h1>
<p>Each brief shows the MCP-tools drawing next to the raw-SVG baseline. Score both against <code>eval/rubric.md</code> in <code>scores.template.json</code>.</p>
${sections.join('\n')}
</body></html>
`;
  return { html, template };
}

/** Writes `index.html` and `scores.template.json` into `runDir`; returns their paths. */
export function writeReport(runDir: string): string[] {
  const { html, template } = buildReport(runDir);
  const files = [join(runDir, 'index.html'), join(runDir, 'scores.template.json')];
  writeFileSync(files[0]!, html);
  writeFileSync(files[1]!, `${JSON.stringify(template, null, 2)}\n`);
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const dir = process.argv[2];
    if (!dir) throw new Error('usage: node eval/src/report.ts <run-dir>   (e.g. eval/runs/20261008T120000)');
    for (const f of writeReport(resolve(dir))) console.log(f);
  } catch (e) {
    console.error(errorText(e));
    process.exitCode = 1;
  }
}
