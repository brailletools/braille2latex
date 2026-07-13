import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DualDocument, ascii2Braille } from '../src/index.js';

// Identity stand-ins for liblouis, matching smoke.test.js's convention — these test
// the sync/splicing/range mechanics, not real braille orthography. Real liblouis
// translateString(..., backtranslate=false) returns ASCII-braille text directly
// (not Unicode braille glyphs), so the identity function is the right shape here —
// see the comment in DualDocument.applyLatexEdit's prose branch.
const identityTranslate = async (unicodeBraille) => unicodeBraille;
const identityTranslateForward = async (text) => text;

function makeDoc(text) {
	return DualDocument.fromBraille(text, {
		translate: identityTranslate,
		translateForward: identityTranslateForward
	});
}

test('fromBraille builds top-level nodes with contiguous latex ranges and separated braille ranges', async () => {
	const doc = await makeDoc('HELLO\n\nWORLD');
	assert.equal(doc.topLevelNodes.length, 2);
	const [a, b] = doc.topLevelNodes;
	assert.equal(doc.brailleText.slice(a.brailleRange.start, a.brailleRange.end), 'HELLO');
	assert.equal(doc.brailleText.slice(b.brailleRange.start, b.brailleRange.end), 'WORLD');
	assert.equal(a.latexRange.end, b.latexRange.start, 'latex ranges should be contiguous');
	assert.equal(doc.label(a), 'Paragraph 1');
	assert.equal(doc.label(b), 'Paragraph 2');
});

test('nodeAtBrailleOffset/nodeAtLatexOffset locate the right top-level node', async () => {
	const doc = await makeDoc('HELLO\n\nWORLD');
	const [a, b] = doc.topLevelNodes;
	assert.equal(doc.nodeAtBrailleOffset(2), a);
	assert.equal(doc.nodeAtBrailleOffset(a.brailleRange.end + 1), a, 'gap between paragraphs belongs to preceding node');
	assert.equal(doc.nodeAtBrailleOffset(b.brailleRange.start + 1), b);
	assert.equal(doc.nodeAtLatexOffset(a.latexRange.start), a);
	assert.equal(doc.nodeAtLatexOffset(b.latexRange.start), b);
});

test('applyBrailleEdit only re-derives the touched paragraph, leaves the sibling node untouched', async () => {
	const doc = await makeDoc('HELLO\n\nWORLD');
	const secondNodeBefore = doc.topLevelNodes[1];
	const newText = 'HELLO THERE\n\nWORLD';
	const result = await doc.applyBrailleEdit(newText, newText.indexOf('THERE') + 5);

	assert.equal(doc.brailleText, newText);
	assert.equal(doc.topLevelNodes.length, 2);
	assert.equal(doc.topLevelNodes[1], secondNodeBefore, 'sibling node identity preserved (not re-derived)');
	assert.equal(typeof result.latexText, 'string');
	assert.equal(typeof result.latexCursor, 'number');
	assert.equal(doc.errors.length, 0);
});

test('applyLatexEdit on an equation node round-trips through latex_to_nemeth and leaves siblings untouched', async () => {
	const doc = await makeDoc('HELLO\n\n_%3+4_:');
	assert.equal(doc.topLevelNodes.length, 2);
	assert.equal(doc.topLevelNodes[1].token, 'EQUATION');
	const firstNodeBefore = doc.topLevelNodes[0];

	const oldLatex = doc.latexText;
	const newLatex = oldLatex.replace('3+4', '5+6');
	const result = await doc.applyLatexEdit(newLatex, newLatex.indexOf('5+6') + 3);

	assert.equal(result.nodeError, null);
	assert.match(result.brailleText, /5/);
	assert.match(result.brailleText, /6/);
	assert.equal(doc.topLevelNodes[0], firstNodeBefore, 'sibling paragraph untouched by an equation edit');
	assert.equal(doc.errors.length, 0);
});

