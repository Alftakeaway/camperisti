// Test avvio: init app.js con store vuoto/corrotto non deve mai lanciare.
import { readFileSync } from 'fs';
import vm from 'vm';
const src = readFileSync('frontend/app.js', 'utf8');

function block(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('blocco non trovato: ' + from);
  return src.slice(a, b + to.length);
}
const initCode = block('// ---- stato locale', 'loadLocal();');
const matchCode = block('function resolveStops', '\n}\n').replace(/\n\}$/, '\n}');

function run(store) {
  const keys = { ...store };
  const localStorage = {
    getItem: k => (k in keys ? keys[k] : null),
    setItem: (k, v) => { keys[k] = String(v); },
    removeItem: k => { delete keys[k]; },
    key: i => Object.keys(keys)[i] || null,
    get length() { return Object.keys(keys).length; },
  };
  const sandbox = { localStorage, DB: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(initCode + '\nthis.__r={user,favs,trips,checks:typeof checks!=="undefined"?checks:"n/a"};', sandbox);
  return { r: sandbox.__r, keys };
}

// 1. primo accesso: store vuoto
let t = run({});
console.log('vuoto:', JSON.stringify(t.r));
if (t.r.user !== null || JSON.stringify(t.r.favs) !== '{}' || JSON.stringify(t.r.trips) !== '[]') throw new Error('default errati');

// 2. store corrotto
t = run({ camperisti_user: '{bad', camperisti_favs: 'xxx', camperisti_trips: 'null', camperisti_checks: '"x"' });
console.log('corrotto:', JSON.stringify(t.r));
if (t.r.user !== null || JSON.stringify(t.r.favs) !== '{}' || JSON.stringify(t.r.trips) !== '[]') throw new Error('fallback corrotto errato');

// 3. tipi sbagliati (trips oggetto, favs array)
t = run({ camperisti_trips: '{"a":1}', camperisti_favs: '[1,2]' });
if (!Array.isArray(t.r.trips) || Array.isArray(t.r.favs)) throw new Error('tipi non sanificati');
console.log('tipi sanificati OK');

// 4. password demo rimosse
t = run({ 'camperisti_pw_a@x.it': 'demo:segreta' });
if ('camperisti_pw_a@x.it' in t.keys) throw new Error('password demo non rimossa');
console.log('cleanup password demo OK');

// 5. migrazione chiavi globali -> namespace
t = run({ camperisti_favs: '{"cam-01":"nota"}', camperisti_trips: '["cam-01"]' });
console.log('migrato:', JSON.stringify(t.r));
if (t.r.favs['cam-01'] !== 'nota' || t.r.trips[0] !== 'cam-01') throw new Error('migrazione fallita');
if (!t.keys.camperisti_migrated || 'camperisti_favs' in t.keys) throw new Error('flag/legacy errati');

// 6. resolveStops: solo ID espliciti, mai fuzzy
vm.runInContext('var DB=' + JSON.stringify({ lazio: [
  { id: 'a', nome: 'Il Guadetto', comune: 'Bolsena' },
  { id: 'b', nome: 'Area Roma Nord', comune: 'Roma' },
] }) + ';', vm.createContext({}));
const sb = { DB: { lazio: [
  { id: 'a', nome: 'Il Guadetto', comune: 'Bolsena' },
  { id: 'b', nome: 'Area Roma Nord', comune: 'Roma' },
] }, findItem: id => sb.DB.lazio.find(x => x.id === id) };
vm.createContext(sb);
vm.runInContext(matchCode, sb);
const m = vm.runInContext('resolveStops({regione:"lazio",stops:["a","inesistente","a"],extra:["Posto X (non in catalogo)"]})', sb);
console.log('resolve:', JSON.stringify(m));
if (m.found.join() !== 'a' || m.missing.join() !== 'Posto X (non in catalogo)') throw new Error('resolve errato');

console.log('BOOT-TEST-OK');
