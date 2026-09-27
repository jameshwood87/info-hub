// "Or just ask CoAgent" tips at the top of the MLS manual pages whose task CoAgent can do (James, 27-09-26: only
// where it can actually do it; second pass the same day, "check other you have missed too", added the search, lead,
// availability, reference-number, import and section overview pages. On the area report pages the tip offers the
// free, quicker answer, not the report itself (James: CoAgent's "what's it worth" is free but not as detailed as
// the paid report). Examples come from the "How to use CoAgent" page where it has one; the others
// follow the abilities James confirmed (add and edit anything in the CRM). Keyed by the path after the manual root,
// the same in both languages. Never use a real listing reference in an example: PL99999 is not a listing.

type Tip = { ask: string; then: string };

export const COAGENT_TIP_ROOTS = { en: '/docs/propertylist-mls-user-manual/', es: '/es/docs/propertylist-mls-manual-de-usuario/' };
export const COAGENT_HOWTO = { en: `${COAGENT_TIP_ROOTS.en}ai-automation/coagent/`, es: `${COAGENT_TIP_ROOTS.es}ai-automation/coagent/` };

const ADD_CONTACT = {
	en: { ask: 'Add Maria Lopez 6XX XXX XXX maria@example.com', then: ', then reply YES and she is added to your contacts, without a duplicate.' },
	es: { ask: 'Añade a Maria Lopez 6XX XXX XXX maria@example.com', then: ' y responde SÍ: se añade a tus contactos, sin crear un duplicado.' },
};
const LISTING = {
	en: { ask: "Let's list a property", then: ' and CoAgent tells you what to send: photos, then the details. It writes the title, description and features when you reply YES.' },
	es: { ask: 'Vamos a anunciar una propiedad', then: ' y CoAgent te dice qué enviar: fotos y después los datos. Escribe el título, la descripción y las características cuando respondes SÍ.' },
};
const EDIT = {
	en: { ask: 'Change the price of PL99999 to 425,000 euros', then: ', then reply YES to save the change.' },
	es: { ask: 'Cambia el precio de PL99999 a 425.000 euros', then: ' y responde SÍ para guardar el cambio.' },
};
const LEADS = {
	en: { ask: 'What are my latest leads?', then: ' and it shows your five newest: who enquired, about which listing and when.' },
	es: { ask: '¿Cuáles son mis últimos leads?', then: ' y te muestra los cinco más recientes: quién consultó, sobre qué propiedad y cuándo.' },
};
const OFFER = {
	en: { ask: 'Marta has made an offer', then: ', then reply YES and her card moves to the right stage on your pipeline.' },
	es: { ask: 'Marta ha hecho una oferta', then: ' y responde SÍ: su tarjeta pasa a la etapa correcta de tu pipeline.' },
};
const SEARCH = {
	en: { ask: 'What have we got in Marbella, three beds, up to two million?', then: ' and it answers with listings from the shared MLS, with prices and links.' },
	es: { ask: '¿Qué tenemos en Marbella, tres dormitorios, hasta dos millones?', then: ' y te responde con propiedades del MLS compartido, con precios y enlaces.' },
};

const AREA = (en: string, es: string) => ({
	en: { ask: 'What is Nueva Andalucía worth?', then: ` for a quick answer, free: the middle asking price and the range on the market there. ${en}` },
	es: { ask: '¿Cuánto vale Nueva Andalucía?', then: ` para una respuesta rápida y gratis: el precio medio de salida y el rango en el mercado allí. ${es}` },
});

export const COAGENT_TIPS: Record<string, { en: Tip; es: Tip }> = {
	'contacts-crm/': ADD_CONTACT,
	'contacts-crm/add-contact/': ADD_CONTACT,
	'contacts-crm/notes-and-history/': {
		en: { ask: 'Add a note to Marta: she wants to see it again Saturday', then: ', then reply YES and it is saved to her file.' },
		es: { ask: 'Añade una nota a Marta: quiere verla otra vez el sábado', then: ' y responde SÍ: se guarda en su ficha.' },
	},
	'core-workflow/': LISTING,
	'core-workflow/listing-a-property/': LISTING,
	// James, 27-09-26: "you can send your xml feed to coagent and it will do it also".
	'core-workflow/import-properties/': {
		en: { ask: 'Import my properties from https://example.com/feed.xml', then: ' and CoAgent does the import for you.' },
		es: { ask: 'Importa mis propiedades desde https://example.com/feed.xml', then: ' y CoAgent hace la importación por ti.' },
	},
	'core-workflow/tips-for-creating-high-quality-property-listings/': LISTING,
	'managing-listings/': EDIT,
	'managing-listings/editing-existing-listings/': EDIT,
	'managing-listings/changing-property-status/': {
		en: { ask: 'Mark PL99999 as sold', then: ', then reply YES to save the change.' },
		es: { ask: 'Marca PL99999 como vendida', then: ' y responde SÍ para guardar el cambio.' },
	},
	'managing-listings/reference-numbers/': {
		en: { ask: 'Tell me about PL99999', then: ' and it answers with the price, bedrooms, size, location and the link.' },
		es: { ask: 'Háblame de PL99999', then: ' y te responde con el precio, los dormitorios, la superficie, la ubicación y el enlace.' },
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
	'searching-and-alerts/': SEARCH,
	'searching-and-alerts/filters/': SEARCH,
	'searching-and-alerts/scheduling-appointments-and-meetings/': {
		en: { ask: 'Is PL99999 still available?', then: ' and, if it belongs to another agency, CoAgent asks them for you through the MLS when you reply YES.' },
		es: { ask: '¿Sigue disponible PL99999?', then: ' y, si es de otra agencia, CoAgent les pregunta por ti a través del MLS cuando respondes SÍ.' },
	},
	'managing-your-leads/': LEADS,
	'managing-your-leads/managing-enquires/': LEADS,
	'managing-your-leads/mls-leads/': LEADS,
	'managing-your-leads/portal-leads/': LEADS,
	'managing-your-leads/direct-microsite-leads/': LEADS,
	'managing-listings/tracking-property-enquiries-leads/': LEADS,
	'reports-statistics/': AREA('The reports in this section go into much more detail.', 'Los informes de esta sección son mucho más detallados.'),
	'reports-statistics/area-market-reports/': AREA('The report on this page goes into much more detail.', 'El informe de esta página es mucho más detallado.'),
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
