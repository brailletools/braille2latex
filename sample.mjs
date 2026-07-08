#!/usr/bin/env node
// sample.mjs — Convert a BRF (ASCII Braille) file to LaTeX from the command line.
//
// Nemeth math sections are converted via Abraham (pure JS).
// Text back-translation uses the system `lou_translate` binary (brew install liblouis).
//
// Usage:
//   node sample.mjs <file.brf> [options]
//
// Options:
//   --table TABLE      liblouis table (default: en-ueb-g2.ctb)
//   --text             back-translate text sections to English (requires lou_translate)
//   --full-doc         wrap output in a complete LaTeX document

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { nemeth_to_latex, ascii2Braille } from './src/brailleMap.js';

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name) {
    const i = args.indexOf(name);
    if (i !== -1) { args.splice(i, 1); return true; }
    return false;
}
function option(name, def) {
    const i = args.indexOf(name);
    if (i !== -1) { const v = args[i + 1]; args.splice(i, 2); return v; }
    return def;
}

const wantText    = flag('--text');
const wantFullDoc = flag('--full-doc');
const table       = option('--table', 'en-ueb-g2.ctb');
const filePath    = args[0];

if (!filePath) {
    console.error('Usage: node sample.mjs <file.brf> [--table TABLE] [--text] [--full-doc]');
    process.exit(1);
}

// ── Back-translation helper ───────────────────────────────────────────────────

function backTranslate(asciiBraille, tbl) {
    const unicode = ascii2Braille(asciiBraille);
    try {
        const result = execFileSync('lou_translate', ['--backward', tbl], {
            input: unicode,
            encoding: 'utf8',
        });
        return result.trimEnd();
    } catch {
        process.stderr.write('[sample] lou_translate not found; install liblouis for text back-translation\n');
        return unicode;
    }
}

// ── Parse BRF into paragraphs ─────────────────────────────────────────────────

const NEMETH_START = '_%';
const NEMETH_STOP  = '_:';

const raw = readFileSync(filePath, 'utf8').replace(/\r\n|\r/g, '\n');
const paragraphs = raw.split('\n\n');

const outputParagraphs = [];

for (const para of paragraphs) {
    let inNemeth = false;
    let textBuf  = '';
    let mathBuf  = '';
    let paraOut  = '';

    function flushText() {
        if (!textBuf.trim()) { textBuf = ''; return; }
        const t = textBuf.trim();
        textBuf = '';
        if (wantText) {
            paraOut += backTranslate(t, table);
        } else {
            paraOut += ascii2Braille(t);
        }
    }

    function flushMath() {
        if (!mathBuf.trim()) { mathBuf = ''; return; }
        const latex = nemeth_to_latex(mathBuf.trim());
        mathBuf = '';
        paraOut += '$' + latex + '$';
    }

    let j = 0;
    while (j < para.length) {
        const two = para.slice(j, j + 2);
        if (!inNemeth && two === NEMETH_START) {
            flushText();
            inNemeth = true;
            j += 2;
        } else if (inNemeth && two === NEMETH_STOP) {
            flushMath();
            inNemeth = false;
            j += 2;
        } else if (inNemeth) {
            mathBuf += para[j++];
        } else {
            textBuf += para[j++];
        }
    }

    // flush any remaining content
    if (inNemeth) {
        flushMath();
    } else {
        flushText();
    }

    if (paraOut.trim()) outputParagraphs.push(paraOut.trim());
}

// ── Assemble output ───────────────────────────────────────────────────────────

const body = outputParagraphs.join('\n\n');

if (wantFullDoc) {
    console.log([
        '\\documentclass{article}',
        '\\usepackage{amsmath}',
        '\\begin{document}',
        '',
        body,
        '',
        '\\end{document}',
    ].join('\n'));
} else {
    console.log(body);
}
