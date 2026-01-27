import Abraham from '$lib/abraham.min.js'; // the Desmos Abraham library 

/**
 * Mapping from ASCII characters to Braille Unicode characters.
 * This mapping is based on the Braille ASCII standard.
 */
const mapping = {
	'\n': '\n',
	' ': '⠀',
	'!': '⠮',
	'"': '⠐',
	'#': '⠼',
	$: '⠫',
	'%': '⠩',
	'&': '⠯',
	"'": '⠄',
	'(': '⠷',
	')': '⠾',
	'*': '⠡',
	'+': '⠬',
	',': '⠠',
	'-': '⠤',
	'.': '⠨',
	'/': '⠌',
	'0': '⠴',
	'1': '⠂',
	'2': '⠆',
	'3': '⠒',
	'4': '⠲',
	'5': '⠢',
	'6': '⠖',
	'7': '⠶',
	'8': '⠦',
	'9': '⠔',
	':': '⠱',
	';': '⠰',
	'<': '⠣',
	'=': '⠿',
	'>': '⠜',
	'?': '⠹',
	'@': '⠈',
	a: '⠁',
	b: '⠃',
	c: '⠉',
	d: '⠙',
	e: '⠑',
	f: '⠋',
	g: '⠛',
	h: '⠓',
	i: '⠊',
	j: '⠚',
	k: '⠅',
	l: '⠇',
	m: '⠍',
	n: '⠝',
	o: '⠕',
	p: '⠏',
	q: '⠟',
	r: '⠗',
	s: '⠎',
	t: '⠞',
	u: '⠥',
	v: '⠧',
	w: '⠺',
	x: '⠭',
	y: '⠽',
	z: '⠵',
	A: '⠁',
	B: '⠃',
	C: '⠉',
	D: '⠙',
	E: '⠑',
	F: '⠋',
	G: '⠛',
	H: '⠓',
	I: '⠊',
	J: '⠚',
	K: '⠅',
	L: '⠇',
	M: '⠍',
	N: '⠝',
	O: '⠕',
	P: '⠏',
	Q: '⠟',
	R: '⠗',
	S: '⠎',
	T: '⠞',
	U: '⠥',
	V: '⠧',
	W: '⠺',
	X: '⠭',
	Y: '⠽',
	Z: '⠵',
	'[': '⠪',
	'\\': '⠳',
	']': '⠻',
	'^': '⠘',
	_: '⠸'
};

// Create reverse mapping from Braille to ASCII
// Process in a way that prefers lowercase letters when both upper/lower map to same braille
const reverseMapping = {};
Object.entries(mapping).forEach(([key, value]) => {
	// Only set if not already mapped, or if this is lowercase (prefer lowercase)
	if (!reverseMapping[value] || /[a-z]/.test(key)) {
		reverseMapping[value] = key;
	}
});

/**
 * Converts from ASCII characters to Braille Unicode characters.
 * @param {*} input_str 
 * @returns Braille Unicode string
 */
export function ascii2Braille(input_str) {
	let out = '';
	for (const input_char of input_str) {
		out += mapping[input_char] || '';
	}
	return out;
}

/**
 * Converts from Braille Unicode characters to ASCII characters.
 * @param {*} input_str 
 * @returns ASCII string
 */
export function braille2Ascii(input_str) {
	let out = '';
	for (const input_char of input_str) {
		const mapped = reverseMapping[input_char];
		if (mapped !== undefined) {
			out += mapped;
		} else if (input_char.match(/[\u2800-\u28FF]/)) {
			// Unmapped braille character - log and skip
			console.warn('Unmapped braille character:', input_char, 'U+' + input_char.charCodeAt(0).toString(16).toUpperCase());
		} else {
			// Not braille, keep as-is (space, newline, etc.)
			out += input_char;
		}
	}
	return out;
}



export function nemeth_to_latex(text) {
	// convert the data to Braille
	text = text.trim();
	if (!text) return '';
	
	console.info("converting math" + text);
	let latex = '';
	let braille = '';
	
	try {
		braille = ascii2Braille(text);
	} catch (error) {
		console.error("Ascii2Braille failed: " + text);
		console.error(error);
		return text; // Fallback to original text
	}

	try {
		const result = Abraham.nemethToLatex(braille);
		latex = result.value || '';
		
	} catch (error) {
		console.error("Braille2latex failed for braille: " + braille);
		console.error("Original text: " + text);
		console.error(error);
		// Fallback: try to do basic substitution
		latex = text.replace(/\.k/g, '=').replace(/_/g, ' ');
	}
	
	console.log(latex);
	return latex;
}
