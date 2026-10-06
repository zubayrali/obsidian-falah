/** Match every search word, showing individual controls unless the heading matches. */
export function filterSettingsSections(container: HTMLElement, query: string): void {
	const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	const matches = (element: Element | null) => words.every((word) => (element?.textContent ?? "").toLocaleLowerCase().includes(word));
	for (const section of Array.from(container.querySelectorAll<HTMLElement>(".falah-settings-section"))) {
		const headingMatches = words.length > 0 && matches(section.querySelector(".falah-settings-section-header"));
		const rows = Array.from(section.querySelectorAll<HTMLElement>(".setting-item"));
		for (const row of rows) row.hidden = words.length > 0 && !headingMatches && !matches(row);
		const visible = !words.length || headingMatches || (rows.length ? rows.some((row) => !row.hidden) : matches(section));
		section.hidden = !visible;
	}
}
