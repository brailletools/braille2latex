import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { lex, parseWithTranslator, ascii2Braille, braille2Ascii, nemeth_to_latex } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '../bin/braille2latex.js');

test('ascii2Braille/braille2Ascii round-trip plain text', () => {
	const unicode = ascii2Braille('HELLO');
	assert.notEqual(unicode, 'HELLO', 'expected ASCII braille to convert to unicode braille cells');
	assert.equal(braille2Ascii(unicode), 'HELLO');
});

test('nemeth_to_latex converts a simple digit', () => {
	const latex = nemeth_to_latex('#1');
	assert.equal(typeof latex, 'string');
	assert.notEqual(latex.trim(), '', 'expected non-empty LaTeX output for a simple Nemeth digit');
});

test('lex() builds a ROOT > PARA > STRING tree for plain text', () => {
	const tree = lex('HELLO WORLD');
	assert.equal(tree.token, 'ROOT');
	assert.equal(tree.children.length, 1);
	assert.equal(tree.children[0].token, 'PARA');
});

test('parseWithTranslator() converts plain text to LaTeX without needing liblouis installed', async () => {
	// Identity translator stands in for a real back-translation backend (liblouis WASM or
	// lou_translate) — this is the same shape of call the CLI makes, and is the smoke test
	// that would have caught the previous bug where importing this module at all required
	// the `liblouis` peer dependency to be installed, even for callers who never use it.
	const identityTranslate = async (unicodeBraille) => unicodeBraille;
	const latex = await parseWithTranslator('HELLO WORLD', 'en-ueb-g2.ctb', identityTranslate);
	assert.equal(typeof latex, 'string');
	assert.notEqual(latex.trim(), '');
});

test('CLI converts a .brf file to output without crashing', () => {
	const fixture = path.join(__dirname, 'fixture.brf');
	writeFileSync(fixture, 'HELLO WORLD\n');
	try {
		const output = execFileSync('node', [cliPath, fixture, '--braille-only'], { encoding: 'utf8' });
		assert.notEqual(output.trim(), '');
	} finally {
		unlinkSync(fixture);
	}
});
