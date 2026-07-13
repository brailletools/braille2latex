// @ts-nocheck
// DualDocument: a canonical braille<->LaTeX document model that keeps both
// representations, plus per-top-level-node status, in sync at paragraph/equation
// granularity. Built on top of processFile.js's existing Element tree (lex()/
// to_latex()) rather than replacing it — see braille2latex README and the
// webeditor side-by-side sync plan for the rationale.
//
// Terminology: "top-level nodes" are ROOT's direct children (PARA or EQUATION,
// after Element.check_for_equation() promotes single-Nemeth paragraphs). All
// editing/sync/error-tracking in this module operates at that granularity — not
// full-document, not per-character. See processFile.js's assignTopLevelBrailleRanges
// and the ROOT case of Element.to_latex() for where brailleRange/latexRange come from.

import { lex, tokens, translateForward as defaultTranslateForward } from './processFile.js';
import { latex_to_nemeth } from './brailleMap.js';

const defaultTable = 'en-ueb-g2.ctb';

// Every node in `nodes` "owns" [node[rangeKey].start, next node's start) — gaps
// between nodes (e.g. the 2-char '\n\n' braille paragraph separator) belong to the
// preceding node. This gives a well-defined index for every offset in [0, textLength].
function findOwningIndex(nodes, rangeKey, offset) {
	for (let i = 0; i < nodes.length; i++) {
		const nextStart = i + 1 < nodes.length ? nodes[i + 1][rangeKey].start : Infinity;
		if (offset < nextStart) return i;
	}
	return nodes.length - 1;
}

// Common-prefix/common-suffix diff. The edited region is
// oldText[prefixLen, oldText.length - suffixLen) -> newText[prefixLen, newText.length - suffixLen).
// Good enough for locating "what changed" without a real diff library — callers only
// need the boundary of the edit, not a full character-level diff.
function diffRegion(oldText, newText) {
	const maxPrefix = Math.min(oldText.length, newText.length);
	let prefixLen = 0;
	while (prefixLen < maxPrefix && oldText[prefixLen] === newText[prefixLen]) prefixLen++;

	const maxSuffix = Math.min(oldText.length, newText.length) - prefixLen;
	let suffixLen = 0;
	while (
		suffixLen < maxSuffix &&
		oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
	) {
		suffixLen++;
	}

	return { prefixLen, suffixLen };
}

function stripTrailingBlankLines(s) {
	return s.replace(/\n+$/, '');
}

// A single-line equation's latex is `$...$`; a multi-line Nemeth block is one or
// more `$$...$$\n` segments concatenated (see the NEMETH case of Element.to_latex()).
// Only the single inline-math case is unwrapped here — multi-line equations aren't
// yet editable from the LaTeX pane (documented limitation: the slice below won't
// match either pattern, latex_to_nemeth() will then throw on the raw `$$...$$\n$$...$$`
// text, and the edit safely surfaces as a sync error instead of corrupting anything).
function extractMathBody(latexSlice) {
	const s = stripTrailingBlankLines(latexSlice).trim();
	if (s.startsWith('$$') && s.endsWith('$$') && s.length >= 4) return s.slice(2, -2);
	if (s.startsWith('$') && s.endsWith('$') && s.length >= 2) return s.slice(1, -1);
	return s;
}

// Crude \textbf{}/\textit{} unwrap for editing prose from the LaTeX pane. Does not
// reconstruct BOLD/ITALIC node structure — editing markup from the LaTeX side
// currently degrades that node to plain text on the braille side. Documented
// phase-1 limitation, not a bug: full LaTeX markup round-tripping would need a real
// LaTeX parser, which nothing in this dependency graph provides.
function stripProseMarkup(latexSlice) {
	return stripTrailingBlankLines(latexSlice)
		.replace(/\\text(?:bf|it)\{/g, '')
		.replace(/}/g, '');
}

// A PARA node's latex can mix prose and inline/display math (e.g. "can $ax = b$" —
// a STRING and a NEMETH child as siblings, which check_for_equation() only promotes
// to a pure EQUATION node when the PARA has *no other* children — most real
// documents mix a word with an equation on the same line, so this is the common
// case, not an edge case). Splits latexSlice into alternating prose/math segments
// so each can be translated through the right pipeline, instead of forward-
// translating the whole thing (literal "$"/"\" math syntax included) as if it were
// plain prose — which silently mistranslates real content instead of erroring.
function segmentMixedLatex(latexSlice) {
	const s = stripTrailingBlankLines(latexSlice);
	const segments = [];
	const re = /\$\$([\s\S]*?)\$\$|\$([^$]*)\$/g;
	let lastIndex = 0;
	let match;
	while ((match = re.exec(s)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ type: 'prose', text: s.slice(lastIndex, match.index) });
		}
		const mathBody = match[1] !== undefined ? match[1] : match[2];
		segments.push({ type: 'math', text: mathBody });
		lastIndex = re.lastIndex;
	}
	if (lastIndex < s.length) {
		segments.push({ type: 'prose', text: s.slice(lastIndex) });
	}
	return segments;
}

