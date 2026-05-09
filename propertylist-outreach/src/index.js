/**
 * PropertyList Outreach - Main Entry Point
 * 
 * Cron: Daily at 08:00 (Europe/Madrid)
 * Manual: GET /run, GET /status, GET /digest
 */

import 'dotenv/config';
import cron from 'node-cron';
import express from 'express';
import { log } from './logger.js';
import { initDedup, isAlreadySignedUp } from './dedup.js';
import tracker from './tracker.js';
import { postToDiscord, postDigest, postError } from './discord.js';
import { addToMailchimp } from './mailchimp.js';
import { runScraper } from './scraper.js';

// Config
const WEBHOOK = process.env.DISCORD_OUTREACH_WEBHOOK;
const LOG_WEBHOOK = process.env.DISCORD_LOG_WEBHOOK || WEBHOOK;

/**
 * Main outreach cycle
 */
async function runOutreachCycle() {
  log('=== Starting Outreach Cycle ===');
  
  try {
    // Initialize integrations
    
    const existingSets = await initDedup();
    
    // Run scraper
    log('[Outreach] Running scraper...');
    const newAgencies = await runScraper({ isAlreadySignedUp }, existingSets);
    
    log(`[Outreach] Found ${newAgencies.length} new agencies`);
    
    // Process each new agency
    let added = 0;
    for (const agency of newAgencies) {
      // Check if already tracked locally
      if (tracker.isTracked(agency.website)) {
        log(`[Outreach] Already tracked: ${agency.website}`);
        continue;
      }
      
      // Add to local tracker
      const inserted = tracker.insertAgency(agency);
      if (!inserted) {
        log(`[Outreach] Already in tracker: ${agency.website}`);
        continue;
      }
      
      // Add to Mailchimp if email exists
      if (agency.email) {
        const mcResult = await addToMailchimp(agency);
        if (mcResult) {
          tracker.updateStatus(agency.website, 'mailchimp_added', { 
            mailchimp_id: mcResult.id 
          });
        }
      }
      
      // Post to Discord
      await postToDiscord(agency, WEBHOOK, 'NEW');
      
      added++;
      log(`[Outreach] Processed: ${agency.name} (${agency.email})`);
    }
    
    // Post daily digest
    const stats = tracker.getStats();
    const pending = tracker.getPending();
    await postDigest(stats, pending, WEBHOOK);
    
    log(`=== Outreach Cycle Complete: ${added} new agencies ===`);
    
  } catch (err) {
    log(`[Outreach] Error: ${err.message}`);
    await postError(err.message, LOG_WEBHOOK);
  }
}

/**
 * Express server for manual triggers
 */
const app = express();

app.get('/run', async (req, res) => {
  res.send('Running outreach cycle...');
  await runOutreachCycle();
  res.send('Done');
});

app.get('/status', async (req, res) => {
  const stats = tracker.getStats();
  res.json(stats);
});

app.get('/digest', async (req, res) => {
  const stats = tracker.getStats();
  const pending = tracker.getPending();
  await postDigest(stats, pending, WEBHOOK);
  res.json({ sent: true });
});

app.get('/health', (req, res) => {
  res.send('OK');
});

// Start server
const PORT = parseInt(process.env.PORT) || 3210;
app.listen(PORT, () => {
  log(`PropertyList Outreach started on port ${PORT}`);
});

// Cron: Daily at 08:00 Madrid time
// cron.schedule('0 8 * * *', runOutreachCycle, { timezone: 'Europe/Madrid' });

// For testing, run once on startup
log('Starting first outreach cycle...');
runOutreachCycle();

export default { runOutreachCycle };