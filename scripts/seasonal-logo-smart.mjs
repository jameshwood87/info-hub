import { copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Get current date
const now = new Date();
const month = now.getMonth() + 1; // JS months are 0-11
const day = now.getDate();

// Determine the appropriate season/logo based on date
let season = 'default'; // fallback

// Fixed date holidays (month/day)
if (month === 12 && day === 25) season = 'christmas';
else if (month === 12 && day === 26) season = 'default'; // post-Christmas
else if (month === 10 && day === 31) season = 'halloween';
else if (month === 2 && day === 14) season = 'valentines';
else if (month === 3 && day === 17) season = 'stpatricks';
else if (month === 4 && day === 17) season = 'easter';
// Summer solstice (approx June 21)
else if (month === 6 && day >= 21) season = 'spring'; // Actually summer, but keeping existing naming

// For now, if no specific holiday, we'll use default
// In future, we could add more seasonal logic here

// Map season to logo file (matching existing filenames)
const logoMap = {
  'christmas': 'logo-christmas.png',
  'halloween': 'logo-halloween.png',
  'valentines': 'logo-valentines.png',
  'stpatricks': 'logo-stpatricks.png',
  'easter': 'logo-easter.png',
  'spring': 'logo-summer.png', // summer logo used for spring/summer
  'default': 'logo-default.png'
};

const logoFile = logoMap[season] || 'logo-default.png';
const src = resolve('public/og', logoFile);
const dst = resolve('public/logo-black.png');

// Check if source exists
if (!existsSync(src)) {
  console.error(`Missing source logo: ${src}`);
  console.log(`Available logos:`);
  const ogDir = resolve('public/og');
  // List available logos for debugging
  process.exit(1);
}

// Only copy if the logo is actually different
try {
  // Check if files are identical (optional optimization)
  // For now, just copy - it's fast enough
  copyFileSync(src, dst);
  console.log(`✅ Smart seasonal logo: Switched to ${season} (${logoFile})`);
} catch (error) {
  console.error(`Error copying logo: ${error.message}`);
  process.exit(1);
}