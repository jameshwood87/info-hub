/**
 * Centralized platform statistics.
 * Update these values in one place → rebuild → push.
 * All pages importing from here get the new numbers automatically.
 */
export const PLATFORM_STATS = {
  agents: 1250,
  agencies: '800+',
  listings: '6,000+',
} as const;

export const STATS = {
  agents: {
    value: 1250,
    formatted: '1,250+',
    label: 'Active agents',
  },
  agencies: {
    value: '800+', // keep as string (800+) for display consistency
    label: 'Agencies',
  },
  listings: {
    value: '6,000+',
    label: 'Shared Properties',
  },
} as const;