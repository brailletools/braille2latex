import Abraham from '$lib/abraham.min.js'; // the Desmos Abraham library 

/** 
* TODO: This constant is for a horrible embarassing hack to replace newlines with a character code 
* that is hopefully unique temporarily during parsing. To be fixed I HOPE!
*/
export const NEWLINESYM = "_*_";

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
	'': '⠄',
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

/**
 * Converts from ASCII characters to Braille Unicode characters.
 * @param {*} input_str 
 * @returns Braille Unicode string
 */
function ascii2Braille(input_str) {
	let out = '';
	for (const input_char of input_str) {
		out += mapping[input_char] || '';
	}
	return out;
}



export function nemeth_to_latex(text) {
	// convert the data to Braille
	text = text.trim();
	console.log("converting math" + text);
	let latex = '';
	let braille = '';
	try {
		braille = ascii2Braille(text);
	} catch (error) {
		console.log("Ascii2Braille failed: " + text);
		console.log(error)
	}

	try {
		latex = Abraham.nemethToLatex(braille).value;
	} catch (error) {
		console.log("Braille2latex: " + braille);
		console.log(error)
	}
	console.log(latex);
	return latex;
}
