#!/usr/bin/env npx tsx
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type CliMarker = {
	pos: [number, number, number];
	color?: string;
	size?: number;
};

type CdpLike = {
	send: (method: string, params?: Record<string, unknown>, sessionId?: string | null, timeout?: number) => Promise<any>;
	evaluate: (sessionId: string, expression: string, timeout?: number) => Promise<any>;
	on: (method: string, handler: (params: any, sessionId: string | null) => void) => () => void;
	off: (method: string, handler: (params: any, sessionId: string | null) => void) => void;
	close: () => void;
};

type ConnectFn = (timeout?: number) => Promise<CdpLike>;

let cachedConnect: ConnectFn | null = null;
async function getConnect(): Promise<ConnectFn> {
	if (cachedConnect) return cachedConnect;
	try {
		const mod = (await import('./cdp.js')) as { connect: ConnectFn };
		cachedConnect = mod.connect;
		return cachedConnect;
	} catch (error: any) {
		if (error?.code === 'ERR_MODULE_NOT_FOUND' && String(error?.message ?? '').includes("package 'ws'")) {
			throw new Error(
				"Missing dependency 'ws' for scripts/cdp.js. Run: cd skills/canvas-screenshot/scripts && npm install"
			);
		}
		throw error;
	}
}

function parseVector3(input: string, flagName: string): [number, number, number] {
	const parts = input.split(',').map((v) => Number.parseFloat(v.trim()));
	if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
		throw new Error(`Invalid ${flagName} value "${input}". Expected format: x,y,z`);
	}
	return [parts[0], parts[1], parts[2]];
}

function parseMarker(input: string): CliMarker {
	const parts = input.split(',').map((v) => v.trim());
	if (parts.length < 3) {
		throw new Error(`Invalid --marker value "${input}". Expected: x,y,z[,color][,size]`);
	}

	const pos = [
		Number.parseFloat(parts[0]),
		Number.parseFloat(parts[1]),
		Number.parseFloat(parts[2])
	] as [number, number, number];

	if (pos.some((n) => !Number.isFinite(n))) {
		throw new Error(`Invalid --marker position in "${input}". Expected numeric x,y,z.`);
	}

	let color: string | undefined;
	let size: number | undefined;

	if (parts[3]) {
		const maybeSize = Number.parseFloat(parts[3]);
		if (Number.isFinite(maybeSize)) {
			if (maybeSize <= 0) {
				throw new Error(`Invalid --marker size in "${input}". Size must be > 0.`);
			}
			size = maybeSize;
		} else {
			color = parts[3];
		}
	}

	if (parts[4]) {
		const parsedSize = Number.parseFloat(parts[4]);
		if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
			throw new Error(`Invalid --marker size in "${input}". Size must be > 0.`);
		}
		size = parsedSize;
	}

	return { pos, color, size };
}

function parseMarkersArg(input: string): CliMarker[] {
	if (!input) {
		throw new Error('Missing value for --marker. Expected: "x,y,z[,color][,size]"');
	}
	return input
		.split(';')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => parseMarker(entry));
}

