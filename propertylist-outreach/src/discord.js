/**
 * Discord Webhook Integration
 * Posts new agencies and daily digests to Discord
 */

import axios from 'axios';

/**
 * Send embed to Discord webhook
 * @param {Object} agency - { name, website, email, source, region }
 * @param {string} webhookUrl 
 * @param {string} status - Status message
 * @returns {string|null} - Message ID or null
 */
export async function postToDiscord(agency, webhookUrl, status = 'NEW') {
  if (!webhookUrl) return null;
  
  const color = status === 'NEW' ? 0x2ecc71 : // green
               status === 'ERROR' ? 0xe74c3c : // red
               0x3498db; // blue
  
  const embed = {
    embeds: [{
      title: `🏢 ${status === 'NEW' ? 'New Agency Discovered' : 'Agency Update'}`,
      color,
      fields: [
        { name: 'Name', value: agency.name, inline: true },
        { name: 'Website', value: agency.website, inline: true },
        { name: 'Email', value: agency.email || 'N/A', inline: true },
        { name: 'Phone', value: agency.phone || 'N/A', inline: true },
        { name: 'Source', value: agency.source, inline: true },
        { name: 'Region', value: agency.region || 'N/A', inline: true },
      ],
      footer: { text: `PropertyList Outreach • ${new Date().toISOString().split('T')[0]}` },
      timestamp: new Date().toISOString(),
    }],
  };
  
  try {
    const response = await axios.post(webhookUrl, embed);
    return response.data?.id || 'sent';
  } catch (err) {
    console.error('[Discord] Error:', err.message);
    return null;
  }
}

/**
 * Post daily digest to Discord
 * @param {Object} stats - { total, new_today, contacted, signed_up, dead }
 * @param {Array} pending - Array of pending agencies
 * @param {string} webhookUrl
 */
export async function postDigest(stats, pending, webhookUrl) {
  if (!webhookUrl) return;
  
  const date = new Date().toISOString().split('T')[0];
  
  const embed = {
    embeds: [{
      title: `📊 PropertyList Outreach Digest — ${date}`,
      color: 0x3498db,
      description: `
**Totals:**
• Total tracked: ${stats.total}
• New today: ${stats.new_today}
• Contacted: ${stats.contacted}
• Replied: ${stats.replied}
• Signed up: ${stats.signed_up}
• Mailchimp added: ${stats.mailchimp_added}
• Dead: ${stats.dead}
      `.trim(),
      fields: pending.length > 0 ? [{
        name: `Pending Agencies (${pending.length})`,
        value: pending.slice(0, 10).map(a => 
          `• ${a.name} (${a.status}) - ${a.source}`
        ).join('\n') + (pending.length > 10 ? `\n...and ${pending.length - 10} more` : ''),
      }] : [],
      footer: { text: 'PropertyList Outreach' },
      timestamp: new Date().toISOString(),
    }],
  };
  
  try {
    await axios.post(webhookUrl, embed);
  } catch (err) {
    console.error('[Discord] Digest error:', err.message);
  }
}

/**
 * Post error to Discord
 * @param {string} errorMsg 
 * @param {string} webhookUrl
 */
export async function postError(errorMsg, webhookUrl) {
  if (!webhookUrl) return;
  
  const embed = {
    embeds: [{
      title: '⚠️ Outreach Error',
      color: 0xe74c3c,
      description: errorMsg,
      footer: { text: 'PropertyList Outreach' },
      timestamp: new Date().toISOString(),
    }],
  };
  
  try {
    await axios.post(webhookUrl, embed);
  } catch (err) {
    console.error('[Discord] Error post failed:', err.message);
  }
}

export default { postToDiscord, postDigest, postError };