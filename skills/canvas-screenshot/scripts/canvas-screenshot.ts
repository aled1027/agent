#!/usr/bin/env npx tsx
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

type CliMarker = {
	pos: [number, number, number];
	color?: string;
	size?: number;
};

type CdpResponse = {
	id: number;
	result?: unknown;
	error?: { message?: string };
};

type CdpEvent = {
	method: string;
	params?: Record<string, unknown>;
	sessionId?: string;
};

class CdpClient {
	private ws: WebSocket;
	private nextId = 1;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private eventHandlers = new Map<string, Array<(event: CdpEvent) => void>>();

	private constructor(ws: WebSocket) {
		this.ws = ws;
		this.ws.onmessage = (message) => {
			if (typeof message.data !== 'string') return;
			const payload = JSON.parse(message.data) as CdpResponse | CdpEvent;

			if ('id' in payload) {
				const pending = this.pending.get(payload.id);
				if (!pending) return;
				this.pending.delete(payload.id);
				if (payload.error) {
					pending.reject(new Error(payload.error.message ?? 'CDP command failed'));
				} else {
					pending.resolve(payload.result);
				}
				return;
			}

			const handlers = this.eventHandlers.get(payload.method);
			if (handlers) {
				for (const handler of handlers) handler(payload);
			}
		};
		this.ws.onerror = () => {
			this.rejectAllPending(new Error('Chrome CDP websocket error'));
		};
		this.ws.onclose = () => {
			this.rejectAllPending(new Error('Chrome CDP websocket closed'));
		};
	}

	private rejectAllPending(error: Error) {
		for (const [id, pending] of this.pending.entries()) {
			this.pending.delete(id);
			pending.reject(error);
		}
	}

	static async connect(webSocketUrl: string, timeoutMs = 10000): Promise<CdpClient> {
		return await new Promise((resolve, reject) => {
			const ws = new WebSocket(webSocketUrl);
			const timeout = setTimeout(() => {
				ws.close();
				reject(new Error('Timed out connecting to Chrome CDP websocket'));
			}, timeoutMs);

			ws.onopen = () => {
				clearTimeout(timeout);
				resolve(new CdpClient(ws));
			};

			ws.onerror = () => {
				clearTimeout(timeout);
				reject(new Error('Failed to connect to Chrome CDP websocket'));
			};
		});
	}

	on(method: string, handler: (event: CdpEvent) => void) {
		const handlers = this.eventHandlers.get(method) ?? [];
		handlers.push(handler);
		this.eventHandlers.set(method, handlers);
	}

	off(method: string, handler: (event: CdpEvent) => void) {
		const handlers = this.eventHandlers.get(method);
		if (!handlers) return;
		this.eventHandlers.set(
			method,
			handlers.filter((h) => h !== handler)
		);
	}

	async send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
		if (this.ws.readyState !== WebSocket.OPEN) {
			throw new Error('Chrome CDP websocket is not open');
		}

		const id = this.nextId++;
		const payload: Record<string, unknown> = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;

