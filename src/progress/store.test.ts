import { beforeEach, describe, expect, it } from "vitest";
import {
	PROGRESS_SCHEMA_VERSION,
	ReadingProgressService,
	parseProgressStore,
	type ProgressFileIO,
	type ProgressScheduler,
} from "./index";

function manualScheduler(): ProgressScheduler & { runAll(): void } {
	let nextHandle = 1;
	const callbacks = new Map<number, () => void>();
	return {
		setTimeout(callback) {
			const handle = nextHandle++;
			callbacks.set(handle, callback);
			return handle;
		},
		clearTimeout(handle) { callbacks.delete(handle); },
		runAll() {
			const pending = [...callbacks.values()];
			callbacks.clear();
			for (const callback of pending) callback();
		},
	};
}

function memoryIO(seed: Record<string, string> = {}): ProgressFileIO & {
	files: Record<string, string>;
	writes: string[];
} {
	const files = { ...seed };
	const writes: string[] = [];
	return {
		files,
		writes,
		async read(path) {
			if (!(path in files)) throw new Error("ENOENT");
			return files[path];
		},
		async write(path, data) {
			files[path] = data;
			writes.push(data);
		},
		async exists(path) { return path in files; },
		async mkdir(path) { files[path] = "<directory>"; },
	};
}

describe("ReadingProgressService", () => {
	let io: ReturnType<typeof memoryIO>;
	let service: ReadingProgressService;
	let scheduler: ReturnType<typeof manualScheduler>;

	beforeEach(async () => {
		io = memoryIO();
		scheduler = manualScheduler();
		service = new ReadingProgressService(io, "Falah/progress.json", {
			scheduler,
			now: () => 1234,
			debounceMs: 100,
		});
		await service.load();
	});

	it("starts empty when no progress file exists", () => {
		expect(service.lastRead()).toBeUndefined();
		expect(service.resumeTarget()).toBeUndefined();
		expect(service.allFurthest()).toEqual({});
	});

	it("records last read and the per-surah furthest position immediately", () => {
		service.record({ surah: 2, ayah: 10, scrollAnchor: "2:10" });

		expect(service.lastRead()).toEqual({
			surah: 2, ayah: 10, scrollAnchor: "2:10", updatedAt: 1234,
		});
		expect(service.furthestForSurah(2)).toEqual(service.lastRead());
		expect(service.resumeTarget()).toEqual({ surah: 2, ayah: 10, scrollAnchor: "2:10" });
	});

	it("moves last read backwards without reducing furthest read", () => {
		service.record({ surah: 2, ayah: 20, scrollAnchor: "2:20" });
		service.record({ surah: 2, ayah: 8, scrollAnchor: "2:8" });

		expect(service.lastRead()?.ayah).toBe(8);
		expect(service.furthestForSurah(2)?.ayah).toBe(20);
		expect(service.resumeTarget()).toEqual({ surah: 2, ayah: 20, scrollAnchor: "2:20" });
	});

	it("flushes then switches to a different progress file", async () => {
		service.record({ surah: 2, ayah: 20, scrollAnchor: "2:20" });
		io.files["Other/progress.json"] = JSON.stringify({
			version: PROGRESS_SCHEMA_VERSION,
			lastRead: { surah: 3, ayah: 5, scrollAnchor: "3:5", updatedAt: 2 },
			furthestRead: { "3": { surah: 3, ayah: 5, scrollAnchor: "3:5", updatedAt: 2 } },
		});
		await service.switchPath("Other/progress.json");
		expect(io.files["Falah/progress.json"]).toContain('"ayah": 20');
		expect(service.resumeTarget()?.surah).toBe(3);
	});

	it("tracks furthest positions independently by surah", () => {
		service.record({ surah: 1, ayah: 7, scrollAnchor: "1:7" });
		service.record({ surah: 2, ayah: 5, scrollAnchor: "2:5" });

		expect(service.furthestForSurah(1)?.ayah).toBe(7);
		expect(service.furthestForSurah(2)?.ayah).toBe(5);
	});

	it("debounces rapid records into one durable write", async () => {
		service.record({ surah: 2, ayah: 1, scrollAnchor: "2:1" });
		service.record({ surah: 2, ayah: 2, scrollAnchor: "2:2" });
		expect(io.writes).toHaveLength(0);

		scheduler.runAll();
		await service.flush();

		expect(io.writes).toHaveLength(1);
		const persisted = JSON.parse(io.writes[0]) as { lastRead: { ayah: number } };
		expect(persisted.lastRead.ayah).toBe(2);
	});

	it("flush writes pending state immediately and creates its parent directory", async () => {
		service.record({ surah: 3, ayah: 7, scrollAnchor: "3:7" });
		await service.flush();

		expect(io.files["Falah"]).toBe("<directory>");
		expect(JSON.parse(io.files["Falah/progress.json"])).toMatchObject({
			version: PROGRESS_SCHEMA_VERSION,
			lastRead: { surah: 3, ayah: 7 },
		});
		scheduler.runAll();
		await service.flush();
		expect(io.writes).toHaveLength(1);
	});

	it("reloads persisted progress", async () => {
		service.record({ surah: 18, ayah: 10, scrollAnchor: "18:10" });
		await service.flush();
		const reloaded = new ReadingProgressService(io, "Falah/progress.json", {
			scheduler: manualScheduler(),
		});
		await reloaded.load();

		expect(reloaded.resumeTarget()).toEqual({
			surah: 18, ayah: 10, scrollAnchor: "18:10",
		});
		expect(reloaded.furthestForSurah(18)?.ayah).toBe(10);
	});

	it("clear persists an empty current-version store", async () => {
		service.record({ surah: 18, ayah: 10, scrollAnchor: "18:10" });
		await service.clear();

		expect(service.resumeTarget()).toBeUndefined();
		expect(JSON.parse(io.files["Falah/progress.json"])).toEqual({
			version: PROGRESS_SCHEMA_VERSION,
			furthestRead: {},
		});
	});

	it("rejects invalid positions without changing state", () => {
		expect(() => service.record({ surah: 0, ayah: 1, scrollAnchor: "0:1" })).toThrow(RangeError);
		expect(() => service.record({ surah: 1, ayah: 0, scrollAnchor: "1:0" })).toThrow(RangeError);
		expect(() => service.record({ surah: 1, ayah: 1, scrollAnchor: " " })).toThrow(TypeError);
		expect(service.lastRead()).toBeUndefined();
	});

	it("returns defensive copies", () => {
		service.record({ surah: 2, ayah: 10, scrollAnchor: "2:10" });
		const last = service.lastRead()!;
		last.ayah = 99;
		const furthest = service.allFurthest();
		furthest["2"].ayah = 98;

		expect(service.lastRead()?.ayah).toBe(10);
		expect(service.furthestForSurah(2)?.ayah).toBe(10);
	});
});

describe("progress schema", () => {
	it("degrades malformed JSON, unsupported versions, and invalid positions to empty", () => {
		for (const input of [
			"not json",
			JSON.stringify({ version: 2, furthestRead: {} }),
			JSON.stringify({ version: 1, lastRead: { surah: 0 }, furthestRead: {} }),
			JSON.stringify({
				version: 1,
				furthestRead: { "2": { surah: 3, ayah: 1, scrollAnchor: "3:1", updatedAt: 1 } },
			}),
		]) {
			expect(parseProgressStore(input)).toEqual({ version: 1, furthestRead: {} });
		}
	});
});
