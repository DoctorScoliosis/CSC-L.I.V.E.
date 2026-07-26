/*
 * Toast notifications for the dashboard pages.
 *
 * A toast is the small message that appears in the bottom-right corner
 * after an action ("Team deleted successfully!"). Three types:
 *   "success" (default, green), "warning" (amber), "error" (red).
 *
 * Used by: Admin and Committee dashboards. The Student dashboard and the
 * registration form use their own inline status areas instead.
 */

export function showDashboardToast(message, type = "success") {
	const toast = document.createElement("div");
	const toneClass = type === "error"
		? "border-red-200 bg-red-50 text-red-800"
		: type === "warning"
		? "border-amber-200 bg-amber-50 text-amber-800"
		: "border-emerald-200 bg-emerald-50 text-emerald-800";
	toast.className = `fixed bottom-5 right-5 z-[9999] max-w-sm rounded-2xl border px-4 py-3 text-sm font-bold shadow-2xl ${toneClass}`;
	toast.textContent = message;
	document.body.appendChild(toast);
	window.setTimeout(() => {
		toast.classList.add("opacity-0", "transition-opacity", "duration-300");
		window.setTimeout(() => toast.remove(), 350);
	}, 2600);
}