// @ts-nocheck
// DualDocument: a canonical braille<->LaTeX document model that keeps both
// representations, plus per-top-level-node status, in sync at paragraph/equation
// granularity. Built on top of processFile.js's existing Element tree (lex()/
// to_latex()) rather than replacing it — see braille-bridge README and the
// webeditor side-by-side sync plan for the rationale.
//
// Terminology: "top-level nodes" are ROOT's direct children (PARA or EQUATION,
// after Element.check_for_equation() promotes single-Nemeth paragraphs). All
// editing/sync/error-tracking in this module operates at that granularity — not
// full-document, not per-character. See processFile.js's assignTopLevelBrailleRanges
// and the ROOT case of Element.to_latex() for where brailleRange/latexRange come from.

import { lex, fromMarkdown as parseMarkdown, tokens, translateForward as defaultTranslateForward } from './processFile.js';
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

// A PARA node's latex/markdown can mix prose and inline/display math (e.g.
// "can $ax = b$" — a STRING and a NEMETH child as siblings, which
// check_for_equation() only promotes to a pure EQUATION node when the PARA has
// *no other* children — most real documents mix a word with an equation on the
// same line, so this is the common case, not an edge case). Splits the slice
// into alternating prose/math segments so each can be translated through the
// right pipeline, instead of forward-translating the whole thing (literal
// "$"/"\" math syntax included) as if it were plain prose — which silently
// mistranslates real content instead of erroring. Shared by both the LaTeX and
// Markdown panes: both use the identical $.../$$...$$ math delimiter syntax
// (Pandoc's Markdown math extension matches LaTeX's), only the surrounding
// prose markup differs (\textbf{}/\textit{} vs. **/*, stripped separately by
// stripProseMarkup()/stripMarkdownMarkup() below).
function segmentMixedMathText(latexSlice) {
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

// Forward-translates a PARA node's latex text (or, from applyLatexEdit's partial-
// update path, just a touched sub-range of one) into braille-ASCII — segments
// prose vs inline/display math (see segmentMixedLatex's doc comment above) and
// translates each through the right pipeline. Shared by both the whole-node
// fallback path and the partial/child-region path below, so they build a
// replacement string the same way.
async function regenerateParaBraille(latexText, table, forward) {
	const parts = [];
	for (const segment of segmentMixedMathText(latexText)) {
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
			parts.push(await forward(prose, table));
		}
	}
	return parts.join('');
}

// Markdown-pane mirror of stripProseMarkup() above: crude **bold**/*italic*
// unwrap for editing prose from the Markdown pane. Same documented phase-1
// limitation — doesn't reconstruct BOLD/ITALIC node structure, so editing
// markup from the Markdown side degrades that node to plain text on the
// braille side, same as editing \textbf{}/\textit{} from the LaTeX side does.
function stripMarkdownMarkup(markdownSlice) {
	return stripTrailingBlankLines(markdownSlice)
		.replace(/\*\*/g, '')
		.replace(/\*/g, '');
}

