import { describe, expect, it } from 'vitest';
import { POST as loginPost } from '../src/pages/api/admin/login';

describe('/api/admin/login', () => {
	it('sets session cookies on successful login', async () => {
		process.env.INFO_HUB_ADMIN_PASSWORD = 'pw';
		process.env.INFO_HUB_ADMIN_PASSWORD_SALT = 'salt';
		delete process.env.INFO_HUB_ADMIN_PASSWORD_HASH;

		const req = new Request('http://test/api/admin/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password: 'pw' }),
		});

		const res = await loginPost({ request: req, clientAddress: '127.0.0.1' } as any);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		const setCookie = res.headers.get('set-cookie') || '';
		expect(setCookie).toContain('pl_admin_session=');
	});

	it('rate limits repeated failures', async () => {
		process.env.INFO_HUB_ADMIN_PASSWORD = 'pw2';
		process.env.INFO_HUB_ADMIN_PASSWORD_SALT = 'salt2';
		delete process.env.INFO_HUB_ADMIN_PASSWORD_HASH;

		const attempt = async () => {
			const req = new Request('http://test/api/admin/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password: 'wrong' }),
			});
			return loginPost({ request: req, clientAddress: '10.0.0.1' } as any);
		};

		let last: Response | null = null;
		for (let i = 0; i < 10; i++) last = await attempt();
		expect(last?.status).toBe(429);
	});
});

