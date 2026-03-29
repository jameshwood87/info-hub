const res = await fetch('https://info.propertylist.es/sitemap.xml');
const xml = await res.text();
const urls = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
const nh = urls.filter((u) => u.includes('/neighbourhood/andalucia/') && u.endsWith('/'));
const slugs = nh.map((u) => u.split('/').filter(Boolean).slice(-1)[0]);
const uniq = Array.from(new Set(slugs)).sort();
process.stdout.write(`count ${uniq.length}\n`);
process.stdout.write(`${uniq.join('\n')}\n`);

