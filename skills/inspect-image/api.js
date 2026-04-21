/**
 * OpenRouter API client for vision models.
 * Analogous to web-browser's cdp.js — shared client used by CLI scripts.
 */

import fs from 'node:fs';
import path from 'node:path';

// Remove embedded data URLs before writing debug payloads to disk. Some APIs may
// echo image-bearing request content back in their JSON, which is terrible for
// artifact size and downstream context management.
function sanitizeForJson(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeForJson);
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, nestedValue]) => {
      // The common case is image_url.url, but recurse generically so any future
      // nested data URLs also get stripped.
      if (key === 'url' && typeof nestedValue === 'string' && nestedValue.startsWith('data:image/')) {
        return [key, '[omitted data URL]'];
      }
      return [key, sanitizeForJson(nestedValue)];
    });
    return Object.fromEntries(entries);
  }

  if (typeof value === 'string' && value.startsWith('data:image/')) {
    return '[omitted data URL]';
  }

  return value;
}

export class OpenRouterClient {
  constructor({ apiKey, model, baseUrl } = {}) {
    this.apiKey = apiKey ?? process.env.OPENROUTER_API_KEY;
    this.model = model ?? 'google/gemini-3.1-pro-preview';
    this.baseUrl = baseUrl ?? 'https://openrouter.ai/api/v1';

    if (!this.apiKey) {
      throw new Error('Missing API key. Set OPENROUTER_API_KEY or pass --api-key.');
    }
  }

  async analyzeImage({ prompt, imagePath, detail = 'auto', maxTokens, signal } = {}) {
    const mimeType = mimeTypeFor(imagePath);
    const bytes = fs.readFileSync(imagePath);
    // OpenRouter expects an inline data URL for local image uploads.
    const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;

    const body = {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail,
              },
            },
          ],
        },
      ],
    };

    if (Number.isFinite(maxTokens) && maxTokens > 0) {
      body.max_tokens = maxTokens;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const details = data ? JSON.stringify(data, null, 2) : `${response.status} ${response.statusText}`;
      throw new Error(`Model request failed for ${imagePath}:\n${details}`);
    }

    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.length) {
      throw new Error(`Model response for ${imagePath} did not include choices[0].message.content text.`);
    }

    // Return a sanitized copy for optional JSON export so debugging stays possible
    // without persisting the original image payload.
    return { text, raw: sanitizeForJson(data) };
  }
}

export function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      throw new Error(`Unsupported image type for ${filePath}. Use jpg, jpeg, png, gif, or webp.`);
  }
}

export function resolveImagePath(imagePath) {
  const absolutePath = path.resolve(imagePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Image not found: ${absolutePath}`);
  }
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${absolutePath}`);
  }
  return absolutePath;
}

export function readPromptFile(promptFile) {
  const promptPath = path.resolve(promptFile);
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file not found: ${promptPath}`);
  }
  return fs.readFileSync(promptPath, 'utf8').trim();
}