function parseArgs() {
	const args = process.argv.slice(2);
	const result: {
		out?: string;
		port?: number;
		fullPage?: boolean;
		route?: string;
		selector?: string;
		angle?: string;
		pos?: [number, number, number];
		lookAt?: [number, number, number];
		zoom?: number;
		inlineMarkers: CliMarker[];
		cdpPort?: number;
		headless?: boolean;
		chromePath?: string;
	} = { inlineMarkers: [] };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const next = args[i + 1];

		switch (arg) {
			case '--out':
				result.out = next;
				i++;
				break;
			case '--port':
				result.port = Number.parseInt(next, 10);
				i++;
				break;
			case '--route':
				result.route = next;
				i++;
				break;
			case '--selector':
				result.selector = next;
				i++;
				break;
			case '--full-page':
				result.fullPage = true;
				break;
			case '--angle':
				result.angle = next;
				i++;
				break;
			case '--pos':
				result.pos = parseVector3(next, '--pos');
				i++;
				break;
			case '--look-at':
				result.lookAt = parseVector3(next, '--look-at');
				i++;
				break;
			case '--zoom':
				result.zoom = Number.parseFloat(next);
				i++;
				break;
			case '--marker':
				result.inlineMarkers.push(...parseMarkersArg(next));
				i++;
				break;
			case '--cdp-port':
				result.cdpPort = Number.parseInt(next, 10);
				i++;
				break;
			case '--headless':
				result.headless = true;
				break;
			case '--chrome-path':
				result.chromePath = next;
				i++;
				break;
			case '--help':
			case '-h':
				console.log(`
Capture screenshot from a canvas route using Chrome over CDP.

Usage:
  npx tsx scripts/canvas-screenshot.ts [options]

Core options:
  --out <file>          Output file (default: screenshots/agent-loop-canvas.png)
  --port <number>       Dev server port (default: 5173)
  --route <path>        Route path (default: /demos/agent-loop)
  --selector <css>      Canvas selector (default: .three-container canvas)
  --full-page           Capture full page instead of canvas
  --cdp-port <number>   CDP port (must be 9222 with shared scripts)

Camera options (forwarded as query params):
  --angle <preset>      front|back|left|right|top|bottom|iso|iso-back|iso-left|iso-right
  --pos "x,y,z"         Explicit camera position
  --look-at "x,y,z"     OrbitControls target / look-at point
  --zoom <number>       Zoom multiplier (>1 zooms in)

Debug marker options:
  --marker "x,y,z,color,size"
                        Add marker(s). Repeat flag or separate multiple markers with ';'.
                        Example: --marker "0,0,0,#ff0,0.2;1,0,0,#0ff,0.15"

Notes:
  This script uses ./start.js + ./cdp.js and expects CDP on localhost:9222.
  --headless and --chrome-path are ignored by this implementation.
  The target route must read optional query params: angle, pos, lookAt, zoom, markers.
`);
				process.exit(0);
		}
	}

	return result;
}

function startChromeViaScript() {
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	const startScript = path.join(scriptDir, 'start.js');
	const started = spawnSync(process.execPath, [startScript], {
		encoding: 'utf8'
	});

	if (started.status !== 0) {
		const stderr = started.stderr?.trim();
		const stdout = started.stdout?.trim();
		throw new Error(
			`Failed to run start.js${stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : ''}`
		);
	}
}

async function ensureChrome(cdpPort: number) {
	if (cdpPort !== 9222) {
		throw new Error('--cdp-port must be 9222 when using shared scripts/cdp.js');
	}

	const connect = await getConnect();
	try {
		const cdp = await connect(1500);
		cdp.close();
		return;
	} catch {
		startChromeViaScript();
	}
}

async function waitForLoad(cdp: CdpLike, sessionId: string, timeoutMs = 30000) {
	const state = await cdp.evaluate(sessionId, 'document.readyState');
	if (state === 'complete') return;

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cdp.off('Page.loadEventFired', handler);
			reject(new Error('Timed out waiting for Page.loadEventFired'));
		}, timeoutMs);

		const handler = (_params: any, eventSessionId: string | null) => {
			if (eventSessionId !== sessionId) return;
			clearTimeout(timeout);
			cdp.off('Page.loadEventFired', handler);
			resolve();
		};

		cdp.on('Page.loadEventFired', handler);
	});
}

async function waitForSelectorRect(
	cdp: CdpLike,
	sessionId: string,
	selector: string,
	timeoutMs = 30000
): Promise<{ x: number; y: number; width: number; height: number }> {
	const started = Date.now();

	while (Date.now() - started < timeoutMs) {
		const rect = (await cdp.evaluate(
			sessionId,
			`(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return null;
				const rect = el.getBoundingClientRect();
				const style = getComputedStyle(el);
				const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
				if (!visible) return null;
				return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
			})()`
		)) as { x: number; y: number; width: number; height: number } | null;

		if (
			rect &&
			Number.isFinite(rect.x) &&
			Number.isFinite(rect.y) &&
			Number.isFinite(rect.width) &&
			Number.isFinite(rect.height)
		) {
			return rect;
		}

		await new Promise((resolve) => setTimeout(resolve, 250));
	}

	throw new Error(`Timed out waiting for visible selector: ${selector}`);
}

