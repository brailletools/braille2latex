import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '../bin/braille2latex.js');

/** Runs the CLI against a fresh fixture file, cleaning it up afterward. */
function withFixture(name, content, run) {
	const fixture = path.join(__dirname, name);
	writeFileSync(fixture, content);
	try {
		return run(fixture);
	} finally {
		unlinkSync(fixture);
	}
}

test('CLI converts a .brf file to LaTeX (default format) without crashing', () => {
	withFixture('fixture.brf', 'HELLO WORLD\n', (fixture) => {
		const output = execFileSync('node', [cliPath, fixture, '--braille-only'], { encoding: 'utf8' });
		assert.notEqual(output.trim(), '');
	});
});

test('CLI --format markdown converts a .brf file to Markdown instead of LaTeX', () => {
	withFixture('fixture-md.brf', '_.HELLO_. WORLD\n', (fixture) => {
		const output = execFileSync('node', [cliPath, fixture, '--braille-only', '--format', 'markdown'], {
			encoding: 'utf8'
		});
		assert.notEqual(output.trim(), '');
		assert.doesNotMatch(output, /\\textbf/, 'markdown output must not contain LaTeX bold markup');
		assert.match(output, /\*\*/, 'expected a Markdown bold span');
	});
});

test('CLI --format rst routes through Pandoc (a non-hand-rolled format)', () => {
	withFixture('fixture-rst.brf', '_.HELLO_. WORLD\n', (fixture) => {
		const output = execFileSync('node', [cliPath, fixture, '--braille-only', '--format', 'rst'], {
			encoding: 'utf8'
		});
		assert.notEqual(output.trim(), '');
		assert.doesNotMatch(output, /\\textbf/, 'must not be LaTeX');
		assert.match(output, /\*\*/, 'reStructuredText also uses ** for bold');
	});
});

test('CLI --format html --full-doc maps to Pandoc\'s standalone:true (full <html> wrapper)', () => {
	withFixture('fixture-html.brf', 'HELLO\n', (fixture) => {
		const fragment = execFileSync('node', [cliPath, fixture, '--braille-only', '--format', 'html'], {
			encoding: 'utf8'
		});
		const standalone = execFileSync(
			'node',
			[cliPath, fixture, '--braille-only', '--format', 'html', '--full-doc'],
			{ encoding: 'utf8' }
		);
		assert.doesNotMatch(fragment, /<html/i);
		assert.match(standalone, /<html/i);
	});
});

test('CLI rejects a binary --format (e.g. docx) without -o', () => {
	withFixture('fixture-docx-noout.brf', 'HELLO\n', (fixture) => {
		try {
			execFileSync('node', [cliPath, fixture, '--braille-only', '--format', 'docx'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
			assert.fail('expected the CLI to exit non-zero');
		} catch (error) {
			assert.match(error.stderr.toString(), /produces a binary document/);
		}
	});
});

test('CLI --format docx -o FILE writes a real .docx (zip) file', () => {
	withFixture('fixture-docx.brf', '_.HELLO_. WORLD\n', (fixture) => {
		const outPath = path.join(__dirname, 'fixture-out.docx');
		try {
			execFileSync('node', [cliPath, fixture, '--braille-only', '--format', 'docx', '-o', outPath], {
				encoding: 'utf8'
			});
			const bytes = readFileSync(outPath);
			assert.ok(bytes.length > 0);
			assert.equal(bytes.slice(0, 2).toString(), 'PK', 'a .docx file is a zip archive (PK header)');
		} finally {
			try {
				unlinkSync(outPath);
			} catch {
				// already absent
			}
		}
	});
});

test('CLI rejects an unknown Pandoc --format cleanly (no raw stack trace)', () => {
	withFixture('fixture-badformat.brf', 'HELLO\n', (fixture) => {
		try {
			execFileSync('node', [cliPath, fixture, '--braille-only', '--format', 'not-a-real-format'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
			assert.fail('expected the CLI to exit non-zero');
		} catch (error) {
			assert.match(error.stderr.toString(), /--format not-a-real-format failed/);
		}
	});
});
