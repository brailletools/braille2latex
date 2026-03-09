# Braille2Latex

This is a website that lets you type in braille or upload a braille file, and download it as latex, PDF, or HTML. It supports math in NEMETH format. You can try it at 
https://make4all.github.io/braille2latex/

## Dependencies & Credits

This project uses the following open-source libraries:

### [Abraham](https://www.desmos.com/api/v1.11/docs/abraham.html) (Desmos)
Handles Nemeth to LaTeX conversion for mathematical notation.
- **License**: Proprietary (Desmos API)
- **Usage**: Converts ASCII Braille math (Nemeth) to LaTeX format

### [liblouis](https://github.com/liblouis/liblouis)
Provides Braille translation tables and conversion logic for various languages and Braille grades.
- **License**: LGPL v2.1+
- **Usage**: Translates between Braille and text, supports Grade 1, Grade 2, and UEB

### [latex.js](https://github.com/michael-brade/LaTeX.js)
A JavaScript LaTeX parser that generates HTML from LaTeX source code, enabling client-side rendering.
- **License**: MIT
- **Usage**: Converts LaTeX to HTML for preview and display, and intermediate format for PDF generation

### [html2pdf.js](https://github.com/eKoopmans/html2pdf.js)
Converts HTML content to PDF in the browser using jsPDF and html2canvas.
- **License**: MIT
- **Usage**: Generates PDF files from HTML without requiring server-side processing

### [liblouis (JavaScript binding)](https://github.com/liblouis/liblouis.js)
JavaScript bindings for liblouis, compiled to WebAssembly for browser compatibility.
- **License**: LGPL v2.1+
- **Usage**: Enables real-time Braille translation in the web interface

## Developing

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

