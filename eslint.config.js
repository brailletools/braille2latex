import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        ignores: ['node_modules/', 'src/abraham.min.js'],
    },
    {
        files: ['src/**/*.js'],
        languageOptions: {
            globals: { ...globals.browser },
        },
    },
    {
        files: ['*.mjs', '*.cjs', 'bin/**/*.js'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
];