		return await new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			try {
				this.ws.send(JSON.stringify(payload));
			} catch (error) {
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	close() {
		this.ws.close();
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
  --cdp-port <number>   Chrome remote-debugging port (default: 9222)
  --chrome-path <path>  Chrome executable path for auto-launch (optional)
  --headless            If auto-launch is needed, run Chrome in headless mode

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
  This script first tries an existing Chrome on the CDP port, then auto-launches one if needed.
  This assumes the target route reads optional query params: angle, pos, lookAt, zoom, markers.
  Example:
    /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222

Examples:
  npx tsx scripts/canvas-screenshot.ts --angle iso --out screenshots/iso.png
  npx tsx scripts/canvas-screenshot.ts --pos "2,1,2" --look-at "0,0,0" --zoom 1.5
`);
				process.exit(0);
		}
	}

	return result;
}

async function getBrowserWebSocketUrl(cdpPort: number): Promise<string> {
	const endpoint = `http://127.0.0.1:${cdpPort}/json/version`;
	const res = await fetch(endpoint);
	if (!res.ok) throw new Error(`Failed to query ${endpoint} (${res.status})`);
	const json = (await res.json()) as { webSocketDebuggerUrl?: string };
	if (!json.webSocketDebuggerUrl) {
		throw new Error(`No webSocketDebuggerUrl returned from ${endpoint}`);
	}
	return json.webSocketDebuggerUrl;
}

function resolveChromeExecutable(chromePath?: string): string {
	if (chromePath) return chromePath;

	if (process.platform === 'darwin') {
		const macCandidates = [
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Chromium.app/Contents/MacOS/Chromium'
		];
		for (const candidate of macCandidates) {
			if (fs.existsSync(candidate)) return candidate;
		}
	}

	if (process.platform === 'win32') {
		const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
		const pfx86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
		const local = process.env.LocalAppData ?? '';
		const winCandidates = [
			`${pf}\\Google\\Chrome\\Application\\chrome.exe`,
			`${pfx86}\\Google\\Chrome\\Application\\chrome.exe`,
			`${local}\\Google\\Chrome\\Application\\chrome.exe`
		];
		for (const candidate of winCandidates) {
			if (fs.existsSync(candidate)) return candidate;
		}
	}

	return process.platform === 'win32' ? 'chrome.exe' : 'google-chrome';
}

function launchChrome(cdpPort: number, chromePath?: string, headless = false): {
	process: ChildProcess;
	userDataDir: string;
} {
	const executable = resolveChromeExecutable(chromePath);
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-screenshot-chrome-'));
	const launchArgs = [
		`--remote-debugging-port=${cdpPort}`,
		'--no-first-run',
		'--no-default-browser-check',
		`--user-data-dir=${userDataDir}`,
		'about:blank'
	];
	if (headless) {
		launchArgs.unshift('--headless=new', '--disable-gpu');
	}

	const chromeProcess = spawn(executable, launchArgs, { stdio: 'ignore' });
	if (!chromeProcess.pid) {
		throw new Error(`Failed to launch Chrome executable: ${executable}`);
	}

	return { process: chromeProcess, userDataDir };
}

async function waitForBrowserWebSocketUrl(cdpPort: number, timeoutMs = 15000): Promise<string> {
	const started = Date.now();
	let lastError: unknown;
	while (Date.now() - started < timeoutMs) {
		try {
			return await getBrowserWebSocketUrl(cdpPort);
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	throw new Error(
		`Timed out waiting for Chrome CDP endpoint on port ${cdpPort}${
			lastError ? ` (${String(lastError)})` : ''
		}`
	);
}

async function waitForLoad(client: CdpClient, sessionId: string, timeoutMs = 30000) {
	const stateResult = (await client.send(
		'Runtime.evaluate',
		{
			expression: 'document.readyState',
			returnByValue: true
		},
		sessionId
	)) as { result?: { value?: unknown } };
	if (stateResult?.result?.value === 'complete') return;

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			client.off('Page.loadEventFired', handler);
			reject(new Error('Timed out waiting for Page.loadEventFired'));
		}, timeoutMs);

		const handler = (event: CdpEvent) => {
			if (event.sessionId !== sessionId) return;
			clearTimeout(timeout);
			client.off('Page.loadEventFired', handler);
			resolve();
		};

		client.on('Page.loadEventFired', handler);
	});
}

