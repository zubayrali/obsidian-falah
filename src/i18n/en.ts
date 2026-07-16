// Every user-facing string in Falah. This is the source of truth: other locales
// are Partial<Strings>, so any key they omit falls back to English at merge time.
//
// Interpolation is a function per key, never concatenation at the call site —
// word order differs in RTL (Arabic) and in Urdu, and a call site that glues
// fragments together cannot be translated correctly.
export const en = {
	pluginName: "Falah",
};

export type Strings = typeof en;