export class DualDocument {
	constructor({ tree, table, translate, translateForward }) {
		this._tree = tree;
		this.table = table || defaultTable;
		this._translate = translate;
		this._translateForward = translateForward;
		this._nextDocId = 0;
		for (const node of this._tree.children) {
			node.docId = this._nextDocId++;
			node.status = 'ok';
			node.errorPane = null;
			node.errorMessage = null;
		}
	}

	/**
	 * Build a DualDocument from braille source, translating the whole thing once.
	 * translate/translateForward are optional back-/forward-translation overrides
	 * (mirrors parse()/parseWithTranslator() in processFile.js) — mainly for tests
	 * that don't want to spin up the liblouis WASM worker. When omitted, translate
	 * falls back to processFile.js's own liblouis-worker default (requires
	 * configure() to have been called), and translateForward falls back to this
	 * module's imported translateForward (same requirement).
	 * @param {string} text
	 * @param {{ table?: string, translate?: Function, translateForward?: Function }} [options]
	 */
	static async fromBraille(text, { table = defaultTable, translate, translateForward } = {}) {
		const tree = lex(text);
		await tree.to_latex(table, translate);
		return new DualDocument({ tree, table, translate, translateForward });
	}

	get brailleText() {
		return this._tree.sourceText;
	}

	get latexText() {
		return this._tree.latex;
	}

	get topLevelNodes() {
		return this._tree.children;
	}

	nodeAtBrailleOffset(offset) {
		return this._tree.children[findOwningIndex(this._tree.children, 'brailleRange', offset)] ?? null;
	}

	nodeAtLatexOffset(offset) {
		return this._tree.children[findOwningIndex(this._tree.children, 'latexRange', offset)] ?? null;
	}

	label(node) {
		const nodes = this._tree.children;
		const idx = nodes.indexOf(node);
		if (idx === -1) return 'Unknown';
		const isEquation = node.token === tokens.EQUATION;
		const type = isEquation ? 'Equation' : 'Paragraph';
		let ordinal = 0;
		for (let i = 0; i <= idx; i++) {
			if ((nodes[i].token === tokens.EQUATION) === isEquation) ordinal++;
		}
		return `${type} ${ordinal}`;
	}

	/** Current out-of-sync nodes across both directions. Empty when fully synced. */
	get errors() {
		return this._tree.children
			.filter((n) => n.status === 'error')
			.map((n) => ({
				nodeId: n.docId,
				pane: n.errorPane,
				label: this.label(n),
				range: n.errorPane === 'latex' ? n.latexRange : n.brailleRange,
				message: n.errorMessage
			}));
	}

	// Recomputes every top-level node's absolute brailleRange/latexRange from its
	// own (already-correct) WIDTH, cumulatively — used after any splice so ranges
	// stay contiguous (latex) / separated by the 2-char '\n\n' (braille) without
	// needing per-edit delta-shifting math.
	_recomputeRanges(brailleText, latexText) {
		this._tree.sourceText = brailleText;
		this._tree.latex = latexText;
		let bCursor = 0;
		let lCursor = 0;
		this._tree.children.forEach((node) => {
			const bWidth = node.brailleRange.end - node.brailleRange.start;
			const lWidth = node.latexRange.end - node.latexRange.start;
			node.brailleRange = { start: bCursor, end: bCursor + bWidth };
			node.latexRange = { start: lCursor, end: lCursor + lWidth };
			bCursor += bWidth + 2; // '\n\n' separator between braille paragraphs
			lCursor += lWidth; // latex top-level ranges are already contiguous
		});
	}

