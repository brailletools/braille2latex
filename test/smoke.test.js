import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { lex, parseWithTranslator, ascii2Braille, braille2Ascii, nemeth_to_latex, latex_to_nemeth } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '../bin/braille2latex.js');

test('ascii2Braille/braille2Ascii round-trip plain text', () => {
	const unicode = ascii2Braille('HELLO');
	assert.notEqual(unicode, 'HELLO', 'expected ASCII braille to convert to unicode braille cells');
	assert.equal(braille2Ascii(unicode), 'HELLO');
});

test('braille2Ascii does not leak the literal string "undefined" for unrecognized input', () => {
	// Regression test: Abraham's UnicodeBraille.toBrailleAscii() returns the literal
	// *string* "undefined" (not the JS value) for a line it can't back-translate —
	// e.g. a raw, un-converted ASCII character left in what's supposed to be a
	// Unicode-braille-only string. The old `?? line` fallback only catches JS
	// null/undefined, so this string sentinel passed straight through as if it were
	// real content, silently corrupting the document with the word "undefined".
	const raw = '+'; // not a Unicode braille character
	const result = braille2Ascii(raw);
	assert.notEqual(result, 'undefined');
	assert.equal(result, raw, 'unrecognized input should fall back to itself, not the string "undefined"');
});

test('nemeth_to_latex converts a simple digit', () => {
	const latex = nemeth_to_latex('#1');
	assert.equal(typeof latex, 'string');
	assert.notEqual(latex.trim(), '', 'expected non-empty LaTeX output for a simple Nemeth digit');
});

test('latex_to_nemeth converts simple math expressions (digits, fractions, radicals, superscripts, greek letters)', () => {
	const cases = ['x^2', '\\frac{1}{2}', '\\sqrt{x}', '3+4', '\\alpha', 'x_2^3'];
	for (const c of cases) {
		const braille = latex_to_nemeth(c);
		assert.equal(typeof braille, 'string');
		assert.notEqual(braille.trim(), '', `expected non-empty Nemeth braille for ${JSON.stringify(c)}`);
	}
});

test('latex_to_nemeth throws (does not silently pass through) on invalid/unbalanced LaTeX', () => {
	assert.throws(() => latex_to_nemeth('\\frac{1}{2'));
});

test('latex_to_nemeth returns empty string for empty input, matching nemeth_to_latex', () => {
	assert.equal(latex_to_nemeth(''), '');
});

test('lex() builds a ROOT > PARA > STRING tree for plain text', () => {
	const tree = lex('HELLO WORLD');
	assert.equal(tree.token, 'ROOT');
	assert.equal(tree.children.length, 1);
	assert.equal(tree.children[0].token, 'PARA');
});

test('lex() closes a NEMETH block opened mid-line via the word-based branch', () => {
	// Regression test: a NEMETH block that starts partway through a line (i.e. the
	// line itself begins in word-based/non-NEMETH mode, like "C\n_%ax = b_:" does)
	// must still recognize the closing "_:" marker. 
	const tree = lex('C\n_%ax = b_:');
	const para = tree.children[0];
	assert.equal(para.token, 'PARA');
	const nemeth = para.children.find((c) => c.token === 'NEMETH');
	assert.ok(nemeth, 'expected a NEMETH child');
	assert.equal(nemeth.value, 'ax =b', 'NEMETH value must not include the closing "_:" marker');

	// Content typed after the equation must land in a sibling node, not get
	// absorbed into the (never-closed) NEMETH block.
	const tree2 = lex('C\n_%ax = b_:\nmore text');
	const para2 = tree2.children[0];
	const nemeth2 = para2.children.find((c) => c.token === 'NEMETH');
	assert.equal(nemeth2.value, 'ax =b');
	assert.ok(
		para2.children.some((c) => c.token === 'STRING' && c.value?.includes('more')),
		'trailing text after the equation must be its own STRING sibling'
	);
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
