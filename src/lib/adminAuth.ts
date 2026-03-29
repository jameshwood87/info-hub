import crypto from 'node:crypto';

type AdminSession = {
	id: string;
	userId: string;
	role: 'admin' | 'editor';
	createdAtMs: number;
	expiresAtMs: number;
	csrfToken: string;
};

const SESSION_COOKIE = 'pl_admin_session';
const CSRF_COOKIE = 'pl_admin_csrf';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 8;

const sessions = new Map<string, AdminSession>();
const loginAttempts = new Map<string, { count: number; resetAtMs: number }>();

const readEnv = (k: string) => (process.env[k] as string | undefined) || (import.meta as any).env?.[k] || undefined;

const cookieParse = (cookieHeader: string | null) => {
	const out: Record<string, string> = {};
	if (!cookieHeader) return out;
	const parts = cookieHeader.split(';');
	for (const raw of parts) {
		const i = raw.indexOf('=');
		if (i <= 0) continue;
		const k = raw.slice(0, i).trim();
		const v = raw.slice(i + 1).trim();
		if (!k) continue;
		out[k] = decodeURIComponent(v);
	}
	return out;
};

const cookieSerialize = (name: string, value: string, opts: { httpOnly?: boolean; maxAge?: number; path?: string } = {}) => {
	const parts = [`${name}=${encodeURIComponent(value)}`];
	parts.push(`Path=${opts.path || '/'}`);
	parts.push('SameSite=Lax');
	const secure = readEnv('NODE_ENV') === 'production';
	if (secure) parts.push('Secure');
	if (opts.httpOnly) parts.push('HttpOnly');
	if (typeof opts.maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
	return parts.join('; ');
};

const base64Url = (buf: Buffer) =>
	buf
		.toString('base64')
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll(/=+$/g, '');

const randomId = (bytes = 32) => base64Url(crypto.randomBytes(bytes));

const pruneSessions = () => {
	const now = Date.now();
	for (const [k, v] of sessions) {
		if (v.expiresAtMs <= now) sessions.delete(k);
	}
};

const scryptAsync = (password: string, salt: string, keylen: number) =>
	new Promise<Buffer>((resolve, reject) => {
		crypto.scrypt(password, salt, keylen, (err, derivedKey) => {
			if (err) reject(err);
			else resolve(derivedKey as Buffer);
		});
	});

const safeEqual = (a: Buffer, b: Buffer) => {
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
};

export const getAdminSessionFromRequest = (request: Request): AdminSession | null => {
	pruneSessions();
	const cookies = cookieParse(request.headers.get('cookie'));
	const sid = cookies[SESSION_COOKIE];
	if (!sid) return null;
	const session = sessions.get(sid);
	if (!session) return null;
	if (session.expiresAtMs <= Date.now()) {
		sessions.delete(sid);
		return null;
	}
	return session;
};

export const assertAdmin = (request: Request): AdminSession => {
	const session = getAdminSessionFromRequest(request);
	if (!session) {
		throw Object.assign(new Error('unauthorized'), { status: 401 });
	}
	return session;
};

export const assertCsrf = (request: Request, session: AdminSession) => {
	const cookies = cookieParse(request.headers.get('cookie'));
	const csrfCookie = cookies[CSRF_COOKIE] || '';
	const csrfHeader = request.headers.get('x-csrf-token') || '';
	if (!csrfCookie || !csrfHeader) {
		throw Object.assign(new Error('csrf_missing'), { status: 403 });
	}
	if (csrfCookie !== csrfHeader) {
		throw Object.assign(new Error('csrf_mismatch'), { status: 403 });
	}
	if (csrfHeader !== session.csrfToken) {
		throw Object.assign(new Error('csrf_invalid'), { status: 403 });
	}
};

export const rateLimitLogin = (key: string) => {
	const now = Date.now();
	const state = loginAttempts.get(key);
	if (!state || state.resetAtMs <= now) {
		loginAttempts.set(key, { count: 0, resetAtMs: now + RATE_LIMIT_WINDOW_MS });
		return;
	}
	if (state.count >= RATE_LIMIT_MAX_ATTEMPTS) {
		throw Object.assign(new Error('rate_limited'), { status: 429, retryAfterMs: Math.max(0, state.resetAtMs - now) });
	}
};

export const recordLoginFailure = (key: string) => {
	const now = Date.now();
	const state = loginAttempts.get(key);
	if (!state || state.resetAtMs <= now) {
		loginAttempts.set(key, { count: 1, resetAtMs: now + RATE_LIMIT_WINDOW_MS });
		return;
	}
	state.count += 1;
};

export const clearLoginFailures = (key: string) => {
	loginAttempts.delete(key);
};

export const verifyAdminPassword = async (passwordAttempt: string) => {
	const verify = async (prefix: 'INFO_HUB_ADMIN' | 'INFO_HUB_EDITOR') => {
		const configuredSalt =
			readEnv(`${prefix}_PASSWORD_SALT`) || (prefix === 'INFO_HUB_ADMIN' ? 'propertylist-info-hub-admin-salt' : '');
		const configuredHashB64 = readEnv(`${prefix}_PASSWORD_HASH`);
		const configuredPassword = readEnv(`${prefix}_PASSWORD`) || '';

		if (!configuredHashB64 && !configuredPassword) return false;
		if (!configuredSalt) return false;

		const expected = configuredHashB64
			? Buffer.from(configuredHashB64, 'base64')
			: await scryptAsync(configuredPassword, configuredSalt, 64);

		const got = await scryptAsync(passwordAttempt, configuredSalt, 64);
		return safeEqual(expected, got);
	};

	return await verify('INFO_HUB_ADMIN');
};

export const verifyAdminRoleForPassword = async (passwordAttempt: string): Promise<'admin' | 'editor' | null> => {
	const okAdmin = await verifyAdminPassword(passwordAttempt).catch(() => false);
	if (okAdmin) return 'admin';

	const configuredEditorSalt = readEnv('INFO_HUB_EDITOR_PASSWORD_SALT');
	const configuredEditorHash = readEnv('INFO_HUB_EDITOR_PASSWORD_HASH');
	const configuredEditorPassword = readEnv('INFO_HUB_EDITOR_PASSWORD');
	const editorConfigured = Boolean(configuredEditorSalt && (configuredEditorHash || configuredEditorPassword));
	if (!editorConfigured) return null;

	const verifyEditor = async () => {
		const configuredSalt = configuredEditorSalt || '';
		const configuredHashB64 = configuredEditorHash || '';
		const configuredPassword = configuredEditorPassword || '';
		const expected = configuredHashB64
			? Buffer.from(configuredHashB64, 'base64')
			: await scryptAsync(configuredPassword, configuredSalt, 64);
		const got = await scryptAsync(passwordAttempt, configuredSalt, 64);
		return safeEqual(expected, got);
	};

	const okEditor = await verifyEditor().catch(() => false);
	return okEditor ? 'editor' : null;
};

export const assertRole = (session: AdminSession, roles: Array<'admin' | 'editor'>) => {
	const role = session.role || 'admin';
	if (!roles.includes(role)) {
		throw Object.assign(new Error('forbidden'), { status: 403 });
	}
};

export const createAdminSession = (role: 'admin' | 'editor' = 'admin') => {
	pruneSessions();
	const id = randomId(24);
	const csrfToken = randomId(24);
	const now = Date.now();
	const safeRole = role === 'editor' ? 'editor' : 'admin';
	const session: AdminSession = {
		id,
		userId: safeRole,
		role: safeRole,
		createdAtMs: now,
		expiresAtMs: now + SESSION_TTL_MS,
		csrfToken,
	};
	sessions.set(id, session);
	return session;
};

export const deleteAdminSession = (request: Request) => {
	const cookies = cookieParse(request.headers.get('cookie'));
	const sid = cookies[SESSION_COOKIE];
	if (sid) sessions.delete(sid);
};

export const adminAuthCookies = (session: AdminSession) => {
	const maxAgeSeconds = Math.floor((session.expiresAtMs - Date.now()) / 1000);
	return {
		session: cookieSerialize(SESSION_COOKIE, session.id, { httpOnly: true, maxAge: maxAgeSeconds, path: '/' }),
		csrf: cookieSerialize(CSRF_COOKIE, session.csrfToken, { httpOnly: false, maxAge: maxAgeSeconds, path: '/' }),
	};
};

export const adminClearCookies = () => {
	return {
		session: cookieSerialize(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' }),
		csrf: cookieSerialize(CSRF_COOKIE, '', { httpOnly: false, maxAge: 0, path: '/' }),
	};
};
