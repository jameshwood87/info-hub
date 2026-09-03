// legal-currency.mjs - laws that are no longer in force.
//
// The idea researcher and the article generator both read this so that a dead
// instrument cannot be proposed, or written about, as if it were current law.
// Added 03-09-26: the topic queue spent six weeks stuck on an article built on
// a decree that had already been rejected by Congress.
//
// Keep this list short. One entry per instrument we have actually got wrong.

export const RETIRED_LAWS = [
  {
    id: 'RDL 8/2026',
    name: 'Real Decreto-ley 8/2026, the March 2026 rent-cap and housing decree',
    what_happened: 'Congress rejected it on 28-04-26 and it ceased to have effect on 30-04-26. It is not current law and never became permanent.',
    also_covers: 'Any framing about housing decree tax bonifications for landlords, or about the housing decree being postponed to September, describes this dead decree.',
  },
];

// Positions that are stable but get misreported in the same way.
export const STANDING_FACTS = [
  'Andalucia is not a zona tensionada and never adopted the state rental reference index.',
];

// One plain-text block to paste into a model prompt.
export function legalCurrencyBlock() {
  const laws = RETIRED_LAWS.map((l) => `- ${l.name}. ${l.what_happened} ${l.also_covers}`).join('\n');
  const facts = STANDING_FACTS.map((f) => `- ${f}`).join('\n');
  return `LAWS THAT ARE NO LONGER IN FORCE (never present these as current law):\n${laws}\n\nCURRENT POSITION:\n${facts}`;
}
