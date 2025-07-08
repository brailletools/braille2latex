    import Abraham from '$lib/abraham.min.js';
    import { ascii2Braille } from './brailleMap';
	import * as ohm from 'ohm-js';
	import grammarFile from '$lib/grammar.ohm?raw';

    export const grammar = ohm.grammar(grammarFile);

	export const semantics = grammar.createSemantics();
	semantics.addOperation('eval', {
		Braille(_spaces, paragraphs, _newlines) {
			console.debug('Braille: eval paragraphs');
			return paragraphs.children.map((paragraph) => paragraph.eval()).join('\n\n');
		},

		InlineNemeth(_open, nemeth, _close) {
			console.debug('InlineNemeth: eval text');
			let latex = Abraham.nemethToLatex(ascii2Braille(nemeth.eval())).value;
			console.debug(latex);
			return '$' + latex + '$';
		},

		Equation(nemeth) {
			console.debug('Equation: eval nemeth');
			return '$' + nemeth.eval() + '$';
		},

		EndLine(_) {
			console.debug('EndLine');
			return '\n';
		},

		EndParagraph(_line, _space, _line2, _spaces) {
			console.debug('EndParagraph');
			return '\n\n';
		},

		Text(txt) {
			console.debug('Text');
			let latex = txt.sourceString;
			console.debug(latex);
			return latex;
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

		_iter(...children) {
			console.debug('iter: eval children');
			return children.map((c) => c.eval());
		}
	});