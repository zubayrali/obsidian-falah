import {
	emptyProgressStore,
	parseProgressStore,
	serializeProgressStore,
	type ProgressStore,
	type ReadingPosition,
	type ResumeTarget,
} from "./schema";

/** The subset of the vault FileIO contract needed by reading progress.
 * src/data/store.FileIO is structurally compatible with this interface. */
export interface ProgressFileIO {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
}

export interface RecordProgressInput {
	surah: number;
	ayah: number;
	scrollAnchor: string;
}

export interface ProgressScheduler {
	setTimeout(callback: () => void, delayMs: number): number;
	clearTimeout(handle: number): void;
}

export interface ProgressStoreOptions {
	scheduler: ProgressScheduler;
	now?: () => number;
	debounceMs?: number;
	onPersistError?: (error: unknown) => void;
}

export class ReadingProgressService {
	private store: ProgressStore = emptyProgressStore();
	private dirty = false;
	private timer: number | undefined;
	private activeFlush: Promise<void> | undefined;
	private readonly now: () => number;
	private readonly debounceMs: number;
	private readonly onPersistError: (error: unknown) => void;
	private readonly scheduler: ProgressScheduler;

	constructor(
		private readonly io: ProgressFileIO,
		private path: string,
		options: ProgressStoreOptions,
	) {
		this.scheduler = options.scheduler;
		this.now = options.now ?? (() => Date.now());
		this.debounceMs = Math.max(0, options.debounceMs ?? 1000);
		this.onPersistError = options.onPersistError ?? (() => undefined);
	}

	async load(): Promise<void> {
		// Preserve a pending update if a caller explicitly reloads the service.
		await this.flush();
		this.store = (await this.io.exists(this.path))
			? parseProgressStore(await this.io.read(this.path))
			: emptyProgressStore();
		this.dirty = false;
	}

	/** Update memory immediately and coalesce disk writes. The caller should pass
	 * the stable `data-ayah-key` of the top/active reader row as scrollAnchor. */
	record(input: RecordProgressInput): void {
		this.assertInput(input);
		const position: ReadingPosition = { ...input, updatedAt: this.now() };
		this.store.lastRead = position;

		const key = String(input.surah);
		const previous = this.store.furthestRead[key];
		if (!previous || input.ayah > previous.ayah) {
			this.store.furthestRead[key] = { ...position };
		}
		this.dirty = true;
		this.scheduleFlush();
	}

	lastRead(): ReadingPosition | undefined {
		return this.store.lastRead ? { ...this.store.lastRead } : undefined;
	}

	resumeTarget(): ResumeTarget | undefined {
		const lastRead = this.store.lastRead;
		const position = lastRead ? this.store.furthestRead[String(lastRead.surah)] ?? lastRead : undefined;
		if (!position) return undefined;
		return {
			surah: position.surah,
			ayah: position.ayah,
			scrollAnchor: position.scrollAnchor,
		};
	}

	async switchPath(path: string): Promise<void> {
		const next = path.trim();
		if (!next || next === this.path) return;
		await this.flush();
		this.path = next;
		this.store = emptyProgressStore();
		await this.load();
	}

	furthestForSurah(surah: number): ReadingPosition | undefined {
		const position = this.store.furthestRead[String(surah)];
		return position ? { ...position } : undefined;
	}

	allFurthest(): Record<string, ReadingPosition> {
		return Object.fromEntries(
			Object.entries(this.store.furthestRead).map(([key, value]) => [key, { ...value }]),
		);
	}

	/** Clear progress and durably persist the empty state before resolving. */
	async clear(): Promise<void> {
		this.store = emptyProgressStore();
		this.dirty = true;
		await this.flush();
	}

	/** Persist all state observed before this call resolves, including updates
	 * made while an earlier write is in flight. Safe to call during unload. */
	async flush(): Promise<void> {
		this.cancelTimer();
		if (this.activeFlush) {
			await this.activeFlush;
			if (this.dirty) await this.flush();
			return;
		}
		if (!this.dirty) return;

		this.activeFlush = this.drainWrites();
		try {
			await this.activeFlush;
		} finally {
			this.activeFlush = undefined;
			this.cancelTimer();
		}
	}

	private async drainWrites(): Promise<void> {
		while (this.dirty) {
			this.dirty = false;
			try {
				await this.persist();
			} catch (error) {
				this.dirty = true;
				throw error;
			}
		}
	}

	private async persist(): Promise<void> {
		const directory = this.path.includes("/")
			? this.path.slice(0, this.path.lastIndexOf("/"))
			: "";
		if (directory && !(await this.io.exists(directory))) {
			await this.io.mkdir(directory);
		}
		await this.io.write(this.path, serializeProgressStore(this.store));
	}

	private scheduleFlush(): void {
		this.cancelTimer();
		this.timer = this.scheduler.setTimeout(() => {
			this.timer = undefined;
			void this.flush().catch(this.onPersistError);
		}, this.debounceMs);
	}

	private cancelTimer(): void {
		if (this.timer !== undefined) {
			this.scheduler.clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	private assertInput(input: RecordProgressInput): void {
		if (!Number.isSafeInteger(input.surah) || input.surah < 1 || input.surah > 114) {
			throw new RangeError("surah must be an integer from 1 to 114");
		}
		if (!Number.isSafeInteger(input.ayah) || input.ayah < 1) {
			throw new RangeError("ayah must be a positive integer");
		}
		if (!input.scrollAnchor.trim()) {
			throw new TypeError("scrollAnchor must be a non-empty string");
		}
	}
}
