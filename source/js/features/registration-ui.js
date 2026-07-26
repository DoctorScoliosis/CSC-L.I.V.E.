/*
 * Alerts and modal dialogs for the CSC Cup registration page.
 *
 * Owns the inline form alert (setAlert / clearAlert) and the three overlay
 * modals: privacy notice, registration success, and rule notice. All DOM
 * access goes through the shared `dom` object from registration-context.js.
 */

import { dom, REGISTRATION_SUCCESS_MESSAGE, MAJOR_SELECTION_RULE_MESSAGE } from "../pages/registration-context.js";

export function setAlert(message, type = "error") {
	if (type !== "success") {
		openRuleNoticeModal(message, "Registration Notice");
		return;
	}
	dom.formAlert.textContent = message;
	dom.formAlert.className = `rounded-2xl border-2 px-5 py-4 text-base font-black form-alert-attention ${
		type === "success"
			? "border-emerald-400 bg-emerald-50 text-emerald-900"
			: "border-red-500 bg-red-50 text-red-800"
	}`;
	dom.formAlert.classList.remove("hidden");
	dom.formAlert.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function clearAlert() {
	dom.formAlert.classList.add("hidden");
	dom.formAlert.textContent = "";
}

export function openPrivacyNotice() {
	dom.privacyNoticeModal.classList.add("is-open");
	document.body.classList.add("overflow-hidden");
}

export function closePrivacyNoticeFunction() {
	dom.privacyNoticeModal.classList.remove("is-open");
	document.body.classList.remove("overflow-hidden");
}

export function openSuccessModal() {
	dom.successModalMessage.textContent = REGISTRATION_SUCCESS_MESSAGE;
	dom.successModal.classList.add("is-open");
	document.body.classList.add("overflow-hidden");
	dom.closeSuccessModal.focus();
}

export function closeSuccessModalFunction() {
	dom.successModal.classList.remove("is-open");
	document.body.classList.remove("overflow-hidden");
}

export function openRuleNoticeModal(message = MAJOR_SELECTION_RULE_MESSAGE, title = "Sport Selection Rule") {
	clearAlert();
	dom.ruleNoticeTitle.textContent = title;
	dom.ruleNoticeMessage.textContent = message;
	dom.ruleNoticeModal.classList.add("is-open");
	document.body.classList.add("overflow-hidden");
}

export function closeRuleNoticeModal() {
	dom.ruleNoticeModal.classList.remove("is-open");
	document.body.classList.remove("overflow-hidden");
}