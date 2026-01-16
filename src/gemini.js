import axios from 'axios';

// Gemini Image generation via REST (Nano Banana style)
// Docs: ai.google.dev/gemini-api/docs/image-generation

export async function geminiTextToImage({
  apiKey,
  prompt,
  model = 'gemini-2.5-flash-image-preview',
  safety = 'none',
}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  if (!prompt?.trim()) throw new Error('prompt_required');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: prompt.trim() }]
    }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    }
  };

  const { data } = await axios.post(url, body, {
    params: { key: apiKey },
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    timeout: 90_000,
  });

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((p) => p.inlineData?.data);
  if (!inline) {
    const txt = parts.map((p) => p.text).filter(Boolean).join('\n');
    throw new Error(`no_image_in_response${txt ? ': ' + txt.slice(0, 140) : ''}`);
  }

  const mimeType = inline.inlineData?.mimeType || 'image/png';
  const b64 = inline.inlineData?.data;
  const buffer = Buffer.from(b64, 'base64');

  return {
    mimeType,
    buffer,
    text: parts.map((p) => p.text).filter(Boolean).join('\n') || null,
    model,
  };
}
