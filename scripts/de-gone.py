# Restore 410 Gone for the seven pages the German pilot left behind.
#
# They were deleted on 05-08-26 and have been answering 404 since, which tells a
# crawler "maybe later" and keeps them in the recrawl queue. 410 says the page is
# deliberately gone, which is the truth and gets them dropped.
#
# Scoped to those seven paths on purpose, NOT to /de/*: German is being added
# back as a site language, so a prefix rule would kill the new pages the moment
# they shipped.
import sys

P = '/opt/info-hub/src/middleware.ts'
s = open(P, encoding='utf-8').read()

if 'DE_PILOT_GONE' in s:
    print('already present')
    sys.exit(0)

block = '''		// The German pilot's seven pages, deleted 05-08-26. They answered 404,
		// which reads to a crawler as "maybe it comes back" and keeps them in the
		// recrawl queue; 410 is the honest answer and retires them. Listed one by
		// one rather than as a /de/ prefix, because German is a live site language
		// again and a prefix rule would take the new pages down with them.
		const DE_PILOT_GONE = new Set([
			'/de/',
			'/de/immobilie-in-spanien-kaufen/',
			'/de/immobilienbetrug-in-spanien-vermeiden/',
			'/de/gebiete/elviria/',
			'/de/gebiete/golden-mile/',
			'/de/gebiete/la-cala-de-mijas/',
			'/de/gebiete/los-monteros/',
			'/de/gebiete/puerto-banus/',
		]);
		{
			const p = pathname.endsWith('/') ? pathname : pathname + '/';
			if (DE_PILOT_GONE.has(p)) {
				return new Response('Gone', { status: 410, headers: { 'content-type': 'text/plain; charset=utf-8' } });
			}
		}

'''

anchor = "\t\t// Blog redirects - duplicate/filler posts → canonical versions"
if anchor not in s:
    print('ANCHOR NOT FOUND')
    sys.exit(1)

s = s.replace(anchor, block + anchor, 1)
open(P, 'w', encoding='utf-8').write(s)
print('inserted 410 block for 8 paths')