async function waitForSelectorRect(
	client: CdpClient,
	sessionId: string,
	selector: string,
	timeoutMs = 30000
): Promise<{ x: number; y: number; width: number; height: number }> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const result = (await client.send(
			'Runtime.evaluate',
			{
				expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          if (!visible) return null;
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()`,
				returnByValue: true
			},
			sessionId
		)) as { result?: { value?: unknown } };

		const rect = result?.result?.value as { x: number; y: number; width: number; height: number } | null;
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

	let client: CdpClient | null = null;
	let targetId: string | null = null;
	let sessionId: string | null = null;
	let launchedChrome: ChildProcess | null = null;
	let launchedChromeUserDataDir: string | null = null;

	try {
		let webSocketUrl: string;
		let usedExistingChrome = false;
		try {
			webSocketUrl = await getBrowserWebSocketUrl(cdpPort);
			usedExistingChrome = true;
		} catch {
			console.log(`No Chrome detected on CDP port ${cdpPort}. Launching Chrome...`);
			const launched = launchChrome(cdpPort, args.chromePath, args.headless ?? false);
			launchedChrome = launched.process;
			launchedChromeUserDataDir = launched.userDataDir;
			webSocketUrl = await waitForBrowserWebSocketUrl(cdpPort, 15000);
		}

		if (usedExistingChrome && args.headless) {
			console.warn('--headless ignored because an existing Chrome instance is being used.');
		}

		client = await CdpClient.connect(webSocketUrl);

		const targetResult = (await client.send('Target.createTarget', { url: 'about:blank' })) as {
			targetId: string;
		};
		targetId = targetResult.targetId;

		const attachResult = (await client.send('Target.attachToTarget', {
			targetId,
			flatten: true
		})) as { sessionId: string };
		sessionId = attachResult.sessionId;

		await client.send('Page.enable', {}, sessionId);
		await client.send('Runtime.enable', {}, sessionId);
		await client.send(
			'Emulation.setDeviceMetricsOverride',
			{
				width: 1920,
				height: 1080,
				deviceScaleFactor: 1,
				mobile: false
			},
			sessionId
		);

		console.log('Opening:', url);
		await client.send('Page.navigate', { url }, sessionId);
		await waitForLoad(client, sessionId, 60000);
		await new Promise((resolve) => setTimeout(resolve, 1500));

		const outputDir = path.dirname(outputPath);
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}

		let screenshotData: string;
		if (args.fullPage) {
			const layout = (await client.send('Page.getLayoutMetrics', {}, sessionId)) as {
				contentSize?: { width: number; height: number; x?: number; y?: number };
			};
			const contentWidth = Math.max(1, Math.ceil(layout.contentSize?.width ?? 1920));
			const contentHeight = Math.max(1, Math.ceil(layout.contentSize?.height ?? 1080));
			const captured = (await client.send(
				'Page.captureScreenshot',
				{
					format: 'png',
					captureBeyondViewport: true,
					clip: { x: 0, y: 0, width: contentWidth, height: contentHeight, scale: 1 }
				},
				sessionId
			)) as { data: string };
			screenshotData = captured.data;
		} else {
			const rect = await waitForSelectorRect(client, sessionId, selector, 30000);
			const captured = (await client.send(
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
				sessionId
			)) as { data: string };
			screenshotData = captured.data;
		}

		fs.writeFileSync(outputPath, Buffer.from(screenshotData, 'base64'));
		console.log('Screenshot saved to:', outputPath);
	} catch (e) {
		console.error('Capture failed:', e);
		console.error(
			`Make sure Chrome can be launched or is running with remote debugging enabled, e.g. --remote-debugging-port=${cdpPort}`
		);
		process.exit(1);
	} finally {
		if (client && targetId) {
			try {
				await client.send('Target.closeTarget', { targetId });
			} catch {
				// ignore cleanup errors
			}
		}
		if (client && sessionId) {
			try {
				await client.send('Target.detachFromTarget', { sessionId });
			} catch {
				// ignore cleanup errors
			}
		}
		client?.close();
		if (launchedChrome && !launchedChrome.killed) {
			try {
				launchedChrome.kill();
			} catch {
				// ignore cleanup errors
			}
		}
		if (launchedChromeUserDataDir) {
			try {
				fs.rmSync(launchedChromeUserDataDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
