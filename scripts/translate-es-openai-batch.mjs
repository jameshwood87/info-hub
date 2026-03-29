import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const parseArgs = (argv) => {
	const out = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (!a?.startsWith('--')) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		const hasValue = next && !next.startsWith('--');
		const value = hasValue ? next : true;
		if (Object.prototype.hasOwnProperty.call(out, key)) {
			const prev = out[key];
			out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
		} else {
			out[key] = value;
		}
		if (hasValue) i++;
	}
	return out;
};

const args = parseArgs(process.argv);

const loadDotEnv = () => {
	const parseLine = (line) => {
		const s = String(line || '').trim();
		if (!s) return null;
		if (s.startsWith('#')) return null;
		const eq = s.indexOf('=');
		if (eq <= 0) return null;
		const key = s.slice(0, eq).trim();
		let val = s.slice(eq + 1).trim();
		if (!key) return null;
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
		return { key, val };
	};

	const candidates = [
		path.join(process.cwd(), '.env'),
		path.join(process.cwd(), '.env.local'),
		path.join(process.cwd(), '..', '.env'),
		path.join(process.cwd(), '..', '.env.local'),
	];

	for (const fp of candidates) {
		try {
			const raw = fs.readFileSync(fp, 'utf8');
			for (const line of raw.split('\n')) {
				const hit = parseLine(line);
				if (!hit) continue;
				if (process.env[hit.key] == null || process.env[hit.key] === '') process.env[hit.key] = hit.val;
			}
		} catch {
		}
	}
};

loadDotEnv();

