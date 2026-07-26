/*
 * Generic modal open/close helpers.
 *
 * Every modal in the Admin, Committee and Student dashboards follows the
 * same Tailwind pattern: the overlay element carries "hidden" when closed
 * and "flex" when open. These two helpers are the whole trick:
 *
 *   openModal(teamModal);
 *   closeModal(teamModal);
 *
 * Page modules keep their own named functions (openAddTeamModal etc.)
 * because each one also resets forms and prefills fields — those call
 * these helpers rather than repeating the class juggling.
 *
 * NOT used by CSC-CUP-Form.html: the registration form's overlays use an
 * "is-open" class pattern instead, and that stays in its page module.
 */

export function openModal(modalElement) {
	if (!modalElement) {
		return;
	}
	modalElement.classList.remove("hidden");
	modalElement.classList.add("flex");
}

export function closeModal(modalElement) {
	if (!modalElement) {
		return;
	}
	modalElement.classList.add("hidden");
	modalElement.classList.remove("flex");
}