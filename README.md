# Braille2Latex

This is a website that lets you type in braille or upload a braille file, and download it as latex. It supports math in NEMETH format. You can try it at 
https://make4all.github.io/braille2latex/

The Nemeth to Latex conversion is handled by the Desmos [abraham library](https://www.desmos.com/api/v1.11/docs/abraham.html)

Other Braille conversion is based on the [liblouis](https://github.com/liblouis/liblouis) library.

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

