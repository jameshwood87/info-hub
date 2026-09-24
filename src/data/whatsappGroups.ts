// Every PropertyList WhatsApp community and group with its invite code. Each code was checked against the
// group name on its invite page (og:title) on 24-09-26; the table lives in
// PropertyList/whatsapp-groups-page-24-09-26/links.md. "full" means the group sits at WhatsApp's member
// limit: its link still works and puts you on the waiting list (James, 24-09-26). Keep this file and the
// docs page (kb 1609 EN / 1612 ES) in step: the docs page is the reference list, this feeds /whatsapp-groups/.
export type Lang = 'en' | 'es';
export type AreaId = 'marbella' | 'malaga' | 'estepona' | 'madrid' | 'barcelona' | 'mallorca' | 'ibiza' | 'specialist';
export type Kind =
	| 'sales'
	| 'longterm'
	| 'shortterm'
	| 'renttobuy'
	| 'openhouses'
	| 'buyers'
	| 'strequests'
	| 'bonus'
	| 'newdev'
	| 'commercial'
	| 'plots'
	| 'hotels'
	| 'services';

export interface Group {
	code: string;
	kind: Kind;
	name: Record<Lang, string>;
	desc: Record<Lang, string>;
	full?: boolean;
}
export interface Community {
	code: string;
	name: Record<Lang, string>;
	desc: Record<Lang, string>;
}
export interface Area {
	id: AreaId;
	/** section heading */
	name: Record<Lang, string>;
	/** chip label */
	short: Record<Lang, string>;
	community?: Community;
	groups: Group[];
	/** where the dot sits on the Spain map; "inset" dots go in the Costa del Sol magnifier */
	map?: { lon: number; lat: number; layer: 'main' | 'inset' };
}

export const INVITE = (code: string) => `https://chat.whatsapp.com/${code}`;

/** 2500 -> "2,500" (EN) or "2.500" (ES). Spanish locale formatting drops the separator on four-digit numbers, so this is done by hand. */
export const fmtNum = (n: number, lang: Lang) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'es' ? '.' : ',');

/** The network-wide announcements group, shown first whatever the area. */
export const INFO_GROUP: Group = {
	code: 'KUFodMvHrU7AsUUG2M8qdm',
	kind: 'sales',
	name: { en: 'PropertyList info', es: 'Avisos de PropertyList' },
	desc: { en: 'Announcements from PropertyList for all areas: new groups and changes', es: 'Avisos de PropertyList para todas las zonas: grupos nuevos y cambios' },
};

export const KIND_LABEL: Record<Kind, Record<Lang, string>> = {
	sales: { en: 'Sales', es: 'Ventas' },
	longterm: { en: 'Long-term rentals', es: 'Larga temporada' },
	shortterm: { en: 'Short-term rentals', es: 'Corta temporada' },
	renttobuy: { en: 'Rent to buy', es: 'Opción a compra' },
	openhouses: { en: 'Open houses', es: 'Open houses' },
	buyers: { en: 'Buyer requests', es: 'Demandas de compradores' },
	strequests: { en: 'Short-term requests', es: 'Demandas de corta temporada' },
	bonus: { en: 'Bonus commission', es: 'Comisión extra' },
	newdev: { en: 'New developments', es: 'Obra nueva' },
	commercial: { en: 'Commercial', es: 'Locales y oficinas' },
	plots: { en: 'Plots and land', es: 'Parcelas y terrenos' },
	hotels: { en: 'Hotels', es: 'Hoteles' },
	services: { en: 'Property services', es: 'Servicios inmobiliarios' },
};

/** The three standard groups every area community carries. */
const trio = (sales: string, longterm: string, shortterm: string, opts: { full?: boolean; shortDesc?: Record<Lang, string> } = {}): Group[] => [
	{ code: sales, kind: 'sales', full: opts.full, name: { en: 'Sales and buyers', es: 'Ventas y compradores' }, desc: { en: 'Listings for sale and buyer requests', es: 'Inmuebles en venta y demandas de compradores' } },
	{ code: longterm, kind: 'longterm', full: opts.full, name: { en: 'Long-term rentals', es: 'Alquiler de larga temporada' }, desc: { en: 'Larga temporada', es: 'Larga temporada' } },
	{ code: shortterm, kind: 'shortterm', full: opts.full, name: { en: 'Short-term rentals', es: 'Alquiler de corta temporada' }, desc: opts.shortDesc || { en: 'Corta temporada and holiday lets', es: 'Corta temporada y vacacional' } },
];

