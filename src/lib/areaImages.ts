// Self-hosted area imagery. Drop a file at public/area-images/{slug}.{webp|jpg|jpeg|png}
// and it becomes the area hero, hub card thumb and og:image (deploy to publish).
// Falls back to null -> callers use the live listing photo instead.
import fs from 'node:fs';

const exts = ['webp', 'jpg', 'jpeg', 'png'];
const cache = new Map<string, string | null>();

export const areaImagePath = (slug: string): string | null => {
	const s = String(slug || '').toLowerCase().trim();
	if (!s) return null;
	const hit = cache.get(s);
	if (hit !== undefined) return hit;
	let found: string | null = null;
	for (const ext of exts) {
		if (fs.existsSync(`public/area-images/${s}.${ext}`)) {
			found = `/area-images/${s}.${ext}`;
			break;
		}
	}
	cache.set(s, found);
	return found;
};
