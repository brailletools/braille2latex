export function handleFileChange(event, callback) {
        const input = event.target;
        const file = input?.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                callback(reader.result, file.name);
            };
            reader.readAsText(file);
        }
}

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