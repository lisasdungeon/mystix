/**
 * MystiX — GM-facing Mystic Point activity log viewer.
 *
 * A resizable dialog listing every recorded activity with filters by actor,
 * action type, and user, so long sessions stay auditable. Pure filter logic
 * lives in exported helpers so tests can exercise it without a dialog.
 */

import { describeAction, describeDetail, formatDateTime, getLog } from "./activity-log.js";
import { loc } from "./core.js";

const { DialogV2 } = foundry.applications.api;
const SLUG = "mystix";

/** Whether the current user may open the log viewer. */
export function canViewLog() {
    return game.user.isGM;
}

/** Every distinct, alphabetized actor name present in the log. */
export function listLogActors(log = getLog()) {
    return sortedValues(log, (entry) => entry.actorName);
}

/** Every distinct action code present in the log, alphabetized. */
export function listLogActions(log = getLog()) {
    return sortedValues(log, (entry) => entry.action);
}

/** Every distinct user name present in the log, alphabetized. */
export function listLogUsers(log = getLog()) {
    return sortedValues(log, (entry) => entry.userName);
}

/** Alphabetized unique values of a log entry field. */
function sortedValues(log, selector) {
    return [...new Set(log.map(selector).filter((value) => value != null && value !== ""))].sort((a, b) =>
        String(a).localeCompare(String(b)),
    );
}

/**
 * Filter the log. Blank/null criteria match everything. The result is
 * newest first (the log's native order) and capped to `limit` rows.
 * @param {object[]} log Newest-first log entries.
 * @param {{ actorName?: string|null, action?: string|null,
 *           userName?: string|null, limit?: number }} criteria
 * @returns {object[]} Filtered entries, newest first.
 */
export function filterLog(log, { actorName = null, action = null, userName = null, limit = 200 } = {}) {
    // Positive integer limits cap the rows; anything else uses the default.
    const requested = Math.trunc(Number(limit));
    const maxRows = Number.isFinite(requested) && requested > 0 ? requested : 200;
    return log
        .filter((entry) => {
            if (actorName && entry.actorName !== actorName) return false;
            if (action && entry.action !== action) return false;
            if (userName && entry.userName !== userName) return false;
            return true;
        })
        .slice(0, maxRows);
}

/**
 * Render log entries as CSV with a header row. Columns mirror the viewer:
 * Timestamp (ISO), Date, Time, Character, Action, Amount, From, To, Detail,
 * User. Quoting follows RFC 4180: fields are quoted only when needed.
 * @param {object[]} entries Newest-first log entries (order is preserved).
 * @returns {string}
 */
