const ORIGIN = process.env.INFO_HUB_ORIGIN || 'https://info.propertylist.es';
const PASSWORD = process.env.INFO_HUB_ADMIN_PASSWORD || '';

const normalisePath = (p) => {
	const raw = String(p || '').trim();
	if (!raw) return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	const noQuery = withSlash.split('?')[0].split('#')[0];
	const cleaned = noQuery.replace(/\/{2,}/g, '/');
	return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
};

const parseCookieHeader = (res) => {
	const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
	if (set.length) return set.map((s) => String(s).split(';')[0]).join('; ');
	const one = res.headers.get('set-cookie') || '';
	return one
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => String(s).split(';')[0])
		.join('; ');
};

const loginAdmin = async () => {
	if (!PASSWORD) throw new Error('missing_INFO_HUB_ADMIN_PASSWORD');
	const res = await fetch(`${ORIGIN}/api/admin/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ password: PASSWORD }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !json?.csrfToken) throw new Error(`login_failed ${res.status}`);
	return { cookie: parseCookieHeader(res), csrf: String(json.csrfToken) };
};

const listPages = async (auth) => {
	const url = `${ORIGIN}/api/admin/kb-pages?prefixes=${encodeURIComponent('/general-information/')}&status=any&limit=1000&bucket=all`;
	const res = await fetch(url, { headers: { cookie: auth.cookie } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok || !Array.isArray(json.items)) throw new Error(`list_failed ${res.status}`);
	return json.items;
};

const patchMeta = async (auth, id, patch) => {
	const res = await fetch(`${ORIGIN}/api/admin/meta/${encodeURIComponent(String(id))}`, {
		method: 'PATCH',
		headers: { cookie: auth.cookie, 'x-csrf-token': auth.csrf, 'content-type': 'application/json' },
		body: JSON.stringify(patch),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.ok) {
		const err = json?.error ? ` ${json.error}` : '';
		throw new Error(`patch_failed ${res.status}${err}`);
	}
	return json.meta || {};
};

const featured = [
	{
		path: '/general-information/a-new-five-star-gem-for-marbella/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/6010421/pexels-photo-6010421.jpeg',
			featuredImageAlt: 'Marbella five-star hotel facade',
			featuredImageTitle: 'Marbella luxury hotel',
			featuredImageCaption: 'A five-star hotel facade in Mediterranean style.',
			featuredImageCredit: 'Photo via Pexels',
		},
	},
	{
		path: '/general-information/a-new-gem-in-abu-dhabis-crown-la-zagaleta/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/17174768/pexels-photo-17174768.jpeg',
			featuredImageAlt: 'Luxury villa exterior for La Zagaleta development',
			featuredImageTitle: 'Luxury villa and real estate',
			featuredImageCaption: 'A modern luxury villa exterior.',
			featuredImageCredit: 'Photo by Viktoriia Kondratiuk / Pexels',
		},
	},
	{
		path: '/general-information/benefits-of-living-on-the-costa-del-sol/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/13049614/pexels-photo-13049614.jpeg',
			featuredImageAlt: 'Costa del Sol beach at sunrise',
			featuredImageTitle: 'Costa del Sol lifestyle',
			featuredImageCaption: 'A calm sunrise on the coast.',
			featuredImageCredit: 'Photo by Elliot Kim / Pexels',
		},
	},
	{
		path: '/general-information/benefits-of-obtaining-a-mortgage-when-buying-a-property-in-andalucia/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/28914932/pexels-photo-28914932.jpeg',
			featuredImageAlt: 'Mortgage and real estate finance paperwork with keys',
			featuredImageTitle: 'Mortgage and property finance',
			featuredImageCaption: 'Real estate finance with keys, documents, and a calculator.',
			featuredImageCredit: 'Photo by Jakub Zerdzicki / Pexels',
		},
	},
	{
		path: '/general-information/best-beaches-to-visit-in-the-costa-del-sol/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/13049614/pexels-photo-13049614.jpeg',
			featuredImageAlt: 'Best beaches on the Costa del Sol',
			featuredImageTitle: 'Costa del Sol beaches',
			featuredImageCaption: 'A scenic beach view at sunrise.',
			featuredImageCredit: 'Photo by Elliot Kim / Pexels',
		},
	},
	{
		path: '/general-information/big-thank-you-to-the-propertylist-community/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/7642008/pexels-photo-7642008.jpeg',
			featuredImageAlt: 'Real estate handover celebrating a successful property transaction',
			featuredImageTitle: 'Property community',
			featuredImageCaption: 'Celebrating success in the property community.',
			featuredImageCredit: 'Photo by Alena Darmel / Pexels',
		},
	},
	{
		path: '/general-information/crime-on-the-costa-del-sol/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/10466469/pexels-photo-10466469.jpeg',
			featuredImageAlt: 'Police car at night with emergency lights',
			featuredImageTitle: 'Public safety and crime',
			featuredImageCaption: 'A police car scene at night.',
			featuredImageCredit: 'Photo by cottonbro studio / Pexels',
		},
	},
	{
		path: '/general-information/elementor-10796/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/17510720/pexels-photo-17510720.jpeg',
			featuredImageAlt: 'Málaga coastline with cathedral in the background',
			featuredImageTitle: 'Málaga coastline',
			featuredImageCaption: 'Málaga’s coastline and skyline.',
			featuredImageCredit: 'Photo by Max Luz / Pexels',
		},
	},
	{
		path: '/general-information/finding-your-dream-home-in-coastal-vs-inland-andalucia/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/3340980/pexels-photo-3340980.jpeg',
			featuredImageAlt: 'White Andalusian town in the hills',
			featuredImageTitle: 'Inland Andalucía living',
			featuredImageCaption: 'A peaceful white town in Andalucía.',
			featuredImageCredit: 'Photo by Manuel Torres Garcia / Pexels',
		},
	},
	{
		path: '/general-information/greening-san-pedro-alcantara-a-new-wave-of-trees/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/5237385/pexels-photo-5237385.jpeg',
			featuredImageAlt: 'Tree-lined street in a Mediterranean city',
			featuredImageTitle: 'Urban greening and trees',
			featuredImageCaption: 'A leafy urban street with greenery.',
			featuredImageCredit: 'Photo by Leeloo The First / Pexels',
		},
	},
	{
		path: '/general-information/madrid-to-marbella-in-a-flash-high-speed-train/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/3010257/pexels-photo-3010257.jpeg',
			featuredImageAlt: 'High-speed train at a modern station platform',
			featuredImageTitle: 'High-speed rail travel',
			featuredImageCaption: 'A modern train platform and high-speed rail.',
			featuredImageCredit: 'Photo by Ave Calvar Martinez / Pexels',
		},
	},
	{
		path: '/general-information/malagas-commercial-market-gets-a-boost/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/11330398/pexels-photo-11330398.jpeg',
			featuredImageAlt: 'Aerial view of Spanish city buildings and urban development',
			featuredImageTitle: 'Commercial property market',
			featuredImageCaption: 'Aerial view of an urban commercial area.',
			featuredImageCredit: 'Photo by Elia / Pexels',
		},
	},
	{
		path: '/general-information/malagas-michelin-moment-a-culinary-boom-thats-great-news-for-real-estate/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/6327684/pexels-photo-6327684.jpeg',
			featuredImageAlt: 'Fine dining table setting and restaurant atmosphere',
			featuredImageTitle: 'Fine dining and Michelin restaurants',
			featuredImageCaption: 'A fine dining table setting.',
			featuredImageCredit: 'Photo by Mara Cotta / Pexels',
		},
	},
	{
		path: '/general-information/malagas-property-market-soars-to-new-heights/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/34144299/pexels-photo-34144299.jpeg',
			featuredImageAlt: 'Málaga port and cityscape view',
			featuredImageTitle: 'Málaga property market',
			featuredImageCaption: 'Málaga’s port and city skyline.',
			featuredImageCredit: 'Photo by Peter Vercoelen / Pexels',
		},
	},
	{
		path: '/general-information/marbella-fcs-stadium-dreams-take-shape/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/9716370/pexels-photo-9716370.jpeg',
			featuredImageAlt: 'Aerial view of a football stadium',
			featuredImageTitle: 'Football stadium development',
			featuredImageCaption: 'A football stadium seen from above.',
			featuredImageCredit: 'Photo by Kindel Media / Pexels',
		},
	},
	{
		path: '/general-information/marbella-makes-hotel-industry-history/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/6010421/pexels-photo-6010421.jpeg',
			featuredImageAlt: 'Marbella hotel industry and luxury hospitality',
			featuredImageTitle: 'Marbella hotels and hospitality',
			featuredImageCaption: 'Luxury hospitality on the Costa del Sol.',
			featuredImageCredit: 'Photo via Pexels',
		},
	},
	{
		path: '/general-information/marbella-property-boom-2025-where-luxury-meets-lifestyle-on-the-costa-del-sol/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/18168094/pexels-photo-18168094.jpeg',
			featuredImageAlt: 'Marbella waterfront promenade and pier',
			featuredImageTitle: 'Marbella luxury lifestyle',
			featuredImageCaption: 'A coastal promenade in Marbella.',
			featuredImageCredit: 'Photo by Milan Trninic / Pexels',
		},
	},
	{
		path: '/general-information/marbellas-promenade-gets-a-refreshing-makeover/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/18168094/pexels-photo-18168094.jpeg',
			featuredImageAlt: 'Marbella promenade by the sea',
			featuredImageTitle: 'Marbella promenade',
			featuredImageCaption: 'A seaside pier and promenade.',
			featuredImageCredit: 'Photo by Milan Trninic / Pexels',
		},
	},
	{
		path: '/general-information/must-visit-attractions-and-hidden-gems-costa-del-sol/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/13049614/pexels-photo-13049614.jpeg',
			featuredImageAlt: 'Costa del Sol coastal view and beach',
			featuredImageTitle: 'Costa del Sol travel',
			featuredImageCaption: 'A scenic coast ideal for exploring.',
			featuredImageCredit: 'Photo by Elliot Kim / Pexels',
		},
	},
	{
		path: '/general-information/short-term-rentals-are-here/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/34135038/pexels-photo-34135038.jpeg',
			featuredImageAlt: 'Short-term rental paperwork and property keys',
			featuredImageTitle: 'Short-term rentals',
			featuredImageCaption: 'Keys and documents for property rentals.',
			featuredImageCredit: 'Photo by Jakub Zerdzicki / Pexels',
		},
	},
	{
		path: '/general-information/spains-new-national-register-for-short-term-rentals/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/313691/pexels-photo-313691.jpeg',
			featuredImageAlt: 'Documents and laptop planning for rental compliance',
			featuredImageTitle: 'Short-term rental register',
			featuredImageCaption: 'Paperwork and planning for compliance.',
			featuredImageCredit: 'Photo by energepic.com / Pexels',
		},
	},
	{
		path: '/general-information/thirsty-costa-del-sol-gets-a-refreshing-uplift/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/2929255/pexels-photo-2929255.jpeg',
			featuredImageAlt: 'Water reservoir and dam between mountains',
			featuredImageTitle: 'Water infrastructure and reservoirs',
			featuredImageCaption: 'A reservoir and dam in a mountain valley.',
			featuredImageCredit: 'Photo by JACK REDGATE / Pexels',
		},
	},
	{
		path: '/general-information/what-are-the-benefits-of-using-propertylists-property-portal-for-renting/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/313691/pexels-photo-313691.jpeg',
			featuredImageAlt: 'Using a property portal on a laptop to manage rentals',
			featuredImageTitle: 'Property portal for renting',
			featuredImageCaption: 'Reviewing property information on a laptop.',
			featuredImageCredit: 'Photo by energepic.com / Pexels',
		},
	},
	{
		path: '/general-information/what-are-the-legal-requirements-for-short-term-renting-in-andalucia/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/8293744/pexels-photo-8293744.jpeg',
			featuredImageAlt: 'Real estate consultation with documents and calculator',
			featuredImageTitle: 'Short-term rental legal requirements',
			featuredImageCaption: 'A consultation with documents and planning.',
			featuredImageCredit: 'Photo by RDNE Stock project / Pexels',
		},
	},
	{
		path: '/general-information/what-are-the-living-costs-in-the-costa-del-sol/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/28914932/pexels-photo-28914932.jpeg',
			featuredImageAlt: 'Cost of living budget with euro notes, keys, and calculator',
			featuredImageTitle: 'Cost of living on the Costa del Sol',
			featuredImageCaption: 'Budgeting for housing and living costs.',
			featuredImageCredit: 'Photo by Jakub Zerdzicki / Pexels',
		},
	},
	{
		path: '/general-information/why-buy-property-as-an-investment/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/17174768/pexels-photo-17174768.jpeg',
			featuredImageAlt: 'Luxury property investment and modern villa exterior',
			featuredImageTitle: 'Property investment',
			featuredImageCaption: 'A modern villa representing property investment.',
			featuredImageCredit: 'Photo by Viktoriia Kondratiuk / Pexels',
		},
	},
	{
		path: '/general-information/why-is-it-important-to-have-a-good-estate-agent/',
		meta: {
			featuredImageUrl: 'https://images.pexels.com/photos/8293744/pexels-photo-8293744.jpeg',
			featuredImageAlt: 'Estate agent consultation and real estate advice',
			featuredImageTitle: 'Working with an estate agent',
			featuredImageCaption: 'A client meeting with a real estate agent.',
			featuredImageCredit: 'Photo by RDNE Stock project / Pexels',
		},
	},
];

const main = async () => {
	const auth = await loginAdmin();
	const items = await listPages(auth);
	const idByPath = new Map(items.map((it) => [normalisePath(it.path), String(it.id || '')]));

	const results = [];
	for (const row of featured) {
		const path = normalisePath(row.path);
		const id = idByPath.get(path) || '';
		if (!id) {
			results.push({ path, ok: false, error: 'missing_id_for_path' });
			continue;
		}
		try {
			await patchMeta(auth, id, row.meta);
			results.push({ path, id, ok: true });
		} catch (e) {
			results.push({ path, id, ok: false, error: String(e?.message || e) });
		}
	}
	process.stdout.write(JSON.stringify(results, null, 2));
	process.stdout.write('\n');
};

main().catch((e) => {
	process.stderr.write(String(e?.stack || e));
	process.stderr.write('\n');
	process.exit(1);
});
