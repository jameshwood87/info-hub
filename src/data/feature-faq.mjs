// Q&A data for new FAQ section "How much does PropertyList cost and what do I get?"
// Section header: "How much does PropertyList cost and what do I get?"
// Section anchor: #how-much-does-propertylist-cost-and-what-do-i-get

export const featureFaqItems = [
  // ─── Website Builder ───────────────────────────────────────────────────
  {
    id: 'website-builder-exists',
    q: 'Does PropertyList have a website builder for estate agents?',
    aHtml:
      'Yes. PropertyList offers a drag-and-drop website builder designed for estate agents and agencies. Build and preview your full agency site for free, only paying when you publish. <a href="https://info.propertylist.es/website-builder">See how it works</a>.',
  },
  {
    id: 'auto-property-upload',
    q: 'Do I need to manually upload my properties to my agency website?',
    aHtml:
      'No. Every listing in your PropertyList MLS - photos, prices, descriptions - loads onto your agency website automatically. No manual re-entry needed.',
  },
  {
    id: 'custom-domain',
    q: 'Can I use my own domain with the PropertyList website builder?',
    aHtml:
      'Yes. Connect your own domain (your-agency.com) to your PropertyList website. The custom domain add-on costs 20 credits/month (about €20) on top of the base plan.',
  },
  {
    id: 'seo-features',
    q: 'What SEO features are included in the PropertyList website builder?',
    aHtml:
      'AI-generated SEO meta titles and descriptions for every page, auto-generated location and area pages, and built-in schema markup. Every listing page is structured for search engines out of the box.',
  },
  {
    id: 'leads-to-crm',
    q: 'How do leads from my agency website get into my CRM?',
    aHtml:
      'Lead capture forms are embedded on your site and feed enquiries directly into your PropertyList CRM the moment a visitor submits one - no manual export, no lag.',
  },
  {
    id: 'cancel-website-builder',
    q: 'What happens to my website if I cancel the website builder subscription?',
    aHtml:
      'Your published website goes offline. Your property listings and CRM data are unaffected - everything stays in PropertyList. You can republish at any time with no penalty or re-upload.',
  },

  // ─── XML Feeds ────────────────────────────────────────────────────────
  {
    id: 'xml-own-website',
    q: 'I already have a website - can I still get my PropertyList properties on it?',
    aHtml:
      'Yes, two ways: a live XML feed your site reads on a schedule, or the Website API, a REST key your site calls directly for live results. Your own listings are free to export either way. Powering your site with the whole network is 35 credits a month, XML or API, same price. Both can push to third-party portals at the same time. <a href="https://propertylist.es/api-docs" rel="noopener">API docs</a>.',
  },
  {
    id: 'xml-property-types',
    q: 'What types of properties are included in the XML feed?',
    aHtml:
      'The combined feed covers all resale properties, long-term rentals, and holiday rentals in one stream. One feed, all inventory types.',
  },
  {
    id: 'xml-new-developments',
    q: 'Is there a separate XML feed for new developments?',
    aHtml:
      'Yes. New development and off-plan properties are in a separate dedicated feed - keeping your resale/rental feed clean and uncluttered.',
  },
  {
    id: 'xml-portals',
    q: 'Can I use the XML feed to push listings to other portals like Idealista?',
    aHtml:
      'Yes, and pushing to third-party portals is free - Idealista, Fotocasa, or any platform that accepts XML. The feed subscription only applies when you use it to power your own website with the network listings; your own listings are free there too.',
  },
  {
    id: 'xml-cost',
    q: 'How much does the XML feed cost?',
    aHtml:
      'Pushing your listings to other portals - Idealista, Fotocasa, or any platform that accepts XML - is free. The paid feed is for powering your own website with the listings of the whole network (your own stock is free): 35 credits a month (about €35) for the resale and rentals feed, and 25 credits/month for the new developments feed. <a href="https://info.propertylist.es/pricing">Full pricing</a>.',
  },

  // ─── Market Intelligence ──────────────────────────────────────────────
  {
    id: 'market-reports',
    q: 'Does PropertyList offer property market reports?',
    aHtml:
      'Yes. The PropertyList Market Intelligence platform (intelligence.propertylist.es) provides data-driven reports across the Costa del Sol, built on live MLS transaction data.',
  },
  {
    id: 'market-reports-free',
    q: 'Are the market reports free?',
    aHtml:
      'Free city snapshots are available without signup - monthly readings covering median price, year-on-year change, and days on market for Marbella, Estepona, Mijas, Benahavís, Fuengirola, Sotogrande, and more. Paid forensic reports and live subscriptions are also available.',
  },
  {
    id: 'forensic-reports',
    q: 'What are the paid forensic intelligence reports and how much do they cost?',
    aHtml:
      'Single-fee PDF reports delivered in under a minute. Pricing: Executive Overview €5, Market Value Index €9, District Deep-Dive €9, New Dev Pipeline €19, Buyer Origin & Demand €19, Investment Forensic €29.',
  },
  {
    id: 'live-dashboard',
    q: 'Is there a live market dashboard for serious investors or advisors?',
    aHtml:
      'Yes. Strategic Investor (€29/month) gives you 5 curated sectors, 10 deep-dive reports per month, weekly data refreshes, and threshold alerts. Enterprise Authority (€99/month) adds unlimited areas, unlimited reports, white-label client PDFs, and advanced buyer-origin heatmaps.',
  },

  // ─── CRM & Pipelines ──────────────────────────────────────────────────
  {
    id: 'crm-free',
    q: 'Is the PropertyList CRM really free?',
    aHtml:
      'The core MLS and CRM are free forever. That includes the Lead, Seller and Property pipelines, with no limits. You pay only for demand: 5 credits for each qualified lead you decide to move into the Buyer pipeline, taken from your credit balance. The Tenants pipeline comes with the Rentals Module subscription and the Nurture pipeline with the Automation and Nurture subscription. <a href="https://info.propertylist.es/pricing">See full pricing</a>.',
  },
  {
    id: 'pipeline-boards',
    q: 'What pipeline boards does the PropertyList CRM include?',
    aHtml:
      'Six pipelines that work together automatically: Lead (every new lead lands in New Lead), Buyer (qualified purchasers), Seller (vendor journey), Property (stock status, new listings auto-land in Active Listing), Tenants (rental pipeline, part of the Rentals Module subscription) and Nurture (past clients and referrals, part of the Automation and Nurture subscription). The Buyer and Property pipelines also carry the legal phase: Reservation Paid, Deposit Paid, Mortgage in Progress, Notary Appointment and WON - Deed Signed. Lead and Seller are fixed; Buyer and Property are editable.',
  },
  {
    id: 'pipeline-setup',
    q: 'Do I have to set up the pipeline boards manually?',
    aHtml:
      'No. All boards are automatically configured and all existing contacts and properties are backfilled onto the correct boards on day one - nothing to set up.',
  },
  {
    id: 'pipeline-pricing',
    q: 'How does the pipeline pricing work - what do I actually pay for?',
    aHtml:
      'You pay for demand, not for supply. The Lead, Seller and Property pipelines are free. The Buyer pipeline costs 5 credits for each qualified lead you decide to move into it, and buyer credits come from your credit balance. The Tenants pipeline comes with the Rentals Module: 50 credits per 30-day period, with a free 30-day trial. The Nurture pipeline comes with the Automation and Nurture subscription at 20 credits/month (about €20), which also covers all automated emails, Hot-lead detection and the Daily Action Queue.',
  },

  // ─── Rentals Module ───────────────────────────────────────────────────
  {
    id: 'private-listings',
    q: 'Can I keep a listing private and not share it with other agents?',
    aHtml:
      'Yes. On My Listings, select any properties and use Bulk actions &gt; "Do not share with other agents". The property is hidden from other agencies in the MLS, kept off their microsites and removed from all export feeds - but stays live on the public portal, so direct buyers still find it and every lead comes to you. Your first 5 live private listings are free, then 5 credits each, and you can re-enable sharing any time. <a href="https://info.propertylist.es/docs/propertylist-mls-user-manual/managing-listings/private-listings/">Read the guide</a>.',
  },
  {
    id: 'crm-email-integration',
    q: 'Can I connect my own email (Gmail or Outlook) to the CRM?',
    aHtml: 'Inbox integration is in build now: you will securely OAuth-connect Gmail/Google Workspace or Outlook/Microsoft 365, get two-way sync, and send from your own address while conversations thread automatically against the right lead. <a href="https://info.propertylist.es/docs/propertylist-mls-user-manual/contacts-crm/connect-your-email/">See the setup guide</a> to get your Google Workspace or Microsoft 365 ready today.',
  },
  {
    id: 'rentals-module',
    q: 'Does PropertyList have a rentals management module?',
    aHtml:
      'Yes. The Rentals Module unlocks the full rental workflow - from first enquiry through to lease completion and renewal.',
  },
  {
    id: 'rentals-includes',
    q: 'What does the Rentals module include?',
    aHtml:
      'A dedicated Tenants pipeline, a Tenancies ledger (live/expiring/ended leases with deposit status), automatic lease renewal emails (30 days before expiry, multi-language), a maintenance workflow with supplier tracking, a landlord portfolio view showing rent roll and renewals due, and a full audit log for deposit disputes.',
  },
  {
    id: 'rentals-cost',
    q: 'How much does the Rentals module cost?',
    aHtml:
      'Free 30-day trial, no credit card required. After the trial it is 50 credits per 30-day period, with no charge until you renew.',
  },
  {
    id: 'rentals-deposit-disputes',
    q: 'Does the Rentals module handle deposit disputes and comply with Spanish rental law?',
    aHtml:
      'Yes. The audit log timestamps every status and deposit change with the agent responsible - providing defensible evidence for Spanish deposit disputes under the LAU / RDL 8/2024 framework.',
  },

  // ─── Credits & Pricing ─────────────────────────────────────────────────
  {
    id: 'credits-work',
    q: 'How do PropertyList credits work?',
    aHtml:
      '1 credit (~1€). Buy in bulk for a discount. Credits never expire. Used to unlock paid features across the platform. For anything monthly, you can switch on auto top-up: a saved card refills your balance by the cost of your active subscriptions the day before renewal, so nothing pauses. It is a way to pay, not an extra charge. <a href="https://info.propertylist.es/pricing">See credit pricing</a>.',
  },
  {
    id: 'credits-expire',
    q: 'Do credits expire?',
    aHtml: 'No. PropertyList credits never expire - use them at your own pace.',
  },
  {
    id: 'earn-free-credits',
    q: 'Can I earn free credits on PropertyList?',
    aHtml:
      'Yes. Get your agency verified (free, and any time you like) and receive 20 free credits. Agents also earn 20 credits for each agency that signs up via their referral link - and the new signup gets 10 credits.',
  },

  // ─── MCP / Developers ─────────────────────────────────────────────────
  {
    id: 'api-developers',
    q: 'Does PropertyList have an API for developers?',
    aHtml:
      'Two, for different jobs. The Website API pulls your own PropertyList stock into your website (a REST key you create, rotate and revoke in your account, 35 credits a month for the whole network, free for your own listings). The MCP at mcp.propertylist.es is a Model Context Protocol server that lets AI agents search the market: search_properties, find_properties_by_description, autocomplete_location, get_property, area_market_summary and list_agencies. <a href="https://propertylist.es/api-docs" rel="noopener">Website API docs</a>, <a href="https://mcp.propertylist.es/" rel="noopener">MCP</a>.',
  },
  {
    id: 'ai-tools',
    q: 'Can I connect PropertyList to AI tools like Claude, Cursor, or Perplexity?',
    aHtml:
      'Yes. The MCP connects live PropertyList data to any MCP-compatible client - Claude, Cursor, Zed, Perplexity and any Model Context Protocol tool - so an AI agent can search your market on your behalf. Install via Claude Desktop config, npx adapter or the direct JSON-RPC endpoint. Structured search works with no key; the natural-language AI matcher needs an agent key, which is approval only.',
  },
  {
    id: 'mcp-free',
    q: 'Is the MCP free to use?',
    aHtml:
      'Three tiers. Public: free, no signup, no key, structured search, location autocomplete, full listing detail and area market summaries at 60 requests a minute. Agent: a free key, approval only (each request is reviewed by hand), which switches on the natural-language AI matcher with 200 AI searches a month included, then 1 credit per 10 searches from your agency wallet and nothing else charged, at 600 requests a minute. Enterprise: custom, billed by contract, for banks, valuers, portals and AI product teams. <a href="https://mcp.propertylist.es/" rel="noopener">mcp.propertylist.es</a>.',
  },

  // ─── Oracle ────────────────────────────────────────────────────────────
  {
    id: 'oracle',
    q: 'What is PropertyList Oracle?',
    aHtml:
      'PropertyList Oracle (oracle.propertylist.es) is a live, signed €/m² price feed for Spanish real estate - purpose-built for tokenisation platforms, on-chain lenders, and property-backed stablecoin issuers who need daily attestation. Built for RWA (Real World Asset) protocols. <a href="https://oracle.propertylist.es">Explore PropertyList Oracle</a>.',
  },
];

// JSON-LD FAQPage schema - all 30 questions, plain text answers (no HTML)
export const featureFaqLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: featureFaqItems.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: f.aHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    },
  })),
};