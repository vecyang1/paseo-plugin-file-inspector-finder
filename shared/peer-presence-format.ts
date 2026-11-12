/**
 * Peer presence (T-098): the text the settings screen prints for a shared file's sessions and
 * for the recording check. Pure, so the format is tested without the app.
 *
 * A value the CLI did not state prints as `?`. It never prints as 0.
 */
import type { PeerPresenceSummary, PeerPresenceVerify, PeerSharedFileSession } from "./contracts";

/** Paseo agent id cut to 7 characters, or 8 of the session id for a session outside Paseo. */
export function peerSessionShortId(session: Pick<PeerSharedFileSession, "agent" | "session">): string {
  if (session.agent) return session.agent.slice(0, 7);
  return session.session ? session.session.slice(0, 8) : "?";
}

/** Same steps as the CLI's own listing: seconds under 90, minutes under 90 min, then hours. */
export function formatPeerAge(nowSec: number, lastSec: number | null, isZh: boolean): string {
  if (lastSec === null || !Number.isFinite(lastSec) || !Number.isFinite(nowSec)) return "?";
  const secs = Math.max(0, Math.floor(nowSec - lastSec));
  if (secs < 90) return isZh ? `${secs} 秒前` : `${secs}s ago`;
  if (secs < 5400) {
    const minutes = Math.floor(secs / 60);
    return isZh ? `${minutes} 分钟前` : `${minutes} min ago`;
  }
  const hours = Math.floor(secs / 3600);
  return isZh ? `${hours} 小时前` : `${hours} h ago`;
}

/** `id · model · status · age · ×count`. The provider stands in when no model is stated. */
export function formatPeerSessionRow(
  session: PeerSharedFileSession,
  nowSec: number,
  isZh: boolean,
): string {
  const model = session.model || session.provider || session.harness || "?";
  const count = session.count === null ? "?" : String(session.count);
  return [
    peerSessionShortId(session),
    model,
    session.status || "unknown",
    formatPeerAge(nowSec, session.last, isZh),
    `×${count}`,
  ].join(" · ");
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** "32 edits by 8 sessions on 20 files", or "" when any of the three counts was not read. */
export function formatPresenceSummary(
  presence: PeerPresenceSummary | null | undefined,
  isZh: boolean,
): string {
  if (!presence) return "";
  const { edits, sessions, files } = presence;
  if (edits === null || sessions === null || files === null) return "";
  return isZh
    ? `${sessions} 个会话在 ${files} 个文件上有 ${edits} 次编辑`
    : `${plural(edits, "edit", "edits")} by ${plural(sessions, "session", "sessions")} on ${plural(files, "file", "files")}`;
}

/** `ok`, `gap: <session ids>` or `unknown`, followed by the CLI's reason when it gave one. */
export function formatPresenceVerdict(
  verify: PeerPresenceVerify | null | undefined,
  isZh: boolean,
): string {
  if (!verify) return isZh ? "未知" : "unknown";
  let verdict: string;
  if (verify.ok === true) {
    verdict = isZh ? "正常" : "ok";
  } else if (verify.ok === false) {
    const word = isZh ? "缺口" : "gap";
    verdict = verify.gapSessions.length > 0 ? `${word}: ${verify.gapSessions.join(", ")}` : word;
  } else {
    verdict = isZh ? "未知" : "unknown";
  }
  return verify.reason ? `${verdict} (${verify.reason})` : verdict;
}
