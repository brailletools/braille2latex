import Abraham from '$lib/abraham.min.js'; // the Desmos Abraham library 
import { ascii2Braille } from './brailleMap'; // import the ASCII to Braille mapping function
import * as ohm from 'ohm-js'; // import the ohm-js library for parsing
import grammarBraille from '$lib/grammarBraille.ohm?raw'; // import the grammar file for parsing
import grammarInner from '$lib/grammarInner.ohm?raw'; // import the grammar file for parsing

const P = (content) => ({ type: 'P', content })
const E = (content) => ({ type: 'E', content })

/**
 * A parser is a tool that takes a text file or string and breaks it down into its
 * component parts, according to a set of rules defined in a grammar. This allows us
 * to analyze the structure of the text and extract meaningful information from it.
 * In this case, we are using the ohm-js library to create a parser from the grammar files.
 * The parser will be used to parse Braille text and convert it into LaTeX format.
 */
export function parse_blocks(text) {
	let blocks = parse_blocks_outer(text);
	blocks.map(block => {
		if ((block.type = 'P')
			|| (block.type = 'E')
			|| (block.type = 'N')) {
			console.log("parsing block", block.toString());
			let block = parse_blocks_inner(block);
			console.log("match", block);
			return block;
			}
		return block;
	});

function parse_blocks_outer(text) {}
	let parser = {}
	/**
	  * A grammar specifies how a text file or string is organized (such as
	  * the fact that two newlines before and after math should be interpreted as 
	  * an equation in latex). Using the grammar, we can parse a file or string
	  * into a syntax tree, which is a structured representation of the text.
	 */
	parser.grammar = ohm.grammar(grammarBraille); // create the grammar from the file
	parser.semantics = parser.grammar.createSemantics();
	/**
	  * Semantics define how to interpret the syntax tree. Specifically, they allow 
	  * us to walk through the syntax tree and produce a new string, which is 
	  * the LaTeX representation of the original text.
	  */
	parser.semantics.addOperation('blocks', {
		_terminal() { return this.sourceString },
		Blank: (a, b) => ({ type: 'BLANK' }),
		Paragraph: a => P(a.sourceString),
		Equation: (_1, a, _2, _) => E(a.blocks().join("")),
		_iter(...children) {
			return children.map(c => c.blocks().join(""));
		}
	})

	let match = parser.grammar.match(text + "\n\n");
	console.log("parsing text", match.toString());
	return match;
}

function parse_blocks_inner(block) {
	let parser = {};

	parser.grammar = ohm.grammar(grammarInner); // create the grammar from the file
	parser.semantics = parser.grammar.createSemantics(); // create the semantics for the grammar

	parser.semantics.addOperation('content', {
		_terminal() { return this.sourceString },
		Plain(a) { return ['Plain', a.content().join("")] },
		Bold(_1, a, _2) { return ['Bold', "\textbf{" + a.content().join("") + "}"] },
		Italic(_1, a, _2) { return ['Italic', "\textit{" + a.content().join("") + "}"] },
		InlineNemeth(_1, a, _2) {
			return ['N',
				N("$" + Abraham.nemethToLatex(ascii2Braille(a.content().join(""))) + "$")]
		}
	});

	let match = parser.semantics(match);
	console.log("parsing text", match.toString());
	if (match.failed()) {
		l("match failed on block", block)
		block.content = [['plain', block.content]]
	} else {
		block.content = parser.semantics(match).content()
	}
	return block
}



