# Finance Overview

A simple, private money tracker that works in the browser on all your devices, with end-to-end encrypted sync (and as an iOS/Android app). Import a bank statement (CSV), see a monthly overview of money in and out, and browse, categorize and add transactions. Your data is encrypted on your device before it's synced, so only you can read it.

Built with React Native and Expo (SDK 57).

## Features

**Dashboard**
- **Key numbers**: overall total, total in current accounts, total in savings & investments, and your expected balance in 6 months. You type in each account's balance and type (current, or savings & investments) and update it whenever you like. The accounts list is grouped by type with subtotals.
- **Balances that follow your statements**: link an account to your ING current, ING savings (Oranje Spaarrekening), ING investment, Revolut current or Revolut crypto statements. Imported transactions dated after the day you typed in the balance are added to it automatically. Transfers between your own accounts move money from one account to the other, so the overall total stays right. Editing the name or link keeps the balance date; typing a new balance starts over from that day.
- **Expected balance for the next 6 months**, based on your accounts, planned income and expenses, and budgets. Tap a month to see how it adds up; you're warned if it's expected to drop below zero.
- **Coming up**: everything planned in the next 30 days.
- **Plans**: recurring (monthly or yearly) and one-off expenses and income, e.g. rent, salary, a trip.
- **Monthly budgets** per category, with progress for the current month.
- **Debts**: money people owe you, or you owe, kept separate from your total and forecast.

**Monthly**
- Net result, money in vs out, a 6-month chart (tap a month to open it), spending by category with budget progress, and your biggest expenses.

