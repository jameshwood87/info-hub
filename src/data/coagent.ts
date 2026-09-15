// The CoAgent WhatsApp number, in one place for every page that mentions it.
// Paste it here at 9am on Tuesday 15 September and /coagent/, /es/coagent/,
// /1000-agencies/ and /es/1000-agencias/ all switch from "goes live Tuesday" to a
// real WhatsApp button on the next deploy. Leave it empty until then.
export const COAGENT_NUMBER = '+1 585 496 9911';

export function coagentWaLink(text = 'Hi'): string {
	const digits = COAGENT_NUMBER.replace(/[^0-9]/g, '');
	return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : '';
}

// Where an agent adds their mobile to their own user, so CoAgent knows who is writing.
export const CRM_STAFF_URL = 'https://agents.propertylist.es/staff';
