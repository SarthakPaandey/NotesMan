import * as cheerio from 'cheerio';
// pdf-parse is a CommonJS module. We load it via require to prevent static ESM default check failures in Next.js Turbopack.
const pdf = require('pdf-parse');

export interface ParsedDocument {
  text: string;
  metadata: {
    title: string;
    sourceType: 'pdf' | 'web' | 'text';
    author?: string;
    pagesCount?: number;
    url?: string;
  };
}

/**
 * Extracts and cleans text from a PDF buffer.
 */
export async function parsePDF(buffer: Buffer, originalFilename: string): Promise<ParsedDocument> {
  try {
    const data = await pdf(buffer);
    
    // Fallback title to filename if not found in pdf metadata
    const title = data.info?.Title || originalFilename;
    const author = data.info?.Author || 'Unknown';
    const pagesCount = data.numpages || 1;

    return {
      text: data.text,
      metadata: {
        title,
        sourceType: 'pdf',
        author,
        pagesCount,
      },
    };
  } catch (error: any) {
    console.error('Error parsing PDF:', error);
    throw new Error(`Failed to parse PDF document: ${error.message}`);
  }
}

/**
 * Scrapes a web URL, removing boilerplate tags (scripts, styles, headers, footers)
 * and extracting semantic markdown-like content using Cheerio.
 */
export async function parseWebURL(url: string): Promise<ParsedDocument> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Clean up unnecessary tags
    $('script, style, iframe, noscript, svg, nav, footer, header, head, aside, select, button').remove();

    // Extract title
    const pageTitle = $('title').text() || $('h1').first().text() || url;

    // Build clean readable text by focusing on semantic blocks
    const contentBlocks: string[] = [];

    // Prioritize main, article, or fallback to body
    const mainContainer = $('main, article, #content, .content, #main').first();
    const rootElement = mainContainer.length > 0 ? mainContainer : $('body');

    // Traverse headings, paragraphs, and list items to preserve readability
    rootElement.find('h1, h2, h3, h4, h5, h6, p, li').each((_, elem) => {
      const text = $(elem).text().trim();
      if (!text) return;

      const tagName = elem.tagName.toLowerCase();
      if (tagName.startsWith('h')) {
        // Format heading with markdown-style markup for better block chunking
        const level = tagName.substring(1);
        const prefix = '#'.repeat(parseInt(level, 10));
        contentBlocks.push(`\n${prefix} ${text}\n`);
      } else if (tagName === 'li') {
        contentBlocks.push(`- ${text}`);
      } else {
        contentBlocks.push(text);
      }
    });

    const parsedText = contentBlocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!parsedText) {
      throw new Error('No readable text found on the target web page.');
    }

    return {
      text: parsedText,
      metadata: {
        title: pageTitle.trim(),
        sourceType: 'web',
        url,
      },
    };
  } catch (error: any) {
    console.error(`Error scraping URL ${url}:`, error);
    throw new Error(`Failed to scrape web page: ${error.message}`);
  }
}

/**
 * Handles plain text uploads.
 */
export async function parsePlainText(text: string, title: string): Promise<ParsedDocument> {
  return {
    text: text.trim(),
    metadata: {
      title,
      sourceType: 'text',
    },
  };
}
