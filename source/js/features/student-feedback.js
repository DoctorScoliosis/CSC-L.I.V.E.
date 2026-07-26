/*
 * Student feedback form for the Student dashboard.
 *
 * Submits a recommendation or concern to the student_feedback table, where
 * the admin dashboard reviews it. All fields except the message are
 * optional (students can submit anonymously).
 */

import { supabase, dom, STUDENT_FEEDBACK_TABLE } from "../pages/student-context.js";

export async function submitFeedback(event) {
	event.preventDefault();
	const message = dom.feedbackMessage.value.trim();
	if (!message) {
		dom.studentFeedbackStatus.textContent = "Please write your message before submitting.";
		dom.studentFeedbackStatus.className = "text-sm font-bold text-red-600";
		return;
	}
	dom.submitStudentFeedback.disabled = true;
	dom.submitStudentFeedback.textContent = "Submitting...";
	dom.studentFeedbackStatus.textContent = "";
	const feedbackRecord = {
		feedback_type: dom.feedbackType.value.trim(),
		student_name: dom.feedbackStudentName.value.trim() || null,
		student_id: dom.feedbackStudentId.value.trim() || null,
		contact_info: dom.feedbackContact.value.trim() || null,
		message,
		status: "New"
	};
	const { error } = await supabase
		.from(STUDENT_FEEDBACK_TABLE)
		.insert([feedbackRecord]);
	dom.submitStudentFeedback.disabled = false;
	dom.submitStudentFeedback.textContent = "Submit Feedback";
	if (error) {
		console.error("Student feedback error:", error.message || error);
		dom.studentFeedbackStatus.textContent = "Feedback was not sent. Please try again later.";
		dom.studentFeedbackStatus.className = "text-sm font-bold text-red-600";
		return;
	}
	dom.studentFeedbackForm.reset();
	dom.feedbackType.value = "Recommendation";
	dom.studentFeedbackStatus.textContent = "Thank you. Your feedback was sent to the admin.";
	dom.studentFeedbackStatus.className = "text-sm font-bold text-emerald-700";
}