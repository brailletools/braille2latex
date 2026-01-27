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
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}