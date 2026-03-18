import * as THREE from 'three';

type CameraPreset =
	| 'front'
	| 'back'
	| 'left'
	| 'right'
	| 'top'
	| 'bottom'
	| 'iso'
	| 'iso-back'
	| 'iso-left'
	| 'iso-right';

type MarkerInput = {
	pos?: [number, number, number] | { x: number; y: number; z: number };
	color?: string;
	size?: number;
};

type DebugMarker = {
	position: THREE.Vector3;
	color: string;
	size: number;
};

type InitialViewOptions = {
	angle?: CameraPreset;
	pos?: THREE.Vector3;
	lookAt?: THREE.Vector3;
	zoom?: number;
	markers?: DebugMarker[];
};

const CAMERA_PRESETS: Record<CameraPreset, [number, number, number]> = {
	front: [0, 0, 2],
	back: [0, 0, -2],
	left: [-2, 0, 0],
	right: [2, 0, 0],
	top: [0, 2, 0],
	bottom: [0, -2, 0],
	iso: [2, 2, 2],
	'iso-back': [-2, 2, -2],
	'iso-left': [-2, 2, 2],
	'iso-right': [2, 2, -2]
};

type OrbitLikeControls = {
	target: THREE.Vector3;
	update: () => void;
};

function parseVector3(input: string | null): THREE.Vector3 | undefined {
	if (!input) return undefined;
	const parts = input
		.split(',')
		.map((v) => Number.parseFloat(v.trim()))
		.filter((n) => Number.isFinite(n));
	if (parts.length !== 3) return undefined;
	return new THREE.Vector3(parts[0], parts[1], parts[2]);
}

function parseMarkers(input: string | null): DebugMarker[] {
	if (!input) return [];

	const tryParse = (raw: string): unknown | null => {
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	};

	let parsed: unknown | null = null;
	parsed = tryParse(input);

	if (!parsed) {
		try {
			parsed = tryParse(decodeURIComponent(input));
		} catch {
			parsed = null;
		}
	}

	if (!parsed) {
		try {
			parsed = tryParse(atob(input));
		} catch {
			parsed = null;
		}
	}

	if (!parsed) return [];

	const normalizeMarker = (value: MarkerInput, fallbackColor = 'magenta'): DebugMarker | null => {
		if (!value || !value.pos) return null;
		const pos = value.pos;
		const vector = Array.isArray(pos)
			? new THREE.Vector3(pos[0], pos[1], pos[2])
			: new THREE.Vector3(pos.x, pos.y, pos.z);
		if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
			return null;
		}
		return {
			position: vector,
			color: value.color ?? fallbackColor,
			size:
				typeof value.size === 'number' && Number.isFinite(value.size) && value.size > 0
					? value.size
					: 0.05
		};
	};

	if (Array.isArray(parsed)) {
		return parsed
			.map((item) => normalizeMarker(item as MarkerInput))
			.filter((item): item is DebugMarker => item !== null);
	}

	if (typeof parsed === 'object' && parsed !== null) {
		return Object.entries(parsed as Record<string, MarkerInput>)
			.map(([name, item]) => normalizeMarker(item, name.includes('red') ? 'red' : 'magenta'))
			.filter((item): item is DebugMarker => item !== null);
	}

	return [];
}

function getInitialViewOptions(search: string): InitialViewOptions {
	const params = new URLSearchParams(search);
	const angle = params.get('angle') as CameraPreset | null;
	const pos = parseVector3(params.get('pos'));
	const lookAt = parseVector3(params.get('lookAt'));
	const zoomRaw = params.get('zoom');
	const zoom = zoomRaw ? Number.parseFloat(zoomRaw) : undefined;
	const markers = parseMarkers(params.get('markers'));

	return {
		angle: angle && CAMERA_PRESETS[angle] ? angle : undefined,
		pos,
		lookAt,
		zoom: zoom && Number.isFinite(zoom) && zoom > 0 ? zoom : undefined,
		markers
	};
}

function applyViewOptions(
	camera: THREE.PerspectiveCamera,
	options: InitialViewOptions,
	controls?: OrbitLikeControls
): void {
	const target = options.lookAt?.clone() ?? new THREE.Vector3(0, 0, 0);
	let position = camera.position.clone();

	if (options.angle && CAMERA_PRESETS[options.angle]) {
		const [x, y, z] = CAMERA_PRESETS[options.angle];
		position = new THREE.Vector3(x, y, z);
	}

	if (options.pos) {
		position.copy(options.pos);
	}

	if (options.zoom && options.zoom !== 1) {
		const offset = position.clone().sub(target).divideScalar(options.zoom);
		position = target.clone().add(offset);
	}

	camera.position.copy(position);
	if (controls) {
		controls.target.copy(target);
		controls.update();
	} else {
		camera.lookAt(target);
		camera.updateMatrixWorld();
	}
}

function addDebugMarkers(group: THREE.Group, markers: DebugMarker[]): void {
	for (const marker of markers) {
		const geometry = new THREE.SphereGeometry(marker.size, 20, 20);
		const material = new THREE.MeshBasicMaterial({ color: marker.color });
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(marker.position);
		group.add(mesh);
	}
}

export class ViewDebug {
	private markerGroup = new THREE.Group();
	private readonly scene: THREE.Scene;
	private readonly options: InitialViewOptions;

	constructor(
		scene: THREE.Scene,
		camera: THREE.PerspectiveCamera,
		controls?: { target: THREE.Vector3; update: () => void },
		search: string = window.location.search
	) {
		this.scene = scene;
		this.options = getInitialViewOptions(search);
		this.scene.add(this.markerGroup);
		applyViewOptions(camera, this.options, controls);
		addDebugMarkers(this.markerGroup, this.options.markers ?? []);
	}

	dispose(): void {
		for (const child of this.markerGroup.children) {
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				if (Array.isArray(child.material)) {
					child.material.forEach((material) => material.dispose());
				} else {
					child.material.dispose();
				}
			}
		}
		this.markerGroup.clear();
		this.scene.remove(this.markerGroup);
	}
}
