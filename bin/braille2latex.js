#!/usr/bin/env node
// braille2latex — Convert a BRF (ASCII Braille) file to LaTeX from the command line.
//
// Nemeth math sections are converted via Abraham (pure JS, always available).
// Text sections are back-translated via the system `lou_translate` binary if one
// can be found (LOU_TRANSLATE_PATH env var, or already on PATH); otherwise they
// fall back to Unicode braille. This command never installs lou_translate itself —
// see https://github.com/brailletools/liblouis-env (run `liblouis-fetch`) for a
// cross-platform way to install it.
//
// Usage:
//   braille2latex <file.brf> [options]
//
// Options:
//   --table TABLE, --dictionary TABLE   liblouis table (default: en-ueb-g2.ctb)
//   --full-doc                          wrap output in a complete LaTeX document
//   --braille-only                      skip text back-translation; always emit Unicode braille
//   -o, --output FILE                   write output to FILE instead of stdout

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseWithTranslator } from '../src/index.js';

// ── Argument parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name) {
    const i = args.indexOf(name);
    if (i !== -1) { args.splice(i, 1); return true; }
    return false;
}
function option(names, def) {
    for (const name of names) {
        const i = args.indexOf(name);
        if (i !== -1) { const v = args[i + 1]; args.splice(i, 2); return v; }
    }
    return def;
}

const wantFullDoc = flag('--full-doc');
const brailleOnly = flag('--braille-only');
const table        = option(['--table', '--dictionary'], 'en-ueb-g2.ctb');
const outputPath   = option(['-o', '--output'], null);
const filePath     = args[0];

if (!filePath) {
    console.error('Usage: braille2latex <file.brf> [--table TABLE | --dictionary TABLE] [--full-doc] [--braille-only] [-o FILE]');
    process.exit(1);
}

// ── Resolve lou_translate (resolve-only — never installs anything) ─────────

function resolveLouTranslate() {
    if (process.env.LOU_TRANSLATE_PATH) return process.env.LOU_TRANSLATE_PATH;
    try {
        const finder = process.platform === 'win32' ? 'where' : 'which';
        const found = execFileSync(finder, ['lou_translate'], { encoding: 'utf8' }).split('\n')[0].trim();
        return found || null;
    } catch {
        return null;
    }
}

let louTranslatePath = null;
if (!brailleOnly) {
    louTranslatePath = resolveLouTranslate();
    if (!louTranslatePath) {
        process.stderr.write(
            '[braille2latex] lou_translate not found; text sections will be shown as Unicode braille.\n' +
            '[braille2latex] Install it via liblouis-env: run `liblouis-fetch` ' +
            '(https://github.com/brailletools/liblouis-env), or set LOU_TRANSLATE_PATH.\n'
        );
    }
}

async function translate(unicodeBraille, tbl) {
    if (!louTranslatePath) return unicodeBraille;
    try {
        const result = execFileSync(louTranslatePath, ['--backward', tbl], {
            input: unicodeBraille,
            encoding: 'utf8',
        });
        return result.trimEnd();
    } catch {
        return unicodeBraille;
    }
}

// ── Convert ──────────────────────────────────────────────────────────────

const raw = readFileSync(filePath, 'utf8');
const body = (await parseWithTranslator(raw, table, translate)).trim();

const output = wantFullDoc
    ? [
        '\\documentclass{article}',
        '\\usepackage{amsmath}',
        '\\begin{document}',
        '',
        body,
        '',
        '\\end{document}',
    ].join('\n')
    : body;

if (outputPath) {
    writeFileSync(outputPath, output + '\n');
} else {
    console.log(output);
}
