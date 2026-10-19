// Offline TTML. Match XML namespace URIs and per-line keys, never prefixes
// or visible lyric text. Browser and Node consumers share the same DOM API.
const TTML_NS = 'http://www.w3.org/ns/ttml';
const TTM_NS = 'http://www.w3.org/ns/ttml#metadata';
const ITUNES_NS = 'http://music.apple.com/lyric-ttml-internal';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const TTP_NS = 'http://www.w3.org/ns/ttml#parameter';

function parseDocument(source) {
  if (!/<(?:[\w.-]+:)?tt(?:\s|>)/i.test(String(source || ''))) return null;
  let invalid = false;
  const Parser = typeof DOMParser === 'function' ? DOMParser : require('@xmldom/xmldom').DOMParser;
  try {
    const parser = new Parser({ errorHandler: {
      warning() {}, error() { invalid = true; }, fatalError() { invalid = true; }
    } });
    const doc = parser.parseFromString(String(source).replace(/^\uFEFF/, ''), 'application/xml');
    const root = doc.documentElement;
    if (invalid || !root || root.localName !== 'tt' ||
        (root.namespaceURI && root.namespaceURI !== TTML_NS) || doc.getElementsByTagName('parsererror').length) return null;
    return doc;
  } catch { return null; }
}

function elements(node, namespace, name) {
  return Array.from(node.getElementsByTagNameNS(namespace, name));
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseAttributes(source) {
  return Object.fromEntries([...String(source || '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map(match => [match[1], decodeEntities(match[2] ?? match[3] ?? '')]));
}

function parseTime(value, frameRate = 24) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let match = text.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  match = text.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  match = text.match(/^(\d+(?:\.\d+)?)(h|ms|s|f)?$/i);
  if (!match) return null;
  const unit = (match[2] || 's').toLowerCase();
  return Number(match[1]) * ({ h: 3600, ms: .001, s: 1, f: 1 / (Number(frameRate) || 24) })[unit];
}

const visibleText = value => String(value || '').replace(/\s+/g, ' ').trim();

function parseTranslationTable(source, elementName = 'translation') {
  const doc = typeof source === 'string' ? parseDocument(source) : source;
  const table = new Map();
  if (!doc) return table;
  const name = elementName.split(':').pop();
  for (const block of elements(doc, ITUNES_NS, name)) {
    if (name === 'translation' && block.getAttribute('type') === 'replacement') continue;
    const language = (block.getAttributeNS(XML_NS, 'lang') || '').toLowerCase();
    if (!language) continue;
    const entries = table.get(language) || new Map();
    for (const entry of elements(block, ITUNES_NS, 'text')) {
      const key = entry.getAttribute('for'), text = visibleText(entry.textContent);
      if (key && text) entries.set(key, text);
    }
    table.set(language, entries);
  }
  return table;
}

function parseAgents(source) {
  const doc = typeof source === 'string' ? parseDocument(source) : source;
  const agents = new Map();
  if (doc) for (const node of elements(doc, TTM_NS, 'agent')) {
    const id = node.getAttributeNS(XML_NS, 'id') || node.getAttribute('id');
    if (id) agents.set(id, { id, type: node.getAttribute('type') || 'person',
      names: elements(node, TTM_NS, 'name').map(name => visibleText(name.textContent)).filter(Boolean) });
  }
  return agents;
}

function parseParagraph(node, start, readTime) {
  const main = [], background = [];
  function walk(parent, target, cursor, timed = false, explicitEnd = null) {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        const text = String(child.nodeValue || '').replace(/\s+/g, ' ');
        if (!text.trim()) {
          if (target.length && !/\s$/.test(target[target.length - 1].text)) target[target.length - 1].text += ' ';
        } else {
          target.push({ start: cursor, end: explicitEnd, text, ...(!timed ? { approximate: true } : {}) });
        }
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (child.localName === 'br') {
        if (target.length) target[target.length - 1].text += ' ';
        continue;
      }
      const begin = readTime(child.getAttribute('begin'));
      const duration = readTime(child.getAttribute('dur'));
      const end = readTime(child.getAttribute('end')) ?? (duration !== null ? (begin ?? cursor) + duration : null);
      const role = child.getAttributeNS(TTM_NS, 'role') || child.getAttribute('role');
      walk(child, role === 'x-bg' ? background : target, begin ?? cursor, timed || begin !== null, end);
      cursor = end ?? begin ?? cursor;
    }
  }
  walk(node, main, start);
  for (const words of [main, background]) {
    if (words.length) {
      words[0].text = words[0].text.trimStart();
      words[words.length - 1].text = words[words.length - 1].text.trimEnd();
    }
  }
  return { main, background };
}

function parseTtml(source) {
  const doc = parseDocument(source);
  if (!doc) return null;
  const root = doc.documentElement;
  const frameRate = Number(root.getAttributeNS(TTP_NS, 'frameRate')) || 24;
  const aliases = new Map();
  for (const node of elements(doc, TTM_NS, 'time')) {
    const id = node.getAttributeNS(XML_NS, 'id'), value = parseTime(node.getAttribute('value'), frameRate);
    if (id && value !== null) aliases.set(id, value);
  }
  const readTime = value => aliases.has(value) ? aliases.get(value) : parseTime(value, frameRate);
  const translations = parseTranslationTable(doc, 'translation');
  const pronunciations = parseTranslationTable(doc, 'transliteration');
  const agents = parseAgents(doc), sides = new Map();
  let people = 0;
  for (const [id, agent] of agents) if (agent.type === 'person') sides.set(id, people++ === 0 ? 'left' : 'right');
  const lines = [];
  for (const paragraph of elements(doc, root.namespaceURI || null, 'p')) {
    const start = readTime(paragraph.getAttribute('begin'));
    if (start === null) continue;
    const duration = readTime(paragraph.getAttribute('dur'));
    const end = readTime(paragraph.getAttribute('end')) ?? (duration !== null ? start + duration : null);
    const parsed = parseParagraph(paragraph, start, readTime);
    const text = visibleText(parsed.main.map(word => word.text).join(''));
    if (!text) continue;
    const fallbackEnd = end ?? start + Math.max(.6, Math.min(12, [...text].length * .28));
    const finishWords = words => words.filter(word => word.text).map((word, index) => ({
      ...word, end: word.end ?? words[index + 1]?.start ?? fallbackEnd
    }));
    const native = parsed.main.some(word => !word.approximate);
    const line = { start, end, text, words: native ? finishWords(parsed.main) : [] };
    if (parsed.background.length) line.subline = {
      text: visibleText(parsed.background.map(word => word.text).join('')), words: finishWords(parsed.background)
    };
    const key = paragraph.getAttributeNS(ITUNES_NS, 'key') || paragraph.getAttribute('key');
    for (const [table, field] of [[translations, 'translations'], [pronunciations, 'pronunciation']]) {
      const values = [...table].filter(([, entries]) => entries.has(key)).map(([language, entries]) => [language, entries.get(key)]);
      if (values.length) line[field] = Object.fromEntries(values);
    }
    line.alignment = sides.get(paragraph.getAttributeNS(TTM_NS, 'agent') || paragraph.getAttribute('agent')) || 'unspecified';
    lines.push(line);
  }
  if (!lines.length) return null;
  const writers = [...new Set(elements(doc, ITUNES_NS, 'songwriter').map(node => visibleText(node.textContent)).filter(Boolean))];
  return { format: 'ttml', lines, ...(writers.length ? { writers } : {}) };
}

function hasNativeWordTiming(text) {
  return Boolean(parseTtml(text)?.lines.some(line => line.words.some(word => !word.approximate)));
}

const TTML_API = { parseTtml, parseTime, parseAttributes, parseTranslationTable, parseAgents, decodeEntities, hasNativeWordTiming };
if (typeof module === 'object' && module.exports) module.exports = TTML_API;
if (typeof window !== 'undefined') window.MedoTtml = TTML_API;
