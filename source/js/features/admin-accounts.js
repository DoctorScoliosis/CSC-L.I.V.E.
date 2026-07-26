/*
 * Account Approvals tab for the Admin dashboard.
 *
 * Reviews every registered admin and committee account from user_profiles.
 * Accounts can be accepted, held, suspended, or deleted, and each account's
 * sport assignment can be edited via a modal. Approval status changes and
 * sport assignment go through the admin_set_account_approval_status and
 * admin_assign_account_sport RPCs; account deletion tries the
 * delete_user_account RPC and falls back to a plain profile delete.
 */

import {
	state,
	dom,
	supabase,
	ACCOUNT_PROFILES_TABLE,
	OVERALL_COMMITTEE_SPORT_ID,
	OVERALL_COMMITTEE_SPORT_NAME,
	getStoredAdminUser
} from "../pages/admin-context.js";
import {
	normalizeAccountStatus,
	getAccountStatusClass,
	getAccountStatusLabel,
	getAccountRoleLabel,
	getAccountMobileNumber,
	getAccountAssignedSportLabel,
	getAssignedSportOptions,
	getAssignedSportId,
	getAssignedSportName,
	isOverallCommitteeAssignment,
	getAdminSportAssignmentGroups,
	normalizeSportGroupKey,
	getGeneralSportName,
	getCallHref
} from "../pages/admin-helpers.js";
import { escapeHTML } from "../utils/dom.js";
import { formatDateTime } from "../utils/datetime.js";
import { showDashboardToast } from "../ui/toast.js";
import { showDashboardConfirm } from "../ui/confirm.js";

export async function loadAccountApprovals() {
	if (!dom.accountApprovalsTableBody) return;
	if (state.isLoadingAccountApprovals) {
		state.shouldReloadAccountApprovalsAgain = true;
		return;
	}
	state.isLoadingAccountApprovals = true;
	state.shouldReloadAccountApprovalsAgain = false;
	try {
		if (state.accountApprovalsData.length === 0) {
			dom.accountApprovalsTableBody.innerHTML = `
			<tr>
			<td colspan="8" class="py-6 px-4 text-center text-gray-500">Loading account approvals...</td>
			</tr>
			`;
		}
		const { data, error } = await supabase
			.from(ACCOUNT_PROFILES_TABLE)
			.select("*")
			.order("created_at", { ascending: false });
		if (error) {
			console.error("Error loading account approvals:", error.message || error);
			dom.accountApprovalsTableBody.innerHTML = `
			<tr>
			<td colspan="8" class="py-6 px-4 text-center text-red-500 font-semibold">
			Failed to load account approvals. Run the account approval SQL and check your user_profiles policies.
			</td>
			</tr>
			`;
			return;
		}
		state.accountApprovalsData = data || [];
		renderAccountApprovals();
	} finally {
		state.isLoadingAccountApprovals = false;
		if (state.shouldReloadAccountApprovalsAgain) {
			state.shouldReloadAccountApprovalsAgain = false;
			await loadAccountApprovals();
		}
	}
}

