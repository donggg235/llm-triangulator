import fs from 'fs/promises';
import { parse } from 'csv-parse/sync';

// --- helpers ---
const toNum = (x) => {
  if (x === null || x === undefined) return null;
  const n = Number(String(x).replace(/[%]/g,''));
  return Number.isFinite(n) ? n : null;
};
const nowIso = () => new Date().toISOString();
const okJSON = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
};
const okTEXT = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
};

// --- load config (and sanity check) ---
let cfg;
try {
  cfg = JSON.parse(await fs.readFile('config.json', 'utf8'));
} catch (e) {
  console.warn('WARN: config.json missing or invalid; proceeding with defaults.', e.message);
  cfg = {};
}

// --- sources ---
async function fetchLMArena() {
  const out = [];
  if (!cfg.lmarena_csv_url) {
    console.warn('WARN: lmarena_csv_url not set in config.json — skipping LMArena.');
    return out;
  }
  try {
    const csv = await okTEXT(cfg.lmarena_csv_url);
    const rows = parse(csv, { columns: true, skip_empty_lines: true });
    for (const r of rows) {
      const model = r['Model'] || r['model'] || r['name'];
      if (!model) continue;
      const org = r['Organization'] || r['Org'] || r['organization'];
      const lic = r['License'] || r['license'];
      const mtb = toNum(r['MT-bench (score)'] ?? r['MT-Bench'] ?? r['mtbench']);
      const mmlu = toNum(r['MMLU (5-shot)'] ?? r['MMLU'] ?? r['mmlu']);
      const elo = toNum(r['Arena Elo'] ?? r['Elo'] ?? r['arena_elo']);
      if (mtb != null) out.push({ source:'lmarena', model, org, license:lic, benchmark:'MT-Bench', metric:'score', value: mtb, url: cfg.lmarena_csv_url, last_updated: nowIso() });
      if (mmlu != null) out.push({ source:'lmarena', model, org, license:lic, benchmark:'mmlu', metric:'acc', value: mmlu, url: cfg.lmarena_csv_url, last_updated: nowIso() });
      if (elo != null) out.push({ source:'lmarena', model, org, license:lic, benchmark:'Arena Elo', metric:'elo', value: elo, url: cfg.lmarena_csv_url, last_updated: nowIso() });
    }
  } catch (e) {
    console.warn('WARN: LMArena fetch failed:', e.message);
  }
  return out;
}

async function fetchHFOLLv2() {
  const out = [];
  try {
    const endpoint = 'https://datasets-server.huggingface.co/rows?dataset=open-llm-leaderboard%2Fresults&config=default&split=train&offset=0&length=2000';
    const j = await okJSON(endpoint);
    for (const row of j.rows || []) {
      const r = row.row || row;
      const model = r.model_name || r.model || r.name;
      if (!model) continue;
      out.push({
        source: 'hf_oll_v2',
        model,
        benchmark: String(r.task || '').toLowerCase(),
        metric: String(r.metric || '').toLowerCase(),
        value: toNum(r.metric_value),
        url: 'https://huggingface.co/open-llm-leaderboard',
        last_updated: r.timestamp || nowIso()
      });
    }
  } catch (e) {
    console.warn('WARN: HF OLL v2 fetch failed:', e.message);
  }
  return out;
}

async function fetchHELM() {
  const out = [];
  const urls = Array.isArray(cfg.helm_json_urls) ? cfg.helm_json_urls : [];
  for (const url of urls) {
    try {
      const j = await okJSON(url);
      const list = j.results || j.leaderboard || j.data || [];
      for (const r of list) {
        const model = r.model || r.name || (r.system && r.system.name);
        if (!model) continue;
        const metric = (r.metric || (r.metrics && r.metrics.name) || 'score') + '';
        const value = r.value ?? r.score ?? (r.metrics && r.metrics.value);
        out.push({
          source: 'helm',
          model,
          benchmark: j.metadata?.scenario_name || j.scenario || 'HELM',
          metric: metric.toLowerCase(),
          value: toNum(value),
          url,
          last_updated: j.metadata?.timestamp || nowIso()
        });
      }
    } catch (e) {
      console.warn('WARN: HELM fetch failed for', url, e.message);
    }
  }
  return out;
}

// --- run all; never crash the workflow ---
(async () => {
  try {
    const [a,b,c] = await Promise.all([fetchLMArena(), fetchHFOLLv2(), fetchHELM()]);
    const all = [...a, ...b, ...c].filter(r => r && r.model && r.value != null);
    await fs.mkdir('data', { recursive: true });
    await fs.writeFile('data/aggregate.json', JSON.stringify(all, null, 2));
    console.log(`OK: wrote data/aggregate.json with ${all.length} rows`);
  } catch (e) {
    console.error('FATAL:', e.stack || e.message);
    // Still write an empty file so the site works
    try {
      await fs.mkdir('data', { recursive: true });
      await fs.writeFile('data/aggregate.json', '[]');
      console.log('Wrote empty data/aggregate.json due to error.');
    } catch {}
    // Do NOT fail the job — allow Pages to serve the site
    // process.exit(1);  // intentionally not exiting with failure
  }
})();
