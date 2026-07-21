import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lex, ascii2Braille, braille2Ascii, nemeth_to_latex, latex_to_nemeth } from '../src/index.js';

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
	// 'ax = b' preserves the source's literal spacing (matches what the dedicated
	// character-by-character NEMETH branch would produce for the same content) —
	// not 'ax =b'. 
	assert.equal(nemeth.value, 'ax = b', 'NEMETH value must not include the closing "_:" marker');

	// Content typed after the equation must land in a sibling node, not get
	// absorbed into the (never-closed) NEMETH block.
	const tree2 = lex('C\n_%ax = b_:\nmore text');
	const para2 = tree2.children[0];
	const nemeth2 = para2.children.find((c) => c.token === 'NEMETH');
	assert.equal(nemeth2.value, 'ax = b');
	assert.ok(
		para2.children.some((c) => c.token === 'STRING' && c.value?.includes('more')),
		'trailing text after the equation must be its own STRING sibling'
	);
});

test('lex() inserts a space at a line wrap within a paragraph instead of fusing words', () => {
	// Regression test: a single '\n' inside a paragraph (as opposed to the '\n\n'
	// that marks an actual paragraph break) is a line wrap -- e.g. one line per
	// row of OCR-detected braille cells. Previously the wrap contributed no
	// separator at all, so "require\nwaiting" rendered as "requirewaiting".
	const tree = lex('require\nwaiting');
	const para = tree.children[0];
	assert.equal(para.children.length, 1);
	assert.equal(para.children[0].value, 'require waiting');

	// A real paragraph break (blank line) must still NOT gain an extra space --
	// that boundary already becomes a new PARA, not a joined run.
	const tree2 = lex('first para\n\nsecond para');
	assert.equal(tree2.children.length, 2);
	assert.equal(tree2.children[0].children[0].value, 'first para');
	assert.equal(tree2.children[1].children[0].value, 'second para');
});

test('lex() does not drop a single-character word after the first word/run in a paragraph', () => {
	// Regression test for braille2latex#20: a single-character word (e.g. "a")
	// occurring anywhere after the first word/run used to get nested as a *child*
	// of the current STRING node instead of merging into it — and to_latex()'s
	// STRING case never recurses into .children, so the word silently vanished
	// from the rendered output.
	const tree = lex('I have a big dog');
	const para = tree.children[0];
	assert.equal(para.children.length, 1, 'all words on one unmarked line merge into a single STRING run');
	assert.equal(para.children[0].value, 'I have a big dog');
});

test('lex() keeps correct spacing around a single-character word inside a BOLD run', () => {
	// Regression test for braille2latex#20's secondary symptom: the old special
	// case for single-character words returned early inside BOLD/ITALIC runs,
	// skipping the trailing-space append every other word gets — gluing the next
	// word directly onto it (e.g. "big a dog" rendered as "big adog").
	const tree = lex('_.big a dog_.');
	const para = tree.children[0];
	const bold = para.children.find((c) => c.token === 'BOLD');
	assert.ok(bold, 'expected a BOLD child');
	assert.equal(bold.value, 'big a dog');
});

test('lex() marks childRangesReliable and stamps correct per-child brailleRange for markup-separated runs', () => {
	const tree = lex('_.CAN_. DOG');
	const para = tree.children[0];
	assert.equal(para.childRangesReliable, true);
	assert.equal(para.children.length, 2);

	const [bold, string] = para.children;
	assert.equal(bold.token, 'BOLD');
	assert.equal(string.token, 'STRING');
	assert.equal(para.brailleRange.start, 0);
	const paraRaw = '_.CAN_. DOG';
	assert.equal(paraRaw.slice(bold.brailleRange.start, bold.brailleRange.end), '_.CAN_.');
	assert.equal(paraRaw.slice(string.brailleRange.start, string.brailleRange.end), ' DOG');
});

test('lex() marks childRangesReliable for a plain unmarked paragraph too', () => {
	// Depends on braille2latex#20's fix: before that fix, "I have a big dog" split
	// into two top-level STRING children ("I " and "have big dog", with "a" dropped
	// silently in between) which the marker-only scanner — correctly — wouldn't have
	// predicted, so this would have been unreliable rather than a real coverage gain.
	const tree = lex('I have a big dog');
	const para = tree.children[0];
	assert.equal(para.childRangesReliable, true);
	assert.equal(para.children.length, 1);
	assert.equal(para.children[0].brailleRange.start, 0);
	assert.equal(para.children[0].brailleRange.end, 'I have a big dog'.length);
});

test('lex() falls back to childRangesReliable = false when the marker-only scan cannot match the real tree', () => {
	// "_%3+4_:more" hits a separate, pre-existing lexer quirk: content immediately
	// following a closing "_:" with no space lands in the (never-rendered) PARA
	// node's own .value instead of becoming a sibling child — so the real tree has
	// only one top-level child (the NEMETH node) while the marker-only scanner,
	// which has no way to know about that quirk, predicts two spans (nemeth + the
	// trailing text). The mismatch must be caught, not guessed through.
	const tree = lex('_%3+4_:more');
	const para = tree.children[0];
	assert.equal(para.children.length, 1, 'sanity check: the dropped-text quirk really does produce only one child here');
	assert.equal(para.childRangesReliable, false);
	assert.equal(para.children[0].brailleRange, null, 'brailleRange must be left unset, not a guessed value');
});

test('lex()/to_latex() converts plain text to LaTeX without needing liblouis installed', async () => {
	// Identity translator stands in for a real back-translation backend (liblouis
	// WASM) — this is the smoke test that would have caught the previous bug
	// where importing this module at all required the `liblouis` peer dependency
	// to be installed, even for callers who never use it.
	const identityTranslate = async (unicodeBraille) => unicodeBraille;
	const latex = await lex('HELLO WORLD').to_latex('en-ueb-g2.ctb', identityTranslate);
	assert.equal(typeof latex, 'string');
	assert.notEqual(latex.trim(), '');
});
