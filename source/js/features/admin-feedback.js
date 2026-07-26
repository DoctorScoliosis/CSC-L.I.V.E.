/*
 * Student Feedback tab for the Admin dashboard.
 *
 * Reviews feedback submitted by students through the student dashboard's
 * feedback form. Each item can be marked Reviewed or deleted. Long messages
 * are truncated with a "View message" modal.
 */

import { state, dom, supabase, STUDENT_FEEDBACK_TABLE } from "../pages/admin-context.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTime } from "../utils/datetime.js";
import { showDashboardToast } from "../ui/toast.js";
import { showDashboardConfirm } from "../ui/confirm.js";

export async function loadStudentFeedback() {
	if (!dom.studentFeedbackTableBody) return;
	if (state.isLoadingStudentFeedback) {
		state.shouldReloadStudentFeedbackAgain = true;
		return;
	}
	state.isLoadingStudentFeedback = true;
	state.shouldReloadStudentFeedbackAgain = false;
	try {
		if (state.studentFeedbackData.length === 0) {
			dom.studentFeedbackTableBody.innerHTML = `
			<tr>
			<td colspan="6" class="py-6 px-4 text-center text-gray-500">Loading student feedback...</td>
			</tr>
			`;
		}
		const { data, error } = await supabase
			.from(STUDENT_FEEDBACK_TABLE)
			.select("*")
			.order("created_at", { ascending: false });
		if (error) {
			console.error("Error loading student feedback:", error.message || error);
			dom.studentFeedbackTableBody.innerHTML = `
			<tr>
			<td colspan="6" class="py-6 px-4 text-center text-red-500 font-semibold">
			Failed to load feedback. Check the student_feedback table and policies.
			</td>
			</tr>
			`;
			return;
		}
		state.studentFeedbackData = data || [];
		renderStudentFeedback();
	} finally {
		state.isLoadingStudentFeedback = false;
		if (state.shouldReloadStudentFeedbackAgain) {
			state.shouldReloadStudentFeedbackAgain = false;
			await loadStudentFeedback();
		}
	}
}

export function renderStudentFeedback() {
	if (!dom.studentFeedbackTableBody) return;
	if (state.studentFeedbackData.length === 0) {
		dom.studentFeedbackTableBody.innerHTML = `
		<tr>
		<td colspan="6" class="py-6 px-4 text-center text-gray-500">No student feedback submitted yet.</td>
		</tr>
		`;
		return;
	}
	dom.studentFeedbackTableBody.innerHTML = "";
	state.studentFeedbackData.forEach(item => {
		const isReviewed = item.status === "Reviewed";
		const feedbackMessage = String(item.message || "");
		const isLongFeedbackMessage = feedbackMessage.length > 90;
		const statusClass = isReviewed
			? "bg-emerald-100 text-emerald-700"
			: "bg-blue-100 text-blue-700";
		const row = document.createElement("tr");
		row.className = "border-b border-gray-100 align-top";
		row.innerHTML = `
		<td class="py-3 px-4">
		<span class="feedback-type-badge inline-flex max-w-full whitespace-normal break-words rounded-full px-3 py-1 text-xs font-bold ${item.feedback_type === "Concern" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}">
		${escapeHTML(item.feedback_type || "Feedback")}
		</span>
		</td>
		<td class="py-3 px-4">
		<p class="font-semibold text-gray-900">${escapeHTML(item.student_name || "Anonymous")}</p>
		<p class="text-xs text-gray-500">${escapeHTML(item.student_id || "No student ID")}</p>
		<p class="text-xs text-gray-500">${escapeHTML(item.contact_info || "No contact")}</p>
		</td>
		<td class="max-w-0 py-3 px-4 text-sm leading-relaxed text-gray-700">
		${isLongFeedbackMessage ? `
		<p class="truncate">${escapeHTML(feedbackMessage)}</p>
		<button type="button" data-feedback-message-id="${escapeHTML(item.id)}" class="view-feedback-message mt-1 font-bold text-blue-600 hover:text-blue-800">View message</button>
		` : `<p class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">${escapeHTML(feedbackMessage)}</p>`}
		</td>
		<td class="py-3 px-4">
		<span class="inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClass}">
		${escapeHTML(item.status || "New")}
		</span>
		</td>
		<td class="py-3 px-4 text-sm text-gray-600">${formatDateTime(item.created_at)}</td>
		<td class="py-3 px-4 space-y-2">
		<button type="button" data-feedback-id="${item.id}" class="mark-feedback-reviewed px-3 py-2 rounded-lg text-sm font-semibold ${isReviewed ? "bg-gray-200 text-gray-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 text-white"}" ${isReviewed ? "disabled" : ""}>
		${isReviewed ? "Reviewed" : "Mark Reviewed"}
		</button>
		<button type="button" data-feedback-id="${item.id}" class="delete-student-feedback block px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
		Delete
		</button>
		</td>
		`;
		dom.studentFeedbackTableBody.appendChild(row);
	});
	document.querySelectorAll(".mark-feedback-reviewed").forEach(button => {
		button.addEventListener("click", () => markFeedbackReviewed(button.dataset.feedbackId));
	});
	document.querySelectorAll(".view-feedback-message").forEach(button => {
		button.addEventListener("click", () => openStudentFeedbackMessageModal(button.dataset.feedbackMessageId));
	});
	document.querySelectorAll(".delete-student-feedback").forEach(button => {
		button.addEventListener("click", () => deleteStudentFeedback(button.dataset.feedbackId));
	});
}

export function openStudentFeedbackMessageModal(feedbackId) {
	const feedback = state.studentFeedbackData.find(item => String(item.id) === String(feedbackId));
	if (!feedback || !dom.studentFeedbackMessageModal || !dom.studentFeedbackMessageModalText) return;
	dom.studentFeedbackMessageModalText.textContent = feedback.message || "";
	dom.studentFeedbackMessageModal.classList.remove("hidden");
	dom.studentFeedbackMessageModal.classList.add("flex");
}

export function closeStudentFeedbackMessageModalFunction() {
	dom.studentFeedbackMessageModal?.classList.add("hidden");
	dom.studentFeedbackMessageModal?.classList.remove("flex");
}

export async function markFeedbackReviewed(id) {
	const { error } = await supabase
		.from(STUDENT_FEEDBACK_TABLE)
		.update({
			status: "Reviewed",
			reviewed_at: new Date().toISOString()
		})
		.eq("id", id);
	if (error) {
		console.error("Error reviewing feedback:", error.message || error);
		alert("Failed to mark feedback as reviewed.");
		return;
	}
	await loadStudentFeedback();
}

export async function deleteStudentFeedback(id) {
	const confirmDelete = await showDashboardConfirm("Are you sure you want to permanently delete this student feedback?", {
		title: "Delete Feedback",
		confirmText: "Delete Feedback"
	});
	if (!confirmDelete) {
		return;
	}
	const { error } = await supabase
		.from(STUDENT_FEEDBACK_TABLE)
		.delete()
		.eq("id", id);
	if (error) {
		console.error("Error deleting student feedback:", error.message || error);
		alert(`Failed to delete feedback: ${error.message || "Unknown database error."}`);
		return;
	}
	await loadStudentFeedback();
	showDashboardToast("Student feedback deleted.");
}