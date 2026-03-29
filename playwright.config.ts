import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 60_000,
	use: {
		baseURL: 'http://127.0.0.1:4567',
	},
	webServer: {
		command: 'node ./tests/e2e-server.mjs',
		url: 'http://127.0.0.1:4567',
		reuseExistingServer: false,
		timeout: 120_000,
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{ name: 'firefox', use: { browserName: 'firefox' } },
		{ name: 'webkit', use: { browserName: 'webkit' } },
		{ name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
	],
});