export function logToCsv(entries) {
    const headers = [
        "Timestamp", "Date", "Time", "Character", "Action", "Amount", "From", "To", "Detail", "User",
    ];
    const rows = entries.map((entry) => [
        isoTimestamp(entry.at),
        csvDate(entry.at),
        csvTime(entry.at),
        entry.actorName ?? "",
        describeAction(entry.action, entry.amount),
        entry.amount ?? "",
        entry.from ?? "",
        entry.to ?? "",
        describeDetail(entry.detail),
        entry.userName ?? "",
    ]);
    return [headers, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}

/** ISO-8601 timestamp for a log entry, blank when missing/invalid. */
function isoTimestamp(timestamp) {
    const date = new Date(Number(timestamp));
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

/** Locale YYYY-MM-DD for a log entry, blank when missing/invalid. */
function csvDate(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return "";
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${mm}-${dd}`;
}

/** Locale HH:MM for a log entry, blank when missing/invalid. */
function csvTime(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return "";
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

/** Quote a CSV field only when it contains a comma, quote, or newline. */
function csvField(value) {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/** The suggested filename for a CSV export, stamped with today's date. */
export function csvFilename() {
    return `mystix-log-${csvDate(Date.now())}.csv`;
}

/**
 * Download the given CSV text as a file via a temporary object URL.
 * @param {string} csv
 * @param {string} filename
 */
export function downloadCsv(csv, filename = csvFilename()) {
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/**
 * Copy text to the clipboard, preferring the async API with a
 * textarea fallback for non-secure contexts.
 * @param {string} text
 * @returns {Promise<boolean>} whether the copy likely succeeded
 */
export async function copyToClipboard(text) {
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (error) {
        console.warn("MystiX | clipboard API failed, using fallback:", error);
    }
    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        return copied;
    } catch (error) {
        console.warn("MystiX | clipboard fallback failed:", error);
        return false;
    }
}

/** Render one log entry as a viewer row: time, actor, action, detail, user. */
export function renderLogRow(entry) {
    return `
        <li class="mystix-log-row">
            <span class="mystix-log-when">${escapeHtml(formatDateTime(entry.at))}</span>
            <span class="mystix-log-actor"><strong>${escapeHtml(entry.actorName ?? "—")}</strong></span>
            <span class="mystix-log-action">${escapeHtml(describeAction(entry.action, entry.amount))}</span>
            <span class="mystix-log-detail">${escapeHtml(describeDetail(entry.detail))}</span>
            <span class="mystix-log-user">${escapeHtml(describeUserFragment(entry.userName))}</span>
        </li>
    `;
}

/** Localized "who did it" fragment; tolerates missing user names. */
function describeUserFragment(userName) {
    return userName ? loc("MYSTIX.Log.ByUser", { user: userName }) : "—";
}

/** Escape text for safe inclusion in HTML content. */
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** `<option>` list from values; `selected` gets the `selected` attribute. */
function optionList(values, selected) {
    return values
        .map(
            (value) =>
                `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(
                    describeOption(value),
                )}</option>`,
        )
        .join("");
}

/** Human-readable label for a filter option (actions get localized names). */
function describeOption(value) {
    return describeAction(value);
}

/**
 * Open the log viewer. GM only; re-renders live when the log changes.
 * @returns {Promise<void>}
 */
export async function openLogViewer() {
    if (!canViewLog()) {
        ui.notifications.warn(loc("MYSTIX.Errors.GMOnly"));
        return;
    }

    // Filter state persists across re-renders while the dialog stays open.
    let selectedActor = "";
    let selectedAction = "";
    let selectedUser = "";

    const dialog = new DialogV2({
        window: { title: loc("MYSTIX.LogViewer.Title"), resizable: true },
        content: `<div class="mystix-log-viewer" data-viewer></div>`,
        modal: false,
    });
    const onChanged = () => {
        if (dialog.rendered) dialog.render(false);
    };
    Hooks.on("mystixLogChanged", onChanged);
    dialog.addEventListener("close", () => {
        Hooks.off("mystixLogChanged", onChanged);
    });

    await dialog.render({ force: true });

    const paint = () => {
        const log = getLog();
        const root = dialog.element.querySelector("[data-viewer]");
        if (!root) return;
        root.innerHTML = buildContent(log, { selectedActor, selectedAction, selectedUser });

        // Keep an option selected even when the filter list no longer
        // contains it (e.g. the entry scrolled past the 200-entry cap).
        if (selectedActor && !listLogActors(log).includes(selectedActor)) {
            root.querySelector('[name="actorName"]')?.insertAdjacentHTML(
                "beforeend",
                optionList([selectedActor], selectedActor),
            );
        }
        if (selectedAction && !listLogActions(log).includes(selectedAction)) {
            root.querySelector('[name="action"]')?.insertAdjacentHTML(
                "beforeend",
                optionList([selectedAction], selectedAction),
            );
        }
        if (selectedUser && !listLogUsers(log).includes(selectedUser)) {
            root.querySelector('[name="userName"]')?.insertAdjacentHTML(
                "beforeend",
                optionList([selectedUser], selectedUser),
            );
        }

        for (const name of ["actorName", "action", "userName"]) {
            root.querySelector(`[name="${name}"]`)?.addEventListener("change", (event) => {
                const value = event.target.value;
                if (name === "actorName") selectedActor = value;
                else if (name === "action") selectedAction = value;
                else selectedUser = value;
                paint();
            });
        }

        // Export buttons: copy the filtered rows to the clipboard or download
        // them as CSV for post-session review.
        for (const button of root.querySelectorAll("[data-export]")) {
            button.addEventListener("click", () => void exportEntries(button.dataset.export));
        }
    };

    const exportEntries = async (mode) => {
        const entries = filterLog(getLog(), {
            actorName: selectedActor || null,
            action: selectedAction || null,
            userName: selectedUser || null,
        });
        if (!entries.length) {
            ui.notifications.warn(loc("MYSTIX.LogViewer.NothingToExport"));
            return;
        }
        if (mode === "copy") {
            const copied = await copyToClipboard(logToCsv(entries));
            if (copied) ui.notifications.info(loc("MYSTIX.LogViewer.CopiedCount", { count: entries.length }));
            else ui.notifications.error(loc("MYSTIX.LogViewer.CopyFailed"));
            return;
        }
        downloadCsv(logToCsv(entries));
        ui.notifications.info(loc("MYSTIX.LogViewer.DownloadedCount", { count: entries.length }));
    };

    paint();
}

/** Build the viewer's filter bar + entry list markup from the current log. */
function buildContent(log, { selectedActor, selectedAction, selectedUser }) {
    const entries = filterLog(log, {
        actorName: selectedActor || null,
        action: selectedAction || null,
        userName: selectedUser || null,
    });
    const rows = entries.map(renderLogRow).join("");

    return `
        <div class="mystix-log-filters">
            <label>
                <span>${loc("MYSTIX.LogViewer.FilterActor")}</span>
                <select name="actorName">
                    <option value="">${loc("MYSTIX.LogViewer.AllActors")}</option>
                    ${optionList(listLogActors(log), selectedActor)}
                </select>
            </label>
            <label>
                <span>${loc("MYSTIX.LogViewer.FilterAction")}</span>
                <select name="action">
                    <option value="">${loc("MYSTIX.LogViewer.AllActions")}</option>
                    ${optionList(listLogActions(log), selectedAction)}
                </select>
            </label>
            <label>
                <span>${loc("MYSTIX.LogViewer.FilterUser")}</span>
                <select name="userName">
                    <option value="">${loc("MYSTIX.LogViewer.AllUsers")}</option>
                    ${optionList(listLogUsers(log), selectedUser)}
                </select>
            </label>
            <span class="mystix-log-count">${loc("MYSTIX.LogViewer.ShowingCount", { count: entries.length })}</span>
            <span class="mystix-log-export">
                <button type="button" class="mystix-log-export-btn" data-export="copy"
                    data-tooltip="${escapeHtml(loc("MYSTIX.LogViewer.CopyTooltip"))}">
                    <i class="fa-solid fa-copy"></i> ${escapeHtml(loc("MYSTIX.LogViewer.CopyLabel"))}
                </button>
                <button type="button" class="mystix-log-export-btn" data-export="csv"
                    data-tooltip="${escapeHtml(loc("MYSTIX.LogViewer.CsvTooltip"))}">
                    <i class="fa-solid fa-file-csv"></i> ${escapeHtml(loc("MYSTIX.LogViewer.CsvLabel"))}
                </button>
            </span>
        </div>
        ${
            entries.length
                ? `<ul class="mystix-log-rows">${rows}</ul>`
                : `<p class="mystix-log-none">${loc("MYSTIX.LogViewer.NoMatches")}</p>`
        }
    `;
}
