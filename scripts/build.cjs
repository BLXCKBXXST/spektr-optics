// Development-only packaging: the generated HTML needs no Node.js or other runtime.
const fs = require('node:fs');
const path = require('node:path');
const source = process.argv[2] || path.join(__dirname, '../src/simulator.html');
const destination = path.resolve(process.argv[3] || path.join(__dirname, '../dist/spektr.html'));
if (path.resolve(source) === destination) throw new Error('Keep the editable fragment separate from the export.');
const fragment = fs.readFileSync(source, 'utf8');
if (/<!doctype\s|<\s*(?:html|head|body)(?:\s|>)/i.test(fragment)) throw new Error('Expected an HTML fragment.');
if (/(?:src|href)\s*=\s*["'](?:https?:)?\/\/|@import\b|url\(\s*["']?(?:https?:)?\/\//i.test(fragment)) throw new Error('External resources are not allowed in the portable file.');
const shell = fs.readFileSync(path.join(__dirname, '../src/shell.html'), 'utf8');
const document = shell.replace('<!-- SPEKTR_CONTENT -->', () => fragment);
fs.mkdirSync(path.dirname(destination), {recursive:true});
fs.writeFileSync(destination, document);
console.log(JSON.stringify({file:destination,bytes:Buffer.byteLength(document),network:'not required'}));
