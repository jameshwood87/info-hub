// claims-ledger.mjs - what the blog may say about PropertyList itself.
//
// Curated 24-09-26 from James's ledgers: the production price sheet of 14-09-26 (which
// wins where they disagree, except where James has ruled since: the report's first 3
// free, 23-09-26), the free-versus-paid ledger and the feature-status ledger.
// The generator writes from this block and claims-check.mjs checks every draft against
// it. When a price, a free item or a feature's status changes, change it here too.
// Deliberately short: anything unsettled in the ledgers (portal lead prices, Rentals
// prices, signup credits) is listed as "do not state" rather than guessed.

export const LEDGER_CHECKED = '24-09-26';

const plus = (n) => `${(Math.floor(Number(n) / 10) * 10).toLocaleString('en-GB')}+`;

// Same source and meaning as the site's own counters (src/lib/portalStats.ts):
// agents_count is agencies, employees_count is individual agents.
export async function liveCounts() {
  try {
    const res = await fetch('https://propertylist.es/portal/bootstrap', {
      headers: { Accept: 'application/json', 'User-Agent': 'info-hub-blog' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`bootstrap ${res.status}`);
    const j = await res.json();
    const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
    const out = { agents: n(j?.employees_count), agencies: n(j?.agents_count), listings: n(j?.listings_count) };
    if (!out.agents || !out.agencies || !out.listings) throw new Error('bootstrap counts missing');
    return { agents: plus(out.agents), agencies: plus(out.agencies), listings: plus(out.listings), checked: new Date().toISOString().slice(0, 10) };
  } catch (e) {
    return null;
  }
}

export function claimsLedgerBlock(counts) {
  const countsLine = counts
    ? `- Live counts today (${counts.checked}): ${counts.agents} agents, ${counts.agencies} agencies and ${counts.listings} live listings on the network. Use these exact figures or none.`
    : '- Live counts are unavailable today: do not state how many agents, agencies or listings PropertyList has.';
  // The first-10 CoAgent offer ends on 1 November 2026 and drops out of the block by itself.
  const coagentFirst10 = Date.now() < Date.UTC(2026, 10, 1) ? ' (the first 10 agents to message it are free and unlimited until 1 November 2026)' : '';
  return `PROPERTYLIST FACTS. When the article mentions PropertyList itself, use only these facts. If a fact you want is not listed here, leave it out.
- Free, with no subscription: listing properties on the MLS, sharing them with other agencies, the public portal at propertylist.es, each agency's MicroSite, and the core of the CRM (contacts, the lead, seller and property pipelines, the calendar). Say "free". Never write "free forever".
- Also free now: XML import, XML feeds to other portals, Instant Brochure, Automation and Nurture, agent-to-agent leads and MicroSite leads. Property approval is automatic.
- Credits pay for optional extras. One credit costs about 1 euro (EUR 0.80 to EUR 1 plus IVA, depending on the pack). Never write "1 credit = 1 euro".
- Prices in credits, quote only these: featuring a listing 10 credits for 3 days, 20 for 7 days, 30 for 15 days; moving a qualified buyer lead into the Buyer pipeline 1 credit, the first 5 free; the Property Intelligence Report 5 credits, the first 3 reports free; the Website Builder from 50 credits a month, free to build and preview; an own-website XML feed or the Website API 35 credits a month, with no annual price; extra listing photos 1 credit each after the first 25; CoAgent on WhatsApp 20 free messages a month for every agent${coagentFirst10}, then 50 credits a month per agent for unlimited messages.
${countsLine}
- New agencies are reviewed within 24 hours. Never claim a licence or registry check. Never write "verified agents", "verified agencies" or "verified listings"; write "registered agents".
- Price Oracle figures are prices recorded by Spanish notaries. Never call a PropertyList report a "valuation" or "tasación"; call it the Property Intelligence Report or a market report.
- Not live, never present as available: Instant Renovation, Instant Video and Instant Images (coming soon), a verified-agency badge, connecting a Gmail or Outlook inbox.
- Do not state at all: prices for portal buyer leads or the Rentals Module, credits given at signup, "unlimited" listings or users, "Spain's first", "the only" or any other superlative about PropertyList.`;
}
