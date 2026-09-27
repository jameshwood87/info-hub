// "For agents" blocks at the end of blog posts: one per post, picked by topic from the post's title and address.
// Every price and claim was checked on 27-09-26 against the production price sheet, the free-vs-paid ledger and the
// feature's own live landing page. A change here shows on every post that uses the block: check the source again
// first, and keep the English and the Spanish saying the same thing.

export type AgentBlockId = 'list-area' | 'mls' | 'reports' | 'rentals' | 'brochure' | 'coagent' | 'website';
type Lang = 'en' | 'es';
type Copy = { title: string; body: string; button: string; href: string };

const signup = (lang: Lang, id: AgentBlockId) =>
	`https://agents.propertylist.es/new_agency/new?locale=${lang}&utm_source=info-hub&utm_medium=agent-block&utm_campaign=${id}`;

// {in} becomes the place the post is about ("in Marbella", "on the Costa del Sol"); list-area has its own wording
// for posts that name no place.
export const AGENT_BLOCKS: Record<AgentBlockId, Record<Lang, Copy>> = {
	'list-area': {
		en: {
			title: 'Are you an agent {in}?',
			body: 'List your properties free, in front of buyers and renters looking for a home {in}. Share them with other registered agencies and more agents can sell them with you.',
			button: 'List free on PropertyList',
			href: signup('en', 'list-area'),
		},
		es: {
			title: '¿Eres agente {in}?',
			body: 'Publica tus propiedades gratis, delante de los compradores e inquilinos que buscan casa {in}. Compártelas con otras agencias registradas y más agentes podrán venderlas contigo.',
			button: 'Publica gratis en PropertyList',
			href: signup('es', 'list-area'),
		},
	},
	mls: {
		en: {
			title: 'List once. Other agencies can sell it with you.',
			body: 'PropertyList is an MLS: your listings reach buyers on the portal and other registered agencies, who can sell them with you. Listing and sharing are free.',
			button: 'How the free MLS works',
			href: '/free-mls/',
		},
		es: {
			title: 'Publica una vez. Otras agencias pueden venderlo contigo.',
			body: 'PropertyList es un MLS: tus anuncios llegan a los compradores del portal y a otras agencias registradas, que pueden venderlos contigo. Publicar y compartir es gratis.',
			button: 'Cómo funciona el MLS gratuito',
			href: '/es/mls-gratuito/',
		},
	},
	reports: {
		en: {
			title: 'Pricing a listing? Bring the register.',
			body: 'A Property Intelligence Report sets the asking price against the Spanish notarial register, what buyers actually paid in the area, and gives you three pricing strategies. Your first 3 reports are free.',
			button: 'How the report works',
			href: '/property-intelligence-report/',
		},
		es: {
			title: '¿Vas a fijar un precio? Lleva el registro.',
			body: 'Un Property Intelligence Report compara el precio de salida con el registro notarial, lo que los compradores pagaron de verdad en la zona, y te da tres estrategias de precio. Tus 3 primeros informes son gratis.',
			button: 'Cómo funciona el informe',
			href: '/es/informe-inteligencia-propiedad/',
		},
	},
	rentals: {
		en: {
			title: 'Letting agent? Take your rental book out of the spreadsheet.',
			body: 'The Rentals Module runs long-term lets inside your PropertyList CRM: a tenants pipeline, and one record per tenancy that chases its own renewals. The first 30 days are free, with no card.',
			button: 'See the Rentals Module',
			href: '/rentals/',
		},
		es: {
			title: '¿Gestionas alquileres? Saca tu cartera de la hoja de cálculo.',
			body: 'El módulo de Alquileres lleva los alquileres de larga duración dentro de tu CRM de PropertyList: el pipeline de inquilinos y un registro por contrato que vigila sus propias renovaciones. Los primeros 30 días son gratis, sin tarjeta.',
			button: 'Ver el módulo de Alquileres',
			href: '/es/alquileres/',
		},
	},
	brochure: {
		en: {
			title: 'Change the price once. Every brochure updates itself.',
			body: 'Instant Brochure turns any of your listings into a PDF and a share page. When the price, photos or status change, the link your buyer already has shows the change. Free for agents.',
			button: 'See Instant Brochure',
			href: '/instant-brochure/',
		},
		es: {
			title: 'Cambia el precio una vez. Cada folleto se actualiza solo.',
			body: 'Folleto Instantáneo convierte cualquiera de tus anuncios en un PDF y una página para compartir. Si cambian el precio, las fotos o el estado, el enlace que ya tiene tu comprador lo muestra. Gratis para agentes.',
			button: 'Ver Folleto Instantáneo',
			href: '/es/folleto-instantaneo/',
		},
	},
	coagent: {
		en: {
			title: 'Update your CRM from WhatsApp',
			body: 'CoAgent adds listings, contacts and notes to your PropertyList CRM from a WhatsApp message, and drafts replies to your leads for you to send. Every agent gets 20 free messages a month.',
			button: 'Meet CoAgent',
			href: '/coagent/',
		},
		es: {
			title: 'Actualiza tu CRM desde WhatsApp',
			body: 'CoAgent añade anuncios, contactos y notas a tu CRM de PropertyList desde un mensaje de WhatsApp, y redacta respuestas a tus leads para que tú las envíes. Cada agente tiene 20 mensajes gratis al mes.',
			button: 'Conoce CoAgent',
			href: '/es/coagent/',
		},
	},
	website: {
		en: {
			title: "Your own website, with the whole network's listings",
			body: 'The Website Builder puts your listings on your own site, next to any property on the PropertyList network you choose to show. Free to build and preview, then from 50 credits a month once you publish.',
			button: 'See the Website Builder',
			href: '/website-builder/',
		},
		es: {
			title: 'Tu propia web, con los anuncios de toda la red',
			body: 'El Creador de Webs de PropertyList pone tus anuncios en tu propia web, junto a las propiedades de la red que elijas mostrar. Crearla y previsualizarla es gratis; desde 50 créditos al mes cuando la publicas.',
			button: 'Ver el Creador de Webs',
			href: '/es/constructor-de-webs/',
		},
	},
};

