// Check which neighbourhood guides are skeleton vs enriched
const slugs = [
  'benahavis', 'benalmadena', 'cancelada', 'el-limonar', 'elviria',
  'estepona', 'estepona-old-town', 'fuengirola', 'golden-mile', 'guadalmina',
  'la-cala-de-mijas', 'la-quinta', 'la-zagaleta', 'los-monteros', 'malaga-centre',
  'marbella', 'mijas-costa', 'nerja', 'new-golden-mile', 'nueva-andalucia',
  'pedregalejo', 'puerto-banus', 'san-pedro-de-alcantara', 'sierra-blanca', 'torremolinos'
];

console.log('Checking neighbourhood guide completeness...\n');

let enriched = 0, partial = 0, skeleton = 0;

for (const slug of slugs) {
  const url = `https://info.propertylist.es/neighbourhood/andalucia/malaga/${slug}/`;
  try {
    const res = await fetch(url);
    const html = await res.text();
    
    // Check for skeleton indicators
    const isSkeleton = /no guide has been created|coming soon|placeholder|skeleton|under construction/i.test(html);
    
    // Count sections (h2 tags, or data-attr sections)
    const h2Count = (html.match(/<h2/g) || []).length;
    const h3Count = (html.match(/<h3/g) || []).length;
    const wordCount = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length;
    
    let status;
    if (isSkeleton || wordCount < 200) {
      status = '🔴 SKELETON';
      skeleton++;
    } else if (h2Count >= 4 || wordCount >= 800) {
      status = '✅ ENRICHED';
      enriched++;
    } else {
      status = '🟡 PARTIAL';
      partial++;
    }
    
    console.log(`${status.padEnd(16)} ${slug.padEnd(30)} (${wordCount} words, ${h2Count}h2, ${h3Count}h3)`);
  } catch (e) {
    console.log(`❌ ERROR        ${slug.padEnd(30)} ${e.message}`);
    skeleton++;
  }
}

console.log(`\nSummary: ${enriched} enriched, ${partial} partial, ${skeleton} skeleton/empty out of ${slugs.length}`);
