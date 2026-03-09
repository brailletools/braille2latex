/**
 * Reads a file from an input element and calls a callback with the file's content and name.
 * For BRL files, assumes the content is ASCII braille and passes it through.
 * For BRF files, reads as UTF-8 text.
 * @param {*} event
 * @param {*} callback
 */
export function handleFileChange(event, callback) {
	const input = event.target;
	const file = input?.files?.[0];
	if (file) {
		const reader = new FileReader();
		reader.onload = () => {
			callback(reader.result, file.name);
		};
		// Always read as UTF-8 - works for both BRF and BRL files
		reader.readAsText(file, 'UTF-8');
	}
}

/**
 * Saves a text string as a file with the specified filename.
 * @param {*} text
 * @param {*} filename
 */
export function downloadText(text, filename) {
	const isTex = typeof filename === 'string' && filename.toLowerCase().endsWith('.tex');
	const mime = isTex ? 'application/x-tex' : 'text/plain';
	const blob = new Blob([text], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Wraps LaTeX body content in a minimal, compile-ready LaTeX document.
 * Ensures the downloaded file is a complete .tex document.
 * @param {string} content - LaTeX body to place inside the document environment
 * @returns {string} - Complete LaTeX document
 */
export function wrapLatexDocument(content) {
	const body = (content ?? '').trim();
	// If the body is an error message, comment it out to avoid compilation failure
	const safeBody = body.startsWith('Error') ? `% ${body}` : body;
	return [
		'\\documentclass[fleqn]{article}',
		'\\usepackage[utf8]{inputenc}',
		'\\usepackage{amsmath}',
		'\\usepackage{amssymb}',
		'% Remove left indentation for display math to fully left-justify',
		'\\setlength{\\mathindent}{0pt}',
		'\\begin{document}',
		safeBody || '% Empty document',
		'\\end{document}',
		''
	].join('\n');
}

/**
 * Wraps LaTeX body content for browser-based rendering with latex.js.
 * Uses a minimal document structure without packages that require Node.js.
 * @param {string} content - LaTeX body content
 * @returns {string} - Simplified LaTeX document compatible with latex.js
 */
export function wrapLatexDocumentForBrowser(content) {
	const body = (content ?? '').trim();
	const safeBody = body.startsWith('Error') ? `% ${body}` : body;
	return [
		'\\documentclass{article}',
		'\\begin{document}',
		safeBody || '% Empty document',
		'\\end{document}',
		''
	].join('\n');
}

/**
 * Validates whether a string appears to be a complete LaTeX document.
 * Checks for documentclass and document environment markers.
 * @param {string} text
 * @returns {boolean}
 */
export function isCompleteLatexDocument(text) {
	const hasDocClass = /\\documentclass\{[^}]+\}/.test(text);
	const hasBegin = /\\begin\{document\}/.test(text);
	const hasEnd = /\\end\{document\}/.test(text);
	return hasDocClass && hasBegin && hasEnd;
}

/**
 * Triggers a browser download for an arbitrary Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Compiles a complete LaTeX document to PDF using a browser-based LaTeX compiler.
 * Uses latex.js to parse LaTeX and generate HTML, then html2pdf to create a PDF.
 * All processing happens in the browser—no external API calls.
 * @param {string} latexContent - Complete LaTeX document (e.g. from wrapLatexDocument())
 * @param {string} filename - Desired output filename; ".tex" extension is replaced with ".pdf"
 * @returns {Promise<void>}
 * @throws {Error} if compilation fails
 */
export async function compileToPDF(latexContent, filename) {
	const pdfFilename =
		typeof filename === 'string' ? filename.replace(/\.tex$/i, '.pdf') : 'document.pdf';

	try {
		// Get latex.js from global window (loaded via CDN in app.html)
		// The CDN exposes it as 'latexjs' (all lowercase)
		if (!window.latexjs) {
			throw new Error('LaTeX.js library not loaded. Expected window.latexjs to be available.');
		}

		// Get html2pdf from global window (it's a UMD browser library)
		if (!window.html2pdf) {
			throw new Error('html2pdf library not loaded in browser');
		}
		const html2pdf = window.html2pdf;

		// Extract just the document body for browser rendering
		// latex.js can't handle some packages, so strip them out
		const bodyMatch = latexContent.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
		const bodyContent = bodyMatch ? bodyMatch[1].trim() : latexContent;
		const browserLatex = wrapLatexDocumentForBrowser(bodyContent);

		// Create a new HtmlGenerator and use it to parse and generate HTML
		// latex.js API: create generator, then parse with it
		const generator = new window.latexjs.HtmlGenerator({ hyphenate: false });
		const doc = window.latexjs.parse(browserLatex, { generator });

		// The parse returns a DOM node tree - we need to serialize it to HTML
		// The generator has the htmlDocument property with the full document
		const htmlDoc = generator.htmlDocument();

		// Carry over any styles/scripts that latex.js placed in the generated <head>
		if (htmlDoc.head && document && document.head) {
			Array.from(htmlDoc.head.children).forEach((node) => {
				const tag = node.tagName && node.tagName.toLowerCase();
				if (tag === 'style' || tag === 'link' || tag === 'script') {
					// Import the node into the current document before appending
					const imported = document.importNode(node, true);
					document.head.appendChild(imported);
				}
			});
		}

		// Get the body innerHTML, but remove any duplicate content or source code annotations
		let html = htmlDoc.body.innerHTML;

		// latex.js generates both katex-mathml (accessibility) and katex-html (display)
		// We want the MathML version for better accessibility
		const container = document.createElement('div');
		container.innerHTML = html;

		// Remove katex-html elements (we want the MathML version for accessibility)
		const htmlElements = container.querySelectorAll('.katex-html');
		htmlElements.forEach((el) => el.remove());

		// Also remove any pre elements that contain source code (they'll have the LaTeX source)
		const preElements = container.querySelectorAll('pre');
		preElements.forEach((pre) => {
			const text = pre.textContent || pre.innerText || '';
			// If the pre contains LaTeX commands, it's probably the source code
			if (text.includes('\\') || text.includes('documentclass')) {
				pre.remove();
			}
		});

		html = container.innerHTML;
		container.style.padding = '20px';
		container.style.fontFamily = 'serif';
		container.style.lineHeight = '1.5';
		container.style.backgroundColor = 'white';

		// Configure html2pdf options
		const opt = {
			margin: 10,
			filename: pdfFilename,
			image: { type: 'jpeg', quality: 0.98 },
			html2canvas: { scale: 2, useCORS: true },
			jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
		};

		// Generate and download PDF
		await html2pdf().set(opt).from(container).save();
	} catch (err) {
		console.error('PDF compilation error:', err);
		throw new Error(`LaTeX compilation failed: ${err?.message ?? 'Unknown error'}`);
	}
}

/**
 * Opens the LaTeX content in Overleaf for online editing and PDF compilation.
 * Submits the content to Overleaf's "Open in Overleaf" API (POST https://www.overleaf.com/docs,
 * field name "snip") via a hidden form, opening the result in a new browser tab.
 * See: https://www.overleaf.com/learn/latex/Using_the_Overleaf_API
 * @param {string} latexContent - Complete LaTeX document content
 */
export function openInOverleaf(latexContent) {
	const form = document.createElement('form');
	form.method = 'post';
	// Overleaf "Open in Overleaf" API endpoint — accepts `snip` (inline content)
	// or `snip_uri` (data-URI / URL). Using `snip` for direct content submission.
	form.action = 'https://www.overleaf.com/docs';
	form.target = '_blank';
	form.style.display = 'none';

	const input = document.createElement('input');
	input.type = 'hidden';
	input.name = 'snip';
	input.value = latexContent;

	form.appendChild(input);
	document.body.appendChild(form);
	form.submit();
	document.body.removeChild(form);
}

/**
 * Converts a complete LaTeX document to HTML using latex.js and opens it in a new tab.
 * All processing happens in the browser—no external API calls.
 * @param {string} latexContent - Complete LaTeX document (e.g. from wrapLatexDocument())
 * @returns {Promise<void>}
 * @throws {Error} if conversion fails
 */
export async function compileToHTML(latexContent) {
	try {
		// Get latex.js from global window (loaded via CDN in app.html)
		// The CDN exposes it as 'latexjs' (all lowercase)
		if (!window.latexjs) {
			throw new Error('LaTeX.js library not loaded. Expected window.latexjs to be available.');
		}

		// Extract just the document body for browser rendering
		// latex.js can't handle some packages, so strip them out
		const bodyMatch = latexContent.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
		const bodyContent = bodyMatch ? bodyMatch[1].trim() : latexContent;
		const browserLatex = wrapLatexDocumentForBrowser(bodyContent);

		// Create a new HtmlGenerator and use it to parse and generate HTML
		// latex.js API: create generator, then parse with it
		const generator = new window.latexjs.HtmlGenerator({ hyphenate: false });
		const doc = window.latexjs.parse(browserLatex, { generator });

		// The parse returns a DOM node tree - we need to serialize it to HTML
		// The generator has the htmlDocument property with the full document
		const htmlDoc = generator.htmlDocument();

		// Get the body innerHTML, but remove any duplicate content or source code annotations
		let html = htmlDoc.body.innerHTML;

		// latex.js generates both katex-mathml (accessibility) and katex-html (display)
		// For HTML output, we want the MathML version for better accessibility
		const htmlContainer = document.createElement('div');
		htmlContainer.innerHTML = html;

		// Remove katex-html elements (we want the MathML version for accessibility)
		const htmlElements = htmlContainer.querySelectorAll('.katex-html');
		htmlElements.forEach((el) => el.remove());

		// Also remove any pre elements that contain source code (they'll have the LaTeX source)
		const preElements = htmlContainer.querySelectorAll('pre');
		preElements.forEach((pre) => {
			const text = pre.textContent || pre.innerText || '';
			// If the pre contains LaTeX commands, it's probably the source code
			if (text.includes('\\') || text.includes('documentclass')) {
				pre.remove();
			}
		});

		html = htmlContainer.innerHTML;

		// Wrap in a complete HTML document
		const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>LaTeX to HTML</title>
	<style>
		body {
			font-family: serif;
			line-height: 1.5;
			max-width: 800px;
			margin: 0 auto;
			padding: 20px;
			background-color: #fff;
			color: #000;
		}
		code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
		pre { background: #f5f5f5; padding: 10px; border-radius: 3px; overflow-x: auto; }
		table { border-collapse: collapse; width: 100%; }
		td, th { border: 1px solid #ddd; padding: 8px; text-align: left; }
		th { background-color: #f5f5f5; }
	</style>
</head>
<body>
	${html}
</body>
</html>`;

		// Open in a new tab
		const blob = new Blob([fullHtml], { type: 'text/html' });
		const url = URL.createObjectURL(blob);

		// Attempt to open a new tab/window. This may be blocked by popup blockers.
		const newWindow = window.open('', '_blank');

		// Function to safely revoke the object URL
		const revokeUrl = () => {
			try {
				URL.revokeObjectURL(url);
			} catch (e) {
				// Ignore errors during revoke
			}
		};

		if (newWindow) {
			// Navigate the newly opened window to the Blob URL
			newWindow.location.href = url;

			// Revoke the URL once the new page has loaded
			const onLoad = () => {
				revokeUrl();
				newWindow.removeEventListener('load', onLoad);
			};
			newWindow.addEventListener('load', onLoad);

			// Fallback: ensure revocation even if 'load' doesn't fire as expected
			setTimeout(revokeUrl, 60000);
		} else {
			// Popup was blocked; fall back to navigating the current window
			window.location.href = url;
			// Revoke the URL after a delay to allow navigation to complete
			setTimeout(revokeUrl, 60000);
		}
	} catch (err) {
		console.error('HTML conversion error:', err);
		throw new Error(`HTML conversion failed: ${err?.message ?? 'Unknown error'}`);
	}
}
