import Abraham from '$lib/abraham.min.js'; // the Desmos Abraham library 

// Use Abraham's UnicodeBraille conversion for ASCII to Unicode braille
const UnicodeBraille = Abraham.UnicodeBraille;

/**
 * Converts from ASCII characters to Braille Unicode characters.
 * Uses Abraham's built-in UnicodeBraille.coerceToSixDotCells function
 * Processes line by line to preserve newlines
 * @param {*} input_str 
 * @returns Braille Unicode string
 */
export function ascii2Braille(input_str) {
	try {
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
		return UnicodeBraille.toBrailleAscii(input_str);
	} catch (error) {
		console.warn('UnicodeBraille.toBrailleAscii failed:', error);
		return input_str; // Return original if conversion fails
	}
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
			latex = result.value || '';
			
		} catch (error) {
			console.error("Braille2latex failed for braille: " + braille);
			console.error("Original text: " + line);
			console.error(error);
		}
		
		console.log(latex);
		results.push(latex);
	}
	
	return results.join('\n');
}
