import { type Result, ok, err } from "../result.ts";
import { logger } from "../logger.ts";

/**
 * GmailClient seam (SPEC §2): three verbs, adapters behind them.
 * Real adapter = Gmail REST API with an OAuth token bundle (refreshing when
 * expired). Fake adapter = tests and CI. Message loss is forbidden — callers
 * persist the message BEFORE calling, and record failure states after.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string; // plain text
  /** Threading (campaign follow-ups): Gmail thread + RFC ids of the message being replied to. */
  thread?: { threadId: string; inReplyTo: string };
  /** Our own RFC 5322 Message-ID for this message (so later replies can reference it). */
  messageId?: string;
}

export interface ThreadMessageMeta {
  id: string;
  from: string;
  subject: string;
  date: Date | null;
  /** true when Gmail labelled it as ours (SENT) */
  sent: boolean;
}

export type GmailError =
  | { kind: "auth"; detail: string }
  | { kind: "api"; status: number; detail: string }
  | { kind: "network"; detail: string };

export interface GmailClient {
  /** Create a draft in the user's mailbox; returns the draft id. */
  createDraft(email: OutboundEmail): Promise<Result<{ draftId: string }, GmailError>>;
  /** Send directly; returns the message/thread ids. */
  send(email: OutboundEmail): Promise<Result<{ messageId: string; threadId: string }, GmailError>>;
  /** Headers-only view of a thread (needs gmail.metadata scope); used for reply/bounce detection. */
  getThread(threadId: string): Promise<Result<{ messages: ThreadMessageMeta[] }, GmailError>>;
}

export interface TokenBundle {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number; // epoch ms
}

/** Header values must never contain CR/LF — injection would smuggle extra
 *  recipients (Bcc) past dedup, caps, and suppression. */
const headerSafe = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function toRfc822(email: OutboundEmail, from?: string): string {
  const headers = [
    from ? `From: ${headerSafe(from)}` : null,
    `To: ${headerSafe(email.to)}`,
    `Subject: ${headerSafe(email.subject)}`,
    email.messageId ? `Message-ID: ${headerSafe(email.messageId)}` : null,
    email.thread ? `In-Reply-To: ${headerSafe(email.thread.inReplyTo)}` : null,
    email.thread ? `References: ${headerSafe(email.thread.inReplyTo)}` : null,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ]
    .filter(Boolean)
    .join("\r\n");
  return `${headers}\r\n\r\n${email.body}`;
}

const b64url = (s: string) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export class RealGmailClient implements GmailClient {
  constructor(
    private deps: {
      tokens: TokenBundle;
      clientId: string;
      clientSecret: string;
      /** Persist refreshed tokens (encrypted) back to storage. */
      onTokensRefreshed?: (tokens: TokenBundle) => Promise<void>;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private get fetchImpl() {
    return this.deps.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<Result<string, GmailError>> {
    const t = this.deps.tokens;
    const stillValid = t.expiry_date === undefined || t.expiry_date - Date.now() > 60_000;
    if (t.access_token && stillValid) return ok(t.access_token);
    if (!t.refresh_token) return err({ kind: "auth", detail: "token expired, no refresh token" });
    try {
      const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.deps.clientId,
          client_secret: this.deps.clientSecret,
          refresh_token: t.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      if (!res.ok) return err({ kind: "auth", detail: `refresh failed: ${res.status}` });
      const data = (await res.json()) as { access_token: string; expires_in: number };
      this.deps.tokens = {
        ...t,
        access_token: data.access_token,
        expiry_date: Date.now() + data.expires_in * 1000,
      };
      await this.deps.onTokensRefreshed?.(this.deps.tokens);
      return ok(data.access_token);
    } catch (e) {
      return err({ kind: "network", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  private async call<T>(path: string, payload: unknown, method = "POST"): Promise<Result<T, GmailError>> {
    const token = await this.accessToken();
    if (!token.ok) return token;
    try {
      const res = await this.fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        method,
        headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
      });
      if (!res.ok) {
        const detail = await res.text();
        logger.warn({ path, status: res.status }, "gmail api error");
        return err({ kind: "api", status: res.status, detail: detail.slice(0, 500) });
      }
      return ok((await res.json()) as T);
    } catch (e) {
      return err({ kind: "network", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  async createDraft(email: OutboundEmail) {
    const r = await this.call<{ id: string }>("drafts", {
      message: { raw: b64url(toRfc822(email)) },
    });
    return r.ok ? ok({ draftId: r.value.id }) : r;
  }

  async send(email: OutboundEmail) {
    const r = await this.call<{ id: string; threadId: string }>("messages/send", {
      raw: b64url(toRfc822(email)),
      ...(email.thread ? { threadId: email.thread.threadId } : {}),
    });
    return r.ok ? ok({ messageId: r.value.id, threadId: r.value.threadId }) : r;
  }

  async getThread(threadId: string) {
    type Raw = {
      messages?: Array<{
        id: string;
        labelIds?: string[];
        internalDate?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      }>;
    };
    const r = await this.call<Raw>(
      `threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      undefined,
      "GET",
    );
    if (!r.ok) return r;
    const messages: ThreadMessageMeta[] = (r.value.messages ?? []).map((m) => {
      const h = (name: string) =>
        m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      return {
        id: m.id,
        from: h("From"),
        subject: h("Subject"),
        date: m.internalDate ? new Date(Number(m.internalDate)) : null,
        sent: (m.labelIds ?? []).includes("SENT"),
      };
    });
    return ok({ messages });
  }
}

/** Test/dev adapter — records calls, never touches the network. */
export class FakeGmailClient implements GmailClient {
  drafts: OutboundEmail[] = [];
  sent: OutboundEmail[] = [];
  failNext: GmailError | null = null;
  /** threadId → messages the fake "mailbox" holds; tests push replies here. */
  threads = new Map<string, ThreadMessageMeta[]>();

  async getThread(threadId: string) {
    return ok({ messages: this.threads.get(threadId) ?? [] });
  }

  async createDraft(email: OutboundEmail) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      return err(e);
    }
    this.drafts.push(email);
    return ok({ draftId: `fake-draft-${this.drafts.length}` });
  }

  async send(email: OutboundEmail) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      return err(e);
    }
    this.sent.push(email);
    const messageId = `fake-msg-${this.sent.length}`;
    const threadId = email.thread?.threadId ?? `fake-thread-${this.sent.length}`;
    const list = this.threads.get(threadId) ?? [];
    list.push({ id: messageId, from: "me@fake.local", subject: email.subject, date: new Date(), sent: true });
    this.threads.set(threadId, list);
    return ok({ messageId, threadId });
  }
}