**Transactions and import**
- **CSV import**: Revolut and ING statements (English or Dutch export) are recognised automatically. For any other bank you match the columns once (date, description, amount, and optionally an in/out column like ING's "Af Bij"). Dutch and English number and date formats are supported.
- **No duplicates**: importing the same file twice only adds what's new. Two genuinely identical payments in one file are both kept.
- **Categories that learn**: when you change a category, you can apply it to all transactions with the same description, and future imports remember it.
- **Own-account transfers aren't counted**: moving money between your own accounts isn't income or spending, so these are imported but left out of totals automatically: Revolut top-ups, Revolut Digital Assets, ING savings (Oranje Spaarrekening) transfers and round-ups, ING investment-account transfers, and ING top-ups to Revolut. You can switch this per transaction ("Leave out of totals").
- **Imported statements**: a list of every statement you imported (bank, period, number of transactions, counted money in/out). Delete one to remove all its transactions, e.g. to import it again.
- **Manual entries**.
- **Plans file**: a small JSON file with plans, budgets and debts that you can import in one go (used to move over an old spreadsheet). The format is described at the top of `src/lib/setupFile.ts`. Importing the same file twice skips what's already there.
- **Responsive design**: on a computer you get a left sidebar, KPI cards, side-by-side panels, sortable tables, hover tooltips on charts and editing in a side panel; on a phone a compact layout with a bottom tab bar.
- Blue theme with light and dark mode.

### How the forecast works

Expected balance = your accounts' total today + planned income − planned expenses − what's left of your monthly budgets. For the current month only items from today onward count. It only knows what you enter, so it's an estimate. Budgets are meant for day-to-day spending; don't also budget for things you've added as planned expenses (like rent), or they'll be counted twice.

## Run it (web)

The app runs in any browser, including your phone's. On a Mac:

**1. Install the tools (once).** You need [Node.js](https://nodejs.org) (LTS). If the `pnpm` command isn't found, install it globally:

```bash
npm install -g pnpm
pnpm -v            # should print a version number
```

If that gives a permissions error and you use Homebrew, `brew install pnpm` works too. Or skip installing and put `npx` in front of every `pnpm` command below (e.g. `npx pnpm install`).

**2. Install and start** (in the project folder):

```bash
pnpm install
pnpm expo install --fix   # aligns package versions with the Expo SDK
pnpm web
```

The terminal shows a local address (usually `http://localhost:8081`). Open it in your Mac's browser.

**3. Open it on your phone.** With your phone on the same Wi-Fi as your Mac:

- Find your Mac's local IP address: `ipconfig getifaddr en0` (or System Settings → Wi-Fi → Details).
- On your phone, open `http://<that-ip>:8081`, e.g. `http://192.168.1.23:8081`.
- If macOS asks whether to allow incoming connections for Node, allow it.

This works while `pnpm web` is running on your Mac. To use it anywhere and sync between devices, host it on Cloudflare (below).

### Where your data is stored

- **Hosted web version with sync on:** every device keeps its own copy (so it works offline), and an **encrypted** copy is stored in your Cloudflare account. It's encrypted on your device with your passphrase before it's uploaded, so Cloudflare can't read it. Changes sync automatically between your devices.
- **Web version without sync** (for example `pnpm web` on localhost): only in that browser.
- **iOS/Android app:** in a SQLite database on the device (sync isn't available in the phone app yet).

**Your passphrase can't be recovered.** If you forget it, nobody can decrypt the synced data. Write it down somewhere safe. You can also download an (unencrypted) backup from **Import → Your data → Download backup**.

## Host it on Cloudflare (with sync)

The app runs as one Cloudflare Worker: it serves the website and a small sync API, with a Cloudflare D1 database for the encrypted data and Cloudflare Access (GitHub login) in front of it. For one person's use this should fit in Cloudflare's free plans. Cloudflare's dashboard changes over time, so menu names below may differ slightly.

**1. Create the Worker from this repo**

1. In the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository** and pick `Finance_Overview`.
2. Set:
   - **Build command:** `npx expo export --platform web`
   - **Deploy command:** `npx wrangler deploy` (the default)
3. Deploy. The first deploy also creates the D1 database (`wrangler.jsonc` only names the binding; Wrangler 4.45+ creates it automatically).
4. Note the address under **Settings → Domains & Routes**, e.g. `https://finance-overview.<you>.workers.dev`. Don't start using it yet: first put the login in front of it.

**2. Add GitHub as a login method** ([Cloudflare's guide](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/github/))

1. In Cloudflare **Zero Trust**, find your team name under **Settings** (it looks like `<team>.cloudflareaccess.com`). The first time, Zero Trust asks you to choose a plan: pick **Free**.
2. On GitHub: **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Homepage URL: `https://<team>.cloudflareaccess.com`
   - Authorization callback URL: `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
   - Create it, copy the **Client ID**, and generate a **Client secret**.
3. In Zero Trust: **Integrations → Identity providers → Add new → GitHub**, paste the Client ID (App ID) and secret, save, and use **Test** to check it works.

**3. Put the login in front of the app**

1. Open your Worker in **Workers & Pages**, go to its **Access** settings and choose **Protect this Worker behind Access** for **all traffic** (this also covers the workers.dev address and previews).
2. In the policy, choose the **email** option and enter **the email address of your GitHub account** (GitHub → Settings → Emails, the primary one). Apply. This dialog only sets *who* may log in, not *how*.
3. To log in with GitHub: in **Zero Trust → Access → Applications** (may be called **Access controls → Applications**), open the application that was just created for your Worker and edit it. Under **Login methods** / identity providers, select **GitHub** only. Optionally turn on **instant authentication** so you go straight to GitHub. Save.
   - Without this step you log in with a one-time code sent to your email instead, which is also secure.
4. Extra safety (recommended): in the Worker's **Settings → Variables and Secrets**, add a variable `ALLOWED_EMAILS` with your email address. The sync API then refuses every other account, even if the Access policy were ever changed.

**4. Turn on sync**

1. Open the app's address and log in with GitHub.
2. To bring over what you entered on localhost: there, go to **Import → Download backup**; on the hosted app, go to **Import → Choose file** and pick the backup to restore it.
3. Click **Set up** in the blue bar (or the sync status at the bottom of the sidebar) and choose a passphrase.
4. On your other laptop: open the same address, log in with GitHub, click **Unlock** and enter the same passphrase. Everything appears.
5. On an iPhone: open it in Safari and use **Share → Add to Home Screen**, then open it from there (Safari removes data of websites you haven't visited for 7 days, but not of home-screen apps).

After this, every push to `main` redeploys the app automatically.

### How sync works

- Each device keeps a full copy, so the app works offline. Changes upload a moment after you make them; other devices pick them up when you switch back to the app, come back online, or within a minute.
- Your data is encrypted in the browser with AES-GCM (key made from your passphrase with PBKDF2, 600,000 rounds). The server only stores the encrypted result and a version number.
- If two devices changed things at the same time, both sets of changes are combined. Only when the same item was changed on both does the device that syncs last keep its version, and an edit always beats a delete. The same bank statement imported on two devices is kept once.
- "Remember on this device" stores the key in the browser in a form that can't be read out. Use **Forget passphrase on this device** on a device that isn't yours.

## Run it (phone app)

Install the **Expo Go** app on your phone, run `pnpm start`, and scan the QR code. Expo Go only supports the latest SDK; if it says the project's SDK is incompatible, run `pnpm expo install expo@latest && pnpm expo install --fix`.

### If pnpm causes build errors

Expo's docs say recent SDKs work with pnpm's default (isolated) install. If you hit module resolution errors anyway, switch pnpm to a hoisted layout by adding this to a `pnpm-workspace.yaml` file in the project root, then reinstall:

```yaml
nodeLinker: hoisted
```

## Tests

The CSV parsing, amount/date handling, bank imports, forecast, balances, web storage, encryption, sync and the Worker API are covered by tests that run with Node's built-in test runner (Node 22+):

```bash
pnpm test
```

`test/fixtures/revolut-sample.csv` is an anonymized sample statement.

## How to export a CSV from ING

In the ING app or on mijn.ing.nl: go to your current account, choose to download/export transactions, pick **CSV** (comma- or semicolon-separated both work) and a period. English and Dutch exports are both supported. (Menu names may differ between versions.)

## How to export a CSV from Revolut

In the Revolut app: open your account → **Statement** → choose **Excel/CSV**, pick a period, and share/save the file. Then in Finance Overview go to **Import → Choose CSV file**. (Menu names in the Revolut app may differ slightly between versions.)

## Project structure

```
App.tsx                      Tab navigation, database provider
src/db/database.ts           Phone storage: SQLite schema and queries
src/db/database.web.ts       Web storage: same functions, using browser storage
src/db/provider(.web).tsx    Picks the right storage per platform
src/lib/csv.ts               CSV parser (no dependencies)
src/lib/money.ts             Amount parsing and formatting (integer cents)
src/lib/dates.ts             Date parsing and month helpers
src/lib/dialogs.ts           Confirm/alert dialogs that also work in the browser
src/lib/categories.ts        Categories and auto-categorization rules
src/lib/importers.ts         Revolut and generic bank CSV import
src/lib/forecast.ts          Plan dates, upcoming items and the balance forecast
src/lib/setupFile.ts         Plans file (plans, budgets, debts) format and import
src/lib/balances.ts          Account balances kept up to date from imported statements
src/lib/vaultCrypto.ts       Encryption of synced data (AES-GCM, PBKDF2)
src/lib/syncMerge.ts         Combining changes from two devices
src/sync/                    Sync engine (web) and backups
worker/                      Cloudflare Worker: sync API on D1, login check
wrangler.jsonc               Cloudflare configuration
src/screens/                 Dashboard, Monthly, Transactions, Import
src/components/              UI building blocks, charts, tables, sheets/side panels
src/layout.ts                Breakpoints for the responsive layout
test/                        Tests (import, forecast, web storage)
```

## Notes and limitations

- Totals add up amounts as-is; if you import accounts in different currencies, they are not converted.
- For Revolut, fees are subtracted from the amount, reverted/declined transactions are skipped, and pending ones are skipped until they complete (import again later to add them).
- Bank-specific formats other than Revolut use the column matching step.
