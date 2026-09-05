// Every public form on the info hub also writes a row here.
//
// Submissions used to live only in JSON files under var/admin. Those sit outside
// Postgres, so they were not covered by the nightly database dump, could not be
// queried, and a stray edit could wipe them. They now also go to the
// form_submissions table in Directus, which the nightly pg_dump does cover.
//
// This is deliberately additive: each endpoint keeps its existing file write, so
// the database becoming unreachable can never lose a lead, and no working lead
// path had to be rewritten to gain durable storage.

const DIRECTUS = 'http://127.0.0.1:8055';
const TOKEN = (process.env.DIRECTUS_ADMIN_TOKEN || '').trim();

export type SubmissionRow = {
	/** which form: services-waitlist, buyer-lead, walkthrough-lead ... */
	kind: string;
	email?: string;
	name?: string;
	phone?: string;
	lang?: string;
	/** the form or page it came from */
	source?: string;
	page?: string;
	/** everything else the form sent */
	payload?: Record<string, unknown>;
	/** set when a bot screen fired; the row is kept so nothing disappears silently */
	flags?: string;
	/** whether the notification email was accepted */
	notified?: boolean;
};

const trim = (v: unknown, max: number) => {
	const s = String(v ?? '').trim();
	return s ? s.slice(0, max) : null;
};

/**
 * Write one submission to the database. Never throws and never blocks the
 * response on a failure: the endpoint's own file write is the fallback.
 * Returns the new row id, or null if the database could not be reached.
 */
export async function mirrorSubmission(s: SubmissionRow): Promise<number | null> {
	if (!TOKEN) return null;
	try {
		const res = await fetch(`${DIRECTUS}/items/form_submissions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
			body: JSON.stringify({
				kind: s.kind.slice(0, 60),
				email: s.email ? String(s.email).toLowerCase().trim().slice(0, 180) : null,
				name: trim(s.name, 160),
				phone: trim(s.phone, 60),
				lang: (s.lang === 'es' ? 'es' : s.lang || 'en').slice(0, 8),
				source: trim(s.source, 120) || s.kind.slice(0, 120),
				page: trim(s.page, 300),
				payload: s.payload && Object.keys(s.payload).length ? s.payload : null,
				flags: trim(s.flags, 120),
				notified: s.notified ?? false,
				status: 'new',
			}),
			signal: AbortSignal.timeout(6000),
		});
		if (!res.ok) return null;
		const j: any = await res.json().catch(() => null);
		return j?.data?.id ?? null;
	} catch {
		return null;
	}
}
