/**
 * PDF extraction utilities using proper PDF.js library
 */

// Import PDF.js for proper PDF parsing
let pdfjsLib: any = null;

// Initialize PDF.js in a way that works with Cloudflare Workers
async function initPDFJS() {
  if (pdfjsLib) return pdfjsLib;
  
  try {
    // Try to import pdfjs-dist
    pdfjsLib = await import('pdfjs-dist');
    
    // Configure PDF.js for Workers environment
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = null; // Disable worker in CF Workers
    }
    
    return pdfjsLib;
  } catch (error) {
    console.warn('PDF.js not available, falling back to basic extraction');
    return null;
  }
}

/**
 * Improved PDF text extraction using PDF.js library with fallback
 */
export async function extractPDFText(pdfBuffer: ArrayBuffer): Promise<string> {
  const fileSize = pdfBuffer.byteLength;
  console.log(`Processing PDF: ${Math.round(fileSize / 1024)}KB`);
  
  // First try PDF.js (proper PDF parser)
  try {
    const pdfjs = await initPDFJS();
    if (pdfjs) {
      console.log('Using PDF.js for extraction...');
      return await extractWithPDFJS(pdfBuffer, pdfjs);
    }
  } catch (error) {
    console.warn('PDF.js extraction failed, trying fallback methods:', error);
  }
  
  // Fallback to manual parsing methods
  console.log('Using fallback PDF extraction methods...');
  return await extractWithFallbackMethods(pdfBuffer);
}

/**
 * Extract text using proper PDF.js library
 */
async function extractWithPDFJS(pdfBuffer: ArrayBuffer, pdfjs: any): Promise<string> {
  try {
    const uint8Array = new Uint8Array(pdfBuffer);
    
    // Load PDF document
    const loadingTask = pdfjs.getDocument({
      data: uint8Array,
      useSystemFonts: true,
      verbosity: 0, // Reduce logging
    });
    
    const pdf = await loadingTask.promise;
    console.log(`PDF loaded: ${pdf.numPages} pages`);
    
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 50); // Limit pages to process
    
    // Extract text from each page
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // Combine text items from the page
        const pageText = textContent.items
          .map((item: any) => {
            if (item.str) {
              return item.str;
            }
            return '';
          })
          .join(' ')
          .trim();
        
        if (pageText) {
          fullText += pageText + '\n\n';
        }
        
        // Clean up page resources
        page.cleanup();
        
        console.log(`Processed page ${pageNum}/${maxPages} (${pageText.length} chars)`);
        
        // For large documents, stop early if we have enough text
        if (fullText.length > 50000 && pageNum > 10) {
          console.log('Sufficient text extracted, stopping early');
          break;
        }
      } catch (pageError) {
        console.warn(`Error processing page ${pageNum}:`, pageError);
        continue; // Skip this page and continue
      }
    }
    
    // Clean up PDF resources
    pdf.destroy();
    
    if (!fullText.trim()) {
      throw new Error('No text content found in PDF pages');
    }
    
    const cleanedText = cleanExtractedText(fullText);
    console.log(`PDF.js extraction successful: ${cleanedText.length} characters`);
    return cleanedText;
    
  } catch (error: any) {
    throw new Error(`PDF.js extraction failed: ${error.message}`);
  }
}

/**
 * Fallback extraction methods when PDF.js fails
 */
async function extractWithFallbackMethods(pdfBuffer: ArrayBuffer): Promise<string> {
  const uint8Array = new Uint8Array(pdfBuffer);
  let extractedText = '';
  
  // Try multiple fallback methods
  const methods = [
    () => extractUncompressedText(uint8Array),
    () => extractFromPDFObjects(uint8Array),
    () => extractWithSimplePatterns(uint8Array)
  ];
  
  for (const method of methods) {
    try {
      extractedText = method();
      if (extractedText && extractedText.trim().length > 50) {
        break; // Found good text
      }
    } catch (error) {
      console.warn('Fallback method failed:', error);
      continue;
    }
  }
  
  // Clean up the extracted text
  extractedText = cleanExtractedText(extractedText);
  
  // Validate extracted text
  if (!extractedText || extractedText.trim().length < 10) {
    throw new Error('No readable text found in PDF. This PDF might be image-based, encrypted, or use unsupported compression.');
  }
  
  // Check if the text seems garbled
  const garbledRatio = calculateGarbledRatio(extractedText);
  if (garbledRatio > 0.4) { // More lenient for fallback methods
    throw new Error(`PDF text extraction produced garbled output (${Math.round(garbledRatio * 100)}% non-readable characters). This PDF may be corrupted, image-based, or use unsupported encoding.`);
  }
  
  console.log(`Fallback extraction successful: ${extractedText.length} characters`);
  return extractedText;
}

/**
 * Calculate ratio of garbled/non-readable characters
 */
