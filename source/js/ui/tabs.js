/*
 * Tab switching factory for the Admin and Committee dashboards.
 *
 * Both dashboards work the same way: sidebar buttons call switchTab(name),
 * which hides every .tab-content, shows the chosen one, restyles the
 * .tab-btn buttons, updates the header title/description, and persists the
 * choice. The factory takes each page's own titles, descriptions and
 * storage keys, so the two pages share the mechanics but keep their own
 * tab lists.
 *
 * Persistence model (preserved exactly from the original):
 *   - The active tab is stored in localStorage under the page's storageKey.
 *   - A fresh dashboard session (no sessionStartedKey in sessionStorage)
 *     always starts on the default tab, regardless of what was stored.
 *   - A continuing session restores the stored tab.
 *
 * The Student dashboard uses a DIFFERENT tab system (.tab-button pills,
 * no sidebar, no header text) and keeps its own switcher in its page
 * module. Do not try to unify them.
 *
 * Wiring note for page modules: attach the returned switchTab to window
 * (window.switchTab = switcher.switchTab) so the inline onclick handlers
 * in the HTML can reach it, then call restoreActiveTab() once on load.
 */

import { closeSidebar } from "./sidebar.js";

export function createTabSwitcher(options) {
	const titles = options.titles || {};
	const descriptions = options.descriptions || {};
	const storageKey = options.storageKey;
	const sessionStartedKey = options.sessionStartedKey;
	const defaultTab = options.defaultTab || "overview";
	const onSwitch = options.onSwitch || null;

	function getValidTabName(tabName) {
		return document.getElementById(tabName) && document.querySelector(`[data-tab="${tabName}"]`)
			? tabName
			: defaultTab;
	}

	function switchTab(tabName, switchOptions = {}) {
		const selectedTabName = getValidTabName(tabName);
		document.querySelectorAll(".tab-content").forEach(tab => {
			tab.classList.add("hidden");
		});
		document.querySelectorAll(".tab-btn").forEach(button => {
			button.className = "tab-btn w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 text-gray-700 hover:bg-gray-100";
		});
		document.getElementById(selectedTabName).classList.remove("hidden");
		const activeButton = document.querySelector(`[data-tab="${selectedTabName}"]`);
		activeButton.className = "tab-btn w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 bg-blue-600 text-white shadow-md";
		document.getElementById("pageTitle").textContent = titles[selectedTabName];
		document.getElementById("pageDesc").textContent = descriptions[selectedTabName];
		if (switchOptions.persist !== false) {
			localStorage.setItem(storageKey, selectedTabName);
		}
		if (switchOptions.closeSidebar !== false) {
			closeSidebar();
		}
		if (typeof onSwitch === "function") {
			onSwitch(selectedTabName);
		}
	}

	function restoreActiveTab() {
		const isExistingSession = sessionStorage.getItem(sessionStartedKey) === "true";
		const tabToShow = isExistingSession
			? (localStorage.getItem(storageKey) || defaultTab)
			: defaultTab;
		sessionStorage.setItem(sessionStartedKey, "true");
		switchTab(tabToShow, {
			closeSidebar: false,
			persist: !isExistingSession
		});
	}

	return {
		switchTab,
		restoreActiveTab,
		getValidTabName
	};
}