// build.js — copies tracker/tracker.js to snippet.js at the project root.
// The tracker already inlines its own CSS, so this is a straight copy.
// Run: node build.js
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'tracker.js');
const dest = path.join(__dirname, 'snippet.js');

const code = fs.readFileSync(src, 'utf8');
const banner = `/* Shopify Engagement Snippet — built ${new Date().toISOString()} */\n`;
fs.writeFileSync(dest, banner + code);

console.log(`[ok] wrote ${dest} (${code.length} chars)`);
console.log('Upload snippet.js to a CDN (or serve from your backend) and reference it in theme.liquid.');