function calculateGarbledRatio(text: string): number {
  if (!text || text.length === 0) return 1;
  
  const readableChars = text.match(/[a-zA-Z0-9\s.,;:!?"'()\-\n\r\t]/g);
  const readableCount = readableChars ? readableChars.length : 0;
  
  return 1 - (readableCount / text.length);
}

/**
 * Simplified PDF text extraction from uncompressed streams
 */
function extractUncompressedText(uint8Array: Uint8Array): string {
  try {
    // Use latin1 decoder as it's most compatible with PDF format
    const text = new TextDecoder('latin1').decode(uint8Array);
    let extractedText = '';
    
    // Extract text from Tj and TJ commands (most common PDF text commands)
    const textCommandRegex = /(?:\(([^)]*)\)\s*Tj|\[(.*?)\]\s*TJ)/g;
    let match;
    
    while ((match = textCommandRegex.exec(text)) !== null) {
      let textContent = match[1] || match[2]; // Either Tj or TJ content
      
      if (textContent) {
        // Clean up PDF escape sequences
        textContent = textContent
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\')
          .replace(/\\([()])/g, '$1'); // Unescape parentheses
        
        // Extract readable text from TJ arrays
        if (match[2]) { // TJ array format
          const arrayStrings = textContent.match(/\(([^)]*)\)/g);
          if (arrayStrings) {
            textContent = arrayStrings.map(s => s.slice(1, -1)).join('');
          }
        }
        
        if (textContent.trim() && isReadableText(textContent)) {
          extractedText += textContent + ' ';
        }
      }
    }
    
    return extractedText;
  } catch (error) {
    console.warn('Uncompressed text extraction failed:', error);
    return '';
  }
}

/**
 * Extract text from PDF objects (metadata and simple content)
 */
function extractFromPDFObjects(uint8Array: Uint8Array): string {
  try {
    const text = new TextDecoder('latin1').decode(uint8Array);
    let extractedText = '';
    
    // Look for common text-containing objects
    const patterns = [
      /\/Title\s*\(([^)]+)\)/gi,    // Document title
      /\/Subject\s*\(([^)]+)\)/gi,  // Document subject
      /\/Author\s*\(([^)]+)\)/gi,   // Document author
      /\/Contents\s*\(([^)]+)\)/gi, // Content references
      /\(([^)]{10,200})\)/g         // General text in parentheses
    ];
    
    for (const pattern of patterns) {
      let match;
      let matches = 0;
      while ((match = pattern.exec(text)) !== null && matches < 100) {
        const textContent = match[1];
        if (isReadableText(textContent)) {
          extractedText += textContent + ' ';
          matches++;
        }
      }
    }
    
    return extractedText;
  } catch (error) {
    console.warn('Object extraction failed:', error);
    return '';
  }
}

/**
 * Simple pattern matching as last resort
 */
function extractWithSimplePatterns(uint8Array: Uint8Array): string {
  try {
    const text = new TextDecoder('latin1').decode(uint8Array);
    let extractedText = '';
    
    // Look for any text in parentheses
    const regex = /\(([^)]{5,})\)/g;
    let match;
    let matches = 0;
    
    while ((match = regex.exec(text)) !== null && matches < 500) {
      const textContent = match[1];
      if (isReadableText(textContent)) {
        extractedText += textContent + ' ';
        matches++;
      }
    }
    
    return extractedText;
  } catch (error) {
    console.warn('Simple pattern extraction failed:', error);
    return '';
  }
}

/**
 * Check if text appears to be readable (not binary/encoded)
 */
function isReadableText(text: string): boolean {
  if (!text || text.length < 2) return false;
  
  // Check for reasonable ratio of printable characters
  const printableChars = text.match(/[a-zA-Z0-9\s.,;:!?"'-]/g);
  const printableRatio = printableChars ? printableChars.length / text.length : 0;
  
  return printableRatio > 0.7 && /[a-zA-Z]/.test(text);
}

/**
 * Clean up extracted PDF text
 */
function cleanExtractedText(text: string): string {
  return text
    // Remove common PDF artifacts
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\ufffd/g, '') // Remove replacement characters
    .replace(/[^\x20-\x7E\u00A0-\u00FF\n\r\t]/g, '') // Keep printable ASCII + Latin-1
    
    // Fix spacing issues
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/([.!?])\s*([A-Z])/g, '$1 $2') // Fix sentence spacing
    .replace(/([a-z])([A-Z])/g, '$1 $2')    // Add space between camelCase
    
    // Clean up line breaks
    .replace(/\n\s*\n\s*\n/g, '\n\n')      // Max 2 consecutive newlines
    .replace(/[ \t]+\n/g, '\n')            // Remove trailing spaces
    .replace(/\n[ \t]+/g, '\n')            // Remove leading spaces after newlines
    
    .trim();
}

/**
 * Check if a file is a PDF based on file type or magic number
 */
export function isPDF(fileType: string, buffer?: ArrayBuffer): boolean {
  // Check MIME type
  if (fileType === 'application/pdf') {
    return true;
  }

  // Check file extension in type
  if (fileType.toLowerCase().includes('pdf')) {
    return true;
  }

  // Check magic number if buffer is provided
  if (buffer && buffer.byteLength >= 4) {
    const uint8Array = new Uint8Array(buffer);
    const header = String.fromCharCode(...uint8Array.slice(0, 4));
    return header === '%PDF';
  }

  return false;
}

/**
 * Get supported file types including PDF
 */
export function getSupportedFileTypes(): string[] {
  return [
    'text/plain',
    'text/markdown',
    'application/json',
    'text/javascript',
    'application/javascript',
    'text/typescript',
    'text/html',
    'text/css',
    'text/python',
    'text/x-python',
    'application/pdf',
  ];
}