import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertText, convertToBinaryFormat, convertFromBinaryFormat } from '../src/index.js';

// These exercise the real pandoc-wasm Node entry point (no mocking) -- it
// reads its wasm binary from local disk (see src/pandoc.js's doc comment),
// so this has no network dependency and is fast/reliable in CI.

test('convertText() converts LaTeX to Markdown', async () => {
	const md = await convertText('\\textbf{Hi} $x+1$', 'latex', 'markdown');
	assert.equal(typeof md, 'string');
	assert.match(md, /\*\*Hi\*\*/, 'expected Markdown bold markup');
	assert.match(md, /\$x\s*\+\s*1\$/, 'expected math delimiters preserved');
});

test('convertText() accepts extraOptions (e.g. standalone) merged into Pandoc options', async () => {
	const fragment = await convertText('# Hi', 'markdown', 'html');
	const standalone = await convertText('# Hi', 'markdown', 'html', { standalone: true });
	assert.doesNotMatch(fragment, /<html/i, 'fragment output should not include a document wrapper');
	assert.match(standalone, /<html/i, 'standalone:true should wrap output in a full document');
});

test('convertText() surfaces a Pandoc error for an unknown writer', async () => {
	await assert.rejects(() => convertText('hi', 'markdown', 'not-a-real-format'), /Unknown output format/);
});

test('convertToBinaryFormat()/convertFromBinaryFormat() round-trip Markdown through a real .docx file', async () => {
	const docxBlob = await convertToBinaryFormat('**Hello** World $x+1$', 'markdown', 'docx');
	assert.ok(docxBlob instanceof Blob);
	assert.ok(docxBlob.size > 0);

	const buf = Buffer.from(await docxBlob.arrayBuffer());
	assert.equal(buf.slice(0, 2).toString(), 'PK', 'a .docx file is a zip archive (PK header)');

	const markdownBack = await convertFromBinaryFormat(docxBlob, 'docx', 'markdown');
	assert.match(markdownBack, /\*\*Hello\*\*/);
	assert.match(markdownBack, /\$x\s*\+\s*1\$/);
});
