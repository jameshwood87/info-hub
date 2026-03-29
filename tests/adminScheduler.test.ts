import { beforeEach, describe, expect, it, vi } from 'vitest';

const directus = vi.hoisted(() => ({
	adminGetKbPageById: vi.fn(),
	adminUpdateKbPage: vi.fn(),
	listKbPagesByPrefix: vi.fn(),
}));

const adminMeta = vi.hoisted(() => ({
	getKbMetaSnapshot: vi.fn(),
	listDueScheduled: vi.fn(),
	setKbMeta: vi.fn(),
}));

const adminContent = vi.hoisted(() => ({
	writeAudit: vi.fn(),
}));

const updater = vi.hoisted(() => ({
	refreshKbStatsForKeyWithSnapshot: vi.fn(),
}));

vi.mock('../src/lib/directus', () => directus);
vi.mock('../src/lib/adminMeta', () => adminMeta);
vi.mock('../src/lib/adminContent', () => adminContent);
vi.mock('../src/pages/api/update-area-stats', () => updater);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('adminScheduler', () => {
	it('publishes scheduled pages and clears schedule meta', async () => {
		vi.resetModules();

		adminMeta.listDueScheduled.mockResolvedValue([{ id: '1', scheduledAt: new Date(Date.now() - 1000).toISOString() }]);
		directus.adminGetKbPageById.mockResolvedValue({ id: '1', status: 'draft', path: '/docs/x/' });
		directus.adminUpdateKbPage.mockResolvedValue({});
		adminMeta.setKbMeta.mockResolvedValue({});
		adminContent.writeAudit.mockResolvedValue({});

		const { runPublishScheduler } = await import('../src/lib/adminScheduler');
		await runPublishScheduler({ minIntervalMs: 0 });

		expect(directus.adminUpdateKbPage).toHaveBeenCalledWith('1', { status: 'published' });
		expect(adminContent.writeAudit).toHaveBeenCalled();
		expect(adminMeta.setKbMeta).toHaveBeenCalledWith('1', { scheduledAt: null });
	});

	it('refreshes area stats when due (path keys and id keys)', async () => {
		vi.resetModules();

		const now = Date.now();
		const dueIso = new Date(now - 1000).toISOString();

		adminMeta.getKbMetaSnapshot.mockResolvedValue({
			'/andalucia/malaga/test/': { areaStatsDueAt: dueIso },
			'es-id': { areaStatsUpdatedAt: new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString() },
		});

		directus.adminGetKbPageById.mockResolvedValue({ id: 'es-id', path: '/es/andalucia/malaga/estepona/' });
		adminMeta.setKbMeta.mockResolvedValue({});

		const { runAreaStatsScheduler } = await import('../src/lib/adminScheduler');
		await runAreaStatsScheduler({ minIntervalMs: 0, limit: 10 });

		expect(adminMeta.setKbMeta).toHaveBeenCalledWith(
			'/andalucia/malaga/test/',
			expect.objectContaining({ areaStatsUpdatedAt: expect.any(String), areaStatsDueAt: expect.any(String) }),
		);
		expect(adminMeta.setKbMeta).toHaveBeenCalledWith(
			'es-id',
			expect.objectContaining({ areaStatsUpdatedAt: expect.any(String), areaStatsDueAt: expect.any(String) }),
		);
	});

	it('refreshes neighbourhood stats based on version, listings, and age', async () => {
		vi.resetModules();

		const now = Date.now();
		const oldIso = new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString();

		adminMeta.getKbMetaSnapshot.mockResolvedValue({
			n1: { neighbourhoodStatsVersion: 1, neighbourhoodStatsUpdatedAt: oldIso, neighbourhoodStats: { listingCount: 0 } },
			n2: { neighbourhoodStatsVersion: 2, neighbourhoodStatsUpdatedAt: oldIso, neighbourhoodStats: { listingCount: 3 }, neighbourhoodListings: [] },
		});

		directus.listKbPagesByPrefix.mockImplementation(async ({ prefix }: any) => {
			if (prefix === '/neighbourhood/') return [{ id: 'n1', path: '/neighbourhood/a/' }];
			if (prefix === '/es/barrios/') return [{ id: 'n2', path: '/es/barrios/b/' }];
			return [];
		});

		updater.refreshKbStatsForKeyWithSnapshot.mockResolvedValue({ ok: true, updated: true, skipped: false, key: 'n1', updatedKey: 'n1' });

		const { runNeighbourhoodStatsScheduler } = await import('../src/lib/adminScheduler');
		await runNeighbourhoodStatsScheduler({ minIntervalMs: 0, limit: 10 });

		expect(updater.refreshKbStatsForKeyWithSnapshot).toHaveBeenCalled();
	});

	it('honors keyHint to force refresh a specific neighbourhood path', async () => {
		vi.resetModules();

		adminMeta.getKbMetaSnapshot.mockResolvedValue({});
		directus.listKbPagesByPrefix.mockResolvedValue([]);
		updater.refreshKbStatsForKeyWithSnapshot.mockResolvedValue({ ok: true, updated: true, skipped: false, key: '/neighbourhood/hint/', updatedKey: '/neighbourhood/hint/' });

		const { runNeighbourhoodStatsScheduler } = await import('../src/lib/adminScheduler');
		await runNeighbourhoodStatsScheduler({ minIntervalMs: 0, limit: 1, keyHint: '/neighbourhood/hint/' });

		expect(updater.refreshKbStatsForKeyWithSnapshot).toHaveBeenCalledWith(
			'/neighbourhood/hint/',
			expect.any(Object),
			expect.objectContaining({ force: true }),
		);
	});
});

