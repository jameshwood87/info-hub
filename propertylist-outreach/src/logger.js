/**
 * Simple Logger with timestamp
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'outreach.log');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Log a message with timestamp
 * @param {string} message 
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  
  // Console
  console.log(line.trim());
  
  // File (append)
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    console.error('[Logger] File write error:', err.message);
  }
}

export { log };