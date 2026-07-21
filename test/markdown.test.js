import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DualDocument, ascii2Braille } from '../src/index.js';

// Same identity stand-ins as document.test.js — these exercise the sync/parsing
// mechanics, not real braille orthography. translate() echoes unicode braille
// back unchanged (not real back-translation), so rendered LaTeX/Markdown prose
// contains unicode-braille glyphs, not the original print text — assertions
// below account for that (see document.test.js's comment on identityTranslate).
const identityTranslate = async (unicodeBraille) => unicodeBraille;
const identityTranslateForward = async (text) => text;

function makeDoc(text) {
	return DualDocument.fromBraille(text, {
		translate: identityTranslate,
		translateForward: identityTranslateForward
	});
}

function makeMarkdownDoc(text) {
	return DualDocument.fromMarkdown(text, {
		translate: identityTranslate,
		translateForward: identityTranslateForward
	});
}

test('renderMarkdown() renders a plain paragraph and is not auto-updated by applyBrailleEdit', async () => {
	const doc = await makeDoc('HELLO WORLD');
	assert.equal(doc.markdownText, '', 'markdown must not be eagerly rendered by fromBraille()');

	const first = await doc.renderMarkdown();
	assert.ok(first.includes(ascii2Braille('HELLO')));

	// Editing braille must not silently re-render markdown -- it's lazy, only
	// LaTeX is kept eagerly in sync (see the module's "Round-trip fidelity"
	// design notes).
	await doc.applyBrailleEdit('HELLO WORLD MORE', 'HELLO WORLD MORE'.length);
	assert.equal(doc.markdownText, first, 'markdown must stay stale until renderMarkdown() is called again');

	const second = await doc.renderMarkdown();
	assert.ok(second.includes(ascii2Braille('MORE')), 'a fresh renderMarkdown() call must reflect the latest braille');
});

test('to_markdown() renders BOLD as ** and ITALIC as * markers', async () => {
	// Marker-word-then-plain-word order (matching document.test.js's proven
	// '_.CAN_. DOG' fixture) keeps BOLD/ITALIC as the PARA's own direct child
	// rather than nesting under a still-open STRING sibling — a separate,
	// pre-existing lexer characteristic unrelated to Markdown rendering, not
	// something this test is meant to exercise.
	const boldDoc = await makeDoc('_.CAN_. DOG');
	const boldMd = await boldDoc.renderMarkdown();
	assert.match(boldMd, /\*\*[^*]+\*\*/, 'expected a **...** bold span');

	const italicDoc = await makeDoc('_/RUN_/ FAST');
	const italicMd = await italicDoc.renderMarkdown();
	assert.match(italicMd, /(?<!\*)\*[^*]+\*(?!\*)/, 'expected a *...* italic span');
});

test('to_markdown() renders NEMETH as $...$ inline math, same delimiters as LaTeX', async () => {
	const doc = await makeDoc('C\n_%ax = b_:');
	const md = await doc.renderMarkdown();
	assert.match(md, /\$[^$]+\$/);
});

test('fromMarkdown() parses bold/italic/math into distinct node types', async () => {
	const doc = await makeMarkdownDoc('plain **bold** and *italic* and $x+1$ end');
	assert.equal(doc.errors.length, 0);
	const [para] = doc.topLevelNodes;
	assert.equal(para.token, 'PARA');
	const tokenTypes = para.children.map((c) => c.token);
	assert.ok(tokenTypes.includes('BOLD'));
	assert.ok(tokenTypes.includes('ITALIC'));
	assert.ok(tokenTypes.includes('NEMETH'));
	assert.match(doc.brailleText, /_\.[^_]*_\./, 'bold should be wrapped in braille BOLD markers');
	assert.match(doc.brailleText, /_%[^_]*_:/, 'math should be wrapped in braille NEMETH markers');
});

test('fromMarkdown() promotes a paragraph that is only math to an EQUATION node', async () => {
	const doc = await makeMarkdownDoc('$x+1$');
	assert.equal(doc.topLevelNodes.length, 1);
	assert.equal(doc.topLevelNodes[0].token, 'EQUATION');
});

test('fromMarkdown() on a plain paragraph eagerly populates latexText (fromBraille()-equivalent contract)', async () => {
	const doc = await makeMarkdownDoc('plain text');
	assert.notEqual(doc.latexText, '', 'fromMarkdown() must eagerly render LaTeX once, like fromBraille() does');
});

test('fromMarkdown() never drops an unrecognized block-level construct (e.g. a heading) — translates it literally and flags it', async () => {
	const doc = await makeMarkdownDoc('# A Heading\n\nplain text');
	assert.equal(doc.topLevelNodes.length, 2);
	assert.equal(doc.errors.length, 1, 'exactly the heading paragraph should be flagged');
	assert.equal(doc.errors[0].pane, 'markdown');
	assert.match(doc.brailleText, /Heading/, 'heading text must survive translation, not be stripped (identity forward here)');
	assert.match(doc.brailleText, /plain text$/, 'the second, ordinary paragraph must parse normally');
});

