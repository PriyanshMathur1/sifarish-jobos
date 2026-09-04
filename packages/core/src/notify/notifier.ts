import { logger } from "../logger.ts";

/**
 * Notifier seam (AUTOPILOT-PLAN §2). Callers hand over a message and a
 * destination; adapters hide transport. Every adapter returns a Result-ish
 * outcome rather than throwing, so a dead channel never breaks a crawl.
 */

export interface NotifyMessage {
  subject: string;
  /** plain text body, always present */
  text: string;
  /** optional HTML alternative (email) */
  html?: string;
}

export type NotifyTarget =
  | { channel: "email"; to: string }
  | { channel: "telegram"; chatId: string }
  | { channel: "none" };

export type NotifyOutcome = { ok: true } | { ok: false; error: string };

export interface Notifier {
  send(target: NotifyTarget, message: NotifyMessage): Promise<NotifyOutcome>;
}

/** Dev/no-config adapter: logs, never delivers. */
export class LogNotifier implements Notifier {
  async send(target: NotifyTarget, message: NotifyMessage): Promise<NotifyOutcome> {
    logger.info({ target, subject: message.subject }, "notification (log adapter)");
    return { ok: true };
  }
}

/** Telegram Bot API: one HTTPS call, no library. HTML parse mode, 4096-char cap per message. */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly botToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Chat id of the most recent person who messaged the bot (for one-time setup). */
  async latestChatId(): Promise<{ chatId: string; name: string } | null> {
    try {
      const res = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/getUpdates?limit=20`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        result?: Array<{ message?: { chat?: { id: number; first_name?: string; username?: string } } }>;
      };
      const chats = (data.result ?? []).map((u) => u.message?.chat).filter(Boolean);
      const last = chats.at(-1);
      if (!last) return null;
      return { chatId: String(last.id), name: last.username ?? last.first_name ?? "" };
    } catch {
      return null;
    }
  }

  async send(target: NotifyTarget, message: NotifyMessage): Promise<NotifyOutcome> {
    if (target.channel !== "telegram") return { ok: false, error: "wrong channel" };
    const body = `<b>${escapeHtml(message.subject)}</b>\n\n${message.html ?? escapeHtml(message.text)}`;
    try {
      const res = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: target.chatId,
          text: body.slice(0, 4000),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) return { ok: false, error: `telegram ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** SMTP via nodemailer (same SMTP_URL the magic-link mailer uses). Lazy import keeps core light. */
export class SmtpNotifier implements Notifier {
  constructor(
    private readonly smtpUrl: string,
    private readonly from: string,
  ) {}

  async send(target: NotifyTarget, message: NotifyMessage): Promise<NotifyOutcome> {
    if (target.channel !== "email") return { ok: false, error: "wrong channel" };
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport(this.smtpUrl);
      await transport.sendMail({
        from: this.from,
        to: target.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Routes by channel to whichever adapters are configured; unconfigured channels log. */
export class RoutingNotifier implements Notifier {
  constructor(private readonly adapters: { email?: Notifier; telegram?: Notifier }) {}

  async send(target: NotifyTarget, message: NotifyMessage): Promise<NotifyOutcome> {
    if (target.channel === "none") return { ok: true };
    const adapter = this.adapters[target.channel];
    if (!adapter) {
      logger.warn({ channel: target.channel, subject: message.subject }, "notifier channel not configured");
      return { ok: false, error: `${target.channel} not configured` };
    }
    return adapter.send(target, message);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