const NO_PLACE: Record<Lang, { title: string; in: string }> = {
	en: { title: 'Are you an estate agent?', in: 'in your area' },
	es: { title: '¿Eres agente inmobiliario?', in: 'en tu zona' },
};

const norm = (s: string) =>
	String(s || '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

// First match wins, tested on the post's title and address in either language. Holiday and tourist lets go to
// list-area because the Rentals Module is for long-term lets. A post that matches nothing gets list-area.
const RULES: Array<[AgentBlockId, RegExp]> = [
	['list-area', /\b(whats on|que hacer|short term|holiday|tourist|turistic[oa]s?|vacacional(es)?|corta duracion)\b/],
	['website', /\b(websites?|pagina web|web propia|digital tools?|herramientas digitales)\b/],
	// The portal's AI search runs over the shared MLS; it is not CoAgent.
	['mls', /\b(ai (property )?search|ai property match|busqueda con ia)\b/],
	['coagent',/\b(ai|ia|artificial intelligence|inteligencia artificial|future proof\w*|para el futuro)\b/],
	['brochure', /\b(home staging|presentation|presentacion|brochures?|folletos?|social media|redes sociales)\b/],
	['rentals', /\b(landlords?|tenants?|tenanc(y|ies)|letting|renting|rent increases?|rental (market|supply|tax)|long term|housing (law|rules)|ley de vivienda|normas de vivienda|decreto de vivienda|zona tensionada|arrendador(es)?|inquilin[oa]s?|larga duracion|alquilar|subir el alquiler|subidas? de (la )?renta|mercado de alquiler|oferta de alquiler)\b/],
	['reports', /\b(market|price per|per m2|notar(y|ial|iales|io|ios)|oracle|swimming pool|piscina|who bought|property boom|is booming|investment|inversion|mercado|boom inmobiliario|en auge)\b/],
	['mls', /\b(mls|crm|estate agents?|estate agencies|agencies|share listings|private listings|reference numbers|roadmap|your listings|propertylist community|agentes? inmobiliarios?|agencias|compartir inmuebles|anuncios privados|numeros de referencia|tus anuncios|comunidad propertylist)\b/],
];

export const pickAgentBlock = (title: string, path: string): AgentBlockId => {
	const hay = norm(`${title} ${path}`);
	return (RULES.find(([, re]) => re.test(hay)) || ['list-area'])[0];
};

// Places the list-area block can name, most specific first; only the post's title counts, so a place mentioned in
// passing never gets a post about national tax law titled "Are you an agent in Marbella?".
const PLACES: Array<[string[], Record<Lang, string>]> = [
	[['puerto banus'], { en: 'in Puerto Banús', es: 'en Puerto Banús' }],
	[['nueva andalucia'], { en: 'in Nueva Andalucía', es: 'en Nueva Andalucía' }],
	[['san pedro'], { en: 'in San Pedro de Alcántara', es: 'en San Pedro de Alcántara' }],
	[['la zagaleta', 'benahavis'], { en: 'in Benahavís', es: 'en Benahavís' }],
	[['el limonar', 'pedregalejo', 'malaga'], { en: 'in Málaga', es: 'en Málaga' }],
	[['marbella', 'golden mile', 'milla de oro', 'sierra blanca', 'los monteros'], { en: 'in Marbella', es: 'en Marbella' }],
	[['estepona'], { en: 'in Estepona', es: 'en Estepona' }],
	[['mijas', 'calahonda'], { en: 'in Mijas', es: 'en Mijas' }],
	[['fuengirola'], { en: 'in Fuengirola', es: 'en Fuengirola' }],
	[['benalmadena'], { en: 'in Benalmádena', es: 'en Benalmádena' }],
	[['torremolinos'], { en: 'in Torremolinos', es: 'en Torremolinos' }],
	[['nerja'], { en: 'in Nerja', es: 'en Nerja' }],
	[['sotogrande'], { en: 'in Sotogrande', es: 'en Sotogrande' }],
	[['manilva'], { en: 'in Manilva', es: 'en Manilva' }],
	[['casares'], { en: 'in Casares', es: 'en Casares' }],
	[['costa del sol'], { en: 'on the Costa del Sol', es: 'en la Costa del Sol' }],
	[['andalusia', 'andalucia', 'andaluz'], { en: 'in Andalusia', es: 'en Andalucía' }],
];

export const agentBlockCopy = (id: AgentBlockId, lang: Lang, title: string): Copy => {
	const copy = AGENT_BLOCKS[id][lang];
	if (id !== 'list-area') return copy;
	const hay = ` ${norm(title)}`;
	const place = PLACES.find(([keys]) => keys.some((k) => hay.includes(` ${k}`)))?.[1][lang];
	return {
		...copy,
		title: place ? copy.title.replace('{in}', place) : NO_PLACE[lang].title,
		body: copy.body.replace('{in}', place || NO_PLACE[lang].in),
	};
};
