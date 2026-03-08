<script>
	// @ts-nocheck
	import sample from '$lib/Sample Quiz.brf?raw';
	import {
		handleFileChange,
		downloadText,
		wrapLatexDocument,
		isCompleteLatexDocument
	} from '$lib/helper.js';
	import { parse } from '$lib/processFile.js';
	import { ascii2Braille, braille2Ascii } from '$lib/brailleMap.js';
	import { recognizeImageWithFormatting, isModelReady } from '$lib/brailleOCR.js';
	import liblouis from 'liblouis/easy-api';

	import { base } from '$app/paths';

	// Use liblouis 3.2.0-rc with tables loaded on demand from static/liblouis/tables
	const capi_url = base + '/liblouis/build-no-tables-utf16.js';
	const easyapi_url = base + '/liblouis/easy-api.js';
	const tables_url = base + '/liblouis/tables/';
	console.log(liblouis);

	console.log(capi_url);
	console.log(easyapi_url);

	const brailleTables = [
		{ value: 'en-ueb-g2.ctb', label: 'English UEB Grade 2' },
		{ value: 'en-ueb-g1.ctb', label: 'English UEB Grade 1' },
		{ value: 'en-ueb-math.ctb', label: 'English UEB Math' }
	];

	let text = $state(sample);
	let filename = $state('example_filename.tex');
	let selectedTable = $state(brailleTables[0].value);

	// Image upload and OCR state
	let imageFile = $state(null);
	let imagePreviewUrl = $state('');
	let ocrProcessing = $state(false);
	let ocrError = $state('');

	// Keep braille text as state, but sync with text
	let brailleText = $state(ascii2Braille(sample));
	let lastBrailleText = ascii2Braille(sample);
	
	// Track if the Worker is ready
	let liblouisReady = $state(false);
	let parseReady = $state(false);
	
	// Display value: always show braille, converting ASCII to braille if needed
	let displayBrailleText = $derived.by(() => {
		if (containsAscii(brailleText) && !containsBraille(brailleText)) {
			// Contains ASCII - convert to braille for display
			return ascii2Braille(brailleText);
		}
		return brailleText;
	});
	
	// Check if a string contains braille characters (Unicode 0x2800-0x28FF range)
	function containsBraille(str) {
		return /[\u2800-\u28FF]/.test(str);
	}
	
	// Check if a string contains ASCII text (not just braille or whitespace)
	function containsAscii(str) {
		return /[^\u2800-\u28FF\s\n]/.test(str);
	}
	
	// Convert any remaining ASCII characters to braille in a mixed string
	function sanitizeToAllBraille(str) {
		let result = '';
		for (const char of str) {
			// Check if it's already a braille character, space, or newline
			if (/[\u2800-\u28FF\s]/.test(char)) {
				// Keep braille, spaces, and newlines as-is
				result += char;
			} else {
				// Try to convert any other ASCII character to braille
				const brailleChar = ascii2Braille(char);
				// Use the converted version if different, otherwise keep original
				result += brailleChar !== char ? brailleChar : char;
			}
		}
		return result;
	}
	
	// Intercept and convert ASCII characters before they enter the textarea
	function handleBeforeInput(event) {
		if (!event.data) return;
		
		// Attempt to convert any printable ASCII character to braille
		// This includes letters, numbers, punctuation, etc.
		const brailleChar = ascii2Braille(event.data);
		
		// Only intercept if conversion produces a different result (indicating it was successfully converted)
		if (brailleChar !== event.data) {
			console.log('Converting character before input:', event.data, '=>', brailleChar);
			event.preventDefault();
			
			// Insert the braille character at the cursor position
			const textarea = event.target;
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const currentValue = textarea.value;
			
			const newValue = currentValue.substring(0, start) + brailleChar + currentValue.substring(end);
			textarea.value = newValue;
			brailleText = newValue;
			text = braille2Ascii(newValue);
			lastBrailleText = newValue;
			
			// Move cursor to after inserted character
			textarea.setSelectionRange(start + brailleChar.length, start + brailleChar.length);
		}
	}
	
	// Update both text representations when user types or pastes
	function handleBrailleInput(event) {
		let inputValue = event.target.value;
		
		// Sanitize any stray ASCII letters to braille (for paste events)
		inputValue = sanitizeToAllBraille(inputValue);
		
		// Determine if input contains ASCII or braille
		const hasAscii = containsAscii(inputValue);
		const hasBraille = containsBraille(inputValue);
		
		console.log('Input detected - ASCII:', hasAscii, 'Braille:', hasBraille);
		
		if (hasAscii && !hasBraille) {
			// Pure ASCII input - convert to braille for display, keep ASCII for processing
			const brailleConverted = ascii2Braille(inputValue);
			console.log('ASCII to Braille:', inputValue, '=>', brailleConverted);
			brailleText = brailleConverted;
			text = inputValue;
			lastBrailleText = brailleConverted;
		} else if (hasBraille) {
			// Braille input - convert to ASCII for processing
			const asciiConverted = braille2Ascii(inputValue);
			console.log('Braille to ASCII:', inputValue, '=>', asciiConverted);
			brailleText = inputValue;
			text = asciiConverted;
			lastBrailleText = inputValue;
		} else {
			// Only whitespace or empty
			brailleText = inputValue;
			text = inputValue;
			lastBrailleText = inputValue;
		}
	}

	// Unified file upload handler - detects file type and routes accordingly
	function handleUnifiedFileUpload(event) {
		const file = event.target?.files?.[0];
		if (!file) return;

		// Check if it's an image file
		if (file.type.startsWith('image/')) {
			// Handle as image for OCR
			imageFile = file;
			ocrError = '';

			// Create preview
			const reader = new FileReader();
			reader.onload = () => {
				imagePreviewUrl = reader.result;
				console.log('[OCR] Image loaded for preview');
			};
			reader.readAsDataURL(file);
		} else {
			// Handle as text file (BRF/BRL)
			handleFileChange(event, (result, fname) => {
				text = result;
				brailleText = ascii2Braille(result);
				lastBrailleText = ascii2Braille(result);
				filename = fname.split('.').slice(0, -1).join('.') + '.tex';
				// Clear image preview if there was one
				clearImage();
			});
		}
	}

	// Process image with OCR
	async function processImageOCR() {
		if (!imageFile) {
			ocrError = 'No image selected';
			return;
		}

		ocrProcessing = true;
		ocrError = '';
		console.log('[OCR] Starting OCR processing...');

		try {
			// Check if model is ready, if not, use a placeholder message
			if (!isModelReady()) {
				console.warn('[OCR] Model not ready yet. Using demo/fallback mode.');
				ocrError = 'Note: OCR model is loading. Check console for details.';
				// For now, show placeholder message
				setTimeout(() => {
					ocrError = 'OCR model requires TensorFlow.js setup. See console for model loading status.';
				}, 1000);
			}

			// Call OCR service
			const recognizedText = await recognizeImageWithFormatting(imageFile);
			
			if (recognizedText && recognizedText.length > 0) {
				// Feed recognized text into the braille input
				brailleText = recognizedText;
				text = braille2Ascii(recognizedText);
				lastBrailleText = recognizedText;
				console.log('[OCR] Recognition complete. Found', recognizedText.length, 'characters');
				ocrError = '';
			} else {
				ocrError = 'No text recognized in image. Try a higher resolution scan or clearer image.';
			}
		} catch (error) {
			console.error('[OCR] Processing error:', error);
			ocrError = `OCR Error: ${error.message}`;
		} finally {
			ocrProcessing = false;
		}
	}

	// Clear image preview
	function clearImage() {
		imageFile = null;
		imagePreviewUrl = '';
		ocrError = '';
	}

	let latex = $derived.by(async () => {
		// Wait for Worker to be ready before attempting to parse
		if (!parseReady) {
			console.log('[latex] Waiting for parser to be ready...');
			return 'Initializing...';
		}
		
		try {
			console.log('[latex] Parsing with table:', selectedTable);
			console.log('[latex] Input text length:', text.length);
			
			// Parse the braille input with the selected table
			let evalstring = await parse(text, selectedTable);
			console.log('[latex] Parse complete');
			resolvedLatex = evalstring;
			return evalstring;
		} catch (error) {
			console.error('Parse error:', error);
			const errorMsg = `Error: ${error.message}`;
			resolvedLatex = errorMsg;
			return errorMsg;
		}
	});
	
	// Convert ASCII braille notation to Unicode braille
	function convertAsciBrailleToUnicode(asciBraille, table) {
		return new Promise((resolve) => {
			let attempt = 0;
			const maxAttempts = 2;
			
			console.log('[convertAsciBrailleToUnicode] ========== START ==========');
			console.log('[convertAsciBrailleToUnicode] Input length:', asciBraille.length);
			console.log('[convertAsciBrailleToUnicode] Input (JSON):', JSON.stringify(asciBraille));
			
			const attemptTranslate = () => {
				attempt++;
				try {
					console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt}. Input:`, asciBraille.substring(0, 100));
					
					let resolved = false;
					const callbackId = Math.random();
					console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} registered callback ID: ${callbackId}`);
					
					const timeout = setTimeout(() => {
						if (!resolved) {
							console.warn(`[convertAsciBrailleToUnicode] Attempt ${attempt} TIMEOUT - callback ${callbackId} was never invoked after 5s`);
							resolved = true;
							
							// Retry once after a delay if we haven't hit max attempts
							if (attempt < maxAttempts) {
								console.log(`[convertAsciBrailleToUnicode] Retrying attempt ${attempt + 1} after 500ms delay...`);
								setTimeout(attemptTranslate, 500);
							} else {
								console.warn(`[convertAsciBrailleToUnicode] Max attempts reached, falling back to original input`);
								console.log('[convertAsciBrailleToUnicode] Fallback return (JSON):', JSON.stringify(asciBraille));
								resolve(asciBraille);
							}
						}
					}, 5000);
					
					// Wait for Worker to be ready if needed
					const tryTranslate = () => {
						if (!liblouisReady) {
							console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} waiting for liblouisReady...`);
							setTimeout(tryTranslate, 100);
							return;
						}
						
						console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} liblouis is ready, calling translateString...`);
						try {
							// Ensure unicode.dis is included in table specification
							const fullTable = table.includes('unicode.dis') ? table : `unicode.dis,${table}`;
							console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} using table: ${fullTable}`);
							
							asyncLiblouis.translateString(
								fullTable,
								asciBraille,
								function(result) {
									console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} callback ${callbackId} INVOKED`);
									console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} result type: ${typeof result}`);
									console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} result is null/undefined: ${result == null}`);
									if (result) {
										console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} result length: ${result.length}`);
										console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} result (JSON): ${JSON.stringify(result.substring(0, 100))}`);
									}
									if (!resolved) {
										resolved = true;
										clearTimeout(timeout);
										if (result) {
											console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} SUCCESS - resolving with result`);
											console.log(`[convertAsciBrailleToUnicode] Full result (JSON): ${JSON.stringify(result)}`);
											resolve(result);
										} else {
											console.warn(`[convertAsciBrailleToUnicode] Attempt ${attempt} no result returned, falling back`);
											resolve(asciBraille);
										}
									} else {
										console.warn(`[convertAsciBrailleToUnicode] Attempt ${attempt} callback arrived after resolution`);
									}
								}
							);
							console.log(`[convertAsciBrailleToUnicode] Attempt ${attempt} callback registered, waiting for response...`);
						} catch (innerError) {
							if (!resolved) {
								resolved = true;
								clearTimeout(timeout);
								console.warn(`[convertAsciBrailleToUnicode] Attempt ${attempt} EXCEPTION in translateString:`, innerError);
								
								// Retry once after a delay if we haven't hit max attempts
								if (attempt < maxAttempts) {
									console.log(`[convertAsciBrailleToUnicode] Retrying attempt ${attempt + 1} after 500ms...`);
									setTimeout(attemptTranslate, 500);
								} else {
									console.warn(`[convertAsciBrailleToUnicode] Max attempts reached, falling back`);
									resolve(asciBraille);
								}
							}
						}
					};
					
					tryTranslate();
				} catch (error) {
					console.warn(`[convertAsciBrailleToUnicode] Attempt ${attempt} OUTER EXCEPTION:`, error);
					if (attempt < maxAttempts) {
						setTimeout(attemptTranslate, 500);
					} else {
						resolve(asciBraille);
					}
				}
			};
			
			console.log(`[convertAsciBrailleToUnicode] Starting translation attempts for input length ${asciBraille.length}`);
			attemptTranslate();
		});
	}
	
	// Track the resolved LaTeX for download
	let resolvedLatex = $state('');




	const authorizedExtensions = ['.brf', '.brl'];

	const asyncLiblouis = new liblouis.EasyApiAsync({
		capi: capi_url,
		easyapi: easyapi_url
	});

	function enableOnDemandTables() {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => reject(new Error('enableOnDemandTableLoading timed out')), 10000);
			asyncLiblouis.enableOnDemandTableLoading(tables_url, () => {
				clearTimeout(timeoutId);
				resolve();
			});
		});
	}

	function initializeLiblouis() {
		console.log('[init] Creating asyncLiblouis Worker...');
		const versionReady = new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => reject(new Error('version() timed out')), 10000);
			asyncLiblouis.version(() => {
				clearTimeout(timeoutId);
				resolve();
			});
		});

		return Promise.all([enableOnDemandTables(), versionReady]).then(() => {
			liblouisReady = true;
			parseReady = true;
			console.log('[liblouis] Worker initialized and ready');
		});
	}

	initializeLiblouis().catch(error => {
		console.error('[liblouis] Initialization failed', error);
	});
</script>

<!-- Styling is done with https://tailwindcss.com/, add a css class with whatever style you want -->
<div class="flex flex-row justify-center dark:bg-gray-900">
	<div class="h-screen flex-initial w-300 m-5">
		<div
			class="p-3 border border-gray-100 rounded-lg shadow-lg dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="pb-4 px-4">
				<h3 class="text-3xl dark:text-gray-100">File Upload</h3>

				<label
					id="braille-file-label"
					for="braille-file"
					class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Upload Braille file or image</label
				>
				<input
					accept=".brf,.brl,image/*"
					onchange={handleUnifiedFileUpload}
					id="braille-file"
					name="braille-file"
					type="file"
					aria-labelledby="braille-file-label"
					class="block w-96 text-sm bg-gray-50 dark:bg-gray-950 dark:text-gray-100 file:cursor-pointer cursor-pointer rounded-lg border border-gray-300 dark:border-gray-700 file:py-2 file:px-4 file:mr-4 file:bg-gray-800 dark:file:bg-gray-600 file:hover:bg-gray-700 file:text-white font-light file:font-normal"
				/>
				<p class="mt-1 text-sm text-gray-500 dark:text-gray-300" id="file_input_help">
					Text files (BRF/BRL) or images (JPEG/PNG). For images: best at 300 dpi, landscape, Braille slate scan. See syntax requirements <a
						href="https://github.com/make4all/braille2latex"
						class="font-medium text-blue-600 underline dark:text-blue-500 hover:no-underline"
						>here</a
					>
				</p>

				{#if imagePreviewUrl}
					<div class="mt-3 p-3 bg-gray-800 rounded-lg">
						<div class="mb-2">
							<img
								src={imagePreviewUrl}
								alt="Braille preview"
								class="max-w-full max-h-48 rounded border border-gray-600"
							/>
						</div>
						<div class="flex gap-2">
							<button
								onclick={processImageOCR}
								disabled={ocrProcessing}
								class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded text-sm"
							>
								{ocrProcessing ? 'Processing...' : 'Recognize Text'}
							</button>
							<button
								onclick={clearImage}
								class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-100 rounded text-sm"
							>
								Clear
							</button>
						</div>
						{#if ocrError}
							<div class="mt-2 p-2 bg-red-900 text-red-200 rounded text-sm">
								{ocrError}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="pb-4 px-4">
				<label for="braille-table" class="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Braille table</label>
				<select
					id="braille-table"
					bind:value={selectedTable}
					class="block w-96 text-sm bg-gray-50 dark:bg-gray-950 dark:text-gray-100 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2"
				>
					{#each brailleTables as table (table.value)}
						<option value={table.value}>{table.label}</option>
					{/each}
				</select>
				<p class="mt-1 text-sm text-gray-500 dark:text-gray-300">Used for back-translation during LaTeX conversion.</p>
			</div>
			<div class="flex flex-col lg:flex-row">
				<div class="p-4 flex-auto">
					<h3 class="text-3xl dark:text-gray-100 mb-2">Input (Braille)</h3>
					<textarea
						id="braille-text"
						value={brailleText}
						onbeforeinput={handleBeforeInput}
						oninput={handleBrailleInput}
						class="font-mono bg-gray-900 text-gray-100 rounded-lg p-2.5 whitespace-pre w-full h-96 resize-none overflow-y-auto"
						placeholder="Enter braille text here or upload a file..."
						aria-label="Braille input text"
					></textarea>
				</div>
				<div class="p-4 flex-auto">
					<h3 class="text-3xl dark:text-gray-100 mb-2">Output</h3>
					<div
						class="font-mono bg-gray-900 text-gray-100 rounded-lg p-2.5 whitespace-pre-line max-h-96 overflow-y-auto"
					>
						{#await latex}
							<span class="text-gray-500">Processing... (check browser console for errors)</span>
						{:then result}
							{#if result?.startsWith('Error')}
								<span class="text-red-500">{result}</span>
							{:else}
								{result}
							{/if}
						{:catch error}
							<span class="text-red-500">Fatal Error: {error?.message || error}</span>
						{/await}
					</div>
				</div>
			</div>
			<div class="p-4">
				<h3 class="text-3xl dark:text-gray-100">File Download</h3>
				<label id="latex-download-label" for="latex-download" class="dark:text-gray-100"
					>Download a Latex file:</label
				>

				<button
					id="latex-download"
					name="latex-download"
					class="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 dark:bg-blue-800 dark:hover:bg-blue-900"
					onclick={() => {
						const complete = wrapLatexDocument(resolvedLatex);
						if (!isCompleteLatexDocument(complete)) {
							console.warn('[download] Wrapped LaTeX document may be incomplete');
						}
						downloadText(complete, filename);
					}}
				>
					Download Input as File
				</button>
			</div>
		</div>
	</div>
</div>
