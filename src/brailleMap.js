// @ts-nocheck
// Abraham is a UMD build that registers a global. Import for side effects and read from globalThis.
import './abraham.min.js';

const Abraham = globalThis.Abraham;
if (!Abraham) {
	console.warn('Abraham library failed to load; falling back to pass-through conversions.');
}

// Use Abraham's UnicodeBraille conversion for ASCII to Unicode braille
const UnicodeBraille = Abraham?.UnicodeBraille;

/**
 * Converts from ASCII characters to Braille Unicode characters.
 * Uses Abraham's built-in UnicodeBraille.coerceToSixDotCells function
 * Processes line by line to preserve newlines
 * @param {*} input_str 
 * @returns Braille Unicode string
 */
export function ascii2Braille(input_str) {
	try {
		if (!UnicodeBraille) return input_str;
		// Process line by line to preserve newlines
		const lines = input_str.split('\n');
		const results = lines.map(line => UnicodeBraille.coerceToSixDotCells(line));
		return results.join('\n');
	} catch (error) {
		console.warn('UnicodeBraille.coerceToSixDotCells failed:', error);
		return input_str; // Return original if conversion fails
	}
}

/**
 * Converts from Braille Unicode characters to ASCII characters.
 * Uses Abraham's built-in UnicodeBraille.toBrailleAscii function
 * @param {*} input_str 
 * @returns ASCII string
 */
export function braille2Ascii(input_str) {
	try {
		if (!UnicodeBraille) return input_str;
		// toBrailleAscii doesn't handle \n — it produces the string "undefined" for each newline.
		// Process line by line (mirroring ascii2Braille) to preserve newlines correctly.
		//
		// It also returns the literal *string* "undefined" (not the JS value) for any
		// line containing a character it doesn't recognize as valid Unicode braille —
		// e.g. a raw, unconverted ASCII character that ended up mixed into the braille
		// pane's content. `?? line` only catches the JS null/undefined case; this
		// string sentinel would otherwise pass straight through as if it were real
		// content. Treat it the same way: fall back to the original line rather than
		// silently injecting the word "undefined" into the document.
		const lines = input_str.split('\n');
		const results = lines.map((line) => {
			const converted = UnicodeBraille.toBrailleAscii(line);
			return converted === undefined || converted === null || converted === 'undefined' ? line : converted;
		});
		return results.join('\n');
	} catch (error) {
		console.warn('UnicodeBraille.toBrailleAscii failed:', error);
		return input_str; // Return original if conversion fails
	}
}



/**
 * Converts a LaTeX math string to Nemeth Braille (ASCII) — the reverse direction of
 * nemeth_to_latex(). Unlike nemeth_to_latex, Abraham.latexToNemeth is a straight
 * parser with no tolerance for incomplete/unbalanced input (verified empirically:
 * "\frac{1}{2" throws a hard parse error rather than auto-inserting the missing
 * brace), and this function does NOT fall back to passing the input through on
 * failure — it throws instead. Callers that need "leave the braille pane untouched
 * on failure" behavior (DualDocument.applyLatexEdit) must catch this rather than
 * relying on a silent fallback: treating unparsed LaTeX text as if it were ASCII
 * Nemeth braille would corrupt the braille pane, not just fail to update it.
 * @param {string} text - LaTeX math, no surrounding $ delimiters
 * @param {object} [options] - forwarded to Abraham.latexToNemeth (e.g. operatorNames)
 * @returns {string} ASCII Nemeth braille
 * @throws {Error} if text is not valid LaTeX or Abraham is unavailable
 */
export function latex_to_nemeth(text, options) {
	if (!text || text.trim() === '') return '';
	if (!Abraham) {
		throw new Error('[latex_to_nemeth] Abraham library is not loaded');
	}

	let result;
	try {
		result = Abraham.latexToNemeth(text, options);
	} catch (error) {
		throw new Error(`[latex_to_nemeth] Abraham threw: ${error.message}`);
	}

	if (!result || typeof result !== 'object') {
		throw new Error('[latex_to_nemeth] Unexpected result type from Abraham.latexToNemeth');
	}
	if (result.isError) {
		const message = result.error?._diagnostic?.message || result.error?.message || 'unknown error';
		throw new Error(`[latex_to_nemeth] ${message}`);
	}
	if (result.value === undefined || result.value === null) {
		throw new Error('[latex_to_nemeth] Abraham returned no value');
	}

	return braille2Ascii(result.value);
}

export function nemeth_to_latex(text) {
	// convert the data to Braille
	// Don't trim the entire text - we need to preserve spaces within content
	// Only check if completely empty
	if (!text || text.trim() === '') return '';
	
	// Process line by line through Abraham, preserving blank lines and spaces
	const lines = text.split('\n');
	const results = [];
	
	for (const line of lines) {
		// Don't trim individual lines - preserve spaces within the braille content
		if (line === '' || line.trim() === '') {
			results.push('');
			continue;
		}
		
		let latex = '';
		let braille = '';
		
		try {
			braille = ascii2Braille(line);
		} catch (error) {
			console.error("Ascii2Braille failed: " + line);
			console.error(error);
			results.push(line);
			continue;
		}

		try {
			const result = Abraham.nemethToLatex(braille);
			// Check the Abraham API result structure
			if (result && typeof result === 'object') {
				if (result.isError) {
					console.error("[nemeth_to_latex] Abraham returned an error:", result.error);
					latex = '';
				} else if (result.value !== undefined && result.value !== null) {
					latex = result.value;
				} else {
					console.warn("[nemeth_to_latex] Unexpected result structure - no value property");
					latex = '';
				}
			} else {
				console.warn("[nemeth_to_latex] Unexpected result type (not an object):", typeof result);
				latex = '';
			}
			
		} catch (error) {
			console.error("braille-bridge failed for braille: " + braille);
			console.error("Original text: " + line);
			console.error(error);
			latex = '';
		}
		
		results.push(latex);
	}
	
	return results.join('\n');
}
