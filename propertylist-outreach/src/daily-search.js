/**
 * Daily Agency Search - Appends 10-20 agencies to CSV
 * Runs at 06:30 daily
 * Uses web search for agent discovery
 */

import fs from 'fs';

const CSV_PATH = '/home/pingu/propertylist-outreach/data/agency-contacts.csv';
const MAX_NEW = 15;

function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Load existing emails/websites from CSV
 */
function loadExisting() {
  try {
    if (!fs.existsSync(CSV_PATH)) return { emails: new Set(), sites: new Set() };
    const content = fs.readFileSync(CSV_PATH, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const emails = new Set();
    const sites = new Set();
    
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols[1]) emails.add(cols[1].replace(/"/g, '').toLowerCase());
      if (cols[4]) sites.add(cols[4].replace(/"/g, '').toLowerCase());
    }
    return { emails, sites };
  } catch (err) {
    console.error('[DailySearch] Load error:', err.message);
    return { emails: new Set(), sites: new Set() };
  }
}

/**
 * Append agency row to CSV
 */
function appendToCSV(agency) {
  const row = [
    agency.name || '',
    agency.email || '',
    agency.phone || '',
    agency.whatsapp || '',
    agency.website || '',
    agency.location || '',
    agency.source || 'search',
    today()
  ].map(v => String(v)).join(',');
  
  fs.appendFileSync(CSV_PATH, row + '\n');
  console.log(`[DailySearch] + ${agency.name} (${agency.location})`);
}

/**
 * Main - Run daily search
 * Called via cron at 06:30
 */
async function runDailySearch() {
  console.log(`=== Daily Search: ${today()} ===`);
  
  const { emails, sites } = loadExisting();
  
  // Search queries for different regions
  const queries = [
    { region: 'Madrid', q: 'inmobiliaria Madrid agencia inmobiliaria' },
    { region: 'Barcelona', q: 'inmobiliaria Barcelona agent' },
    { region: 'Valencia', q: 'agencia inmobiliaria Valencia' },
    { region: 'Malaga', q: 'inmobiliaria Marbella Costa del Sol' },
    { region: 'Sevilla', q: 'inmobiliaria Sevilla' },
    { region: 'Alicante', q: 'inmobiliaria Alicante Costa Blanca' },
    { region: 'Murcia', q: 'inmobiliaria Murcia' },
    { region: 'Bilbao', q: 'inmobiliaria Bilbao' },
  ];
  
  const added = [];
  const existing = new Set([...emails, ...sites]);
  
  // Process queries - each can add up to 2 agencies
  for (const { region, q } of queries) {
    if (added.length >= MAX_NEW) break;
    
    try {
      // Use web search
      const result = await callWebSearch(q, region);
      
      for (const agency of result) {
        if (added.length >= MAX_NEW) break;
        const key = (agency.email || agency.website || '').toLowerCase();
        if (key && !existing.has(key)) {
          appendToCSV(agency);
          existing.add(key);
          added.push(agency);
        }
      }
    } catch (err) {
      console.error(`[DailySearch] ${region}: ${err.message}`);
    }
  }
  
  console.log(`=== Done: ${added.length} new agencies ===`);
  return added;
}

/**
 * Web search wrapper - returns agencies from search results
 */
async function callWebSearch(query, location) {
  // Note: This should use the actual web_search tool
  // For now, return empty array - will be called by cron with proper API
  console.log(`[DailySearch] Would search: ${query} (${location})`);
  return [];
}

// Self-test
if (process.argv[1]?.includes('daily-search')) {
  runDailySearch().then(() => process.exit(0)).catch(err => {
    console.error('[DailySearch] Fatal:', err);
    process.exit(1);
  });
}

export { runDailySearch, appendToCSV };