import { pipeline, env } from '@huggingface/transformers';
import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';

// Configure transformers cache directory to be local to our project for self-containment
env.cacheDir = './.cache/huggingface';

export type EmbeddingProvider = 'local' | 'gemini' | 'openai';

let localExtractorInstance: any = null;

/**
 * Singleton getter for the local Transformers.js feature extraction pipeline.
 */
async function getLocalExtractor() {
  if (!localExtractorInstance) {
    console.log('Initializing local embedding model (Xenova/all-MiniLM-L6-v2, ~80MB)...');
    try {
      localExtractorInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        progress_callback: (info: any) => {
          if (info.status === 'downloading') {
            console.log(`Downloading embedding model: ${info.file} - ${Math.round(info.loaded / info.total * 100)}%`);
          }
        }
      });
      console.log('Local embedding model initialized successfully.');
    } catch (err) {
      console.error('Error loading local embedding model:', err);
      throw err;
    }
  }
  return localExtractorInstance;
}

/**
 * Main embedding generator. Generates a dense Float32Array/number vector for a given text.
 */
export async function getEmbedding(
  text: string,
  provider: EmbeddingProvider = 'local'
): Promise<number[]> {
  const sanitizedText = text.replace(/\n/g, ' ').trim();
  if (!sanitizedText) {
    return new Array(provider === 'local' ? 384 : 1536).fill(0);
  }

  // 1. LOCAL EMBEDDINGS (ON-DEVICE)
  if (provider === 'local') {
    try {
      const extractor = await getLocalExtractor();
      const output = await extractor(sanitizedText, { pooling: 'mean', normalize: true });
      return Array.from(output.data); // 384 dimensions
    } catch (err) {
      console.warn('Local embedding model execution failed, falling back to mock embeddings:', err);
      return generateMockEmbedding(sanitizedText, 384);
    }
  }

  // 2. GOOGLE GEMINI EMBEDDINGS
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY environment variable is missing. Falling back to local embeddings.');
      return getEmbedding(sanitizedText, 'local');
    }
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: sanitizedText,
      });
      const res = response as any;
      if (res?.embedding?.values) {
        return res.embedding.values; // 768 dimensions by default
      }
      throw new Error('Invalid embedding response from Gemini API');
    } catch (err: any) {
      console.error('Gemini embedding failed:', err);
      throw new Error(`Gemini embedding failed: ${err.message}`);
    }
  }

  // 3. OPENAI EMBEDDINGS
  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('OPENAI_API_KEY environment variable is missing. Falling back to local embeddings.');
      return getEmbedding(sanitizedText, 'local');
    }
    try {
      const openai = new OpenAI({ apiKey });
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: sanitizedText,
      });
      if (response?.data?.[0]?.embedding) {
        return response.data[0].embedding; // 1536 dimensions by default
      }
      throw new Error('Invalid embedding response from OpenAI API');
    } catch (err: any) {
      console.error('OpenAI embedding failed:', err);
      throw new Error(`OpenAI embedding failed: ${err.message}`);
    }
  }

  throw new Error(`Unknown embedding provider: ${provider}`);
}

/**
 * Deterministic pseudo-random mock embedding generator for testing and offline fallback.
 * Computes a hash of the text and uses it to fill a vector of the required dimension.
 */
function generateMockEmbedding(text: string, dimension: number): number[] {
  const vector: number[] = new Array(dimension).fill(0);
  let hash = 0;
  
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  
  // Fill array deterministically based on hash values
  for (let d = 0; d < dimension; d++) {
    const val = Math.sin(hash + d) * 10000;
    vector[d] = val - Math.floor(val) - 0.5; // Normalized pseudo-random float between -0.5 and 0.5
  }
  
  // L2 Normalize the vector to make it suitable for cosine similarity
  let sumSq = 0;
  for (let d = 0; d < dimension; d++) {
    sumSq += vector[d] * vector[d];
  }
  const norm = Math.sqrt(sumSq) || 1;
  for (let d = 0; d < dimension; d++) {
    vector[d] /= norm;
  }
  
  return vector;
}
