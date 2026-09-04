import type { AppConfig } from "../config.ts";
import { RoutingNotifier, SmtpNotifier, TelegramNotifier, type Notifier } from "./notifier.ts";

/** Wire whatever channels the environment configures; the rest log a warning when used. */
export function buildNotifier(config: AppConfig): Notifier {
  const host = (() => {
    try {
      return new URL(config.APP_URL).hostname;
    } catch {
      return "sifarish.local";
    }
  })();
  return new RoutingNotifier({
    ...(config.SMTP_URL
      ? { email: new SmtpNotifier(config.SMTP_URL, config.NOTIFY_FROM ?? `Sifarish <no-reply@${host}>`) }
      : {}),
    ...(config.TELEGRAM_BOT_TOKEN ? { telegram: new TelegramNotifier(config.TELEGRAM_BOT_TOKEN) } : {}),
  });
}
