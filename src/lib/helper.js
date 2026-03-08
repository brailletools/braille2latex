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
 * Compiles a complete LaTeX document to PDF via the latexonline.cc free API
 * and triggers a browser download of the resulting PDF.
 * @param {string} latexContent - Complete LaTeX document (e.g. from wrapLatexDocument())
 * @param {string} filename - Desired output filename; ".tex" extension is replaced with ".pdf"
 * @returns {Promise<void>}
 * @throws {Error} if the service is unreachable or compilation fails
 */
export async function compileToPDF(latexContent, filename) {
	const pdfFilename =
		typeof filename === 'string' ? filename.replace(/\.tex$/i, '.pdf') : 'document.pdf';

	const formData = new FormData();
	const texBlob = new Blob([latexContent], { type: 'application/x-tex' });
	formData.append('file', texBlob, 'document.tex');

	const response = await fetch('https://latexonline.cc/compile', {
		method: 'POST',
		body: formData
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => '');
		throw new Error(
			`Compilation failed (HTTP ${response.status})${errorText ? ': ' + errorText.substring(0, 200) : ''}`
		);
	}

	const contentType = response.headers.get('Content-Type') ?? '';
	if (!contentType.includes('application/pdf')) {
		const text = await response.text().catch(() => '');
		throw new Error(`Service did not return a PDF${text ? ': ' + text.substring(0, 200) : ''}`);
	}

	const blob = await response.blob();
	downloadBlob(blob, pdfFilename);
}

/**
 * Opens the LaTeX content in Overleaf for online editing and PDF compilation.
 * Submits the content to Overleaf via a hidden form POST using the documented
 * "Open in Overleaf" API (POST https://www.overleaf.com/docs, field name "snip"),
 * opening the result in a new browser tab.
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
