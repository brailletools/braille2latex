// @ts-nocheck
import * as tf from '@tensorflow/tfjs';

/**
 * Braille OCR Service for client-side image recognition
 * Converts scanned Braille pages to Unicode Braille text
 */

let model = null;
let modelReady = false;

/**
 * Initialize the OCR model
 * Loads the TensorFlow.js model from the specified path
 * @param {string} modelPath - Path to the model.json file
 * @returns {Promise<void>}
 */
export async function initializeModel(modelPath = '/models/braille_ocr/model.json') {
	try {
		console.log('[BrailleOCR] Loading model from:', modelPath);
		model = await tf.loadLayersModel(modelPath);
		modelReady = true;
		console.log('[BrailleOCR] Model loaded successfully');
	} catch (error) {
		console.error('[BrailleOCR] Failed to load model:', error);
		modelReady = false;
		throw new Error(`Failed to initialize OCR model: ${error.message}`);
	}
}

/**
 * Check if the model is ready for inference
 * @returns {boolean}
 */
export function isModelReady() {
	return modelReady && model !== null;
}

/**
 * Load image from various input types
 * @param {HTMLImageElement|string|Blob|File} imageInput - Image to load
 * @returns {Promise<HTMLImageElement>}
 */
async function loadImage(imageInput) {
	if (imageInput instanceof HTMLImageElement) {
		return imageInput;
	}

	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = reject;

		if (typeof imageInput === 'string') {
			img.src = imageInput;
		} else if (imageInput instanceof Blob || imageInput instanceof File) {
			img.src = URL.createObjectURL(imageInput);
		} else {
			reject(new Error('Unsupported image input type'));
		}
	});
}

/**
 * Preprocess image for OCR using Canvas API
 * Converts to grayscale, adjusts contrast
 * @param {HTMLImageElement|string|Blob|File} imageInput - Image element or URL
 * @returns {Promise<ImageData>}
 */
async function preprocessImage(imageInput) {
	try {
		const img = await loadImage(imageInput);
		
		// Create canvas and draw image
		const canvas = document.createElement('canvas');
		canvas.width = img.width;
		canvas.height = img.height;
		const ctx = canvas.getContext('2d');
		ctx.drawImage(img, 0, 0);
		
		// Get image data
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const data = imageData.data;
		
		// Convert to grayscale and enhance contrast
		for (let i = 0; i < data.length; i += 4) {
			// Grayscale conversion
			const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
			
			// Enhance contrast (simple linear stretch)
			const enhanced = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
			
			data[i] = enhanced;     // R
			data[i + 1] = enhanced; // G
			data[i + 2] = enhanced; // B
			// Alpha stays the same
		}
		
		console.log('[BrailleOCR] Image preprocessed. Dimensions:', canvas.width, 'x', canvas.height);
		
		// Clean up if we created a URL
		if (imageInput instanceof Blob || imageInput instanceof File) {
			URL.revokeObjectURL(img.src);
		}
		
		return imageData;
	} catch (error) {
		console.error('[BrailleOCR] Image preprocessing failed:', error);
		throw error;
	}
}

/**
 * Segment Braille characters from the image
 * Detects individual Braille cell positions
 * @param {ImageData} imageData - Preprocessed image data
 * @returns {Array} Array of character regions with coordinates
 */
function segmentCharacters(imageData) {
	// This is a simplified segmentation approach
	// In production, this should be more sophisticated
	
	const width = imageData.width;
	const height = imageData.height;
	const data = imageData.data;
	
	const characters = [];
	const cellWidth = Math.max(20, Math.floor(width / 36)); // Assuming ~36 chars per line for slate
	const cellHeight = Math.max(20, Math.floor(height / 13)); // Assuming ~13 lines for standard slate

	console.log('[BrailleOCR] Cell dimensions:', cellWidth, 'x', cellHeight);

	// Simple grid-based segmentation
	for (let row = 0; row < height - cellHeight; row += cellHeight) {
		for (let col = 0; col < width - cellWidth; col += cellWidth) {
			const region = extractRegion(data, width, col, row, cellWidth, cellHeight);
			if (region && region.hasContent) {
				characters.push({
					x: col,
					y: row,
					width: cellWidth,
					height: cellHeight,
					data: region.data
				});
			}
		}
	}

	console.log('[BrailleOCR] Segmented', characters.length, 'characters');
	return characters;
}

