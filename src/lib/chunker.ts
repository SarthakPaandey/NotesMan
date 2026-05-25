export interface Chunk {
  text: string;
  tokenCount: number;
}

export interface ChunkingOptions {
  chunkSize?: number;      // Target character size of a chunk
  chunkOverlap?: number;   // Number of overlapping characters between chunks
}

/**
 * An elegant Recursive Character Text Splitter implemented in pure TypeScript.
 * Splits long text using semantic delimiters (paragraphs, sentences, spaces) recursively
 * to create structured chunks of approximately equal length with overlap.
 */
export class RecursiveCharacterTextSplitter {
  private chunkSize: number;
  private chunkOverlap: number;
  private separators: string[];

  constructor(options: ChunkingOptions = {}) {
    this.chunkSize = options.chunkSize || 500;
    this.chunkOverlap = options.chunkOverlap || 100;
    this.separators = ['\n\n', '\n', '. ', '? ', '! ', ' ', ''];
  }

  /**
   * Estimates token count based on standard 4-character-per-token heuristic.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Recursively splits a text into semantic chunks.
   */
  public splitText(text: string): Chunk[] {
    const chunks: Chunk[] = [];
    const rawChunks = this.recursiveSplit(text, this.separators);
    
    // Merge small chunks together to respect the desired chunkSize + overlap
    let currentChunk = '';
    
    for (const chunk of rawChunks) {
      if (!chunk.trim()) continue;
      
      if (!currentChunk) {
        currentChunk = chunk;
      } else if (currentChunk.length + chunk.length + 1 <= this.chunkSize) {
        currentChunk += ' ' + chunk;
      } else {
        chunks.push({
          text: currentChunk.trim(),
          tokenCount: this.estimateTokens(currentChunk),
        });
        
        // Form the next overlapping chunk
        const overlapStart = Math.max(0, currentChunk.length - this.chunkOverlap);
        const overlapText = currentChunk.substring(overlapStart);
        
        // Find the last space or divider in overlap to keep it clean
        const spaceIdx = overlapText.indexOf(' ');
        const cleanOverlap = spaceIdx !== -1 ? overlapText.substring(spaceIdx + 1) : overlapText;
        
        currentChunk = (cleanOverlap + ' ' + chunk).trim();
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim(),
        tokenCount: this.estimateTokens(currentChunk),
      });
    }
    
    return chunks;
  }

  private recursiveSplit(text: string, separators: string[]): string[] {
    if (text.length <= this.chunkSize) {
      return [text];
    }

    if (separators.length === 0) {
      // Base case: no more separators, hard split at chunkSize
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += this.chunkSize) {
        chunks.push(text.substring(i, i + this.chunkSize));
      }
      return chunks;
    }

    const separator = separators[0];
    const nextSeparators = separators.slice(1);
    
    const parts = text.split(separator);
    const result: string[] = [];
    
    let currentBlock = '';
    
    for (const part of parts) {
      if (currentBlock.length + part.length + separator.length <= this.chunkSize) {
        currentBlock += (currentBlock ? separator : '') + part;
      } else {
        if (currentBlock) {
          result.push(currentBlock);
        }
        
        // If single part is larger than chunkSize, split it recursively using remaining separators
        if (part.length > this.chunkSize) {
          const subParts = this.recursiveSplit(part, nextSeparators);
          result.push(...subParts);
          currentBlock = '';
        } else {
          currentBlock = part;
        }
      }
    }
    
    if (currentBlock) {
      result.push(currentBlock);
    }
    
    return result;
  }
}
