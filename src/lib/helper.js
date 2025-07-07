export function handleFileChange(event, callback) {
        const input = event.target;
        const file = input?.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                callback(reader.result);
            };
            reader.readAsText(file);
        }
}
