import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { lex } from '../src/index.js';

// Real back-translation via lou_translate (not the identity stand-in used
// elsewhere) -- these tests are specifically probing realistic documents
// where BOLD/ITALIC/NEMETH markers appear *after* plain text within the same
// paragraph, a pattern the identity-translate unit tests don't exercise
// clearly since they mostly use single-word fixtures. Skips cleanly if
// lou_translate isn't installed in this environment.
let louTranslatePath = null;
try {
	const { resolveLouTranslate } = await import('@brailletools/liblouis-env');
	louTranslatePath = resolveLouTranslate();
} catch {
	// @brailletools/liblouis-env not resolvable in this environment; tests
	// below fall back to an identity translate (still exercises the *tree
	// structure*, just not real contraction behavior).
}

async function translate(unicodeBraille, table) {
	if (!louTranslatePath) return unicodeBraille;
	// Strip only a trailing newline, not all trailing whitespace -- a trailing
	// space can be meaningful content (see bin/braille-bridge.js's translate()
	// for the full explanation).
	return execFileSync(louTranslatePath, ['--backward', table], {
		input: unicodeBraille,
		encoding: 'utf8'
	}).replace(/\r?\n+$/, '');
}

test('a BOLD span following plain text in the same paragraph is a PARA-level sibling, not nested under STRING', async () => {
	// "hello _.WORLD_. there" -- WORLD is bold, and comes after "hello " has
	// already opened a STRING node. Before the fix, the BOLD marker nested as a
	// CHILD of that STRING node (to_latex()'s STRING case never recurses into
	// .children, so the whole word vanished). applyMarker() now closes STRING
	// before opening BOLD, so BOLD is a sibling instead.
	const tree = lex('hello _.WORLD_. there');
	const para = tree.children[0];
	assert.equal(para.children.length, 3, 'STRING("hello "), BOLD("world"), STRING(" there")');
	assert.equal(para.children[0].token, 'STRING');
	assert.equal(para.children[1].token, 'BOLD');
	assert.equal(para.children[2].token, 'STRING');

	const latex = await tree.to_latex('en-ueb-g2.ctb', translate);
	assert.match(latex, /\\textbf\{[^}]*\}/, 'bold content must survive, wrapped in \\textbf{}');
	assert.match(latex, /hello.*\\textbf\{[^}]*\}.*there/s, 'plain text on both sides must survive too');
});

test('an ITALIC span following plain text in the same paragraph is a PARA-level sibling, not nested under STRING', async () => {
	const tree = lex('hello _/WORLD_/ there');
	const para = tree.children[0];
	assert.equal(para.children.length, 3);
	assert.equal(para.children[1].token, 'ITALIC');

	const latex = await tree.to_latex('en-ueb-g2.ctb', translate);
	assert.match(latex, /\\textit\{[^}]*\}/, 'italic content must survive, wrapped in \\textit{}');
});

test('a BOLD span at the very end of a paragraph (nothing after it) survives', async () => {
	const tree = lex('hello _.WORLD_.');
	const para = tree.children[0];
	assert.equal(para.children.length, 2, 'STRING("hello "), BOLD("world")');

	const latex = await tree.to_latex('en-ueb-g2.ctb', translate);
	assert.match(latex, /\\textbf\{[^}]*\}/, 'trailing bold content must survive');
});

test('a space appears between a leading BOLD/ITALIC span and the text that follows it', async () => {
	// "_.HELLO_. world" -- BOLD is first in the paragraph, so it was already a
	// correct PARA-level sibling even before the fix -- but the space between
	// it and the next word used to be silently lost (the trailing-space check
	// only fired for currentToken types STRING/NEMETH/BOLD/ITALIC, and
	// immediately after a span closes, currentToken is back to PARA).
	const tree = lex('_.HELLO_. world');
	const latex = await tree.to_latex('en-ueb-g2.ctb', translate);
	assert.match(latex, /\\textbf\{[^}]*\} \S/, 'a space must separate the bold span from "world"');
});

test('two marker spans back-to-back, separated only by whitespace in the source, both survive with a separator', async () => {
	const tree = lex('_.BOLD_. _/ITALIC_/');
	const para = tree.children[0];
	assert.equal(para.children.length, 2);
	assert.equal(para.children[0].token, 'BOLD');
	assert.equal(para.children[1].token, 'ITALIC');

	const latex = await tree.to_latex('en-ueb-g2.ctb', translate);
	assert.match(latex, /\\textbf\{[^}]*\}/);
	assert.match(latex, /\\textit\{[^}]*\}/);
});

test('ITALIC nested inside BOLD is preserved as a child span, not dropped', async () => {
	const tree = lex('_.bold _/and italic_/ together_.');
	const para = tree.children[0];
	assert.equal(para.children.length, 1);
	assert.equal(para.children[0].token, 'BOLD');
	const nestedItalic = para.children[0].children.find((c) => c.token === 'ITALIC');
	assert.ok(nestedItalic, 'ITALIC must appear as a child of the enclosing BOLD span');

	const latex = await tree.to_latex('en-ueb-g2.ctb', translate);
	assert.match(latex, /\\textbf\{[^}]*\\textit\{[^}]*\}[^}]*\}/, 'ITALIC must be nested inside \\textbf{}');
});

test('Reference (currently passing): plain, unmarked multi-word paragraphs are unaffected', async () => {
	// Included so the rewrite's regression risk is visible against a known-good
	// baseline of ordinary text, not just the previously-broken cases above.
	const tree = lex('hello there friend');
	const para = tree.children[0];
	assert.equal(para.children.length, 1);
	assert.equal(para.children[0].token, 'STRING');
});