export const AREAS: Area[] = [
	{
		id: 'marbella',
		name: { en: 'Marbella and the Costa del Sol', es: 'Marbella y la Costa del Sol' },
		short: { en: 'Marbella', es: 'Marbella' },
		community: { code: 'E24URzrZ4HS2mQbWJ530Y0', name: { en: 'Marbella community', es: 'Comunidad de Marbella' }, desc: { en: 'Every Marbella group in one link', es: 'Todos los grupos de Marbella en un enlace' } },
		map: { lon: -4.885, lat: 36.51, layer: 'inset' },
		groups: [
			...trio('IeAhpg26L8sFIhl5mBvyUv', 'LTUQINv6RrWLk5Q9wWLIRm', 'CmNucEufDIJ5VAWUJ3C7sJ', { full: true }),
			{ code: 'LUhmkyWZhi51qwiD1Qs5pi', kind: 'renttobuy', full: true, name: { en: 'Rent to buy', es: 'Alquiler con opción a compra' }, desc: { en: 'Opción de compra', es: 'Rent to buy' } },
			{ code: 'I3dMuhmJBwTGZXMK9njwzH', kind: 'openhouses', full: true, name: { en: 'Open houses', es: 'Open houses' }, desc: { en: 'Agent viewings and open days', es: 'Visitas y jornadas de puertas abiertas para agentes' } },
			{ code: 'FKMKwzgYtYP14mCczQgnRJ', kind: 'buyers', name: { en: 'Buyers only', es: 'Solo compradores' }, desc: { en: 'Client requests, no listings', es: 'Demandas de clientes, sin inmuebles' } },
			{ code: 'GrpjyGZE5TD9x4vg9jObe3', kind: 'strequests', name: { en: 'Short-term requests only', es: 'Solo demandas de corta temporada' }, desc: { en: 'Tenant requests for short lets', es: 'Inquilinos que buscan alquiler corto' } },
			{ code: 'Fs3IRNMmLEpFtLM3MmqaZa', kind: 'bonus', name: { en: 'Bonus commission', es: 'Comisión extra' }, desc: { en: 'Sales and rentals with a bonus commission on offer', es: 'Ventas y alquileres que ofrecen una comisión adicional' } },
			{ code: 'KzHTv9sqXr6F0BZezkd2xn', kind: 'newdev', name: { en: 'New developments only', es: 'Solo obra nueva' }, desc: { en: 'Off-plan and new build across the Costa del Sol', es: 'Promociones y obra nueva en toda la Costa del Sol' } },
			{ code: 'GegqNCpFSfU7nLDGZvKhEv', kind: 'commercial', name: { en: 'Commercial property', es: 'Locales y oficinas' }, desc: { en: 'Shops, offices, bars and businesses', es: 'Locales, oficinas, bares y negocios' } },
			{ code: 'GMq0QzIvcKv1XC0Aj8XXc5', kind: 'plots', name: { en: 'Plots and land', es: 'Parcelas y terrenos' }, desc: { en: 'Terrenos', es: 'Suelo urbano y rústico' } },
		],
	},
	{
		id: 'malaga',
		name: { en: 'Málaga and Mijas', es: 'Málaga y Mijas' },
		short: { en: 'Málaga', es: 'Málaga' },
		community: { code: 'DmSY9YGIOhX4mtD43jDA2x', name: { en: 'Málaga community', es: 'Comunidad de Málaga' }, desc: { en: 'Every Málaga group in one link', es: 'Todos los grupos de Málaga en un enlace' } },
		map: { lon: -4.42, lat: 36.72, layer: 'inset' },
		groups: trio('CMDWVE8D6cK0JhZBhZJMC3', 'B6tM8IG1CMh0aB1CTQzKjW', 'CdnJJRT7kTDBpIi4xxmAyr'),
	},
	{
		id: 'estepona',
		name: { en: 'Estepona and Sotogrande', es: 'Estepona y Sotogrande' },
		short: { en: 'Estepona', es: 'Estepona' },
		community: { code: 'LFz8jTJsMLoGkiFXRv05yN', name: { en: 'Estepona and Sotogrande community', es: 'Comunidad de Estepona y Sotogrande' }, desc: { en: 'Every Estepona and Sotogrande group in one link', es: 'Todos los grupos de Estepona y Sotogrande en un enlace' } },
		map: { lon: -5.146, lat: 36.427, layer: 'inset' },
		groups: trio('BKtmqyJzUwe9ZqEV82oxpi', 'GH6DGyGvsxg6hvSOqPoQek', 'I8jzG6f85xuHpjW2qFju0W'),
	},
	{
		id: 'madrid',
		name: { en: 'Madrid', es: 'Madrid' },
		short: { en: 'Madrid', es: 'Madrid' },
		map: { lon: -3.7038, lat: 40.4168, layer: 'main' },
		groups: trio('CgY81ycfLCN6SeyOR0oiyu', 'CssmuuSjj6vDLyBZWhF7Cy', 'FE57C1r5C1E0jCsRL0Cqc1', { shortDesc: { en: 'Corta temporada', es: 'Corta temporada' } }),
	},
	{
		id: 'barcelona',
		name: { en: 'Barcelona', es: 'Barcelona' },
		short: { en: 'Barcelona', es: 'Barcelona' },
		community: { code: 'G8Pd6UwIljDCK00HaxaHaY', name: { en: 'Barcelona community', es: 'Comunidad de Barcelona' }, desc: { en: 'Sales and rentals in and around Barcelona', es: 'Ventas y alquileres en Barcelona y alrededores' } },
		map: { lon: 2.1686, lat: 41.3874, layer: 'main' },
		groups: [],
	},
	{
		id: 'mallorca',
		name: { en: 'Mallorca', es: 'Mallorca' },
		short: { en: 'Mallorca', es: 'Mallorca' },
		community: { code: 'GE2XJdEKJk45dOijveVpvs', name: { en: 'Mallorca community', es: 'Comunidad de Mallorca' }, desc: { en: 'Sales and rentals across Mallorca', es: 'Ventas y alquileres en toda Mallorca' } },
		map: { lon: 2.6502, lat: 39.5696, layer: 'main' },
		groups: [],
	},
	{
		id: 'ibiza',
		name: { en: 'Ibiza', es: 'Ibiza' },
		short: { en: 'Ibiza', es: 'Ibiza' },
		community: { code: 'FFJyKHTiC6tIlhMU3FEAjG', name: { en: 'Ibiza community', es: 'Comunidad de Ibiza' }, desc: { en: 'Sales and rentals across Ibiza', es: 'Ventas y alquileres en toda Ibiza' } },
		map: { lon: 1.4206, lat: 38.9067, layer: 'main' },
		groups: [],
	},
	{
		id: 'specialist',
		name: { en: 'Specialist groups', es: 'Grupos especializados' },
		short: { en: 'Specialist', es: 'Especializados' },
		groups: [
			{ code: 'Ga5RCzHHNDVJF5H1EpwKGp', kind: 'hotels', name: { en: 'Global hotels for sale', es: 'Hoteles en venta en todo el mundo' }, desc: { en: 'Hotels anywhere in the world, agents only', es: 'Solo agentes' } },
			{ code: 'JM8fct2rq2GE0fj6Rv72Hm', kind: 'services', name: { en: 'Property services, Costa del Sol', es: 'Servicios inmobiliarios, Costa del Sol' }, desc: { en: 'Lawyers, movers, photographers, cleaners and the other trades around a move, and the agents who need them', es: 'Abogados, mudanzas, fotógrafos, limpieza y los demás oficios de una mudanza, y los agentes que los necesitan' } },
		],
	},
];

/** Every invite code on the page, for audits: 29 including the info group and the six communities. */
export const ALL_CODES = [INFO_GROUP.code, ...AREAS.flatMap((a) => [...(a.community ? [a.community.code] : []), ...a.groups.map((g) => g.code)])];
