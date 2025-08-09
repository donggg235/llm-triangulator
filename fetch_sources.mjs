import fs from 'fs/promises';
import { parse } from 'csv-parse/sync';

/** Helpers **/
const toNum = (x) => {
  if (x === null || x === undefined) return null;
  const n = Number(String(x).replace(/[%]/g,''));
  return Number.isFinite(n) ? n : null;
};
const nowIso = () => new Date().toISOString();

/** Load config **/
const cfg = JSON.parse(await fs.readFile('config.json', 'utf8'));

/** 1) LMArena (CSV you pasted) **/
async function fetchLMArena() {
  if (!cfg.lmarena_csv_url) return [];
  const csv = await (await fetch(cfg.lmarena_csv_url)).text();
  const rows = parse(csv, { columns: true, skip_empty_lines: true });
  const out = [];

  for (const r of rows) {
    const model = r['Model'] || r['model'] || r['name'];
    const org = r['Organization'] || r['Org'] || r['organization'];
    const lic = r['License'] || r['license'];
    const mtb = toNum(r['MT-bench (score)'] ?? r['MT-Bench'] ?? r['mtbench']);
    const mmlu = toNum(r['MMLU (5-shot)'] ?? r['MMLU'] ?? r['mmlu']);
    const elo = toNum(r['Arena Elo'] ?? r['Elo'] ?? r['arena_elo']);

    if (mtb != null) out.push({ source:'lmarena', model, org, license:lic, benchmark:'MT-Bench', metric:'score', value: mtb, url: cfg.lmarena_csv_url, last_updated: nowIso() });
    if (mmlu != null) out.push({ source:'lmarena', model, org, license:lic, benchmark:'mmlu', metric:'acc', value: mmlu, url: cfg.lmarena_csv_url, last_updated: nowIso() });
    if (elo != null) out.push({ source:'lmarena', model, org, license:lic, benchmark:'Arena Elo', metric:'elo', value: elo, url: cfg.lmarena_csv_url, last_updated: nowIso() });
  }
  return out;
}

/** 2) Hugging Face Open LLM Leaderboard v2 (dataset server) **/
async function fetchHFOLLv2() {
  // Pull up to ~2000 rows; adjust if needed
  const endpoint = 'https://datasets-server.huggingface.co/rows?dataset=open-llm-leaderboard%2Fresults&config=default&split=train&offset=0&length=2000';
  const j = await (await fetch(endpoint)).json();
  const out = [];
  for (const row of j.rows || []) {
    const r = row.row || row;
    out.push({
      source: 'hf_oll_v2',
      model: r.model_name || r.model || r.name,
      benchmark: (r.task || '').toLowerCase(),          // e.g. gsm8k, mmlu, hellaswag, arc_c
      metric: (r.metric || '').toLowerCase(),           // usually 'acc' or similar
      value: toNum(r.metric_value),
      url: 'https://huggingface.co/open-llm-leaderboard',
      last_updated: r.timestamp || nowIso()
    });
  }
  return out;
}

/** 3) HELM (optional JSONs you list) **/
async function fetchHELM() {
  const urls = cfg.helm_json_urls || [];
  const out = [];
  for (const url of urls) {
    try {
      const j = await (await fetch(url)).json();
      // Try to handle a couple of common shapes
      const list =
        j.results ||
        j.leaderboard ||
        j.data ||
        [];
      for (const r of list) {
        const model = r.model || r.name || (r.system && r.system.name);
        const metric = r.metric || (r.metrics && r.metrics.name) || 'score';
        const value = r.value ?? r.score ?? (r.metrics && r.metrics.value);
        out.push({
          source: 'helm',
          model,
          benchmark: j.metadata?.scenario_name || j.scenario || 'HELM',
          metric: String(metric).toLowerCase(),
          value: toNum(value),
          url,
          last_updated: j.metadata?.timestamp || nowIso()
        });
      }
    } catch (e) {
      console.warn('HELM fetch failed for', url, e.message);
    }
  }
  return out;
}

/** Run all & write file **/
const [a,b,c] = await Promise.all([
  fetchLMArena(),
  fetchHFOLLv2(),
  fetchHELM()
]);

const all = [...a, ...b, ...c].filter(r => r.value != null && r.model);
await fs.mkdir('data', { recursive: true });
await fs.writeFile('data/aggregate.json', JSON.stringify(all, null, 2));
console.log(`Wrote data/aggregate.json with ${all.length} rows.`);
