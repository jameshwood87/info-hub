// Community and social counts for the homepage band (src/components/CommunityProof.astro).
// Every figure is a floor: what we can prove, rounded down, with the date it was checked. Update the
// numbers and the date together. Nothing else on the site reads this file.
//
// Sources, 23-09-26: WhatsApp members from James's own count of the PropertyList groups; Facebook
// page and group figures read from the public pages. Facebook shows rounded figures (5.5K, 15.3K),
// so each stored value is the bottom of that rounding, taken down to the hundred below it.
export const SOCIAL_PROOF = {
	whatsapp: {
		members: 2500, // James, 23-09-26: "2500+"
		checked: '2026-09-23',
		docsPath: {
			en: '/docs/propertylist-mls-user-manual/marketing-and-portals/whatsapp-community-groups/',
			es: '/es/docs/propertylist-mls-manual-de-usuario/marketing-and-portals/whatsapp-community-groups/',
		},
	},
	facebookPage: {
		url: 'https://www.facebook.com/PropertyList.es',
		followers: 5400, // Facebook shows 5.5K
		checked: '2026-09-23',
	},
	instagram: {
		url: 'https://www.instagram.com/propertylist.es/',
		followers: 1180, // profile shows 1,188
		checked: '2026-09-24',
	},
	// Ratings and review counts exactly as each platform shows them (they are the platform's own figures,
	// not ours to round). Each row links to where the reviews are written.
	reviews: {
		google: { url: 'https://www.google.com/maps/place/?q=place_id:ChIJxfMLK3KQ0EgRq-CcwhLFdCI', rating: 5.0, count: 36, checked: '2026-09-23' },
		facebook: { url: 'https://www.facebook.com/PropertyList.es/reviews/', recommendPct: 100, count: 27, checked: '2026-09-23' },
		trustpilot: { url: 'https://www.trustpilot.com/review/propertylist.es', rating: 4.1, count: 6, checked: '2026-09-23', show: true },
	},
	facebookGroups: {
		checked: '2026-09-23',
		groups: [
			{ name: 'Marbella Sales & Rentals', url: 'https://www.facebook.com/groups/marbella.propertylist.es', members: 15200 }, // 15.3K
			{ name: 'Marbella Events & Offers', url: 'https://www.facebook.com/groups/property.list.marbella', members: 18200 }, // 18.3K
			{ name: 'Marbella Luxury Villas', url: 'https://www.facebook.com/groups/657731952802513', members: 2700 }, // 2.8K
			{ name: 'New Developments Costa del Sol', url: 'https://www.facebook.com/groups/NewDevelopments.CostaDelSol', members: 650 }, // 653
			{ name: 'Property Services Andalucía', url: 'https://www.facebook.com/groups/propertyservices.propertylist.es', members: 250 }, // 254
			{ name: 'Madrid Sales & Rentals', url: 'https://www.facebook.com/groups/937394874013219', members: 170 }, // 170
		],
	},
} as const;