// Markdown-pane mirror of regenerateParaBraille() above.
async function regenerateParaBrailleFromMarkdown(markdownText, table, forward) {
	const parts = [];
	for (const segment of segmentMixedMathText(markdownText)) {
		if (segment.type === 'math') {
			parts.push('_%' + latex_to_nemeth(segment.text) + '_:');
		} else {
			const prose = stripMarkdownMarkup(segment.text);
			if (prose === '') continue;
			parts.push(await forward(prose, table));
		}
	}
	return parts.join('');
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
			// Only default to 'ok' if nothing has already flagged this node —
			// fromMarkdown() (processFile.js) may have already set status/
			// errorPane/errorMessage on a top-level node for content it couldn't
			// parse (e.g. an unrecognized block-level Markdown construct), and
			// that flag must survive construction, not get silently overwritten.
			if (node.status === undefined) {
				node.status = 'ok';
				node.errorPane = null;
				node.errorMessage = null;
			}
		}
	}

	/**
	 * Build a DualDocument from braille source, translating the whole thing once.
	 * translate/translateForward are optional back-/forward-translation overrides —
	 * mainly for tests that don't want to spin up the liblouis WASM worker. When
	 * omitted, translate
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

	/**
	 * Build a DualDocument from Markdown source (e.g. an uploaded .md file, or
	 * the result of running an uploaded .tex/.docx through Pandoc first, then
	 * to Markdown). Braille is still ground truth afterward — this only
	 * differs from fromBraille() in *how* the initial braille is derived (see
	 * processFile.js's fromMarkdown() for the parse). Eagerly renders LaTeX
	 * once, mirroring fromBraille()'s contract so .latexText/applyLatexEdit()
	 * are immediately usable — Markdown itself is deliberately NOT
	 * eagerly (re-)rendered here or by any edit path; call renderMarkdown()
	 * whenever it's actually needed (the user switches the second pane to
	 * Markdown, or downloads it) — see the webeditor plan's "Formats are
	 * rederived lazily" note for why.
	 * @param {string} text
	 * @param {{ table?: string, translate?: Function, translateForward?: Function }} [options]
	 */
	static async fromMarkdown(text, { table = defaultTable, translate, translateForward } = {}) {
		const tree = await parseMarkdown(text, { table, translateForward });
		await tree.to_latex(table, translate);
		return new DualDocument({ tree, table, translate, translateForward });
	}

	get brailleText() {
		return this._tree.sourceText;
	}

	/**
	 * Whatever LaTeX was last computed. Kept eagerly current by
	 * fromBraille()/applyBrailleEdit()/applyLatexEdit() — but NOT by
	 * applyMarkdownEdit(), which only touches .markdown (see its doc
	 * comment). If the document's most recent edit came through the Markdown
	 * pane, this getter can be stale; call renderLatex() instead whenever you
	 * can't be sure which pane was edited last (e.g. switching the live pane
	 * back to LaTeX).
	 */
	get latexText() {
		return this._tree.latex;
	}

	/**
	 * One-shot render of the current braille tree to LaTeX — recomputes
	 * .latex/.latexRange for every node from scratch (the same cost as a
	 * fresh load, not an incremental update). Safe to call any time; the
	 * result is always current regardless of which pane was edited most
	 * recently, unlike the .latexText getter above.
	 * @returns {Promise<string>}
	 */
	async renderLatex() {
		await this._tree.to_latex(this.table, this._translate);
		return this._tree.latex;
	}

	/**
	 * Whatever Markdown was last computed by renderMarkdown()/
	 * applyMarkdownEdit() (or by fromMarkdown()'s initial parse, though that
	 * doesn't populate this — see fromMarkdown()'s doc comment). Empty string
	 * if Markdown has never been rendered for this document yet. Same
	 * staleness caveat as .latexText, mirrored: NOT kept current by
	 * applyLatexEdit()/applyBrailleEdit() — call renderMarkdown() instead
	 * whenever you can't be sure which pane was edited last.
	 */
	get markdownText() {
		return this._tree.markdown;
	}

	/**
	 * One-shot render of the current braille tree to Markdown — recomputes
	 * .markdown/.markdownRange for every node from scratch (the same cost as
	 * a fresh load, not an incremental update). Call this whenever Markdown
	 * is actually needed; it is never kept in sync automatically by
	 * applyBrailleEdit()/applyLatexEdit() the way LaTeX is. Must be called at
	 * least once (e.g. when the user switches the live pane to Markdown)
	 * before applyMarkdownEdit() can be used — the latter relies on
	 * .markdownRange already being populated.
	 * @returns {Promise<string>}
	 */
	async renderMarkdown() {
		await this._tree.to_markdown(this.table, this._translate);
		return this._tree.markdown;
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

	/**
	 * Current out-of-sync or flagged nodes. Empty when fully synced. Includes
	 * both live-edit sync errors ('error', e.g. an edit spanning multiple
	 * paragraphs or invalid math) and import-time content that couldn't be
	 * semantically parsed ('unsupported', e.g. a Markdown construct
	 * fromMarkdown() doesn't model — see processFile.js's flagUnsupported())
	 * — the latter isn't a failure exactly, but the user should still be able
	 * to see which paragraphs were translated literally rather than parsed.
	 */
	get errors() {
		return this._tree.children
			.filter((n) => n.status === 'error' || n.status === 'unsupported')
			.map((n) => ({
				nodeId: n.docId,
				pane: n.errorPane,
				label: this.label(n),
				range: n.errorPane === 'latex' ? n.latexRange : n.errorPane === 'markdown' ? n.markdownRange : n.brailleRange,
				// `range` above can be null: e.g. a Markdown-import-time
				// 'unsupported' flag (see processFile.js's flagUnsupported())
				// is stamped before markdownRange has ever been computed, if
				// the caller hasn't rendered Markdown yet (renderMarkdown()
				// is lazy — see its doc comment). brailleRange is always
				// populated regardless, so callers that can't use `range`
				// directly (see webeditor's focusNode()) have a reliable
				// fallback instead of silently doing nothing.
				brailleRange: n.brailleRange,
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

	// Markdown-pane mirror of _recomputeRanges() above, used by
	// applyMarkdownEdit() instead of applyLatexEdit()'s.
	_recomputeRangesMarkdown(brailleText, markdownText) {
		this._tree.sourceText = brailleText;
		this._tree.markdown = markdownText;
		let bCursor = 0;
		let mCursor = 0;
		this._tree.children.forEach((node) => {
			const bWidth = node.brailleRange.end - node.brailleRange.start;
			const mWidth = node.markdownRange.end - node.markdownRange.start;
			node.brailleRange = { start: bCursor, end: bCursor + bWidth };
			node.markdownRange = { start: mCursor, end: mCursor + mWidth };
			bCursor += bWidth + 2; // '\n\n' separator between braille paragraphs
			mCursor += mWidth; // markdown top-level ranges are already contiguous
		});
	}

	// Best-effort proportional cursor mapping: find the node containing the cursor
	// in the source pane, apply the same proportional offset within that node's
	// range in the target pane. Braille contractions and LaTeX/Markdown command
	// expansion mean this is NOT exact character-for-character — see plan §3 —
	// but it reliably keeps the cursor in the right node. Public (not just used
	// internally by applyBrailleEdit()/applyLatexEdit()/applyMarkdownEdit()) —
	// also the basis for the webeditor "jump to corresponding location in the
	// other pane" keyboard shortcut, which needs the same mapping on demand,
	// outside of an edit.
	mapCursor(sourceRangeKey, targetRangeKey, cursorOffset) {
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
			return { latexText: this.latexText, latexCursor: this.mapCursor('brailleRange', 'latexRange', cursorOffset) };
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

		return { latexText: this.latexText, latexCursor: this.mapCursor('brailleRange', 'latexRange', cursorOffset) };
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
				brailleCursor: this.mapCursor('latexRange', 'brailleRange', cursorOffset),
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
				brailleCursor: this.mapCursor('latexRange', 'brailleRange', cursorOffset),
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
				// node.latex and latexSlice are both node-relative (0-based at this
				// node's own latex start), same coordinate space
				// assignParaChildBrailleRanges() stamped children's
				// latexRange/brailleRange in, so this diff needs no extra offset math
				// beyond what the document-level diff above already did.
				const children = node.children;
				const { prefixLen: childPrefixLen, suffixLen: childSuffixLen } = diffRegion(node.latex, latexSlice);
				const oldChildRegionStart = childPrefixLen;
				const oldChildRegionEnd = node.latex.length - childSuffixLen;

				// children only cover their own span text, not PARA-level glue outside
				// it (e.g. the trailing "\n\n" to_latex() appends, or display-math
				// spacing) -- unlike top-level nodes, whose ranges are extended by
				// findOwningIndex's "gap belongs to preceding node" convention. Splicing
				// is only safe when the edited region is actually inside the span the
				// children cover; otherwise findOwningIndex would silently clamp an
				// out-of-range offset onto the nearest child and corrupt it.
				const canSplice =
					node.childRangesReliable === true &&
					children.length > 0 &&
					oldChildRegionStart >= children[0].latexRange.start &&
					oldChildRegionEnd <= children[children.length - 1].latexRange.end;

				if (canSplice) {
					// Only forward-translate the actually-changed sub-range and splice it
					// into the node's existing (untouched) braille, instead of regenerating
					// the whole paragraph — see braille2latex#19.
					const forward = this._translateForward || defaultTranslateForward;
					const childFirstIdx = findOwningIndex(children, 'latexRange', oldChildRegionStart);
					const childLastIdx =
						oldChildRegionEnd > oldChildRegionStart
							? findOwningIndex(children, 'latexRange', oldChildRegionEnd - 1)
							: childFirstIdx;

					const childRegionStart = children[childFirstIdx].latexRange.start;
					const childRegionNewEnd = children[childLastIdx].latexRange.end + delta;
					const newChildRegionLatex = latexSlice.slice(childRegionStart, childRegionNewEnd);

					const newBrailleForChildRegion = await regenerateParaBraille(newChildRegionLatex, this.table, forward);

					const oldNodeBrailleText = this.brailleText.slice(node.brailleRange.start, node.brailleRange.end);
					const childBrailleStart = children[childFirstIdx].brailleRange.start;
					const childBrailleOldEnd = children[childLastIdx].brailleRange.end;
					newBrailleForNode =
						oldNodeBrailleText.slice(0, childBrailleStart) +
						newBrailleForChildRegion +
						oldNodeBrailleText.slice(childBrailleOldEnd);
				} else {
					// No reliable child ranges for this node (e.g. a lexer edge case the
					// marker-only scan in processFile.js doesn't cover), no children at
					// all (empty paragraph), or the edited region falls outside every
					// child's actual latex coverage -- fall back to regenerating the
					// whole node, same as before braille2latex#19's fix.
					const forward = this._translateForward || defaultTranslateForward;
					newBrailleForNode = await regenerateParaBraille(latexSlice, this.table, forward);
				}
			}
		} catch (error) {
			node.status = 'error';
			node.errorPane = 'latex';
			node.errorMessage = error?.message || String(error);
			node.latexRange = { start: regionLatexStart, end: regionLatexNewEnd };
			this._recomputeRanges(this.brailleText, newLatexText);
			return {
				brailleText: this.brailleText,
				brailleCursor: this.mapCursor('latexRange', 'brailleRange', cursorOffset),
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
			brailleCursor: this.mapCursor('latexRange', 'brailleRange', cursorOffset),
			nodeError: null
		};
	}

	/**
	 * Markdown-pane mirror of applyLatexEdit() above — same bounded,
	 * single-top-level-node edit model (see that method's doc comment for the
	 * full rationale), substituting Markdown's emphasis markers (asterisk
	 * pairs for bold, single asterisks for italic) for LaTeX's \textbf{}/
	 * \textit{} (math delimiters are identical in both, so
	 * extractMathBody()/segmentMixedMathText() are reused as-is). Requires
	 * renderMarkdown() to have been called at least once first — see its doc
	 * comment.
	 * @returns {Promise<{ brailleText: string, brailleCursor: number, nodeError: string|null }>}
	 */
	async applyMarkdownEdit(newMarkdownText, cursorOffset) {
		if (newMarkdownText === this.markdownText) {
			return {
				brailleText: this.brailleText,
				brailleCursor: this.mapCursor('markdownRange', 'brailleRange', cursorOffset),
				nodeError: null
			};
		}

		const oldMarkdownText = this.markdownText;
		const { prefixLen, suffixLen } = diffRegion(oldMarkdownText, newMarkdownText);
		const oldEditStart = prefixLen;
		const oldEditEnd = oldMarkdownText.length - suffixLen;

		const nodes = this._tree.children;
		const firstIdx = findOwningIndex(nodes, 'markdownRange', oldEditStart);
		const lastIdx = oldEditEnd > oldEditStart ? findOwningIndex(nodes, 'markdownRange', oldEditEnd - 1) : firstIdx;

		if (firstIdx !== lastIdx) {
			const message =
				'Edit spans multiple paragraphs/equations — narrow the edit to a single paragraph or equation to sync.';
			for (let i = firstIdx; i <= lastIdx; i++) {
				nodes[i].status = 'error';
				nodes[i].errorPane = 'markdown';
				nodes[i].errorMessage = message;
			}

			const delta = newMarkdownText.length - oldMarkdownText.length;
			const last = nodes[lastIdx];
			last.markdownRange = {
				start: last.markdownRange.start,
				end: Math.max(last.markdownRange.start, last.markdownRange.end + delta)
			};
			this._recomputeRangesMarkdown(this.brailleText, newMarkdownText);
			return {
				brailleText: this.brailleText,
				brailleCursor: this.mapCursor('markdownRange', 'brailleRange', cursorOffset),
				nodeError: message
			};
		}

		const node = nodes[firstIdx];
		const delta = newMarkdownText.length - oldMarkdownText.length;
		const regionMarkdownStart = node.markdownRange.start;
		const regionMarkdownNewEnd = node.markdownRange.end + delta;
		const markdownSlice = newMarkdownText.slice(regionMarkdownStart, regionMarkdownNewEnd);

		let newBrailleForNode;
		try {
			if (node.token === tokens.EQUATION) {
				const mathBody = extractMathBody(markdownSlice);
				newBrailleForNode = '_%' + latex_to_nemeth(mathBody) + '_:';
			} else {
				const children = node.children;
				const { prefixLen: childPrefixLen, suffixLen: childSuffixLen } = diffRegion(node.markdown, markdownSlice);
				const oldChildRegionStart = childPrefixLen;
				const oldChildRegionEnd = node.markdown.length - childSuffixLen;

				const canSplice =
					node.childRangesReliable === true &&
					children.length > 0 &&
					oldChildRegionStart >= children[0].markdownRange.start &&
					oldChildRegionEnd <= children[children.length - 1].markdownRange.end;

				if (canSplice) {
					const forward = this._translateForward || defaultTranslateForward;
					const childFirstIdx = findOwningIndex(children, 'markdownRange', oldChildRegionStart);
					const childLastIdx =
						oldChildRegionEnd > oldChildRegionStart
							? findOwningIndex(children, 'markdownRange', oldChildRegionEnd - 1)
							: childFirstIdx;

					const childRegionStart = children[childFirstIdx].markdownRange.start;
					const childRegionNewEnd = children[childLastIdx].markdownRange.end + delta;
					const newChildRegionMarkdown = markdownSlice.slice(childRegionStart, childRegionNewEnd);

					const newBrailleForChildRegion = await regenerateParaBrailleFromMarkdown(
						newChildRegionMarkdown,
						this.table,
						forward
					);

					const oldNodeBrailleText = this.brailleText.slice(node.brailleRange.start, node.brailleRange.end);
					const childBrailleStart = children[childFirstIdx].brailleRange.start;
					const childBrailleOldEnd = children[childLastIdx].brailleRange.end;
					newBrailleForNode =
						oldNodeBrailleText.slice(0, childBrailleStart) +
						newBrailleForChildRegion +
						oldNodeBrailleText.slice(childBrailleOldEnd);
				} else {
					const forward = this._translateForward || defaultTranslateForward;
					newBrailleForNode = await regenerateParaBrailleFromMarkdown(markdownSlice, this.table, forward);
				}
			}
		} catch (error) {
			node.status = 'error';
			node.errorPane = 'markdown';
			node.errorMessage = error?.message || String(error);
			node.markdownRange = { start: regionMarkdownStart, end: regionMarkdownNewEnd };
			this._recomputeRangesMarkdown(this.brailleText, newMarkdownText);
			return {
				brailleText: this.brailleText,
				brailleCursor: this.mapCursor('markdownRange', 'brailleRange', cursorOffset),
				nodeError: node.errorMessage
			};
		}

		const oldBrailleStart = node.brailleRange.start;
		const oldBrailleEnd = node.brailleRange.end;
		const newBrailleText =
			this.brailleText.slice(0, oldBrailleStart) + newBrailleForNode + this.brailleText.slice(oldBrailleEnd);

		const subtree = lex(newBrailleForNode);
		await subtree.to_markdown(this.table, this._translate);
		const replacement = subtree.children[0];
		replacement.docId = node.docId;
		replacement.status = 'ok';
		replacement.errorPane = null;
		replacement.errorMessage = null;
		// Keep markdown ranges consistent with the user-edited Markdown pane
		// (newMarkdownText), not the regenerated markdown (subtree.markdown),
		// which may normalize whitespace/markup.
		replacement.markdownRange = { start: 0, end: markdownSlice.length };
		nodes[firstIdx] = replacement;

		this._recomputeRangesMarkdown(newBrailleText, newMarkdownText);

		return {
			brailleText: this.brailleText,
			brailleCursor: this.mapCursor('markdownRange', 'brailleRange', cursorOffset),
			nodeError: null
		};
	}
}
