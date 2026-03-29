import { describe, expect, it, vi } from 'vitest';

describe('adminMeta', () => {
	it('stores and normalizes meta patches', async () => {
		vi.resetModules();
		const { getKbMeta, setKbMeta } = await import('../src/lib/adminMeta');

		await setKbMeta('page-1', {
			tags: ['a', 'b'],
			docCategories: ['public', 'public', 'developer', 'nope' as any],
			featuredImageUrl: 'https://example.com/x.jpg',
			featuredImageAlt: 'Alt',
			featuredImageTitle: 'Title',
			featuredImageCaption: 'Caption',
			featuredImageCredit: 'Credit',
			areaStats: {
				avgPrice: '123',
				priceTrend: 'up',
				rentalYield: '7.1',
				airportDistance: 45,
				beachDistance: null,
				population: '1000',
				expatPercent: '22',
				daysOnMarket: '33',
				listingCount: '50',
			} as any,
		});

		const meta = await getKbMeta('page-1');
		expect(meta.tags).toEqual(['a', 'b']);
		expect(meta.docCategories).toEqual(['public', 'developer']);
		expect(meta.docCategory).toBeUndefined();
		expect(meta.featuredImageUrl).toBe('https://example.com/x.jpg');
		expect(meta.areaStats?.avgPrice).toBe(123);
		expect(meta.areaStats?.rentalYield).toBe(7.1);
		expect(meta.areaStats?.beachDistance).toBe(0);
	});

	it('cleans neighbourhood stats, geo, and listings', async () => {
		vi.resetModules();
		const { getKbMeta, setKbMeta } = await import('../src/lib/adminMeta');

		await setKbMeta('page-2', {
			neighbourhoodStats: {
				avgPriceEur: '250000',
				pricePerM2Eur: '3500',
				sampleSize: '12',
				priceMinEur: '120000',
				priceMaxEur: '900000',
				municipality: '  Estepona ',
				topSubareas: [' Cancelada ', '', null] as any,
				propertyTypeBreakdown: { Apartment: 55.4, Villa: 31.2, Bad: -1 } as any,
				driveToMarbellaMin: '18',
				listingCount: 0,
				recentAvgMaxC: '26.1',
				recentAvgMinC: '17.2',
				annualRainMm: '410',
			} as any,
			neighbourhoodGeo: { lat: '36.4', lon: '-5.1', placeName: 'Cancelada', region: 'Andalucía', country: 'Spain' } as any,
			neighbourhoodListings: [
				{ url: 'https://propertylist.es/x', title: 'Good', priceEur: '123', bedrooms: '2', bathrooms: 2, buildM2: '90' },
				{ url: '', title: 'Bad' },
			] as any,
			neighbourhoodStatsVersion: '2' as any,
		});

		const meta = await getKbMeta('page-2');
		expect(meta.neighbourhoodStats?.avgPriceEur).toBe(250000);
		expect(meta.neighbourhoodStats?.municipality).toBe('Estepona');
		expect(meta.neighbourhoodStats?.topSubareas).toEqual(['Cancelada']);
		expect(meta.neighbourhoodStats?.propertyTypeBreakdown).toEqual({ Apartment: 55, Villa: 31 });
		expect(meta.neighbourhoodGeo?.lat).toBe(36.4);
		expect(meta.neighbourhoodListings?.length).toBe(1);
		expect(meta.neighbourhoodStatsVersion).toBe(2);
	});

	it('lists scheduled pages that are due', async () => {
		vi.resetModules();
		const { listDueScheduled, setKbMeta } = await import('../src/lib/adminMeta');

		const now = Date.now();
		const due1 = new Date(now - 1000).toISOString();
		const due2 = new Date(now - 2000).toISOString();
		const later = new Date(now + 60_000).toISOString();

		await setKbMeta('a', { scheduledAt: due1 });
		await setKbMeta('b', { scheduledAt: later });
		await setKbMeta('c', { scheduledAt: due2 });
		await setKbMeta('d', { scheduledAt: 'not-a-date' });

		const due = await listDueScheduled(now);
		expect(due.map((x) => x.id)).toEqual(['c', 'a']);
	});
});
