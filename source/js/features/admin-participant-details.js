/*
 * Participant document rendering + printing for the Admin dashboard.
 *
 * Owns the read-only document presentation used by the participant details
 * modal: the document cards (with print-selection checkboxes), the
 * full-screen image viewer, and the "print selected images" report.
 *
 * The details modal itself (openParticipantDetailsModal) lives in
 * admin-participants.js and imports these renderers — the dependency is
 * one-directional (participants -> details -> helpers).
 */

import { dom } from "../pages/admin-context.js";
import { getParticipantDisplayName } from "../pages/admin-participant-helpers.js";
import { escapeHTML } from "../utils/dom.js";

export function renderParticipantDocumentCard(label, url) {
	if (!url) {
		return `
		<div class="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm font-semibold text-gray-500">
		${escapeHTML(label)} not submitted.
		</div>
		`;
	}
	return `
	<div class="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-sm">
	<button type="button" data-participant-image-url="${escapeHTML(url)}" class="participant-document-preview block w-full text-left hover:ring-4 hover:ring-blue-100">
	<img src="${escapeHTML(url)}" alt="${escapeHTML(label)}" class="h-56 w-full object-cover">
	</button>
	<label class="flex cursor-pointer items-start gap-3 px-4 py-3 text-sm font-black text-gray-800">
	<input
	type="checkbox"
	class="participant-document-print-checkbox mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
	data-participant-print-label="${escapeHTML(label)}"
	data-participant-print-url="${escapeHTML(url)}"
	checked>
	<span class="min-w-0 flex-1">${escapeHTML(label)}</span>
	</label>
	</div>
	`;
}

export function renderParticipantDocumentCards(label, urls) {
	const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
	if (!list.length) {
		return renderParticipantDocumentCard(label, "");
	}
	return list.map((url, index) => {
		const pageLabel = list.length > 1 ? `${label} - Page ${index + 1}` : label;
		return renderParticipantDocumentCard(pageLabel, url);
	}).join("");
}

export function openParticipantImageViewer(url) {
	if (!url) return;
	dom.participantImageViewerImage.src = url;
	dom.participantImageViewerModal.classList.remove("hidden");
	dom.participantImageViewerModal.classList.add("flex");
}

export function closeParticipantImageViewerFunction() {
	dom.participantImageViewerModal.classList.add("hidden");
	dom.participantImageViewerModal.classList.remove("flex");
	dom.participantImageViewerImage.removeAttribute("src");
}

export function getSelectedParticipantDocumentPrintItems() {
	return Array.from(dom.participantDetailsContent.querySelectorAll(".participant-document-print-checkbox:checked"))
		.map(checkbox => ({
			label: checkbox.dataset.participantPrintLabel || "Participant document",
			url: checkbox.dataset.participantPrintUrl || ""
		}))
		.filter(item => item.url);
}

export function printSelectedParticipantDocuments(participant) {
	const selectedItems = getSelectedParticipantDocumentPrintItems();
	if (!selectedItems.length) {
		alert("Please select at least one document image to print.");
		return;
	}
	const printWindow = window.open("", "_blank", "width=1000,height=800");
	if (!printWindow) {
		alert("Popup blocked. Please allow popups to print participant documents.");
		return;
	}
	const participantName = getParticipantDisplayName(participant);
	const generatedAt = new Date().toLocaleString();
	const printDocument = printWindow.document;
	printDocument.open();
	printDocument.write(`<!DOCTYPE html>
<html>
<head>
<title>Participant Documents - ${escapeHTML(participantName)}</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; color: #111827; font-family: Arial, sans-serif; }
.document-page {
position: relative;
height: 100vh;
overflow: hidden;
break-after: page;
page-break-after: always;
padding: 0;
}
.document-page:last-child { break-after: auto; page-break-after: auto; }
.document-heading {
position: absolute;
left: 8mm;
top: 8mm;
z-index: 2;
max-width: calc(100% - 16mm);
border-radius: 6px;
background: rgba(255, 255, 255, 0.82);
padding: 2mm 3mm;
}
h1 { margin: 0; font-size: 11px; line-height: 1.1; color: #111827; }
h2 { margin: 1px 0 0; font-size: 10px; line-height: 1.1; color: #1e3a8a; }
p { margin: 1px 0 0; color: #4b5563; font-size: 8px; line-height: 1.1; }
.document-image-wrap {
position: absolute;
inset: 0;
display: flex;
align-items: center;
justify-content: center;
padding: 6mm;
}
img { display: block; width: 100%; height: 100%; object-fit: contain; border: 0; border-radius: 0; }
@media print {
@page { margin: 0; }
.document-page { height: 100vh; }
.document-image-wrap { padding: 4mm; }
}
</style>
</head>
<body>
${selectedItems.map(item => `
<section class="document-page">
<div class="document-heading">
<h1>${escapeHTML(participantName)}</h1>
<h2>${escapeHTML(item.label)}</h2>
<p>Generated ${escapeHTML(generatedAt)}</p>
</div>
<div class="document-image-wrap">
<img src="${escapeHTML(item.url)}" alt="${escapeHTML(item.label)}">
</div>
</section>
`).join("")}
<script>
window.addEventListener("load", function () {
window.focus();
window.print();
});
<\/script>
</body>
</html>`);
	printDocument.close();
}