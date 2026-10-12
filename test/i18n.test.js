// Every text the user reads exists in English, French, German and Spanish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES, MESSAGES, t } from '../src/i18n.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const docs = Object.fromEntries(
  await Promise.all(
    LANGUAGES.map(async (language) => [language, await read(`../docs/${language}.md`)]),
  ),
);

/** Every multi-language object of a JSON tree, with its path. */
function* multiLanguage(value, path = '$') {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      yield* multiLanguage(item, `${path}[${index}]`);
    }
  } else if (value && typeof value === 'object') {
    if (typeof value.en === 'string') {
      yield [path, value];
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      yield* multiLanguage(child, `${path}.${key}`);
    }
  }
}

test('every multi-language text of the manifest has the four languages', () => {
  let count = 0;
  for (const [path, text] of multiLanguage(manifest)) {
    count += 1;
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), path);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
  assert.ok(count > 100, 'the walk sees the whole manifest');
});

test('no plain string where the manifest expects a translated text', () => {
  const translatable = ['label', 'description', 'placeholder'];
  const walk = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (translatable.includes(key) && path !== '$') {
          assert.equal(typeof child, 'object', `${path}.${key} must be { en, fr, de, es }`);
        }
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(manifest, '$');
});

test('widget labels hold 3 to 30 characters in every language', () => {
  for (const widget of manifest.widgets) {
    for (const [language, label] of Object.entries(widget.label)) {
      assert.ok(label.length >= 3 && label.length <= 30, `${widget.key}.${language}: "${label}"`);
    }
  }
});

test('runtime messages have the four languages and the same placeholders', () => {
  for (const [key, message] of Object.entries(MESSAGES)) {
    assert.deepEqual(Object.keys(message).sort(), [...LANGUAGES].sort(), key);
    const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const language of LANGUAGES) {
      assert.deepEqual(
        placeholders(message[language]),
        placeholders(message.en),
        `${key}.${language}`,
      );
    }
  }
  assert.deepEqual(t('scanDone', { count: 3 }), {
    en: '3 device(s) found.',
    fr: '3 appareil(s) trouvé(s).',
    de: '3 Gerät(e) gefunden.',
    es: '3 dispositivo(s) encontrado(s).',
  });
});

test('transport messages fit the 200 characters of the badge tooltip', () => {
  for (const key of ['transportKeyMissing', 'transportLocalLost']) {
    for (const text of Object.values(MESSAGES[key])) {
      assert.ok(text.length <= 200);
    }
  }
});

test('the four user docs exist, share the same structure and hold over 300 characters', () => {
  const headings = (markdown) =>
    markdown
      .split('\n')
      .filter((line) => /^#{1,3} /.test(line))
      .map((line) => line.match(/^#+/)[0].length);
  for (const language of LANGUAGES) {
    assert.ok(docs[language].length > 300, `docs/${language}.md is too short`);
    assert.deepEqual(headings(docs[language]), headings(docs.en), `docs/${language}.md structure`);
  }
});

test('the docs use absolute image URLs (the store re-hosts them)', () => {
  for (const language of LANGUAGES) {
    for (const [, url] of docs[language].matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      assert.match(url, /^https:\/\/raw\.githubusercontent\.com\//, `docs/${language}.md: ${url}`);
    }
  }
});
