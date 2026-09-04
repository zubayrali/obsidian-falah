export const PROGRESS_SCHEMA_VERSION = 1 as const;

export interface ReadingPosition {
	surah: number;
	ayah: number;
	scrollAnchor: string;
	updatedAt: number;
}

export interface ResumeTarget {
	surah: number;
	ayah: number;
	scrollAnchor: string;
}

export interface ProgressStore {
	version: typeof PROGRESS_SCHEMA_VERSION;
	lastRead?: ReadingPosition;
	furthestRead: Record<string, ReadingPosition>;
}

export function emptyProgressStore(): ProgressStore {
	return { version: PROGRESS_SCHEMA_VERSION, furthestRead: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isReadingPosition(value: unknown): value is ReadingPosition {
	if (!isRecord(value)) return false;
	return isPositiveInteger(value.surah)
		&& value.surah <= 114
		&& isPositiveInteger(value.ayah)
		&& typeof value.scrollAnchor === "string"
		&& value.scrollAnchor.trim().length > 0
		&& typeof value.updatedAt === "number"
		&& Number.isFinite(value.updatedAt)
		&& value.updatedAt >= 0;
}

/** Parse a persisted progress file. Corrupt, unsupported, or partially invalid
 * files safely degrade to an empty current-version store. */
export function parseProgressStore(json: string): ProgressStore {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		return emptyProgressStore();
	}
	if (!isRecord(value) || value.version !== PROGRESS_SCHEMA_VERSION) {
		return emptyProgressStore();
	}
	if (value.lastRead !== undefined && !isReadingPosition(value.lastRead)) {
		return emptyProgressStore();
	}
	if (!isRecord(value.furthestRead)) return emptyProgressStore();

	const furthestRead: Record<string, ReadingPosition> = {};
	for (const [key, position] of Object.entries(value.furthestRead)) {
		if (!isReadingPosition(position) || String(position.surah) !== key) {
			return emptyProgressStore();
		}
		furthestRead[key] = { ...position };
	}
	return {
		version: PROGRESS_SCHEMA_VERSION,
		lastRead: value.lastRead ? { ...value.lastRead } : undefined,
		furthestRead,
	};
}

export function serializeProgressStore(store: ProgressStore): string {
	const furthestRead = Object.fromEntries(
		Object.entries(store.furthestRead)
			.sort(([a], [b]) => Number(a) - Number(b))
			.map(([surah, position]) => [surah, { ...position }]),
	);
	return `${JSON.stringify({
		version: PROGRESS_SCHEMA_VERSION,
		lastRead: store.lastRead,
		furthestRead,
	}, null, 2)}\n`;
}
