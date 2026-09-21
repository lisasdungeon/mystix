/**
 * MystiX — end-of-session Mystic Point report.
 *
 * Reuses the activity log's summary engine to post a styled chat card: the
 * latest play session (30-minute activity gap), each character's net Mystic
 * Point change, spent vs. gained, and start → end pool. GM-only, also
 * available as a macro API.
 */

import { loc } from "./core.js";
import { csvDate, csvTime, groupLogBySession, summarizeSession } from "./log-viewer.js";
import { getLog } from "./activity-log.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Post the end-of-session report card. GM only; announces in chat.
 * @param {{ announce?: boolean, sessionIndex?: number }} [options]
 *   `sessionIndex` picks a session: 0 (default) is the most recent, 1 the
 *   one before it, and so on.
 * @returns {Promise<boolean>} true if a card was posted
 */
export async function postSessionReport({ announce = true, sessionIndex = 0 } = {}) {
    if (!game.user.isGM) {
        ui.notifications.warn(loc("MYSTIX.Errors.GMOnly"));
        return false;
    }
    const sessions = groupLogBySession(getLog());
    const session = sessions.at(-1 - index(sessionIndex));
    if (!session || session.entries.length === 0) {
        ui.notifications.warn(loc("MYSTIX.Report.EmptyLog"));
        return false;
    }
    if (announce) await postCard(session);
    return true;
}

/** Clamp a (possibly weird) session index into range. */
function index(sessionIndex) {
    const raw = Math.trunc(Number(sessionIndex));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Build and post the chat card for one session. */
async function postCard(session) {
    const when = `${csvDate(session.start)} ${csvTime(session.start)} – ${csvTime(session.end)}`;
    const stats = summarizeSession(session.entries)
        .sort((a, b) => a.actorName.localeCompare(b.actorName))
        .map((stat) => {
            const netClass = stat.net < 0 ? "down" : stat.net > 0 ? "up" : "flat";
            const net = stat.net > 0 ? `+${stat.net}` : `${stat.net}`;
            return `
                <tr>
                    <td class="mystix-report-actor"><strong>${escapeHtml(stat.actorName)}</strong></td>
                    <td class="mystix-report-net ${netClass}">${net}</td>
                    <td class="mystix-report-detail">${escapeHtml(
                        loc("MYSTIX.LogViewer.SummaryRow", { spent: stat.spent, gained: stat.gained }),
                    )}</td>
                    <td class="mystix-report-pool">${stat.start ?? "?"} → ${stat.end ?? "?"}</td>
                </tr>
            `;
        })
        .join("");

    await ChatMessage.create({
        author: game.user.id,
        speaker: { alias: "MystiX" },
        content: `
            <div class="mystix-report-card">
                <div class="mystix-report-header">
                    <i class="fa-solid fa-circle-m"></i>
                    <div>
                        <div class="mystix-report-title">${escapeHtml(loc("MYSTIX.Report.Title"))}</div>
                        <div class="mystix-report-when">${escapeHtml(when)} · ${escapeHtml(
                            loc("MYSTIX.LogViewer.SummaryActions", { count: session.entries.length }),
                        )}</div>
                    </div>
                </div>
                <table class="mystix-report-table">
                    <thead>
                        <tr>
                            <th>${escapeHtml(loc("MYSTIX.LogViewer.FilterActor"))}</th>
                            <th>${escapeHtml(loc("MYSTIX.Report.NetHeader"))}</th>
                            <th>${escapeHtml(loc("MYSTIX.Report.DetailHeader"))}</th>
                            <th>${escapeHtml(loc("MYSTIX.Report.PoolHeader"))}</th>
                        </tr>
                    </thead>
                    <tbody>${stats}</tbody>
                </table>
            </div>
        `,
    });
}

/** Escape text for safe inclusion in HTML content. */
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Convenience: confirm, post the report, then refresh everyone for the next
 * session in one step.
 * @param {{ skipConfirm?: boolean }} [options]
 */
export async function closeSession({ skipConfirm = false } = {}) {
    if (skipConfirm) {
        await postSessionReport();
        return;
    }
    const confirmed = await DialogV2.confirm({
        window: { title: loc("MYSTIX.Report.CloseTitle") },
        content: `<p>${loc("MYSTIX.Report.CloseBody")}</p>`,
        modal: true,
    });
    if (confirmed) await postSessionReport();
}
