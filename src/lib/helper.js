export function handleFileChange(event) {
        const input = event.target;
        const file = input?.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                return reader.result;
            };
            reader.readAsText(file);
        }
}
