import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		setupFiles: ['tests/vitest.setup.ts'],
		include: ['tests/**/*.test.ts'],
		exclude: ['tests/e2e/**'],
		coverage: {
			provider: 'v8',
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 40,
				statements: 80,
			},
			include: ['src/lib/admin*.ts', 'src/pages/api/admin/**/*.ts'],
		},
	},
});
