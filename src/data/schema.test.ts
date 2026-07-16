import { describe, expect, it } from "vitest";
import { DataError, NetworkError, NotFoundError, NotInstalledError, SchemaError, StorageError } from "./schema";

describe("typed errors", () => {
	it("NotInstalledError carries the resource id and a default message", () => {
		const e = new NotInstalledError("core-uthmani");
		expect(e).toBeInstanceOf(DataError);
		expect(e).toBeInstanceOf(Error);
		expect(e.resourceId).toBe("core-uthmani");
		expect(e.message).toContain("core-uthmani");
		expect(e.name).toBe("NotInstalledError");
	});

	it("NotInstalledError accepts a custom message", () => {
		const e = new NotInstalledError("core-uthmani", "custom message");
		expect(e.message).toBe("custom message");
		expect(e.resourceId).toBe("core-uthmani");
	});

	it.each([
		["SchemaError", SchemaError],
		["NetworkError", NetworkError],
		["NotFoundError", NotFoundError],
	])("%s is a DataError with a matching name", (name, Ctor) => {
		const e = new Ctor("boom");
		expect(e).toBeInstanceOf(DataError);
		expect(e.message).toBe("boom");
		expect(e.name).toBe(name);
	});

	it("StorageError is a DataError, named, and preserves cause", () => {
		const cause = new Error("EACCES: permission denied");
		const e = new StorageError("boom", { cause });
		expect(e).toBeInstanceOf(DataError);
		expect(e).toBeInstanceOf(Error);
		expect(e.name).toBe("StorageError");
		expect(e.message).toBe("boom");
		expect(e.cause).toBe(cause);
	});
});
