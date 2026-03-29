import { describe, expect, it } from 'vitest';
import { assertCsrf, createAdminSession, getAdminSessionFromRequest, verifyAdminPassword } from '../src/lib/adminAuth';

describe('adminAuth', () => {
	it('verifies password using scrypt', async () => {
		process.env.INFO_HUB_ADMIN_PASSWORD = 'secret123';
		process.env.INFO_HUB_ADMIN_PASSWORD_SALT = 'testsalt';
		delete process.env.INFO_HUB_ADMIN_PASSWORD_HASH;

		await expect(verifyAdminPassword('secret123')).resolves.toBe(true);
		await expect(verifyAdminPassword('wrong')).resolves.toBe(false);
	});

	it('creates and reads sessions from cookies', () => {
		const s = createAdminSession();
		const req = new Request('http://test/admin', {
			headers: { cookie: `pl_admin_session=${encodeURIComponent(s.id)}; pl_admin_csrf=${encodeURIComponent(s.csrfToken)}` },
		});
		const got = getAdminSessionFromRequest(req);
		expect(got?.id).toBe(s.id);
	});

	it('validates csrf header and cookie against session', () => {
		const s = createAdminSession();
		const req = new Request('http://test/api', {
			method: 'POST',
			headers: {
				cookie: `pl_admin_session=${encodeURIComponent(s.id)}; pl_admin_csrf=${encodeURIComponent(s.csrfToken)}`,
				'x-csrf-token': s.csrfToken,
			},
		});
		expect(() => assertCsrf(req, s)).not.toThrow();
	});
});

