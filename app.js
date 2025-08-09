async function load() {
  const resp = await fetch('data/aggregate.json?cachebust=' + Date.now());
  const data = await resp.json();

  const srcChecks = [...document.querySelectorAll('.src')];
  const benchChecks = [...document.querySelectorAll('.bench')];
  const tbody = document.querySelector('#tbl tbody');
  const stamp = document.querySelector('#stamp');

  function render() {
    const srcSel = new Set(srcChecks.filter(x=>x.checked).map(x=>x.value));
    const benchSel = new Set(benchChecks.filter(x=>x.checked).map(x=>x.value));
    const rows = data.filter(r => srcSel.has(r.source) && (!benchSel.size || benchSel.has((r.benchmark||'').toLowerCase()) || benchSel.has(r.benchmark)));
    tbody.innerHTML = rows
      .sort((a,b)=> (b.value??0) - (a.value??0))
      .slice(0, 200)
      .map(r => `<tr>
        <td>${r.model||''}</td>
        <td>${r.benchmark||''}</td>
        <td>${r.metric||''}</td>
        <td>${(r.value??'').toString()}</td>
        <td>${r.source}</td>
        <td><a href="${r.url}" target="_blank" rel="noopener">open</a></td>
      </tr>`).join('');
  }

  srcChecks.forEach(c=>c.addEventListener('change', render));
  benchChecks.forEach(c=>c.addEventListener('change', render));
  render();

  const latest = data.reduce((d,r)=> r.last_updated && r.last_updated > d ? r.last_updated : d, '');
  stamp.textContent = `Data last refreshed: ${latest || 'unknown'}. Rows: ${data.length}.`;
}

load().catch(e => {
  console.error(e);
  document.querySelector('#stamp').textContent = 'Failed to load data.';
});
