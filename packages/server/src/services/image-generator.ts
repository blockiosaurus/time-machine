import OpenAI from 'openai';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_IMAGE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_IMAGE_API_KEY (or OPENAI_API_KEY) is required for portrait generation.',
    );
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export const PORTRAIT_PROMPT_TEMPLATE = (canonicalName: string) =>
  `Portrait of ${canonicalName}, in the visual style appropriate to their era. ` +
  'Studio framing, head-and-shoulders, high detail, dignified, no text, no watermark.';

/**
 * Generate a portrait via OpenAI Images (gpt-image-1) and return raw bytes.
 * Caller pins the bytes to Irys and stores the resulting CID on the
 * character row + in the EIP-8004 registration doc.
 */
export async function generatePortrait(canonicalName: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
  prompt: string;
}> {
  const client = getClient();
  const prompt = PORTRAIT_PROMPT_TEMPLATE(canonicalName);
  const response = await client.images.generate({
    model: 'gpt-image-1',
    prompt,
    size: '1024x1024',
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI image generation returned no image data');
  }
  const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
  return { bytes, contentType: 'image/png', prompt };
}