const directusUrl = String(args['directus-url'] || process.env.DIRECTUS_URL || 'http://127.0.0.1:8055').replace(/\/+$/, '');
const directusToken = String(args.token || process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '');
const email = String(args['admin-email'] || process.env.DIRECTUS_ADMIN_EMAIL || '');
const password = String(args['admin-password'] || process.env.DIRECTUS_ADMIN_PASSWORD || '');
const openaiKey = String(args['openai-key'] || process.env.OPENAI_API_KEY || '').trim();
const openaiBaseUrl = String(args['openai-base-url'] || process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
const model = String(args.model || 'gpt-4.1-mini');
const overwrite = Boolean(args.overwrite);
const publish = Boolean(args.publish);
const limit = Number(args.limit || 100);
const mode = String(args.mode || 'create');
const batchId = String(args['batch-id'] || '').trim();
const maxOutputTokens = Number(args['max-output-tokens'] || 12000);

const prefixesRaw = args.prefix || args.prefixes || ['/docs/', '/neighbourhood/'];
const prefixes = (Array.isArray(prefixesRaw) ? prefixesRaw : String(prefixesRaw).split(','))
	.map((p) => String(p || '').trim())
	.filter(Boolean);

const normalizePath = (p) => {
	const raw = String(p || '');
	const u = raw.startsWith('http') ? new URL(raw) : null;
	const pathname = u ? u.pathname : raw;
	const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
	const cleaned = withSlash.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const mapDocsEnToEsPath = (p) => {
	const pathNorm = normalizePath(p);
	const parts = pathNorm.split('/').filter(Boolean);
	if (parts[0] !== 'docs') return pathNorm;
	const seg = parts[1] || '';
	const mapped =
		seg === 'propertylist-mls-user-manual'
			? 'propertylist-mls-manual-de-usuario'
			: seg === 'laws-procedures'
				? 'leyes-procedimientos'
				: seg === 'public-portal'
					? 'portal-publico'
					: seg === 'getting-started'
						? 'empezar'
						: seg;
	parts[1] = mapped;
	if (mapped === 'propertylist-mls-manual-de-usuario') {
		const sub = parts[2] || '';
		if (sub === 'getting-started') parts[2] = 'empezar';
	}
	return normalizePath(`/es/${parts.join('/')}/`);
};

const mapNeighbourhoodEnToEsPath = (p) => {
	const pathNorm = normalizePath(p);
	const parts = pathNorm.split('/').filter(Boolean);
	if (parts[0] !== 'neighbourhood') return pathNorm;
	if (parts.length === 2) return normalizePath(`/es/barrios/${parts[1] || ''}/`);
	if (parts.length >= 4 && parts[1] === 'andalucia') return normalizePath(`/es/barrios/${parts[parts.length - 1] || ''}/`);
	return normalizePath(`/es/barrios/${parts[parts.length - 1] || ''}/`);
};

const mapEnToEsPath = (p) => {
	const pathNorm = normalizePath(p);
	if (pathNorm.startsWith('/docs/')) return mapDocsEnToEsPath(pathNorm);
	if (pathNorm.startsWith('/neighbourhood/')) return mapNeighbourhoodEnToEsPath(pathNorm);
	return normalizePath(`/es${pathNorm}`);
};

const looksLikePlaceholderEs = (page) => {
	const body = String(page?.body || '').trim();
	if (!body) return false;
	if (!/abrir en ingl[eé]s/i.test(body)) return false;
	return /traducci[oó]n en curso/i.test(body) || /gu[ií]a en espa[nñ]ol pr[oó]ximamente/i.test(body) || /contenido en espa[nñ]ol pr[oó]ximamente/i.test(body);
};

const directusRequest = async (p, { method = 'GET', token, headers, body } = {}) => {
	const res = await fetch(`${directusUrl}${p}`, {
		method,
		headers: {
			...(body ? { 'content-type': 'application/json' } : {}),
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(headers || {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		if (res.status === 401) {
			throw new Error(
				`Directus 401 ${method} ${p}. Provide DIRECTUS_TOKEN (recommended) or DIRECTUS_ADMIN_EMAIL/DIRECTUS_ADMIN_PASSWORD.${text ? ` Response: ${text}` : ''}`
			);
		}
		throw new Error(`Directus ${res.status} ${method} ${p}${text ? `: ${text}` : ''}`);
	}
	return await res.json();
};

const directusLogin = async () => {
	if (directusToken) return directusToken;
	if (!email || !password) throw new Error('Missing Directus credentials. Set DIRECTUS_TOKEN (recommended) or DIRECTUS_ADMIN_EMAIL/DIRECTUS_ADMIN_PASSWORD.');
	const json = await directusRequest('/auth/login', { method: 'POST', body: { email, password } });
	const token = json?.data?.access_token;
	if (!token) throw new Error('Directus login failed.');
	return token;
};

const listKbPagesByPrefix = async (token, { prefix, lang, status }) => {
	const items = [];
	let offset = 0;
	while (true) {
		const qs = new URLSearchParams();
		qs.set('filter[status][_eq]', status);
		qs.set('filter[language][_eq]', lang);
		qs.set('filter[path][_starts_with]', normalizePath(prefix));
		qs.set('fields', 'id,language,path,title,description,seo_title,seo_description,body,status');
		qs.set('sort', 'id');
		qs.set('limit', String(limit));
		qs.set('offset', String(offset));
		const json = await directusRequest(`/items/kb_pages?${qs.toString()}`, { token });
		const data = Array.isArray(json?.data) ? json.data : [];
		if (!data.length) break;
		items.push(...data);
		if (data.length < limit) break;
		offset += limit;
	}
	return items;
};

const getKbPageByPath = async (token, pathValue, lang) => {
	const qs = new URLSearchParams();
	qs.set('filter[path][_eq]', normalizePath(pathValue));
	if (lang) qs.set('filter[language][_eq]', String(lang));
	qs.set('limit', '1');
	const json = await directusRequest(`/items/kb_pages?${qs.toString()}`, { token });
	return Array.isArray(json?.data) ? json.data[0] || null : null;
};

const upsertKbPage = async (token, item) => {
	const existing = await getKbPageByPath(token, item.path, item.language);
	if (existing?.id) {
		if (!publish && String(existing.status || '') === 'published' && String(item.status || '') === 'draft') {
			item.status = 'published';
		}
		const json = await directusRequest(`/items/kb_pages/${existing.id}`, { method: 'PATCH', token, body: item });
		return { action: 'updated', id: String(json?.data?.id || existing.id) };
	}
	const json = await directusRequest('/items/kb_pages', { method: 'POST', token, body: item });
	return { action: 'created', id: String(json?.data?.id || '') };
};

const openaiRequest = async (p, { method = 'GET', headers, body } = {}) => {
	if (!openaiKey) throw new Error('Missing OPENAI_API_KEY.');
	const res = await fetch(`${openaiBaseUrl}${p}`, {
		method,
		headers: {
			authorization: `Bearer ${openaiKey}`,
			...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
			...(headers || {}),
		},
		body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`OpenAI ${res.status} ${method} ${p}${text ? `: ${text}` : ''}`);
	}
	const ct = res.headers.get('content-type') || '';
	if (ct.includes('application/json')) return await res.json();
	return await res.text();
};

const extractOutputText = (line) => {
	const body = line?.response?.body || line?.response || line?.body || null;
	if (!body) return '';
	if (typeof body.output_text === 'string') return body.output_text;
	const output = Array.isArray(body.output) ? body.output : [];
	for (const item of output) {
		const content = Array.isArray(item?.content) ? item.content : [];
		for (const c of content) {
			if (typeof c?.text === 'string') return c.text;
		}
	}
	return '';
};

const stripEmbeddedDataImages = (html) => {
	const s = String(html || '');
	if (!s) return s;
	return s.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])data:image[^"']*\1[^>]*>/gi, '');
};

const buildTranslationPrompt = ({ title, description, seo_title, seo_description, body }) => {
	const src = {
		title: String(title || ''),
		description: description == null ? null : String(description),
		seo_title: seo_title == null ? null : String(seo_title),
		seo_description: seo_description == null ? null : String(seo_description),
		body: body == null ? null : stripEmbeddedDataImages(String(body)),
	};
	const payload = JSON.stringify(src);
	return `Translate the JSON fields from English to Spanish (Spain). Return ONLY valid JSON matching the schema. Rules:\n- Preserve HTML tags and all attributes exactly as-is (href, src, id, class, data-*, aria-*, style). Translate only human-readable text.\n- Do not change URLs/paths in href/src.\n- Do not include base64 data URIs (data:image...).\n- Keep brand/product terms: PropertyList, MLS, CRM.\n- Keep numbers, dates, units sensible.\n\nINPUT_JSON:\n${payload}`;
};

const buildBatchLine = ({ en, es }) => {
	const prompt = buildTranslationPrompt(en);
	return {
		custom_id: `kb:${String(en.id)}`,
		method: 'POST',
		url: '/v1/responses',
		body: {
			model,
			input: [
				{
					role: 'system',
					content: [
						{
							type: 'input_text',
							text: 'You are a careful technical translator. You preserve HTML structure and never modify attributes or URLs.',
						},
					],
				},
				{ role: 'user', content: [{ type: 'input_text', text: prompt }] },
			],
			text: {
				format: {
					type: 'json_schema',
					name: 'kb_page_es',
					strict: true,
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							title: { type: 'string' },
							description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
							seo_title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
							seo_description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
							body: { anyOf: [{ type: 'string' }, { type: 'null' }] },
						},
						required: ['title', 'description', 'seo_title', 'seo_description', 'body'],
					},
				},
			},
			max_output_tokens: maxOutputTokens,
			metadata: { en_id: String(en.id), en_path: normalizePath(en.path), es_path: normalizePath(es.path) },
		},
	};
};

const ensureDir = async (p) => {
	await fsp.mkdir(p, { recursive: true });
};

const writeJsonl = async (filePath, lines) => {
	const data = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
	await fsp.writeFile(filePath, data, 'utf8');
};

const uploadBatchFile = async (filePath) => {
	const form = new FormData();
	form.set('purpose', 'batch');
	const buf = await fsp.readFile(filePath);
	const name = path.basename(filePath);
	const file = new File([buf], name, { type: 'application/jsonl' });
	form.set('file', file);
	const json = await openaiRequest('/v1/files', { method: 'POST', body: form });
	const id = String(json?.id || '');
	if (!id) throw new Error('OpenAI file upload failed.');
	return id;
};

const createBatch = async (fileId) => {
	const json = await openaiRequest('/v1/batches', {
		method: 'POST',
		body: { input_file_id: fileId, endpoint: '/v1/responses', completion_window: '24h' },
	});
	const id = String(json?.id || '');
	if (!id) throw new Error('OpenAI batch create failed.');
	return id;
};

const getBatch = async (id) => await openaiRequest(`/v1/batches/${encodeURIComponent(id)}`, { method: 'GET' });

const downloadFileContent = async (fileId) =>
	await openaiRequest(`/v1/files/${encodeURIComponent(fileId)}/content`, { method: 'GET', headers: { accept: 'application/jsonl' } });

const mainCreate = async () => {
	const token = await directusLogin();

	const enPages = [];
	const esPages = [];
	const esPrefixes = new Set();
	for (const prefix of prefixes) {
		const prefixNorm = normalizePath(prefix);
		if (!prefixNorm.startsWith('/docs/') && !prefixNorm.startsWith('/neighbourhood/')) continue;
		const hit = await listKbPagesByPrefix(token, { prefix: prefixNorm, lang: 'en', status: 'published' });
		enPages.push(...hit);
		if (prefixNorm.startsWith('/docs/')) esPrefixes.add('/es/docs/');
		if (prefixNorm.startsWith('/neighbourhood/')) esPrefixes.add('/es/barrios/');
	}

	for (const esPrefix of esPrefixes) {
		esPages.push(...(await listKbPagesByPrefix(token, { prefix: esPrefix, lang: 'es', status: 'published' })));
		esPages.push(...(await listKbPagesByPrefix(token, { prefix: esPrefix, lang: 'es', status: 'draft' })));
	}
	const esByPath = new Map(esPages.map((p) => [normalizePath(p.path), p]));

	const jobs = [];
	let skipped = 0;
	for (const en of enPages) {
		const enPath = normalizePath(en.path);
		const esPath = mapEnToEsPath(enPath);
		const existing = esByPath.get(esPath) || null;
		const okExisting = existing && !looksLikePlaceholderEs(existing);
		if (!overwrite && okExisting) {
			skipped++;
			continue;
		}
		jobs.push({ en, es: { path: esPath, existingId: existing?.id ? String(existing.id) : '' } });
	}

	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = path.join(process.cwd(), 'tmp_openai_batches');
	await ensureDir(dir);
	const jsonlPath = path.join(dir, `translate-es-${ts}.jsonl`);
	await writeJsonl(
		jsonlPath,
		jobs.map((j) => buildBatchLine(j))
	);

	const fileId = await uploadBatchFile(jsonlPath);
	const id = await createBatch(fileId);
	process.stdout.write(`batch_created\t${id}\tfile\t${fileId}\tjsonl\t${jsonlPath}\tsource_pages\t${enPages.length}\tqueued\t${jobs.length}\tskipped\t${skipped}\n`);
};

const mainStatus = async () => {
	if (!batchId) throw new Error('Missing --batch-id');
	const json = await getBatch(batchId);
	process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
};

const mainApply = async () => {
	if (!batchId) throw new Error('Missing --batch-id');
	const token = await directusLogin();
	const batch = await getBatch(batchId);
	const status = String(batch?.status || '');
	if (status !== 'completed') throw new Error(`Batch not completed (status=${status}).`);
	const outputFileId = String(batch?.output_file_id || '');
	if (!outputFileId) throw new Error('Batch output_file_id missing.');

	const content = await downloadFileContent(outputFileId);
	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = path.join(process.cwd(), 'tmp_openai_batches');
	await ensureDir(dir);
	const outPath = path.join(dir, `batch-output-${batchId}-${ts}.jsonl`);
	await fsp.writeFile(outPath, String(content || ''), 'utf8');

	const lines = String(content || '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return null;
			}
		})
		.filter(Boolean);

	let ok = 0;
	let failed = 0;
	for (const line of lines) {
		if (line?.error) {
			failed++;
			continue;
		}
		const text = extractOutputText(line);
		let translated = null;
		try {
			translated = JSON.parse(String(text || ''));
		} catch {
			failed++;
			continue;
		}
		const meta = line?.response?.body?.metadata || line?.response?.metadata || line?.metadata || {};
		const enPath = normalizePath(String(meta?.en_path || ''));
		const esPath = enPath ? mapEnToEsPath(enPath) : normalizePath(String(meta?.es_path || ''));
		if (!esPath) {
			failed++;
			continue;
		}
		const item = {
			status: publish ? 'published' : 'draft',
			language: 'es',
			path: esPath,
			title: String(translated?.title || ''),
			description: translated?.description == null ? null : String(translated.description),
			seo_title: translated?.seo_title == null ? null : String(translated.seo_title),
			seo_description: translated?.seo_description == null ? null : String(translated.seo_description),
			body: translated?.body == null ? null : String(translated.body),
		};
		if (!item.title) {
			failed++;
			continue;
		}
		const { action, id } = await upsertKbPage(token, item);
		process.stdout.write(`${action}\t${id}\t${String(meta?.en_path || '')}\t=>\t${esPath}\n`);
		ok++;
	}
	process.stdout.write(`apply_done\tok\t${ok}\tfailed\t${failed}\toutput\t${outPath}\n`);
};

const mainErrors = async () => {
	if (!batchId) throw new Error('Missing --batch-id');
	const batch = await getBatch(batchId);
	const status = String(batch?.status || '');
	if (status !== 'completed') throw new Error(`Batch not completed (status=${status}).`);
	const errorFileId = String(batch?.error_file_id || '');
	if (!errorFileId) throw new Error('Batch error_file_id missing.');

	const content = await downloadFileContent(errorFileId);
	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = path.join(process.cwd(), 'tmp_openai_batches');
	await ensureDir(dir);
	const outPath = path.join(dir, `batch-errors-${batchId}-${ts}.jsonl`);
	await fsp.writeFile(outPath, String(content || ''), 'utf8');

	const lines = String(content || '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return null;
			}
		})
		.filter(Boolean);

	const first = lines[0] || null;
	const sample = lines.find((l) => l?.error || l?.response?.status_code >= 400) || first;
	const errObj = sample?.error || sample?.response?.body?.error || sample?.response?.body || null;
	const message =
		sample?.error?.message ||
		sample?.response?.body?.error?.message ||
		sample?.response?.body?.message ||
		(sample?.response?.body ? JSON.stringify(sample.response.body) : '') ||
		(sample ? JSON.stringify(sample) : '');
	process.stdout.write(`errors_saved\t${outPath}\n`);
	if (message) process.stdout.write(`error_sample\t${String(message).slice(0, 400)}\n`);
	if (errObj) process.stdout.write(`error_sample_json\t${JSON.stringify(errObj).slice(0, 800)}\n`);
	if (sample) process.stdout.write(`error_line_keys\t${Object.keys(sample).join(',')}\n`);
	if (sample?.response) process.stdout.write(`error_response_status\t${String(sample.response.status_code || '')}\n`);
};

if (mode === 'create') await mainCreate();
else if (mode === 'status') await mainStatus();
else if (mode === 'apply') await mainApply();
else if (mode === 'errors') await mainErrors();
else throw new Error(`Unknown --mode ${mode}`);
