/*
 * Off-canvas sidebar for the Admin and Committee dashboards.
 *
 * The sidebar is hidden off-screen (translateX(-105%)) and slides in when
 * the body gets the "sidebar-open" class. The toggle button in the header
 * swaps its label between "☰ Menu" and "Close". On desktop-width resizes
 * the sidebar auto-closes — register that once per page with
 * initSidebarAutoClose().
 *
 * The Student dashboard and the registration form have no sidebar.
 */

export function openSidebar() {
	document.body.classList.add("sidebar-open");
	const toggleButton = document.getElementById("sidebarToggle");
	if (toggleButton) {
		toggleButton.textContent = "Close";
		toggleButton.setAttribute("aria-expanded", "true");
	}
}

export function closeSidebar() {
	document.body.classList.remove("sidebar-open");
	const toggleButton = document.getElementById("sidebarToggle");
	if (toggleButton) {
		toggleButton.textContent = "☰ Menu";
		toggleButton.setAttribute("aria-expanded", "false");
	}
}

export function toggleSidebar() {
	if (document.body.classList.contains("sidebar-open")) {
		closeSidebar();
	} else {
		openSidebar();
	}
}

// Call once from the page module. Closes the sidebar whenever the window
// is resized to desktop width (1024px or wider).
export function initSidebarAutoClose() {
	window.addEventListener("resize", function () {
		if (window.innerWidth >= 1024) {
			closeSidebar();
		}
	});
}