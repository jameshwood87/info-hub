import { describe, expect, it } from 'vitest';
import { neighbourhoodSlugFromPath } from '../src/pages/api/update-area-stats';

describe('neighbourhoodSlugFromPath', () => {
	it('extracts slug from legacy neighbourhood paths', () => {
		expect(neighbourhoodSlugFromPath('/neighbourhood/nueva-andalucia/')).toBe('nueva-andalucia');
		expect(neighbourhoodSlugFromPath('/neighbourhood/nueva-andalucia')).toBe('nueva-andalucia');
	});

	it('extracts slug from structured neighbourhood paths', () => {
		expect(neighbourhoodSlugFromPath('/neighbourhood/andalucia/malaga/nueva-andalucia/')).toBe('nueva-andalucia');
		expect(neighbourhoodSlugFromPath('/neighbourhood/andalucia/malaga/nueva-andalucia')).toBe('nueva-andalucia');
		expect(neighbourhoodSlugFromPath('/neighbourhood/andalucia/cadiz/nueva-andalucia/')).toBe('nueva-andalucia');
	});

	it('extracts slug from Spanish barrios paths', () => {
		expect(neighbourhoodSlugFromPath('/es/barrios/nueva-andalucia/')).toBe('nueva-andalucia');
	});
});
