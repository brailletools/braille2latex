#!/usr/bin/env node
// braille-bridge — Convert a BRF (ASCII Braille) file to LaTeX, Markdown, or any
// Pandoc-supported format, from the command line.
//
// Nemeth math sections are converted via Abraham (pure JS, always available).
// Text sections are back-translated via the system `lou_translate` binary if one
// can be found (LOU_TRANSLATE_PATH env var, or already on PATH — resolved via
// @brailletools/liblouis-env); otherwise they fall back to Unicode braille. This
// command never installs lou_translate itself — run `npx liblouis-fetch` for a
// cross-platform way to install it.
//
// --format latex/markdown are hand-rolled (no Pandoc involved, matching this
// package's own to_latex()/to_markdown() renderers). Any other --format value
// is routed through Pandoc: the braille is first rendered to Markdown, then
// Pandoc converts Markdown -> <format>. Pandoc's wasm binary (~56MB) is only
// loaded from local disk (see src/pandoc.js) if a non-latex/markdown format is
// actually requested — not on every invocation.
//
// Usage:
//   braille-bridge <file.brf> [options]
//
// Options:
//   --table TABLE, --dictionary TABLE   liblouis table (default: en-ueb-g2.ctb)
//   --format FORMAT                     output format: latex, markdown, or any
//                                        Pandoc writer name (default: latex)
//   --full-doc                          wrap output in a complete document
//                                        (hand-rolled for latex/markdown; Pandoc's
//                                        `standalone` option for other formats)
//   --braille-only                      skip text back-translation; always emit Unicode braille
//   -o, --output FILE                   write output to FILE instead of stdout
//                                        (required for binary formats like docx/odt/pptx/epub)

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolveLouTranslate } from '@brailletools/liblouis-env';
import { lex, convertText, convertToBinaryFormat } from '../src/index.js';

// Pandoc writers that produce a binary document rather than text — these
// can't sensibly be printed to stdout, so -o is required for them.
const BINARY_FORMATS = new Set(['docx', 'odt', 'pptx', 'epub', 'epub2', 'epub3']);

// ── Argument parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name) {
	const i = args.indexOf(name);
	if (i !== -1) {
		args.splice(i, 1);
		return true;
	}
	return false;
}
function option(names, def) {
	for (const name of names) {
		const i = args.indexOf(name);
		if (i !== -1) {
			const v = args[i + 1];
			args.splice(i, 2);
			return v;
		}
	}
	return def;
}

const wantFullDoc = flag('--full-doc');
const brailleOnly = flag('--braille-only');
const table = option(['--table', '--dictionary'], 'en-ueb-g2.ctb');
const format = option(['--format'], 'latex');
const outputPath = option(['-o', '--output'], null);
const filePath = args[0];

if (!filePath) {
	console.error(
		'Usage: braille-bridge <file.brf> [--table TABLE | --dictionary TABLE] [--format FORMAT] [--full-doc] [--braille-only] [-o FILE]'
	);
	process.exit(1);
}

if (BINARY_FORMATS.has(format) && !outputPath) {
	console.error(`--format ${format} produces a binary document — pass -o FILE to write it somewhere.`);
	process.exit(1);
}

// lou_translate resolution (resolve-only — never installs anything) now lives
// in @brailletools/liblouis-env, imported above.

let louTranslatePath = null;
if (!brailleOnly) {
	louTranslatePath = resolveLouTranslate();
	if (!louTranslatePath) {
		process.stderr.write(
			'[braille-bridge] lou_translate not found; text sections will be shown as Unicode braille.\n' +
				'[braille-bridge] Install it with: npx liblouis-fetch  (or set LOU_TRANSLATE_PATH).\n'
		);
	}
}

async function translate(unicodeBraille, tbl) {
	if (!louTranslatePath) return unicodeBraille;
	try {
		const result = execFileSync(louTranslatePath, ['--backward', tbl], {
			input: unicodeBraille,
			encoding: 'utf8'
		});
		// Strip only a trailing newline (a CLI-output artifact on some platforms/
		// builds) -- NOT all trailing whitespace. A trailing space can be
		// meaningful content (e.g. the separator lex() stores at the end of a
		// STRING node immediately preceding a BOLD/ITALIC/NEMETH span), and
		// .trimEnd() was silently eating it, reopening the same missing-space bug
		// that fixing lex() itself was meant to close.
		return result.replace(/\r?\n+$/, '');
	} catch {
		return unicodeBraille;
	}
}

// ── Convert ──────────────────────────────────────────────────────────────

const raw = readFileSync(filePath, 'utf8');

if (format === 'latex' || format === 'markdown') {
	const tree = lex(raw);
	const body = (format === 'markdown' ? await tree.to_markdown(table, translate) : await tree.to_latex(table, translate)).trim();

	const output = wantFullDoc
		? format === 'markdown'
			? ['---', 'title: Untitled', '---', '', body].join('\n')
			: [
					'\\documentclass{article}',
					'\\usepackage{amsmath}',
					'\\begin{document}',
					'',
					body,
					'',
					'\\end{document}'
				].join('\n')
		: body;

	if (outputPath) {
		writeFileSync(outputPath, output + '\n');
	} else {
		console.log(output);
	}
} else {
	// Any other --format: render to Markdown first, then let Pandoc take it
	// the rest of the way. This is the same Markdown ⇄ Pandoc "hub" approach
	// webeditor uses for Word — see src/pandoc.js's doc comment.
	try {
		const markdown = (await lex(raw).to_markdown(table, translate)).trim();
		const extraOptions = wantFullDoc ? { standalone: true } : {};

		if (BINARY_FORMATS.has(format)) {
			const blob = await convertToBinaryFormat(markdown, 'markdown', format, extraOptions);
			writeFileSync(outputPath, Buffer.from(await blob.arrayBuffer()));
		} else {
			const output = await convertText(markdown, 'markdown', format, extraOptions);
			if (outputPath) {
				writeFileSync(outputPath, output);
			} else {
				console.log(output);
			}
		}
	} catch (error) {
		console.error(`[braille-bridge] --format ${format} failed: ${error.message}`);
		process.exit(1);
	}
}
