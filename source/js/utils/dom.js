/*
 * Small DOM helpers shared by every page.
 *
 * escapeHTML is the site's defence against HTML injection: any value that
 * comes from the database or from user input MUST pass through it before
 * being placed into an innerHTML string. Do not remove it or "simplify"
 * the character list.
 */

export function escapeHTML(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

// Replaces a table body with a single full-width message row. Used by the
// admin overview tables whenever a section has no data.
export function renderEmptyRow(tbody, colspan, message) {
	if (!tbody) {
		return;
	}
	tbody.innerHTML = `
	<tr>
	<td colspan="${colspan}" class="py-4 px-4 text-gray-600">
	${escapeHTML(message)}
	</td>
	</tr>
	`;
}

// "Juan Dela Cruz" -> "JD". Used for the chat avatar circles.
export function getInitials(name) {
	return String(name || "?")
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map(part => part.charAt(0).toUpperCase())
		.join("") || "?";
}