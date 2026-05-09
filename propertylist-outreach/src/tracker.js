/**
 * Agency Tracker - SQLite Database
 * Tracks discovered agencies and their outreach status
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/tracker.db');
const DATA_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS agencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    website TEXT UNIQUE NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    source TEXT,
    region TEXT,
    status TEXT DEFAULT 'new',
    -- status: 'new' | 'contacted' | 'replied' | 'signed_up' | 'dead' | 'mailchimp_added'
    mailchimp_id TEXT,
    discord_message_id TEXT,
    discovered_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_contacted_at TEXT,
    signed_up_at TEXT,
    notes TEXT,
    UNIQUE(website)
  );

  CREATE INDEX IF NOT EXISTS idx_status ON agencies(status);
  CREATE INDEX IF NOT EXISTS idx_website ON agencies(website);
  CREATE INDEX IF NOT EXISTS idx_email ON agencies(email);
`);

/**
 * Insert or ignore if already exists
 * @param {Object} agency - { name, website, email?, phone?, address?, source, region }
 * @returns {Object|undefined} - The inserted row or undefined if duplicate
 */
export function insertAgency(agency) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO agencies (name, website, email, phone, address, source, region, status, discovered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'))
  `);
  
  const result = stmt.run(
    agency.name,
    normalizeUrl(agency.website),
    agency.email || null,
    agency.phone || null,
    agency.address || null,
    agency.source,
    agency.region || null
  );
  
  if (result.changes > 0) {
    return db.prepare('SELECT * FROM agencies WHERE website = ?').get(normalizeUrl(agency.website));
  }
  return undefined;
}

/**
 * Update agency status and optional fields
 * @param {string} website 
 * @param {string} status 
 * @param {Object} extra - Optional additional fields
 */
export function updateStatus(website, status, extra = {}) {
  const fields = ['status = ?'];
  const values = [status];
  
  if (extra.mailchimp_id) {
    fields.push('mailchimp_id = ?');
    values.push(extra.mailchimp_id);
  }
  if (extra.discord_message_id) {
    fields.push('discord_message_id = ?');
    values.push(extra.discord_message_id);
  }
  if (extra.notes) {
    fields.push('notes = ?');
    values.push(extra.notes);
  }
  if (status === 'contacted' || extra.last_contacted_at) {
    fields.push('last_contacted_at = datetime("now")');
  }
  
  values.push(normalizeUrl(website));
  
  const stmt = db.prepare(`UPDATE agencies SET ${fields.join(', ')} WHERE website = ?`);
  return stmt.run(...values);
}

/**
 * Get all agencies pending outreach
 * @returns {Array} - Agencies not in 'signed_up' or 'dead'
 */
export function getPending() {
  return db.prepare(`
    SELECT * FROM agencies 
    WHERE status NOT IN ('signed_up', 'dead')
    ORDER BY discovered_at DESC
  `).all();
}

/**
 * Get all agencies
 * @param {Object} filters - Optional filters {status, source, region}
 * @returns {Array}
 */
export function getAll(filters = {}) {
  let sql = 'SELECT * FROM agencies WHERE 1=1';
  const params = [];
  
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.source) {
    sql += ' AND source = ?';
    params.push(filters.source);
  }
  if (filters.region) {
    sql += ' AND region = ?';
    params.push(filters.region);
  }
  
  sql += ' ORDER BY discovered_at DESC';
  
  return db.prepare(sql).all(...params);
}

/**
 * Mark agency as signed up
 * @param {string} website
 */
export function markSignedUp(website) {
  const stmt = db.prepare(`
    UPDATE agencies 
    SET status = 'signed_up', signed_up_at = datetime('now')
    WHERE website = ?
  `);
  return stmt.run(normalizeUrl(website));
}

/**
 * Get statistics
 * @returns {Object} - { total, new_today, contacted, signed_up, dead }
 */
export function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM agencies').get().count;
  const new_today = db.prepare(`SELECT COUNT(*) as count FROM agencies WHERE date(discovered_at) = date('now')`).get().count;
  const contacted = db.prepare(`SELECT COUNT(*) as count FROM agencies WHERE status = 'contacted'`).get().count;
  const replied = db.prepare(`SELECT COUNT(*) as count FROM agencies WHERE status = 'replied'`).get().count;
  const signed_up = db.prepare(`SELECT COUNT(*) as count FROM agencies WHERE status = 'signed_up'`).get().count;
  const dead = db.prepare(`SELECT COUNT(*) as count FROM agencies WHERE status = 'dead'`).get().count;
  const mailchimp_added = db.prepare(`SELECT COUNT(*) as count FROM agencies WHERE status = 'mailchimp_added'`).get().count;
  
  return { total, new_today, contacted, replied, signed_up, dead, mailchimp_added };
}

/**
 * Check if website already tracked
 * @param {string} website
 * @returns {boolean}
 */
export function isTracked(website) {
  const result = db.prepare('SELECT 1 FROM agencies WHERE website = ?').get(normalizeUrl(website));
  return !!result;
}

/**
 * Check if email already exists
 * @param {string} email
 * @returns {boolean}
 */
export function emailExists(email) {
  if (!email) return false;
  const result = db.prepare('SELECT 1 FROM agencies WHERE email = ?').get(email.toLowerCase());
  return !!result;
}

/**
 * Normalize URL - remove trailing slash, lowercase
 */
function normalizeUrl(url) {
  if (!url) return null;
  return url.toLowerCase().replace(/\/+$/, '');
}

export default {
  insertAgency,
  updateStatus,
  getPending,
  getAll,
  markSignedUp,
  getStats,
  isTracked,
  emailExists
};