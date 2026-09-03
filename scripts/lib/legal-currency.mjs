// legal-currency.mjs - the legal positions the blog pipeline keeps getting wrong.
//
// The idea researcher and the article generator both read this so that a dead
// instrument cannot be proposed, or written about, as if it were current law,
// and so that a live proposal is not mistaken for a dead one.
// Added 03-09-26 after the queue spent six weeks stuck on one article, then
// corrected the same day: "housing decree" in August 2026 news means the NEW
// draft decree postponed to September, not the March decree Congress rejected.
//
// Keep this list short. One entry per position we have actually got wrong.
// Verify against boe.es before editing: the BOE entry itself flags derogation
// and annulment at the top of the consolidated text.

export const RETIRED_LAWS = [
  {
    id: 'RDL 8/2026',
    name: 'Real Decreto-ley 8/2026 of March 2026, the rent-cap decree (2% ceiling on annual rent updates and a two-year extraordinary extension)',
    what_happened: 'Congress rejected it on 28-04-26 and it ceased to have effect on 30-04-26. It is not current law and never became permanent. Ordinary LAU rules and the IRAV index apply instead.',
  },
  {
    id: 'RD 1312/2024 registration number',
    name: 'The national short-let registration number (NRU/NRA) created by Real Decreto 1312/2024 (Registro Unico de Arrendamientos, effects from 1-7-2025)',
    what_happened: 'The Supreme Court annulled the registration procedure and the obligation to hold a national number to advertise short-term or seasonal lets on platforms (judgments of 19 and 21 May 2026, published in the BOE in June 2026) because the State lacks the competence; regional tourism registries apply instead. The digital single window and the platforms data-sharing duties under EU Regulation 2024/1028 survive.',
  },
];

// Positions that are current but get misreported in the same way.
export const STANDING_FACTS = [
  'A separate housing decree (decreto de vivienda) with IRPF bonifications for landlords who rent affordably, to young tenants or lower the rent, SOCIMI tax changes, 21% VAT on tourist flats and rules for temporary lets was withdrawn from the Council of Ministers agenda on 28-07-26 and postponed to September 2026. Until it is published in the BOE it is a proposal: describe it as a draft, never as law in force, and check the BOE on the day of writing.',
  'Andalucia has declared no zona tensionada and never adopted the state rental reference index. Tourist lets in Andalucia register with the RTA under Decreto 31/2024, and the VFT code must appear in adverts.',
  'For rent updates, contracts signed from 26-05-2023 follow the IRAV index; earlier contracts follow the index agreed in the contract, usually the IPC.',
];

// One plain-text block to paste into a model prompt.
export function legalCurrencyBlock() {
  const laws = RETIRED_LAWS.map((l) => `- ${l.name}. ${l.what_happened}`).join('\n');
  const facts = STANDING_FACTS.map((f) => `- ${f}`).join('\n');
  return `LAWS THAT ARE NO LONGER IN FORCE (never present these as current law):\n${laws}\n\nCURRENT POSITION (state these as they are, and date any claim about a pending decree):\n${facts}`;
}
