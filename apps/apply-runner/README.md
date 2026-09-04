# Sifarish apply runner

Runs on **your** computer, in a visible browser, with your identity. It pulls
the queue Sifarish built from your rules (Apply page), opens each hosted
application form, fills it from your profile, default resume and answer
bank, and either waits for your click (confirm mode) or submits (hands-off).

Hard stops, always: CAPTCHA, login wall, a required question it has no
answer for, an unsupported form. Those come back to the Apply page as
"Needs you" with the exact question, so answering once teaches it.

Supported hosted forms: Greenhouse, Lever, Ashby. LinkedIn Easy Apply and
Naukri are deliberately not supported (their terms forbid automation).

## Setup (once)

```
pnpm install
pnpm apply:setup            # downloads Chromium for Playwright
cp apps/apply-runner/.env.example apps/apply-runner/.env
```

Create a device token on the Apply page and put it in `apps/apply-runner/.env`
together with your Sifarish URL.

## Run

```
pnpm apply
```

Schedule it with Task Scheduler (Windows), launchd (macOS) or cron (Linux)
to run at wake-up if you want the morning routine to be "open the app,
click Submit on what's waiting".
