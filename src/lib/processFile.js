import Abraham from '$lib/abraham.min.js'; // the Desmos Abraham library 
import { ascii2Braille } from './brailleMap'; // import the ASCII to Braille mapping function
import * as ohm from 'ohm-js'; // import the ohm-js library for parsing
import grammarFile from '$lib/grammar.ohm?raw'; // import the grammar file for parsing

/**
 * A parser is a tool that takes a text file or string and breaks it down into its
 * component parts, according to a set of rules defined in a grammar. This allows us
 * to analyze the structure of the text and extract meaningful information from it.
 * In this case, we are using the ohm-js library to create a parser from the grammar files.
 * The parser will be used to parse Braille text and convert it into LaTeX format.
 */
export const grammar = ohm.grammar(grammarFile);

/**
  * Semantics define how to interpret the syntax tree. Specifically, they allow 
  * us to walk through the syntax tree and produce a new string, which is 
  * the LaTeX representation of the original text.
  */
export const semantics = grammar.createSemantics();
semantics.addOperation('eval', {
	Braille(_spaces, items, _newlines) {
		console.debug('Braille: eval paragraphs');
		return items.children.map((paragraph) => paragraph.eval()).join('\r\n\r\n');
	},

	InlineNemeth(_1, nemeth, _2) {
		console.debug('InlineNemeth: eval text');
		let latex = Abraham.nemethToLatex(ascii2Braille(nemeth.eval())).value;
		if (latex.isError) throw new Error("Invalid Nemeth");
		console.debug(latex);
		return '$' + latex + '$';
	},

	Equation(nemeth) {
		console.debug('Equation: eval nemeth');
		return '$' + nemeth.eval() + '$';
	},

	Blank(_) {
		return " ";
	},

	EndLine(_) {
		console.debug('EndLine');
		return '\r\n';
	},

	EndParagraph(_line, _space, _line2, _spaces) {
		console.debug('EndParagraph');
		return '\r\n\r\n';
	},

	Text(txt) {
		console.debug('Text');
		let res = txt.sourceString;
		return res;
	},

	Paragraph(items1, items2) {
		console.debug('Paragraph: eval children');
		let contents = items1.children.map((item1, i) => item1.eval() + items2.children[i].eval());
		console.debug('paragraph: items1');
		console.debug(items1.children.map((item1) => item1.eval()));
		console.debug('paragraph: items2');
		console.debug(items2.children.map((item2) => item2.eval()));
		console.debug('paragraph: end');

		return contents.join(' ');
	},
});