async function main() {
	const args = parseArgs();
	const port = args.port ?? 5173;
	const route = args.route ?? '/demos/agent-loop';
	const selector = args.selector ?? '.three-container canvas';
	const outputPath = args.out ?? 'screenshots/agent-loop-canvas.png';
	const cdpPort = args.cdpPort ?? 9222;

	if (args.headless) {
		console.warn('--headless is ignored (start.js controls Chrome startup).');
	}
	if (args.chromePath) {
		console.warn('--chrome-path is ignored (start.js controls Chrome startup).');
	}

	const params = new URLSearchParams();
	if (args.angle) params.set('angle', args.angle);
	if (args.pos) params.set('pos', args.pos.join(','));
	if (args.lookAt) params.set('lookAt', args.lookAt.join(','));
	if (typeof args.zoom === 'number' && Number.isFinite(args.zoom) && args.zoom > 0) {
		params.set('zoom', String(args.zoom));
	}
	if (args.inlineMarkers.length > 0) {
		const encoded = Buffer.from(JSON.stringify(args.inlineMarkers)).toString('base64');
		params.set('markers', encoded);
	}

	const query = params.toString();
	const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
	const url = `http://localhost:${port}${normalizedRoute}${query ? `?${query}` : ''}`;

	let cdp: CdpLike | null = null;
	let targetId: string | null = null;
	let sessionId: string | null = null;

	try {
		await ensureChrome(cdpPort);
		const connect = await getConnect();
		cdp = await connect(5000);

		const target = (await cdp.send('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
		targetId = target.targetId;

		const attached = (await cdp.send('Target.attachToTarget', {
			targetId,
			flatten: true
		})) as { sessionId: string };
		sessionId = attached.sessionId;

		await cdp.send('Page.enable', {}, sessionId);
		await cdp.send('Runtime.enable', {}, sessionId);
		await cdp.send(
			'Emulation.setDeviceMetricsOverride',
			{ width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
			sessionId
		);

		console.log('Opening:', url);
		await cdp.send('Page.navigate', { url }, sessionId, 60000);
		await waitForLoad(cdp, sessionId, 60000);
		await new Promise((resolve) => setTimeout(resolve, 1500));

		const outputDir = path.dirname(outputPath);
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}

		let screenshotData: string;
		if (args.fullPage) {
			const layout = (await cdp.send('Page.getLayoutMetrics', {}, sessionId)) as {
				contentSize?: { width: number; height: number };
			};
			const contentWidth = Math.max(1, Math.ceil(layout.contentSize?.width ?? 1920));
			const contentHeight = Math.max(1, Math.ceil(layout.contentSize?.height ?? 1080));

			const captured = (await cdp.send(
				'Page.captureScreenshot',
				{
					format: 'png',
					captureBeyondViewport: true,
					clip: { x: 0, y: 0, width: contentWidth, height: contentHeight, scale: 1 }
				},
				sessionId,
				30000
			)) as { data: string };
			screenshotData = captured.data;
		} else {
			const rect = await waitForSelectorRect(cdp, sessionId, selector, 30000);
			const captured = (await cdp.send(
				'Page.captureScreenshot',
				{
					format: 'png',
					captureBeyondViewport: true,
					clip: {
						x: rect.x,
						y: rect.y,
						width: Math.max(1, rect.width),
						height: Math.max(1, rect.height),
						scale: 1
					}
				},
				sessionId,
				30000
			)) as { data: string };
			screenshotData = captured.data;
		}

		fs.writeFileSync(outputPath, Buffer.from(screenshotData, 'base64'));
		console.log('Screenshot saved to:', outputPath);
	} catch (error) {
		console.error('Capture failed:', error);
		process.exit(1);
	} finally {
		if (cdp && sessionId) {
			try {
				await cdp.send('Target.detachFromTarget', { sessionId });
			} catch {
				// ignore cleanup errors
			}
		}
		if (cdp && targetId) {
			try {
				await cdp.send('Target.closeTarget', { targetId });
			} catch {
				// ignore cleanup errors
			}
		}
		cdp?.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
