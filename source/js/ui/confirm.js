/*
 * Confirmation dialog for the dashboard pages.
 *
 * Replaces the browser's native confirm() with a styled modal. Returns a
 * Promise that resolves to true (confirm clicked) or false (cancel,
 * Escape, or backdrop click). Typical use:
 *
 *   const confirmed = await showDashboardConfirm("Delete this team?", {
 *       title: "Delete Team",
 *       confirmText: "Delete Team"
 *   });
 *   if (!confirmed) return;
 *
 * Used by: Admin and Committee dashboards (identical behaviour).
 */

import { escapeHTML } from "../utils/dom.js";

export function showDashboardConfirm(message, options = {}) {
	return new Promise(resolve => {
		const overlay = document.createElement("div");
		overlay.className = "fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4";
		overlay.innerHTML = `
		<div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
		<h2 class="text-xl font-black text-slate-950">${escapeHTML(options.title || "Confirm Action")}</h2>
		<p class="mt-3 whitespace-pre-wrap text-sm font-semibold text-slate-600">${escapeHTML(message)}</p>
		<div class="mt-6 flex justify-end gap-3">
		<button type="button" data-confirm-cancel class="rounded-xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-200">${escapeHTML(options.cancelText || "Cancel")}</button>
		<button type="button" data-confirm-ok class="rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white hover:bg-red-700">${escapeHTML(options.confirmText || "Delete")}</button>
		</div>
		</div>
		`;
		const handleEscape = event => {
			if (event.key !== "Escape") {
				return;
			}
			close(false);
		};
		const close = value => {
			document.removeEventListener("keydown", handleEscape);
			overlay.remove();
			resolve(value);
		};
		overlay.querySelector("[data-confirm-ok]")?.addEventListener("click", () => close(true));
		overlay.querySelector("[data-confirm-cancel]")?.addEventListener("click", () => close(false));
		overlay.addEventListener("click", event => {
			if (event.target === overlay) {
				close(false);
			}
		});
		document.addEventListener("keydown", handleEscape);
		document.body.appendChild(overlay);
		overlay.querySelector("[data-confirm-cancel]")?.focus();
	});
}