test('applyLatexEdit surfaces a parse error without corrupting the braille pane', async () => {
	const doc = await makeDoc('_%3+4_:');
	const oldBraille = doc.brailleText;
	const oldLatex = doc.latexText;
	const brokenLatex = oldLatex.replace('$3+4$', '$\\frac{1}{2$'); // unbalanced brace

	const result = await doc.applyLatexEdit(brokenLatex, brokenLatex.length);

	assert.notEqual(result.nodeError, null);
	assert.equal(result.brailleText, oldBraille, 'braille pane must be left untouched on failure');
	assert.equal(doc.errors.length, 1);
	assert.equal(doc.errors[0].pane, 'latex');
	assert.equal(doc.errors[0].label, 'Equation 1');
});

test('a subsequent successful edit clears a previously flagged error', async () => {
	const doc = await makeDoc('_%3+4_:');
	const oldLatex = doc.latexText;
	const broken = oldLatex.replace('$3+4$', '$\\frac{1}{2$');
	await doc.applyLatexEdit(broken, broken.length);
	assert.equal(doc.errors.length, 1);

	const fixed = broken.replace('$\\frac{1}{2$', '$\\frac{1}{2}$');
	const result = await doc.applyLatexEdit(fixed, fixed.length);

	assert.equal(result.nodeError, null);
	assert.equal(doc.errors.length, 0);
});

test('applyLatexEdit spanning multiple top-level nodes is flagged, not silently corrupted', async () => {
	const doc = await makeDoc('HELLO\n\nWORLD');
	const oldLatex = doc.latexText;
	const oldBraille = doc.brailleText;
	const spanStart = doc.topLevelNodes[0].latexRange.start + 1;
	const spanEnd = doc.topLevelNodes[1].latexRange.start + 1;
	const spanningEdit = oldLatex.slice(0, spanStart) + 'XX' + oldLatex.slice(spanEnd);

	const result = await doc.applyLatexEdit(spanningEdit, spanStart + 2);

	assert.notEqual(result.nodeError, null);
	assert.equal(result.brailleText, oldBraille, 'braille pane left untouched when an edit spans multiple nodes');
	assert.ok(doc.errors.length >= 1);
});

test('applyLatexEdit forward-translates a prose paragraph via an injected translateForward', async () => {
	const doc = await makeDoc('HELLO');
	const oldLatex = doc.latexText;
	const newLatex = oldLatex + ' MORE';
	const result = await doc.applyLatexEdit(newLatex, newLatex.length);

	assert.equal(result.nodeError, null);
	assert.ok(result.brailleText.length > 0);
	assert.equal(doc.errors.length, 0);
});

test('applyLatexEdit on a PARA with markup preserves an untouched sibling child\'s braille verbatim (braille2latex#19)', async () => {
	// Non-identity translateForward, tracking every call it receives: the existing
	// identityTranslateForward can't distinguish "preserved" from "regenerated-
	// identically" since it just echoes its input back unchanged.
	const forwardCalls = [];
	const trackingTranslateForward = async (text) => {
		forwardCalls.push(text);
		return text + 'X';
	};

	const doc = await DualDocument.fromBraille('_.CAN_. DOG', {
		translate: identityTranslate,
		translateForward: trackingTranslateForward
	});
	const para = doc.topLevelNodes[0];
	assert.equal(para.token, 'PARA');
	assert.equal(para.childRangesReliable, true, 'sanity check: this fixture must hit the new splice path');
	const [bold, string] = para.children;
	assert.equal(bold.token, 'BOLD');
	assert.equal(string.token, 'STRING');

	// Edit entirely inside the STRING("DOG") child's latex range, nowhere near BOLD.
	const oldLatex = doc.latexText;
	const insertAt = string.latexRange.end;
	const newLatex = oldLatex.slice(0, insertAt) + 'Z' + oldLatex.slice(insertAt);

	const result = await doc.applyLatexEdit(newLatex, insertAt + 1);

	assert.equal(result.nodeError, null);
	// The BOLD("CAN") child's raw braille bytes must be byte-identical to before —
	// proof it was preserved verbatim, not silently re-forward-translated.
	assert.equal(result.brailleText.startsWith('_.CAN_.'), true);
	// Forward translation must never even be *called* with the untouched BOLD
	// child's content — a stronger check than just inspecting the final output.
	assert.equal(forwardCalls.length, 1);
	assert.equal(forwardCalls[0].includes(ascii2Braille('CAN')), false);
});

