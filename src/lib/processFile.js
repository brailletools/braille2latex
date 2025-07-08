    import Abraham from '$lib/abraham.min.js'; // the Desmos Abraham library 
    import { ascii2Braille } from './brailleMap'; // import the ASCII to Braille mapping function
	import * as ohm from 'ohm-js'; // import the ohm-js library for parsing
	import grammarFile from '$lib/grammar.ohm?raw'; // import the grammar file for parsing
    
	/**
	 * A grammar specifies how a text file or string is organized (such as
	 * the fact that two newlines before and after math should be interpreted as 
	 * an equation in latex). Using the grammar, we can parse a file or string
	 * into a syntax tree, which is a structured representation of the text.
	 */
	export const grammar = ohm.grammar(grammarFile); // create the grammar from the file

	export const semantics = grammar.createSemantics(); // create the semantics for the grammar
	
	/**
	 * Semantics define how to interpret the syntax tree. Specifically, they allow 
	 * us to walk through the syntax tree and produce a new string, which is 
	 * the LaTeX representation of the original text.
	 */
	semantics.addOperation('eval', {
		/**
		 * This is the root of the semantics. It evaluates the entire syntax tree
		 * and returns the LaTeX representation of the text.
		 * @param {*} _spaces 
		 * @param {*} paragraphs 
		 * @param {*} _newlines 
		 * @returns 
		 */
		Braille(_spaces, paragraphs, _newlines) {
			console.debug('Braille: eval paragraphs');
			return paragraphs.children.map((paragraph) => paragraph.eval()).join('\n\n');
		},

		/**
		 * This specifies that Braille recognized as inline Nemeth code should be evaluated 
		 * should be converted to LaTeX math and surrounded by dollar signs to indicate
		 * an inline math expression.
		 * @param {*} _open 
		 * @param {*} nemeth 
		 * @param {*} _close 
		 * @returns 
		 */
		InlineNemeth(_open, nemeth, _close) {
			console.debug('InlineNemeth: eval text');
			let latex = Abraham.nemethToLatex(ascii2Braille(nemeth.eval())).value;
			console.debug(latex);
			return '$' + latex + '$';
		},

		/**
		 * This specifies that Braille recognized as Nemeth code and surrounded by
		 * newlines should be evaluated as a LaTeX equation instead of inline math.
		 * @param {*} nemeth 
		 * @returns 
		 */
		Equation(nemeth) {
			console.debug('Equation: eval nemeth');
			return '$' + nemeth.eval() + '$';
		},

		/**
		 * This essentially says that a single line break in Braille should 
		 * be a single newline in LaTeX (which will be ignored in LaTeX).
		 * @param {*} _ 
		 * @returns 
		 */
		EndLine(_) {
			console.debug('EndLine');
			return '\n';
		},

		/**
		 * This specifies that a paragraph (Braille with two newlines before and after
		 * it) should be converted to two newlines in LaTeX, which will create a new paragraph.
		 * @param {*} _line 
		 * @param {*} _space 
		 * @param {*} _line2 
		 * @param {*} _spaces 
		 * @returns 
		 */
		EndParagraph(_line, _space, _line2, _spaces) {
			console.debug('EndParagraph');
			return '\n\n';
		},

		/**
		 * This specifies that Braille text should not be changed in any way
		 * @param {*} txt 
		 * @returns 
		 */
		Text(txt) {
			console.debug('Text');
			let latex = txt.sourceString;
			console.debug(latex);
			return latex;
		},

		/**
		 * This specifies that a paragraph is made up of one ore more text or Nemeth items
		 * and that these items should be evaluated and joined together with a space between them.
		 * @param {*} items1 
		 * @param {*} items2 
		 * @returns 
		 */
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

		/**
		 * This specifies that anything else in the syntax tree should be evaluated
		 * by calling the eval method on each child. This is a catch-all for any other
		 * type of node in the syntax tree that we haven't explicitly defined.
		 * @param  {...any} children 
		 * @returns 
		 */
		_iter(...children) {
			console.debug('iter: eval children');
			return children.map((c) => c.eval());
		}
	});