test('fromMarkdown() falls back to literal translation, flagged, when math fails to parse', async () => {
	const doc = await makeMarkdownDoc('before $\\frac{1}{2$ after'); // unbalanced brace
	assert.equal(doc.errors.length, 1);
	assert.equal(doc.errors[0].pane, 'markdown');
	assert.doesNotMatch(doc.brailleText, /_%/, 'invalid math must not produce a dangling Nemeth marker');
});

test('fromMarkdown() retains each top-level node\'s original source slice (round-trip-fidelity groundwork)', async () => {
	const doc = await makeMarkdownDoc('first paragraph\n\nsecond paragraph');
	assert.equal(doc.topLevelNodes[0].importedSource, 'first paragraph');
	assert.equal(doc.topLevelNodes[1].importedSource, 'second paragraph');
});

test('applyMarkdownEdit only re-derives the touched paragraph, leaves the sibling node untouched', async () => {
	const doc = await makeDoc('HELLO\n\nWORLD');
	await doc.renderMarkdown();
	const secondNodeBefore = doc.topLevelNodes[1];

	const oldMd = doc.markdownText;
	const helloGlyphs = ascii2Braille('HELLO');
	const insertAt = oldMd.indexOf(helloGlyphs) + helloGlyphs.length;
	const newMd = oldMd.slice(0, insertAt) + ' MORE' + oldMd.slice(insertAt);
	const result = await doc.applyMarkdownEdit(newMd, insertAt + 5);

	assert.equal(result.nodeError, null);
	assert.equal(doc.topLevelNodes.length, 2);
	assert.equal(doc.topLevelNodes[1], secondNodeBefore, 'sibling node identity preserved (not re-derived)');
	assert.equal(doc.errors.length, 0);
});

test('applyMarkdownEdit on an equation node round-trips through latex_to_nemeth and leaves siblings untouched', async () => {
	const doc = await makeDoc('HELLO\n\n_%3+4_:');
	await doc.renderMarkdown();
	assert.equal(doc.topLevelNodes[1].token, 'EQUATION');
	const firstNodeBefore = doc.topLevelNodes[0];

	const oldMd = doc.markdownText;
	const newMd = oldMd.replace('3+4', '5+6');
	const result = await doc.applyMarkdownEdit(newMd, newMd.indexOf('5+6') + 3);

	assert.equal(result.nodeError, null);
	assert.match(result.brailleText, /5/);
	assert.match(result.brailleText, /6/);
	assert.equal(doc.topLevelNodes[0], firstNodeBefore, 'sibling paragraph untouched by an equation edit');
	assert.equal(doc.errors.length, 0);
});

test('applyMarkdownEdit surfaces a parse error without corrupting the braille pane', async () => {
	const doc = await makeDoc('_%3+4_:');
	await doc.renderMarkdown();
	const oldBraille = doc.brailleText;
	const oldMd = doc.markdownText;
	const broken = oldMd.replace('$3+4$', '$\\frac{1}{2$'); // unbalanced brace

	const result = await doc.applyMarkdownEdit(broken, broken.length);

	assert.notEqual(result.nodeError, null);
	assert.equal(result.brailleText, oldBraille, 'braille pane must be left untouched on failure');
	assert.equal(doc.errors.length, 1);
	assert.equal(doc.errors[0].pane, 'markdown');
});

test('applyMarkdownEdit spanning multiple top-level nodes is flagged, not silently corrupted', async () => {
	const doc = await makeDoc('HELLO\n\nWORLD');
	await doc.renderMarkdown();
	const oldMd = doc.markdownText;
	const oldBraille = doc.brailleText;
	const spanStart = doc.topLevelNodes[0].markdownRange.start + 1;
	const spanEnd = doc.topLevelNodes[1].markdownRange.start + 1;
	const spanningEdit = oldMd.slice(0, spanStart) + 'XX' + oldMd.slice(spanEnd);

	const result = await doc.applyMarkdownEdit(spanningEdit, spanStart + 2);

	assert.notEqual(result.nodeError, null);
	assert.equal(result.brailleText, oldBraille, 'braille pane left untouched when an edit spans multiple nodes');
	assert.ok(doc.errors.length >= 1);
});

test('mapCursor works across brailleRange/markdownRange, same as it does for latexRange', async () => {
	const doc = await makeDoc('HELLO\n\nWORLD');
	await doc.renderMarkdown();
	const secondNode = doc.topLevelNodes[1];
	const mapped = doc.mapCursor('brailleRange', 'markdownRange', secondNode.brailleRange.start + 1);
	assert.ok(mapped >= secondNode.markdownRange.start && mapped <= secondNode.markdownRange.end);
});
