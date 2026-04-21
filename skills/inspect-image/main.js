#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { OpenRouterClient, resolveImagePath, readPromptFile } from './api.js';

const DEBUG = process.env.DEBUG === '1';
const log = DEBUG ? (...args) => console.error('[debug]', ...args) : () => {};

const GLOBAL_TIMEOUT_MS = 60_000;

function printHelp() {
  console.log(`inspect-image

Usage:
  ./inspect-image analyze <image...> --prompt <text> [options]
  ./inspect-image analyze <image...> --prompt-file <file> [options]

Behavior:
  Each image is sent in its own separate chat completion request.
  If you pass 5 images, the CLI creates 5 distinct conversations.

Options:
  --prompt <text>         Prompt text to send with each image
  --prompt-file <file>    Read prompt text from a file
  --model <name>          Override model name (default: google/gemini-3.1-pro-preview)
  --api-key <key>         Override API key
  --output <file>         Write JSON output to a file
  --max-tokens <n>        Max completion tokens
  --include-raw           Include sanitized raw API response in JSON output
  --detail <level>        Image detail hint: low, high, or auto (default: auto)
  --timeout <ms>          Global timeout in milliseconds (default: 60000)
  --help                  Show this help

Environment:
  OPENROUTER_API_KEY      Required (unless --api-key is passed)
  DEBUG=1                 Enable debug logging to stderr
`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    return { help: true };
  }

  const images = [];
  const options = {
    detail: 'auto',
    timeout: GLOBAL_TIMEOUT_MS,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--prompt') {
      options.prompt = rest[++i];
    } else if (arg === '--prompt-file') {
      options.promptFile = rest[++i];
    } else if (arg === '--model') {
      options.model = rest[++i];
    } else if (arg === '--api-key') {
      options.apiKey = rest[++i];
    } else if (arg === '--output') {
      options.output = rest[++i];
    } else if (arg === '--max-tokens') {
      options.maxTokens = Number.parseInt(rest[++i], 10);
    } else if (arg === '--include-raw') {
      // Raw responses are excluded by default to avoid dumping large image payloads
      // into JSON artifacts. Opt-in only for explicit debugging.
      options.includeRaw = true;
    } else if (arg === '--detail') {
      options.detail = rest[++i];
    } else if (arg === '--timeout') {
      options.timeout = Number.parseInt(rest[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--')) {
      fail(`Unknown option: ${arg}`);
    } else {
      images.push(arg);
    }
  }

  return { command, images, options };
}

function readPrompt(options) {
  if (options.prompt && options.promptFile) {
    fail('Use either --prompt or --prompt-file, not both.');
  }
  if (options.prompt) {
    return options.prompt;
  }
  if (options.promptFile) {
    return readPromptFile(options.promptFile);
  }
  fail('Missing prompt. Use --prompt or --prompt-file.');
}

function resolveImages(images) {
  if (!images.length) {
    fail('No image paths provided.');
  }
  return images.map(resolveImagePath);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help || parsed.options?.help) {
    printHelp();
    return;
  }

  if (parsed.command !== 'analyze') {
    fail(`Unsupported command: ${parsed.command}`);
  }

  const prompt = readPrompt(parsed.options);
  const imagePaths = resolveImages(parsed.images);
  const timeoutMs = parsed.options.timeout;

  // Global timeout — prevents hanging on stalled network calls
  const globalTimeout = setTimeout(() => {
    console.error('✗ Global timeout exceeded (%dms)', timeoutMs);
    process.exit(1);
  }, timeoutMs);

  // AbortController to cancel in-flight requests on timeout
  const controller = new AbortController();

  let client;
  try {
    client = new OpenRouterClient({
      apiKey: parsed.options.apiKey,
      model: parsed.options.model,
    });
  } catch (e) {
    fail(e.message);
  }

  try {
    log('prompt:', prompt.slice(0, 80));
    log('images:', imagePaths.length);
    log('model:', client.model);

    const results = await Promise.all(
      imagePaths.map(async (imagePath, index) => {
        log('analyzing %s...', path.basename(imagePath));
        const result = await client.analyzeImage({
          prompt,
          imagePath,
          detail: parsed.options.detail,
          maxTokens: parsed.options.maxTokens,
          signal: controller.signal,
        });

        log('✓ completed %s', path.basename(imagePath));

        const output = {
          index,
          image: imagePath,
          response: result.text,
        };

        // Keep output JSON compact by default. Raw responses may contain echoed
        // request structure and can bloat saved artifacts significantly.
        if (parsed.options.includeRaw) {
          output.raw = result.raw;
        }

        return output;
      }),
    );

    const payload = {
      model: client.model,
      createdAt: new Date().toISOString(),
      prompt,
      // Each image is analyzed independently rather than as a single multi-image prompt.
      mode: 'separate-conversations-per-image',
      images: imagePaths,
      results,
    };

    if (parsed.options.output) {
      const outputPath = path.resolve(parsed.options.output);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    }

    if (results.length === 1) {
      console.log(results[0].response);
    } else {
      for (const result of results) {
        console.log(`=== ${path.basename(result.image)} ===`);
        console.log(result.response);
        console.log('');
      }
    }

    if (parsed.options.output) {
      console.error('✓ Wrote %s', path.resolve(parsed.options.output));
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      fail('Request aborted due to timeout.');
    }
    fail(e.message);
  } finally {
    clearTimeout(globalTimeout);
    // Ensure clean shutdown even if something hangs
    setTimeout(() => process.exit(0), 100);
  }
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