	// Best-effort proportional cursor mapping: find the node containing the cursor
	// in the source pane, apply the same proportional offset within that node's
	// range in the target pane. Braille contractions and LaTeX command expansion
	// mean this is NOT exact character-for-character — see plan §3 — but it
	// reliably keeps the cursor in the right node.
	_mapCursor(sourceRangeKey, targetRangeKey, cursorOffset) {
		const nodes = this._tree.children;
		if (nodes.length === 0) return 0;
		const node = nodes[findOwningIndex(nodes, sourceRangeKey, cursorOffset)];
		const srcRange = node[sourceRangeKey];
		const tgtRange = node[targetRangeKey];
		if (!srcRange || !tgtRange) return tgtRange ? tgtRange.start : 0;
		const srcWidth = srcRange.end - srcRange.start;
		const relative = srcWidth > 0 ? Math.min(1, Math.max(0, (cursorOffset - srcRange.start) / srcWidth)) : 0;
		const tgtWidth = tgtRange.end - tgtRange.start;
		return Math.round(tgtRange.start + relative * tgtWidth);
	}

	/**
	 * Apply an edit made in the braille pane. newBrailleText is the pane's full,
	 * current value (not a diff/patch); cursorOffset is the caret position within it.
	 * Only the top-level node(s) touched by the edit are re-lexed/re-translated —
	 * see the module doc comment and plan §2 for why this is bounded to node
	 * granularity rather than full-document or full-AST-diff.
	 * @returns {Promise<{ latexText: string, latexCursor: number }>}
	 */
	async applyBrailleEdit(newBrailleText, cursorOffset) {
		if (newBrailleText === this.brailleText) {
			return { latexText: this.latexText, latexCursor: this._mapCursor('brailleRange', 'latexRange', cursorOffset) };
		}

		const oldBrailleText = this.brailleText;
		const { prefixLen, suffixLen } = diffRegion(oldBrailleText, newBrailleText);
		const oldEditStart = prefixLen;
		const oldEditEnd = oldBrailleText.length - suffixLen;

		const nodes = this._tree.children;
		const firstIdx = findOwningIndex(nodes, 'brailleRange', oldEditStart);
		const lastIdx = oldEditEnd > oldEditStart ? findOwningIndex(nodes, 'brailleRange', oldEditEnd - 1) : firstIdx;

		const delta = newBrailleText.length - oldBrailleText.length;
		const regionBrailleStart = nodes[firstIdx].brailleRange.start;
		const regionBrailleOldEnd = nodes[lastIdx].brailleRange.end;
		const regionBrailleNewEnd = regionBrailleOldEnd + delta;
		const regionSlice = newBrailleText.slice(regionBrailleStart, regionBrailleNewEnd);

		const subtree = lex(regionSlice);
		await subtree.to_latex(this.table, this._translate);

		const replacedFirstNode = nodes[firstIdx];
		subtree.children.forEach((n, i) => {
			n.docId = i === 0 ? replacedFirstNode.docId : this._nextDocId++;
			n.status = 'ok';
			n.errorPane = null;
			n.errorMessage = null;
		});

		const regionLatexStart = nodes[firstIdx].latexRange.start;
		const regionLatexOldEnd = nodes[lastIdx].latexRange.end;
		const newLatexText = this.latexText.slice(0, regionLatexStart) + subtree.latex + this.latexText.slice(regionLatexOldEnd);

		nodes.splice(firstIdx, lastIdx - firstIdx + 1, ...subtree.children);
		this._recomputeRanges(newBrailleText, newLatexText);

		return { latexText: this.latexText, latexCursor: this._mapCursor('brailleRange', 'latexRange', cursorOffset) };
	}