test('applyLatexEdit deletes a whole Nemeth segment atomically, leaving no orphaned marker or touching the sibling STRING', async () => {
	// Reuses the existing mixed-prose+equation fixture ('C\n_%ax = b_:', a PARA
	// with STRING + NEMETH siblings — see the test below). Deleting the entire
	// math segment must not leave a dangling "_%"/"_:" half of a contraction/
	// block marker, and must not touch the untouched STRING("C") sibling.
	const doc = await makeDoc('C\n_%ax = b_:');
	const para = doc.topLevelNodes[0];
	assert.equal(para.childRangesReliable, true, 'sanity check: this fixture must hit the new splice path');
	const [stringChild, nemethChild] = para.children;
	assert.equal(stringChild.token, 'STRING');
	assert.equal(nemethChild.token, 'NEMETH');

	const oldLatex = doc.latexText;
	const newLatex = oldLatex.slice(0, nemethChild.latexRange.start) + oldLatex.slice(nemethChild.latexRange.end);

	const result = await doc.applyLatexEdit(newLatex, nemethChild.latexRange.start);

	assert.equal(result.nodeError, null);
	assert.doesNotMatch(result.brailleText, /_%/, 'no orphaned Nemeth-open marker after deleting the whole math segment');
	assert.doesNotMatch(result.brailleText, /_:/, 'no orphaned Nemeth-close marker after deleting the whole math segment');
	assert.match(result.brailleText, /^C/, 'STRING sibling\'s braille must be untouched by the deletion');
});

test('applyLatexEdit falls back to whole-node regeneration when childRangesReliable is false, without corrupting anything', async () => {
	// 'abc_.bold_.' hits a separate, pre-existing lexer quirk (a BOLD marker
	// landing directly against a word with no space nests it under the STRING
	// node instead of as a PARA sibling), which the marker-only scanner can't
	// predict — see the equivalent lex()-level test in smoke.test.js. This proves
	// the *edit* path degrades safely too, not just the scan/flag itself.
	const doc = await makeDoc('abc_.bold_.');
	const para = doc.topLevelNodes[0];
	assert.equal(para.token, 'PARA');
	assert.equal(para.childRangesReliable, false, 'sanity check: this fixture must hit the fallback path');

	const oldLatex = doc.latexText;
	const newLatex = oldLatex + ' MORE';
	const result = await doc.applyLatexEdit(newLatex, newLatex.length);

	assert.equal(result.nodeError, null);
	assert.ok(result.brailleText.length > 0);
	assert.equal(doc.errors.length, 0);
});

test('applyLatexEdit on a mixed prose+equation paragraph translates each segment through the right pipeline', async () => {
	// A word followed by inline math on the same line ("C\n_%ax = b_:") produces a
	// single PARA node with STRING + NEMETH siblings, NOT a pure EQUATION node —
	// this is the common case for real documents (see Sample Quiz.brf), not an edge
	// case. Editing this node's latex must not forward-translate the literal "$"/"\"
	// math syntax as if it were plain prose.
	const doc = await makeDoc('C\n_%ax = b_:');
	assert.equal(doc.topLevelNodes.length, 1);
	assert.equal(doc.topLevelNodes[0].token, 'PARA', 'mixed prose+math paragraphs are not promoted to EQUATION');

	const oldLatex = doc.latexText;
	const newLatex = oldLatex.replace('ax\\ =b', 'ax\\ =a+b');
	const result = await doc.applyLatexEdit(newLatex, newLatex.length);

	assert.equal(result.nodeError, null);
	// The math segment must go through latex_to_nemeth (producing real Nemeth
	// braille markers), not liblouis forward-translation of the raw LaTeX text.
	assert.match(result.brailleText, /_%/, 'expected a Nemeth block marker in the reconstructed braille');
	assert.doesNotMatch(result.brailleText.toLowerCase(), /undefined/);
});
