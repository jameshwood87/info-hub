// What a complaint was about. Set by the reviewer, never by the reporter.
//
// These are ALLEGATION types, not findings. A report tagged "threats" means someone
// described threatening behaviour, not that we have concluded it happened. The status
// field (new/reviewing/actioned/dismissed) carries the verdict; these carry the subject.
//
// Keep this list short. A taxonomy nobody can hold in their head gets used inconsistently
// and the pattern data becomes noise.

export type ReportCategory = {
	id: string;
	label: string;
	/** shown to the reviewer so the same narrative gets tagged the same way twice */
	hint: string;
	/** conduct issues are actionable on their own; quality disputes usually are not */
	kind: 'conduct' | 'quality' | 'money' | 'integrity';
};

export const REPORT_CATEGORIES: ReportCategory[] = [
	{ id: 'damage', label: 'Damage to property', kind: 'quality',
	  hint: 'Something was broken or marked during the work' },
	{ id: 'work-quality', label: 'Poor workmanship', kind: 'quality',
	  hint: 'The job was done badly or left unfinished' },
	{ id: 'no-show', label: 'Did not turn up or abandoned', kind: 'quality',
	  hint: 'Failed to attend, walked off the job, went silent mid-job' },
	{ id: 'refusal-to-remedy', label: 'Refused to put it right', kind: 'conduct',
	  hint: 'Denied responsibility or refused to repair or refund' },
	{ id: 'rudeness', label: 'Rude or abusive language', kind: 'conduct',
	  hint: 'Insults or abuse toward a customer or another member' },
	{ id: 'threats', label: 'Threats or intimidation', kind: 'conduct',
	  hint: 'Threatened harm, or pressure meant to frighten. Not the same as saying "speak to my lawyer"' },
	{ id: 'overcharging', label: 'Overcharging or hidden fees', kind: 'money',
	  hint: 'Price changed, extras appeared, quote not honoured' },
	{ id: 'non-payment', label: 'Did not pay', kind: 'money',
	  hint: 'Owes money to a member or a supplier' },
	{ id: 'misrepresentation', label: 'Misrepresented the service', kind: 'integrity',
	  hint: 'Claimed credentials, cover or capability they do not have' },
	{ id: 'unlicensed', label: 'Unlicensed or uninsured', kind: 'integrity',
	  hint: 'Trading without a licence or insurance the work requires' },
	{ id: 'data-misuse', label: 'Misused contacts or data', kind: 'integrity',
	  hint: 'Spammed the group, scraped or shared client details' },
	{ id: 'fraud', label: 'Took money and did not deliver', kind: 'integrity',
	  hint: 'The strongest label. Use only where money was taken for nothing' },
];

export const CATEGORY_IDS = REPORT_CATEGORIES.map((c) => c.id);

/** Digits only, +34 stripped, so the same number written four ways matches itself. */
export const contactKey = (v?: string): string => {
	const s = String(v || '').trim();
	if (!s) return '';
	if (/@/.test(s)) return 'email:' + s.toLowerCase();
	const d = s.replace(/[^0-9]/g, '').replace(/^34/, '');
	if (d.length === 9) return 'tel:' + d;
	const tax = s.toUpperCase().match(/\b(?:[ABCDEFGHJNPQRSUVW]\d{8}|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/);
	if (tax) return 'tax:' + tax[0];
	return s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
};
