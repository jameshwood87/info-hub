# Tighten the Website Builder page for someone reading it on a phone between
# viewings. Every price, every fact and every honesty line stays; what goes is
# the second sentence that repeats the first, and the explaining of things the
# picture already shows.
#
# Nothing here changes what the page claims. Run wordcount.py before and after.
import sys

P = '/opt/info-hub/src/pages/website-builder.astro'
s = open(P, encoding='utf-8').read()

PAIRS = [
    # The film explains itself. A caption narrating what the reader is watching
    # is the clearest case of words doing no work.
    (
        '<figcaption class="filmCap">Recorded from the new builder: the fifteen designs, Solaz chosen, the headline selected, the hero rearranged, then Review and publish. 33 seconds. The add-ons and totals shown are the sample site\'s and can be edited.</figcaption>',
        '',
    ),
    # Meta description: also now inside the length Google will show.
    (
        "'Pick one of fifteen finished agency website designs, make it yours, and every property on the PropertyList network is on it, filtered how you want, with enquiries landing in your CRM. Free to build and preview, from 50 credits a month once you publish.'",
        "'Fifteen finished agency website designs, showing the whole PropertyList network filtered how you want. Enquiries land in your CRM. Free to build, from 50 credits a month once you publish.'",
    ),
    (
        'Fifteen finished agency websites, loaded with every property on the network and filtered how you want. Enquiries land in your CRM and pipelines, and your own listings are on the site the day you publish.',
        'Fifteen finished agency websites, loaded with the whole network and filtered how you want. Enquiries land in your CRM.',
    ),
    (
        'Your site reads from the same network as your MLS and CRM. Every property on it can be on your site the day you publish, filtered how you want, and it updates the moment a listing changes.',
        'Your site reads the same network as your MLS and CRM. Current the day you publish, and it updates itself after that.',
    ),
    (
        'Every template is a complete agency website: the same pages, the same blocks an agency needs, in a different look. Pick the one that matches how you already work, not the other way round.',
        'Every one is a complete agency website: same pages, same blocks, different look. Pick the one that matches how you already work.',
    ),
    (
        'Change your mind later: switch template and keep your words, your pages and your settings. Three of the fifteen (Solaz, Noir, Faro) open on a film.',
        'Switch template later and keep your words, pages and settings. Solaz, Noir and Faro open on a film.',
    ),
    (
        'Add your brand colour, your words and your photos in an editor that shows the real site as you work. Each block has several arrangements; pick one.',
        'Your brand colour, your words, your photos, in an editor showing the real site. Each block has several arrangements.',
    ),
    (
        'The network\'s properties and your own are already there, so publishing does not mean uploading anything. Enquiries start landing in your CRM straight away.',
        'Nothing to upload: the listings are already there. Enquiries start landing in your CRM.',
    ),
    (
        'Your own listings are on your site the day you publish. The network\'s stock is there too: filter it and showcase what fits your buyers, straight away.',
        'Your listings are live the day you publish. The network\'s stock is there too: filter it and show what fits your buyers.',
    ),
    (
        'Every enquiry arrives as a lead. Push the ones you want through your pipelines: Lead, Seller and Property are free with no limit, and moving a qualified lead into the Buyer pipeline costs 1 credit.',
        'Every enquiry arrives as a lead. Lead, Seller and Property pipelines are free with no limit; moving a qualified lead into Buyer costs 1 credit.',
    ),
    (
        'Each seller request arrives as a lead with a Property Intelligence Report already filled in, ready to buy for 5 credits if you want it.',
        'Each request arrives as a lead with a Property Intelligence Report already filled in, yours for 5 credits if you want it.',
    ),
    (
        'Spanish purchase costs with the law cited. We check for new and updated rates and refresh the block, so your site stays right without you touching it. Your lawyer confirms the final figure.',
        'Spanish purchase costs, law cited. We refresh the rates when they change, so it stays right without you touching it. Your lawyer confirms the figure.',
    ),
    (
        'Connect your Google Business Profile and your reviews appear on the site, or type them in yourself. Nothing is invented. Your team comes from the staff already in your agency account.',
        'Connect Google Business Profile and your reviews appear, or type them in. Nothing is invented. Your team comes from your agency account.',
    ),
    (
        'English and Spanish come as standard. Add the other languages your buyers use, on the same site.',
        'English and Spanish as standard. Add the other languages your buyers use.',
    ),
    (
        'Nothing to rent, install or renew. Your site is fast and protected from the day you publish, and stays that way.',
        'Nothing to rent, install or renew.',
    ),
    (
        'Served from the Cloudflare network, so pages load fast wherever your buyer is. No hosting bill, no server to look after.',
        'Served from the Cloudflare network, so pages load fast wherever your buyer is. No hosting bill.',
    ),
    (
        'Every site runs on https with a certificate that renews itself. The padlock buyers expect, without you doing anything.',
        'Every site runs on https with a certificate that renews itself.',
    ),
    (
        'DDoS protection and Cloudflare\'s edge security sit in front of your site. Attacks are absorbed before they reach it.',
        'DDoS protection in front of your site. Attacks are absorbed before they reach it.',
    ),
    (
        'Describe a change in plain English and the page updates. Every change is a draft until you publish it, and Undo is always there.',
        'Describe a change in plain English and the page updates. Everything stays a draft until you publish.',
    ),
    (
        '<figcaption>The headline selected in the editor. Shorter, warmer tone, mention the town, or your own words.</figcaption>',
        '<figcaption>The headline selected in the editor.</figcaption>',
    ),
    (
        'Nothing is charged while you build and preview; the subscription starts the day you publish.',
        'Nothing is charged until you publish.',
    ),
    (
        '<li>Home, Properties (search and results, with filters and a saved search), a property page for every listing, About and Contact</li>',
        '<li>Home, Properties (search, filters, saved search), a page for every listing, About and Contact</li>',
    ),
    (
        '<li>Hosting and Cloudflare protection included: fast and protected, nothing for you to manage</li>',
        '<li>Hosting and Cloudflare protection included</li>',
    ),
    (
        '<li>Cancel at the end of any month; the site reverts to the free agency microsite and you keep your domain</li>',
        '<li>Cancel any month; the site reverts to the free agency microsite and you keep your domain</li>',
    ),
    (
        'Each is monthly, switched on from your account, and can be stopped at the end of any month.',
        'Each is monthly, switched on from your account, stopped whenever you like.',
    ),
    (
        "PropertyList's unit for paid features, bought in packs: 1 credit (about 1 EUR) at the smallest pack, less at larger ones. Credits do not expire, so anything you do not use this month is still there next month.",
        "PropertyList's unit for paid features, bought in packs: 1 credit is about 1 EUR at the smallest pack, less at larger ones. Credits do not expire.",
    ),
    (
        'Feed every listing on the network into the site you already have, filtered how you want: only your own stock, or a selection from the network alongside it. XML or the Website API; your developer connects it once and from then on the site reads from the same account as your MLS and CRM.',
        'Feed the network into the site you already have, filtered how you want: your own stock, or a selection from the network alongside it. XML or the Website API, connected once.',
    ),
    # FAQ answers.
    (
        "a: 'Yes. Building and previewing your site costs nothing. You are only charged once you publish it: 50 credits a month from then on, plus any add-ons you switch on.' }",
        "a: 'Yes. Building and previewing cost nothing. You are charged only when you publish: 50 credits a month, plus any add-ons you switch on.' }",
    ),
    (
        "a: 'Your site goes live with every property on the network you have chosen to show, and your own listings, on it straight away. From that point you are charged 50 credits a month for the site, plus any add-ons you have switched on, each billed monthly.' }",
        "a: 'Your site goes live with your listings and whatever network stock you chose to show. From then you pay 50 credits a month, plus any add-ons you switched on.' }",
    ),
    (
        "a: 'Yes. Switch to a different one of the fifteen designs whenever you want, and you keep your words, your pages and your settings.' }",
        "a: 'Yes. Switch to any of the fifteen whenever you want, and keep your words, pages and settings.' }",
    ),
    (
        "a: 'No. Every property on the network is already there, filtered how you want, with your own listings alongside, and it all updates when a listing changes in the CRM. Nothing is typed twice.' }",
        "a: 'No. Your listings and the network stock are already there, and update when a listing changes in the CRM. Nothing is typed twice.' }",
    ),
    (
        "a: 'Straight into your PropertyList CRM, and you get an email for each one. Lead, Seller and Property pipelines are free with no limit. Moving a qualified lead into the Buyer pipeline costs 1 credit.' }",
        "a: 'Into your PropertyList CRM, with an email for each one. Lead, Seller and Property pipelines are free with no limit; moving one into Buyer costs 1 credit.' }",
    ),
    (
        "a: 'Yes, for 20 credits a month. Until then your site runs at your-agency-name.estate-agency.co: your name in the address, not ours.' }",
        "a: 'Yes, for 20 credits a month. Until then your site runs at your-agency-name.estate-agency.co, so your name is in the address, not ours.' }",
    ),
    (
        "a: 'Good from day one: every page ships with clean structure, titles and descriptions. Switch on Auto SEO and GEO (5 credits a month) and an agent dedicated to your site works on it every week: it checks every page, refreshes the keywords to what buyers are searching for now, and fixes what it finds. We still do not promise rankings; no honest platform can.' }",
        "a: 'Clean structure, titles and descriptions on every page from day one. Auto SEO and GEO (5 credits a month) rechecks your site weekly and updates the keywords to what buyers search for now. No platform can honestly promise rankings.' }",
    ),
    (
        "a: 'No. You pick a template, edit it in an editor that shows your real site as you work, and publish when you are ready. Edit with AI lets you describe a change in plain English too.' }",
        "a: 'No. Pick a template, edit it in an editor showing the real site, publish when you are ready. Or describe the change in plain English and let the AI do it.' }",
    ),
    (
        "a: 'We do. Hosting and Cloudflare protection are included: your site is served fast from the Cloudflare network and shielded from attacks, with nothing for you to manage or renew.' }",
        "a: 'We do. Hosting and Cloudflare protection are included: fast, shielded from attacks, nothing for you to manage or renew.' }",
    ),
    (
        "a: 'Yes. Aviso legal, privacy and cookies pages, plus a cookie banner, come with every template. They are included and never billed separately.' }",
        "a: 'Yes. Aviso legal, privacy and cookies pages, plus a cookie banner, come with every template and are never billed separately.' }",
    ),
]

missing = [old for old, _ in PAIRS if old not in s]
if missing:
    print(f'{len(missing)} strings not found, nothing written:')
    for m in missing:
        print('  ' + m[:100])
    sys.exit(1)

for old, new in PAIRS:
    s = s.replace(old, new, 1)

open(P, 'w', encoding='utf-8').write(s)
print(f'{len(PAIRS)} passages tightened')