export function renderAccountApprovals() {
	if (!dom.accountApprovalsTableBody) return;
	if (state.accountApprovalsData.length === 0) {
		dom.accountApprovalsTableBody.innerHTML = `
		<tr>
		<td colspan="8" class="py-6 px-4 text-center text-gray-500">No registered accounts found.</td>
		</tr>
		`;
		return;
	}
	dom.accountApprovalsTableBody.innerHTML = "";
	state.accountApprovalsData.forEach(account => {
		const status = normalizeAccountStatus(account.approval_status);
		const isAccepted = status === "approved";
		const isHeld = status === "hold";
		const isSuspended = status === "suspended";
		const adminUser = getStoredAdminUser();
		const isCurrentAdmin = adminUser?.id && String(adminUser.id) === String(account.id);
		const mobileNumber = getAccountMobileNumber(account);
		const callHref = getCallHref(mobileNumber);
		const row = document.createElement("tr");
		row.className = "border-b border-gray-100 align-top hover:bg-gray-50";
		row.innerHTML = `
		<td class="py-3 px-4">
		<p class="font-semibold text-gray-900">${escapeHTML(account.full_name || "Unnamed account")}</p>
		<p class="text-xs text-gray-500">${escapeHTML(account.email || "No email")}</p>
		</td>
		<td class="py-3 px-4">
		<p class="text-sm font-semibold text-gray-800">${escapeHTML(mobileNumber || "No mobile number")}</p>
		</td>
		<td class="py-3 px-4">
		<span class="inline-flex rounded-full px-3 py-1 text-xs font-bold bg-blue-100 text-blue-700">
		${escapeHTML(getAccountRoleLabel(account.role))}
		</span>
		</td>
		<td class="py-3 px-4">
		<div class="min-w-[150px] space-y-2">
		<p class="text-sm font-semibold text-gray-800">${escapeHTML(getAccountAssignedSportLabel(account))}</p>
		<button type="button" data-account-id="${escapeHTML(account.id)}" class="edit-account-sport rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">
		Edit
		</button>
		</div>
		</td>
		<td class="py-3 px-4">
		<span class="inline-flex rounded-full px-3 py-1 text-xs font-bold ${getAccountStatusClass(status)}">
		${escapeHTML(getAccountStatusLabel(status))}
		</span>
		</td>
		<td class="py-3 px-4 text-sm text-gray-600">${formatDateTime(account.created_at)}</td>
		<td class="py-3 px-4 text-sm text-gray-600">${formatDateTime(account.reviewed_at)}</td>
		<td class="py-3 px-4">
		<div class="flex flex-col sm:flex-row gap-2">
		<button type="button" data-account-id="${escapeHTML(account.id)}" data-account-action="approved" class="account-approval-btn px-3 py-2 rounded-lg text-sm font-semibold ${!isAccepted && !isCurrentAdmin ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}" ${!isAccepted && !isCurrentAdmin ? "" : "disabled"}>
		Accept
		</button>
		<button type="button" data-account-id="${escapeHTML(account.id)}" data-account-action="hold" class="account-approval-btn px-3 py-2 rounded-lg text-sm font-semibold ${!isHeld && !isCurrentAdmin ? "bg-amber-500 hover:bg-amber-600 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}" ${!isHeld && !isCurrentAdmin ? "" : "disabled"}>
		Hold
		</button>
		<button type="button" data-account-id="${escapeHTML(account.id)}" data-account-action="suspended" class="account-approval-btn px-3 py-2 rounded-lg text-sm font-semibold ${!isSuspended && !isCurrentAdmin ? "bg-orange-600 hover:bg-orange-700 text-white" : "bg-gray-200 text-gray-500 cursor-not-allowed"}" ${!isSuspended && !isCurrentAdmin ? "" : "disabled"}>
		Suspend
		</button>
		<button type="button" data-account-id="${escapeHTML(account.id)}" data-account-email="${escapeHTML(account.email || "")}" class="delete-account-btn px-3 py-2 rounded-lg text-sm font-semibold ${!isCurrentAdmin ? "bg-red-50 hover:bg-red-100 text-red-700 border border-red-200" : "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed"}" ${!isCurrentAdmin ? "" : "disabled"}>
		Delete
		</button>
		${callHref ? `
		<a href="${escapeHTML(callHref)}" class="inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-semibold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200">
		Call
		</a>
		` : `
		<span class="inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-400 border border-gray-200">
		No Number
		</span>
		`}
		</div>
		</td>
		`;
		dom.accountApprovalsTableBody.appendChild(row);
	});
	document.querySelectorAll(".account-approval-btn").forEach(button => {
		button.addEventListener("click", () => updateAccountApprovalStatus(button.dataset.accountId, button.dataset.accountAction));
	});
	document.querySelectorAll(".edit-account-sport").forEach(button => {
		button.addEventListener("click", () => openAccountSportEditModal(button.dataset.accountId));
	});
	document.querySelectorAll(".delete-account-btn").forEach(button => {
		button.addEventListener("click", () => deleteAccount(button.dataset.accountId, button.dataset.accountEmail));
	});
}

export function openAccountSportEditModal(accountId) {
	const account = state.accountApprovalsData.find(item => String(item.id) === String(accountId));
	if (!account) return;
	state.editingAccountSportId = accountId;
	dom.accountSportEditAccountName.textContent = account.full_name || account.email || "Account";
	dom.accountSportEditSelect.innerHTML = getAssignedSportOptions(account);
	if (isOverallCommitteeAssignment(account)) {
		dom.accountSportEditSelect.value = OVERALL_COMMITTEE_SPORT_ID;
	} else {
		const assignedGroupKey = normalizeSportGroupKey(getGeneralSportName(getAssignedSportName(account)));
		const matchingGroup = getAdminSportAssignmentGroups().find(group => normalizeSportGroupKey(group.sport_name) === assignedGroupKey);
		dom.accountSportEditSelect.value = matchingGroup?.id || getAssignedSportId(account);
	}
	dom.accountSportEditModal.classList.remove("hidden");
	dom.accountSportEditModal.classList.add("flex");
}

