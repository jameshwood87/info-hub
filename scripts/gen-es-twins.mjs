import fs from 'fs';
for (const l of fs.readFileSync('/opt/info-hub/.env', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const D = process.env.DIRECTUS_URL, T = process.env.DIRECTUS_ADMIN_TOKEN;
const H = { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' };
const AI_KEY = process.env.OPENAI_API_KEY;
const AI_BASE = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.BLOG_MODEL || 'openai/gpt-5-mini';
const noDash = (s) => String(s || '').replace(/\s*[—–]\s*/g, ' - ');
const IDS = [29, 1688, 1689];

async function ai(msg) {
  const r = await fetch(AI_BASE + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + AI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, response_format: { type: 'json_object' }, max_completion_tokens: 16000, messages: [{ role: 'user', content: msg }] }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error('AI ' + r.status + ': ' + t.slice(0, 200));
  const content = JSON.parse(t).choices?.[0]?.message?.content || '';
  if (!content) throw new Error('AI empty content: ' + t.slice(0, 200));
  return JSON.parse(content);
}

const PROMPT = (e) =>
  `Translate this English property-market/law blog post into natural, professional SPANISH (espanol de Espana) for property readers on the Costa del Sol. Keep ALL HTML tags, attributes and URLs EXACTLY; translate only the visible text. Keep every figure, percentage, date, law reference (e.g. RDL 8/2026), euro amount and proper noun EXACT. Plain hyphens only, no em-dashes. Return JSON: {"title":"...","description":"...","seo_title":"...","seo_description":"max 160 chars","body":"full translated HTML"}.\n\nTITLE:\n${e.title}\n\nDESCRIPTION:\n${e.description || ''}\n\nBODY:\n${e.body}`;

(async () => {
  // clean up probe
  try { await fetch(D + '/items/kb_pages?filter[path][_eq]=/es/blog/__probe__', { method: 'DELETE', headers: H }); } catch {}
  const probe = (await (await fetch(D + '/items/kb_pages?filter[path][_eq]=/es/blog/__probe__&fields=id', { headers: H })).json()).data || [];
  for (const p of probe) { await fetch(D + '/items/kb_pages/' + p.id, { method: 'DELETE', headers: H }); console.log('deleted probe #' + p.id); }

  for (const id of IDS) {
    try {
      const e = (await (await fetch(D + '/items/kb_pages/' + id + '?fields=path,title,description,seo_title,seo_description,body,date_created,date_updated', { headers: H })).json()).data;
      const esPath = '/es/blog/' + e.path.replace(/^\/blog\//, '');
      // skip if already exists
      const exist = (await (await fetch(D + '/items/kb_pages?filter[path][_eq]=' + encodeURIComponent(esPath) + '&fields=id', { headers: H })).json()).data || [];
      if (exist.length) { console.log('SKIP (exists) ' + esPath + ' #' + exist[0].id); continue; }
      const tr = await ai(PROMPT(e));
      if (!tr.body || String(tr.body).length < 200) throw new Error('translation body too short: ' + JSON.stringify(tr).slice(0, 200));
      const rec = { status: 'published', language: 'es', path: esPath, title: noDash(tr.title), description: noDash(tr.description || ''), seo_title: noDash(tr.seo_title || tr.title), seo_description: noDash(tr.seo_description || ''), body: noDash(tr.body) };
      const cr = await fetch(D + '/items/kb_pages', { method: 'POST', headers: H, body: JSON.stringify(rec) });
      const crt = await cr.text();
      if (!cr.ok) throw new Error('create ' + cr.status + ': ' + crt.slice(0, 300));
      const created = JSON.parse(crt).data;
      await fetch(D + '/items/kb_pages/' + created.id, { method: 'PATCH', headers: H, body: JSON.stringify({ date_created: e.date_created, date_updated: e.date_updated || e.date_created }) });
      const words = String(tr.body).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      console.log('CREATED ES #' + created.id + '  ' + esPath + '  (' + words + ' words)  title="' + rec.title.slice(0, 50) + '"');
    } catch (err) {
      console.log('FAIL id ' + id + ': ' + err.message);
    }
  }
})();
