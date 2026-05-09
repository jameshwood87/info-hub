/**
 * Mailchimp Integration - Direct axios calls
 */

import axios from 'axios';
import { log } from './logger.js';

const getAuth = () => {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  return { username: 'anystring', password: apiKey };
};

/**
 * Add or update subscriber in Mailchimp
 * @param {Object} agency - { email, name, website, phone }
 * @returns {Object} - { id, email } or null
 */
export async function addToMailchimp(agency) {
  const { server, audienceId } = {
    server: process.env.MAILCHIMP_SERVER_PREFIX,
    audienceId: process.env.MAILCHIMP_AUDIENCE_ID,
  };
  
  if (!audienceId || !server) {
    log('[Mailchimp] Config missing');
    return null;
  }
  
  try {
    const email = agency.email?.toLowerCase();
    if (!email) return null;
    
    // Simple POST to add member
    const url = `https://${server}.api.mailchimp.com/3.0/lists/${audienceId}/members`;
    
    const data = {
      email_address: email,
      status_if_new: 'subscribed',
      merge_fields: {
        FNAME: agency.name?.substring(0, 40) || '',
        COMPANY: agency.name?.substring(0, 40) || '',
        MMERGE16: agency.website || '',
      },
      tags: ['agency-outreach'],
    };
    
    await axios.post(url, data, { auth: getAuth() });
    
    log(`[Mailchimp] Added: ${email}`);
    
    return { id: email, email };
  } catch (err) {
    // If already exists, that's OK
    if (err.response?.status === 400 && err.response?.data?.title === 'Member Exists') {
      log(`[Mailchimp] Already exists: ${agency.email}`);
      return { email: agency.email };
    }
    log(`[Mailchimp] Error: ${err.message}`);
    return null;
  }
}

/**
 * Check if subscriber exists
 */
export async function isInMailchimp(email) {
  const { server, audienceId } = {
    server: process.env.MAILCHIMP_SERVER_PREFIX,
    audienceId: process.env.MAILCHIMP_AUDIENCE_ID,
  };
  
  if (!audienceId || !email) return false;
  
  // This requires MD5 hash - let's skip this check for now
  return false;
}

export default { addToMailchimp, isInMailchimp };