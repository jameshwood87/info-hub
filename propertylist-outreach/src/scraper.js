/**
 * Improved Scraper - Targets Idealista/Kyero/ThinkSpain agent directories
 * Uses direct portal URLs instead of Google search
 */

import axios from 'axios';
import { log } from './logger.js';

const DELAY_MIN = parseInt(process.env.DELAY_MIN_MS) || 2000;
const DELAY_MAX = parseInt(process.env.DELAY_MAX_MS) || 5000;
const MAX_NEW = parseInt(process.env.MAX_NEW_PER_RUN) || 10;

/**
 * Target URLs for Spanish agent portals
 */
const SOURCES = [
  {
    name: 'kyero',
    baseUrl: 'https://www.kyero.com/en/agents',
    regions: ['spain/malaga', 'spain/madrid', 'spain/valencia', 'spain/barcelona'],
  },
  {
    name: 'thinkspain',
    baseUrl: 'https://www.thinkspain.com/directory-spain/estate-agents',
    regions: [''],
  },
  {
    name: 'estateagentsespana',
    baseUrl: 'https://www.estateagentsespana.com',
    regions: [''],
  },
];

/**
 * Run the scraper
 */
export async function runScraper(dedup, existingSets) {
  const agencies = [];
  
  log('[Scraper] Starting improved scraper...');
  
  for (const source of SOURCES) {
    log(`[Scraper] Trying source: ${source.name}`);
    
    for (const region of source.regions) {
      if (agencies.length >= MAX_NEW) break;
      
      const url = region 
        ? `${source.baseUrl}/${region}` 
        : source.baseUrl;
      
      log(`[Scraper] Fetching: ${url}`);
      
      try {
        const found = await scrapeSource(source.name, url);
        
        for (const agency of found) {
          if (agency.email && !dedup.isAlreadySignedUp(agency, existingSets)) {
            agencies.push(agency);
            log(`[Scraper] New: ${agency.name} (${agency.email})`);
          }
        }
      } catch (err) {
        log(`[Scraper] Error from ${url}: ${err.message}`);
      }
      
      await randomDelay(DELAY_MIN, DELAY_MAX);
    }
    
    if (agencies.length >= MAX_NEW) break;
  }
  
  log(`[Scraper] Total found: ${agencies.length}`);
  return agencies.slice(0, MAX_NEW);
}

/**
 * Scrape a single source
 */
async function scrapeSource(sourceName, url) {
  const agencies = [];
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
      maxRedirects: 5,
    });
    
    const html = response.data;
    
    if (sourceName === 'kyero') agencies.push(...extractKyero(html));
    else if (sourceName === 'thinkspain') agencies.push(...extractThinkSpain(html));
    else if (sourceName === 'estateagentsespana') agencies.push(...extractEstateAgentsEspana(html));
    
  } catch (err) {
    log(`[Scraper] Failed: ${err.message}`);
  }
  
  return agencies;
}

function extractKyero(html) {
  const agencies = [];
  const emails = [...new Set(html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.es/gi) || [])];
  
  for (const email of emails.slice(0, 5)) {
    if (!email.includes('kyero')) {
      agencies.push({
        name: email.split('@')[0].replace(/[\._].*/, '').replace(/[^a-zA-Z]/g, ' ').trim(),
        website: `https://${email.split('@')[1]}`,
        email: email.toLowerCase(),
        phone: null,
        address: null,
        source: 'kyero',
        region: 'spain',
      });
    }
  }
  return agencies;
}

function extractThinkSpain(html) {
  const agencies = [];
  const emails = [...new Set(html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi) || [])];
  
  for (const email of emails.slice(0, 5)) {
    if (!email.includes('thinkspain')) {
      const domain = email.split('@')[1];
      agencies.push({
        name: domain.replace(/\.es|\.com/g, '').replace(/[^a-zA-Z]/g, ' ').trim(),
        website: `https://${domain}`,
        email: email.toLowerCase(),
        phone: null,
        address: null,
        source: 'thinkspain',
        region: 'spain',
      });
    }
  }
  return agencies;
}

function extractEstateAgentsEspana(html) {
  const agencies = [];
  const emails = [...new Set(html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi) || [])];
  
  for (const email of emails.slice(0, 5)) {
    if (!email.includes('estateagentsespana')) {
      const domain = email.split('@')[1];
      agencies.push({
        name: domain.replace(/\.es|\.com/g, '').replace(/[^a-zA-Z]/g, ' ').trim(),
        website: `https://${domain}`,
        email: email.toLowerCase(),
        phone: null,
        address: null,
        source: 'estateagentsespana',
        region: 'spain',
      });
    }
  }
  return agencies;
}

async function randomDelay(min, max) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, delay));
}

export default { runScraper };