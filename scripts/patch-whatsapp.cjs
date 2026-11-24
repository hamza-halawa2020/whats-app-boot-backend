// Backport upstream PR #201990 until a released version includes /login/ support.
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(require.resolve('whatsapp-web.js/package.json'));
const version = require(path.join(root, 'package.json')).version;
if (version !== '1.34.8') throw new Error(`Review WhatsApp login patch for version ${version}`);
const target = path.join(root, 'src/Client.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
const patch = fs.readFileSync(path.join(__dirname, '../patches/whatsapp-login.diff'), 'utf8').replace(/\r\n/g, '\n');
for (const hunk of patch.split(/^@@[^\n]*\n/m).slice(1)) {
  const lines = hunk.split('\n').filter(line => /^[ +\-]/.test(line));
  const before = lines.filter(line => line[0] !== '+').map(line => line.slice(1)).join('\n');
  const after = lines.filter(line => line[0] !== '-').map(line => line.slice(1)).join('\n');
  if (source.includes(before)) source = source.replace(before, after);
  else if (!source.includes(after)) throw new Error('WhatsApp patch does not match installed Client.js');
}
fs.writeFileSync(target, source);
console.log('WhatsApp /login/ compatibility patch applied');
