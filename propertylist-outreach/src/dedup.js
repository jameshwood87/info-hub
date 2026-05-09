/**
 * Dedup Module - Cross-reference against existing agencies
 * Checks if agency is already in PropertyList (DB) or Mailchimp
 */

import Database from 'better-sqlite3';
import axios from 'axios';

/**
 * Get all signed-up agencies from local PropertyList DB
 * @returns {Set} - Set of emails and domains to check against
 */
export async function getPropertyListAgencies() {
  const existing = new Set();
  
  try {
    // Read from PropertyList SQLite if path configured
    const dbPath = process.env.PERTYLIST_DB_PATH || '/home/pingu/propertylist-db.sqlite';
    
    // Try to read the database - we need at least the 'agencies' or 'agents' table
    const db = new Database(dbPath, { readonly: true });
    
    // Check for agencies table
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all();
    
    const tableNames = tables.map(t => t.name);
    
    // Query agencies if table exists
    if (tableNames.includes('agencies')) {
      const agencies = db.prepare('SELECT email, website FROM agencies').all();
      agencies.forEach(a => {
        if (a.email) existing.add(a.email.toLowerCase());
        if (a.website) {
          const domain = extractDomain(a.website);
          if (domain) existing.add(domain);
        }
      });
    }
    
    // Query agents if table exists
    if (tableNames.includes('agents')) {
      const agents = db.prepare('SELECT email, last_login FROM agents').all();
      agents.forEach(a => {
        if (a.email) existing.add(a.email.toLowerCase());
      });
    }
    
    db.close();
  } catch (err) {
    console.error('PropertyList DB read error:', err.message);
    // Continue without DB dedup
  }
  
  return existing;
}

/**
 * Get all emails from Mailchimp audience
 * @returns {Set} - Set of emails
 */
export async function getMailchimpEmails() {
  const existing = new Set();
  
  try {
    const apiKey = process.env.MAILCHIMP_API_KEY;
    const server = process.env.MAILCHIMP_SERVER_PREFIX;
    const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;
    
    if (!apiKey || !server || !audienceId) {
      console.warn('Mailchimp config missing, skipping Mailchimp dedup');
      return existing;
    }
    
    // Get all members from audience
    const response = await axios.get(
      `https://${server}.api.mailchimp.com/3.0/lists/${audienceId}/members`,
      {
        auth: { username: 'anystring', password: apiKey },
        params: { count: 1000, fields: 'members.email_address' }
      }
    );
    
    if (response.data?.members) {
      response.data.members.forEach(m => {
        existing.add(m.email_address?.toLowerCase());
      });
    }
  } catch (err) {
    console.error('Mailchimp API error:', err.message);
  }
  
  return existing;
}

/**
 * Check if agency already exists in PropertyList network
 * @param {Object} agency - { email, website }
 * @param {Object} existingSets - { propertyList: Set, mailchimp: Set }
 * @returns {boolean} - true if already signed up
 */
export function isAlreadySignedUp(agency, existingSets) {
  // Check email
  if (agency.email) {
    const email = agency.email.toLowerCase();
    if (existingSets.mailchimp.has(email)) return true;
    if (existingSets.propertyList.has(email)) return true;
  }
  
  // Check domain
  if (agency.website) {
    const domain = extractDomain(agency.website);
    if (domain && existingSets.propertyList.has(domain)) return true;
    if (domain && existingSets.mailchimp.has(domain)) return true;
  }
  
  return false;
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  if (!url) return null;
  try {
    // Add protocol if missing
    const urlStr = url.match(/^https?:\/\//) ? url : `https://${url}`;
    const u = new URL(urlStr);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Initialize dedup - load all existing agencies/emails
 * @returns {Object} - { propertyList: Set, mailchimp: Set }
 */
export async function initDedup() {
  console.log('[Dedup] Loading existing agencies...');
  
  const [propertyList, mailchimp] = await Promise.all([
    getPropertyListAgencies(),
    getMailchimpEmails()
  ]);
  
  console.log(`[Dedup] Loaded: ${propertyList.size} PropertyList, ${mailchimp.size} Mailchimp contacts`);
  
  return { propertyList, mailchimp };
}

export default { initDedup, isAlreadySignedUp };