/**
 * Extract a region from image data
 * @param {Uint8ClampedArray} imageData - Full image data (RGBA format)
 * @param {number} imageWidth - Full image width
 * @param {number} x - Region X coordinate
 * @param {number} y - Region Y coordinate
 * @param {number} width - Region width
 * @param {number} height - Region height
 * @returns {Object|null} Region data or null if empty
 */
function extractRegion(imageData, imageWidth, x, y, width, height) {
	const region = [];
	let hasContent = false;

	for (let row = 0; row < height; row++) {
		for (let col = 0; col < width; col++) {
			const idx = ((y + row) * imageWidth + (x + col)) * 4;
			const pixelValue = imageData[idx]; // R channel (grayscale)
			region.push(pixelValue);
			
			// If pixel is dark enough, region has content
			if (pixelValue < 200) {
				hasContent = true;
			}
		}
	}

	return hasContent ? { data: region, hasContent } : null;
}

/**
 * Recognize Braille characters from segmented regions
 * @param {Array} characters - Array of character regions from segmentation
 * @returns {Promise<string>} Recognized text as Unicode Braille
 */
async function recognizeCharacters(characters) {
	if (!modelReady || !model) {
		throw new Error('Model not ready for inference');
	}

	let result = '';
	const brailleMap = getBrailleCharacterMap();

	try {
		for (const char of characters) {
			// Normalize character data to tensor
			const tensor = tf.tensor2d([char.data], [1, char.data.length]);
			const normalized = tensor.div(255); // Normalize to 0-1

			// Run inference
			const prediction = model.predict(normalized);
			const output = await prediction.data();
			const charIndex = Math.argMax(output);

			// Map index to Braille character
			const brailleChar = brailleMap[charIndex] || '⠀'; // Empty cell fallback
			result += brailleChar;

			tensor.dispose();
			prediction.dispose();
		}
	} catch (error) {
		console.error('[BrailleOCR] Character recognition failed:', error);
		throw error;
	}

	return result;
}

/**
 * Get mapping of model output indices to Braille Unicode characters
 * This should match the training data encoding
 * @returns {Array<string>} Array of Braille Unicode characters
 */
function getBrailleCharacterMap() {
	// Braille Unicode range: U+2800 to U+28FF (64 dot combinations + space)
	// This is a basic mapping - should be trained specifically for your use case
	const map = [];
	for (let i = 0; i < 256; i++) {
		map.push(String.fromCharCode(0x2800 + i));
	}
	return map;
}

/**
 * Main OCR function: Convert image to Braille text
 * @param {HTMLImageElement|string|Blob|File} imageInput - Image to process
 * @returns {Promise<string>} Recognized Braille text
 */
export async function recognizeImage(imageInput) {
	try {
		console.log('[BrailleOCR] Starting OCR process...');

		if (!modelReady) {
			console.warn('[BrailleOCR] Model not loaded, initializing...');
			await initializeModel();
		}

		// Step 1: Preprocess image
		console.log('[BrailleOCR] Preprocessing image...');
		const preprocessed = await preprocessImage(imageInput);

		// Step 2: Segment characters
		console.log('[BrailleOCR] Segmenting characters...');
		const characters = segmentCharacters(preprocessed);

		if (characters.length === 0) {
			console.warn('[BrailleOCR] No characters detected in image');
			return '';
		}

		// Step 3: Recognize characters
		console.log('[BrailleOCR] Recognizing characters...');
		const result = await recognizeCharacters(characters);

		console.log('[BrailleOCR] OCR complete. Result length:', result.length);
		return result;
	} catch (error) {
		console.error('[BrailleOCR] OCR process failed:', error);
		throw error;
	}
}

/**
 * Process image and return formatted Braille with structure (lines)
 * @param {HTMLImageElement|string|Blob|File} imageInput - Image to process
 * @returns {Promise<string>} Formatted Braille text with newlines
 */
export async function recognizeImageWithFormatting(imageInput) {
	const brailleText = await recognizeImage(imageInput);
	
	// Assuming standard Braille slate: 36 characters per line, 13 lines
	const charsPerLine = 36;
	let formatted = '';
	
	for (let i = 0; i < brailleText.length; i++) {
		formatted += brailleText[i];
		if ((i + 1) % charsPerLine === 0 && i + 1 < brailleText.length) {
			formatted += '\n';
		}
	}
	
	return formatted;
}
