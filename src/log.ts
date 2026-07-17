import { Notice } from "obsidian";

export type LogLevel = "info" | "warn" | "error";

/** One place for user-facing messages: a Notice plus a matching console line, so
 *  every user-visible failure leaves a trace a bug report can quote.
 *
 *  Deliberately NEVER throws — obsidian-lifeos's equivalent throws at error
 *  level, but our error notices sit inside catch blocks that intentionally
 *  continue (a failed write reports false and keeps the user's text). Code that
 *  must abort throws explicitly at its own call site.
 *
 *  `silent` logs without a Notice, for background failures the user needn't see. */
export function logMessage(
	message: string,
	level: LogLevel = "info",
	opts?: { silent?: boolean; durationMs?: number }
): void {
	if (!opts?.silent) new Notice(message, opts?.durationMs ?? (level === "error" ? 10000 : undefined));
	const line = `Falah: ${message}`;
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.info(line);
}