	/**
	 * Apply an edit made in the LaTeX pane. newLatexText is the pane's full,
	 * current value; cursorOffset is the caret position within it. Unlike
	 * applyBrailleEdit, there is no LaTeX lexer to rediscover paragraph/equation
	 * boundaries, so this only succeeds when the edit stays within a single
	 * existing top-level node's range; on failure (parse error, or an edit that
	 * spans multiple nodes) the braille pane's content for the affected node(s) is
	 * left untouched and the node is flagged in `errors` instead — see plan §5.
	 * @returns {Promise<{ brailleText: string, brailleCursor: number, nodeError: string|null }>}
	 */
	async applyLatexEdit(newLatexText, cursorOffset) {
		if (newLatexText === this.latexText) {
			return {
				brailleText: this.brailleText,
				brailleCursor: this._mapCursor('latexRange', 'brailleRange', cursorOffset),
				nodeError: null
			};
		}

		const oldLatexText = this.latexText;
		const { prefixLen, suffixLen } = diffRegion(oldLatexText, newLatexText);
		const oldEditStart = prefixLen;
		const oldEditEnd = oldLatexText.length - suffixLen;

		const nodes = this._tree.children;
		const firstIdx = findOwningIndex(nodes, 'latexRange', oldEditStart);
		const lastIdx = oldEditEnd > oldEditStart ? findOwningIndex(nodes, 'latexRange', oldEditEnd - 1) : firstIdx;

		if (firstIdx !== lastIdx) {
			// Edit spans multiple top-level nodes: not resolvable at node granularity
			// (no LaTeX lexer to rediscover new boundaries). Flag every spanned node.
			const message =
				'Edit spans multiple paragraphs/equations — narrow the edit to a single paragraph or equation to sync.';
			for (let i = firstIdx; i <= lastIdx; i++) {
				nodes[i].status = 'error';
				nodes[i].errorPane = 'latex';
				nodes[i].errorMessage = message;
			}

			// Keep internal latex ranges monotonic/contiguous so future offset lookups
			// don't operate on stale positions. Since we can't re-lex LaTeX here, assign
			// the entire length delta to the last spanned node.
			const delta = newLatexText.length - oldLatexText.length;
			const last = nodes[lastIdx];
			last.latexRange = {
				start: last.latexRange.start,
				end: Math.max(last.latexRange.start, last.latexRange.end + delta)
			};
			this._recomputeRanges(this.brailleText, newLatexText);
			return {
				brailleText: this.brailleText,
				brailleCursor: this._mapCursor('latexRange', 'brailleRange', cursorOffset),
				nodeError: message
			};
		}

		const node = nodes[firstIdx];
		const delta = newLatexText.length - oldLatexText.length;
		const regionLatexStart = node.latexRange.start;
		const regionLatexNewEnd = node.latexRange.end + delta;
		const latexSlice = newLatexText.slice(regionLatexStart, regionLatexNewEnd);

		let newBrailleForNode;
		try {
			if (node.token === tokens.EQUATION) {
				const mathBody = extractMathBody(latexSlice);
				newBrailleForNode = '_%' + latex_to_nemeth(mathBody) + '_:';
			} else {
				// PARA nodes can mix prose and math as siblings (see
				// segmentMixedLatex's doc comment) — translate each segment through
				// the right pipeline and concatenate, rather than treating the whole
				// slice as prose.
				const forward = this._translateForward || defaultTranslateForward;
				const parts = [];
				for (const segment of segmentMixedLatex(latexSlice)) {
					if (segment.type === 'math') {
						parts.push('_%' + latex_to_nemeth(segment.text) + '_:');
					} else {
						const prose = stripProseMarkup(segment.text);
						if (prose === '') continue;
						// liblouis's translateString(..., backtranslate=false) returns
						// braille-ASCII text directly (e.g. "c " for "can", the grade-2
						// contraction) — NOT Unicode braille glyphs, despite the parallel
						// with defaultLiblouisTranslate's back-translate direction (which
						// takes Unicode braille IN). Running this back through
						// braille2Ascii() a second time fed it non-Unicode-braille input
						// and hit the same "undefined" sentinel bug from a different
						// angle. Use the result as-is; it's already in the ASCII-braille
						// form node.value expects (case doesn't affect which cell a basic
						// letter maps to, so liblouis's lowercase output round-trips fine
						// through ascii2Braille() later).
						parts.push(await forward(prose, this.table));
					}
				}
				newBrailleForNode = parts.join('');
			}
		} catch (error) {
			node.status = 'error';
			node.errorPane = 'latex';
			node.errorMessage = error?.message || String(error);
			node.latexRange = { start: regionLatexStart, end: regionLatexNewEnd };
			this._recomputeRanges(this.brailleText, newLatexText);
			return {
				brailleText: this.brailleText,
				brailleCursor: this._mapCursor('latexRange', 'brailleRange', cursorOffset),
				nodeError: node.errorMessage
			};
		}

		const oldBrailleStart = node.brailleRange.start;
		const oldBrailleEnd = node.brailleRange.end;
		const newBrailleText =
			this.brailleText.slice(0, oldBrailleStart) + newBrailleForNode + this.brailleText.slice(oldBrailleEnd);

		const subtree = lex(newBrailleForNode);
		await subtree.to_latex(this.table, this._translate);
		const replacement = subtree.children[0];
		replacement.docId = node.docId;
		replacement.status = 'ok';
		replacement.errorPane = null;
		replacement.errorMessage = null;
		// Keep latex ranges consistent with the user-edited LaTeX pane (newLatexText),
		// not the regenerated latex (subtree.latex), which may normalize whitespace/markup.
		replacement.latexRange = { start: 0, end: latexSlice.length };
		nodes[firstIdx] = replacement;

		this._recomputeRanges(newBrailleText, newLatexText);

		return {
			brailleText: this.brailleText,
			brailleCursor: this._mapCursor('latexRange', 'brailleRange', cursorOffset),
			nodeError: null
		};
	}
}
