// "Or just ask CoAgent" tips at the top of the MLS manual pages whose task CoAgent can do (James, 27-09-26: only
// where it can actually do it). Examples come from the "How to use CoAgent" page where it has one; the others follow
// the abilities James confirmed (add and edit anything in the CRM). Keyed by the path after the manual root, the same
// in both languages. Never use a real listing reference in an example: PL99999 is not a listing.

type Tip = { ask: string; then: string };

export const COAGENT_TIP_ROOTS = { en: '/docs/propertylist-mls-user-manual/', es: '/es/docs/propertylist-mls-manual-de-usuario/' };
export const COAGENT_HOWTO = { en: `${COAGENT_TIP_ROOTS.en}ai-automation/coagent/`, es: `${COAGENT_TIP_ROOTS.es}ai-automation/coagent/` };

const LEADS = {
	en: { ask: 'What are my latest leads?', then: ' and it shows your five newest: who enquired, about which listing and when.' },
	es: { ask: '¿Cuáles son mis últimos leads?', then: ' y te muestra los cinco más recientes: quién consultó, sobre qué propiedad y cuándo.' },
};
const OFFER = {
	en: { ask: 'Marta has made an offer', then: ', then reply YES and her card moves to the right stage on your pipeline.' },
	es: { ask: 'Marta ha hecho una oferta', then: ' y responde SÍ: su tarjeta pasa a la etapa correcta de tu pipeline.' },
};

export const COAGENT_TIPS: Record<string, { en: Tip; es: Tip }> = {
	'contacts-crm/add-contact/': {
		en: { ask: 'Add Maria Lopez 6XX XXX XXX maria@example.com', then: ', then reply YES and she is added to your contacts, without a duplicate.' },
		es: { ask: 'Añade a Maria Lopez 6XX XXX XXX maria@example.com', then: ' y responde SÍ: se añade a tus contactos, sin crear un duplicado.' },
	},
	'contacts-crm/notes-and-history/': {
		en: { ask: 'Add a note to Marta: she wants to see it again Saturday', then: ', then reply YES and it is saved to her file.' },
		es: { ask: 'Añade una nota a Marta: quiere verla otra vez el sábado', then: ' y responde SÍ: se guarda en su ficha.' },
	},
	'core-workflow/listing-a-property/': {
		en: { ask: "Let's list a property", then: ' and CoAgent tells you what to send: photos, then the details. It writes the title, description and features when you reply YES.' },
		es: { ask: 'Vamos a anunciar una propiedad', then: ' y CoAgent te dice qué enviar: fotos y después los datos. Escribe el título, la descripción y las características cuando respondes SÍ.' },
	},
	'managing-listings/editing-existing-listings/': {
		en: { ask: 'Change the price of PL99999 to 425,000 euros', then: ', then reply YES to save the change.' },
		es: { ask: 'Cambia el precio de PL99999 a 425.000 euros', then: ' y responde SÍ para guardar el cambio.' },
	},
	'managing-listings/changing-property-status/': {
		en: { ask: 'Mark PL99999 as sold', then: ', then reply YES to save the change.' },
		es: { ask: 'Marca PL99999 como vendida', then: ' y responde SÍ para guardar el cambio.' },
	},
	'marketing-and-portals/instant-brochure/': {
		en: { ask: 'BROCHURE PL99999', then: ' and it sends back a brochure with your branding, as a web page and a PDF, free.' },
		es: { ask: 'FOLLETO PL99999', then: ' y te devuelve un folleto con tu marca, como página web y PDF, gratis.' },
	},
	'pipeline-and-tasks/how-to-use-the-calendar/': {
		en: { ask: 'Where is my next viewing?', then: " and it answers with the address and the client's phone number." },
		es: { ask: '¿Dónde es mi próxima visita?', then: ' y te responde con la dirección y el teléfono del cliente.' },
	},
	'pipeline-and-tasks/managing-your-schedule-and-tasks/': {
		en: { ask: 'What have I got tomorrow?', then: ' and it lists your whole day, in order.' },
		es: { ask: '¿Qué tengo mañana?', then: ' y te da el día entero, en orden.' },
	},
	'managing-your-leads/managing-enquires/': LEADS,
	'managing-listings/tracking-property-enquiries-leads/': LEADS,
	'reports-statistics/generating-property-reports/': {
		en: { ask: 'What is PL99999 worth?', then: ' for a figure from notary-recorded sales in that town, then reply REPORT for the full market report.' },
		es: { ask: '¿Cuánto vale PL99999?', then: ' para una cifra basada en ventas escrituradas ante notario en ese municipio, y responde INFORME para el informe completo de mercado.' },
	},
	'your-account/how-to-setup-company-staff-accounts/': {
		en: { ask: 'Add Pablo Garcia to my staff, pablo@example.com', then: ', then reply YES to save it.' },
		es: { ask: 'Añade a Pablo Garcia a mi personal, pablo@example.com', then: ' y responde SÍ para guardarlo.' },
	},
	'pipeline-and-tasks/': OFFER,
	'pipeline-and-tasks/pipeline/': OFFER,
};

export const coagentTipFor = (path: string, lang: 'en' | 'es') => {
	const root = COAGENT_TIP_ROOTS[lang];
	if (!String(path || '').startsWith(root)) return null;
	const sub = path.slice(root.length);
	const tip = COAGENT_TIPS[sub];
	return tip ? { sub, ...tip[lang] } : null;
};
