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
    a.download = filename
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

