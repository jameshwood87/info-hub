import { describe, expect, it } from 'vitest';
import { municipalityFromCommaLocation, portalPathFor } from '../src/pages/api/update-area-stats';

describe('municipalityFromCommaLocation', () => {
	it('extracts municipality for La Quinta override string', () => {
		expect(municipalityFromCommaLocation('La Quinta, Benahavís, Málaga, Spain')).toBe('Benahavís');
	});

	it('returns empty string when insufficient parts', () => {
		expect(municipalityFromCommaLocation('La Quinta')).toBe('');
	});
});

describe('portalPathFor', () => {
	it('builds municipality-scoped portal paths', () => {
		expect(portalPathFor('la-quinta', 'Benahavís')).toBe('/portal/for-sale/benahavis/la-quinta');
		expect(portalPathFor('los-monteros', 'Marbella')).toBe('/portal/for-sale/marbella/los-monteros');
		expect(portalPathFor('los-monteros', 'Bahía de Marbella')).toBe('/portal/for-sale/marbella/los-monteros');
	});

	it('falls back to slug-only portal paths', () => {
		expect(portalPathFor('los-monteros', '')).toBe('/portal/for-sale/los-monteros');
	});
});
