import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DualDocument } from '../src/index.js';

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