export function closeAccountSportEditModalFunction() {
	state.editingAccountSportId = "";
	dom.accountSportEditModal.classList.add("hidden");
	dom.accountSportEditModal.classList.remove("flex");
}

export async function updateAccountAssignedGame(accountId, sportId) {
	const selectedSport = state.sportsData.find(sport => String(sport.id) === String(sportId));
	const isOverallCommittee = String(sportId) === OVERALL_COMMITTEE_SPORT_ID;
	const selectedGroup = getAdminSportAssignmentGroups().find(group => String(group.id) === String(sportId));
	const isGeneralSportGroup = Boolean(selectedGroup);
	const nextAssignedSportId = isOverallCommittee || isGeneralSportGroup ? null : (selectedSport?.id || null);
	const nextAssignedSportName = isOverallCommittee
		? OVERALL_COMMITTEE_SPORT_NAME
		: isGeneralSportGroup
		? selectedGroup.sport_name
		: (selectedSport?.sport_name || null);
	const { error } = await supabase.rpc("admin_assign_account_sport", {
		target_user_id: accountId,
		assigned_sport_id: nextAssignedSportId,
		assigned_sport_name: nextAssignedSportName
	});
	if (error) {
		console.error("Error updating assigned game:", error.message || error);
		alert("Failed to assign game. Add assigned_sport_id and assigned_sport_name columns to user_profiles and check update policies.");
		await loadAccountApprovals();
		return;
	}
	const account = state.accountApprovalsData.find(item => String(item.id) === String(accountId));
	if (account) {
		account.assigned_sport_id = nextAssignedSportId;
		account.assigned_sport_name = nextAssignedSportName;
	}
	renderAccountApprovals();
	closeAccountSportEditModalFunction();
}

export async function updateAccountApprovalStatus(accountId, nextStatus) {
	const allowedStatuses = new Set(["approved", "hold", "suspended"]);
	const normalizedStatus = allowedStatuses.has(nextStatus) ? nextStatus : "hold";
	const adminUser = getStoredAdminUser();
	if (adminUser?.id && String(adminUser.id) === String(accountId)) {
		alert("You cannot change the approval status of the account currently signed in.");
		return;
	}
	const actionLabels = {
		approved: "accept this account and allow dashboard access",
		hold: "put this account on hold and block dashboard access",
		suspended: "suspend this account and block dashboard access"
	};
	const confirmMessage = `Are you sure you want to ${actionLabels[normalizedStatus]}?`;
	const shouldUpdate = await showDashboardConfirm(confirmMessage, {
		title: "Update Account Status",
		confirmText: "Continue"
	});
	if (!shouldUpdate) {
		return;
	}
	const { error } = await supabase.rpc("admin_set_account_approval_status", {
		target_user_id: accountId,
		next_status: normalizedStatus
	});
	if (error) {
		console.error("Error updating account approval:", error.message || error);
		alert("Failed to update account approval. Check the user_profiles policies.");
		return;
	}
	await loadAccountApprovals();
}

export async function deleteAccount(accountId, accountEmail) {
	const adminUser = getStoredAdminUser();
	if (adminUser?.id && String(adminUser.id) === String(accountId)) {
		alert("You cannot delete the account currently signed in.");
		return;
	}
	const label = accountEmail ? ` (${accountEmail})` : "";
	const confirmDelete = await showDashboardConfirm(`Delete this account${label}? This removes the user profile and, after running the SQL function, the Supabase Auth user too.`, {
		title: "Delete Account",
		confirmText: "Delete Account"
	});
	if (!confirmDelete) {
		return;
	}
	let deleteError = null;
	const rpcResult = await supabase.rpc("delete_user_account", {
		target_user_id: accountId
	});
	if (rpcResult.error) {
		console.warn("delete_user_account RPC failed, falling back to profile delete:", rpcResult.error.message || rpcResult.error);
		const fallbackResult = await supabase
			.from(ACCOUNT_PROFILES_TABLE)
			.delete()
			.eq("id", accountId);
		deleteError = fallbackResult.error;
	}
	if (deleteError) {
		console.error("Error deleting account:", deleteError.message || deleteError);
		alert("Failed to delete account. Run the updated account approval SQL and check the user_profiles policies.");
		return;
	}
	await loadAccountApprovals();
	showDashboardToast("Account deleted.");
}