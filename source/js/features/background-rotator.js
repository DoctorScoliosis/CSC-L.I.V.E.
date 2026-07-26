/*
 * Background photo rotator for the dashboard pages and the registration form.
 *
 * Before the refactor, four pages each carried their own inline copy of this
 * crossfade, and a fifth, better copy sat abandoned in
 * dashboard-backgrounds/backgrounds.js, never wired up. This module is that
 * fifth copy, tidied up: it preloads the photos, cleans up its timer on
 * re-init, and copes with an empty image list.
 *
 * How it works: styles.css paints two fixed layers (body::before and
 * body::after) from the CSS variables set here. Every ROTATE_INTERVAL_MS the
 * module writes the next photo into the hidden layer, then flips the
 * "dashboard-bg-show-b" class on <body>; the 1.8s opacity transition in
 * styles.css performs the actual crossfade. The photos themselves live in
 * assets/backgrounds/ (see DEFAULT_BACKGROUND_IMAGES).
 *
 * Usage from a page module:
 *   import { initBackgroundRotator } from "../features/background-rotator.js";
 *   initBackgroundRotator();                     // default photo set
 *   initBackgroundRotator({ images: [...] });    // custom photo set
 *
 * The registration form used to probe two different folders for each photo
 * (a fossil of the old duplicated-asset layout). The photos now live in one
 * canonical place, so the form simply uses the default set — no probing.
 */

// The default photo set, relative to the site root (source/). Order matters:
// the first entry is the photo shown before the first rotation.
export const DEFAULT_BACKGROUND_IMAGES = [
	"./assets/backgrounds/56435184_2377398058971412_6905733492668104704_n.jpg",
	"./assets/backgrounds/469984691_918281827068965_7471383534469226798_n.jpg",
	"./assets/backgrounds/472760250_9329332677111214_8161660048911603548_n.jpg",
	"./assets/backgrounds/671018030_1284495603780917_8907957753481931746_n.jpg"
];

// How long each photo stays on screen before crossfading to the next.
export const ROTATE_INTERVAL_MS = 8500;

let backgroundTimer = null;

export function initBackgroundRotator(options = {}) {
	const start = () => {
		const images = (Array.isArray(options.images) ? options.images : DEFAULT_BACKGROUND_IMAGES)
			.filter(Boolean);
		const root = document.documentElement;

		// Idempotent: a second call replaces the first rotator rather than
		// stacking timers.
		window.clearInterval(backgroundTimer);
		backgroundTimer = null;
		document.body.classList.remove("dashboard-bg-show-b");

		if (images.length === 0) {
			root.style.removeProperty("--dashboard-photo-url");
			root.style.removeProperty("--dashboard-photo-url-a");
			root.style.removeProperty("--dashboard-photo-url-b");
			root.style.removeProperty("--dashboard-photo-size");
			return;
		}

		// Warm the browser cache so the first crossfade does not flash a
		// half-loaded photo.
		images.forEach(src => {
			const image = new Image();
			image.src = src;
		});

		let currentIndex = 0;
		let visibleLayer = "a";
		root.style.setProperty("--dashboard-photo-size", "cover");
		root.style.setProperty("--dashboard-photo-url-a", `url("${images[0]}")`);
		root.style.setProperty("--dashboard-photo-url-b", `url("${images[0]}")`);

		if (images.length > 1) {
			backgroundTimer = window.setInterval(() => {
				currentIndex = (currentIndex + 1) % images.length;
				const nextUrl = `url("${images[currentIndex]}")`;
				if (visibleLayer === "a") {
					root.style.setProperty("--dashboard-photo-url-b", nextUrl);
					window.requestAnimationFrame(() => document.body.classList.add("dashboard-bg-show-b"));
					visibleLayer = "b";
				} else {
					root.style.setProperty("--dashboard-photo-url-a", nextUrl);
					window.requestAnimationFrame(() => document.body.classList.remove("dashboard-bg-show-b"));
					visibleLayer = "a";
				}
			}, options.intervalMs || ROTATE_INTERVAL_MS);
		}
	};

	// Page modules already run after the document is parsed, but keep the
	// guard so the module is safe to import from anywhere.
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start, { once: true });
	} else {
		start();
	}
}

// Stops the rotator and leaves whichever photo is currently visible in place.
export function stopBackgroundRotator() {
	window.clearInterval(backgroundTimer);
	backgroundTimer = null;
}