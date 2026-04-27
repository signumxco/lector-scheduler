# Lector Scheduling System

A self-hosted, parish-owned lector scheduling system. Google Apps Script handles all backend logic and email. A static web app on GitHub Pages handles the lector-facing UI. No paid services required.

---

## How It Works

| When | What happens |
|------|-------------|
| 16th of each month | Lectors receive a personal link to submit availability for next month |
| 23rd of each month | Schedule is auto-generated; coordinator gets an email with a link to review |
| Coordinator approves | Review in Google Sheets, adjust if needed, then publish with one click |
| After publishing | Each lector receives their assignments with reading text and prep links |
| 1 week before each Mass | Automatic reminder emails go out |
| Anytime | Lectors can request a substitute via a link in their assignment email |

---

## Architecture

```
Google Sheet         — Data store (5 tabs: Lectors, MassTimes, Availability, Schedule, Tokens)
Google Apps Script   — All logic, email, and reading scraping (runs on Google's servers)
GitHub Pages         — Static UI served to lectors (no server required)
Gmail                — Outbound email via the coordinator's Google account
USCCB.org            — Reading URLs scraped verbatim; never generated
lectorprep.org       — Prep notes scraped verbatim; never generated
```

---

## Setup Guide

### Step 1 — Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it something like **Lector Schedule**.
3. Copy the **Spreadsheet ID** from the URL:
   - URL format: `https://docs.google.com/spreadsheets/d/`**`YOUR_SPREADSHEET_ID`**`/edit`
   - Save this ID — you'll need it in Step 2.

---

### Step 2 — Set Up Google Apps Script

1. In your Google Sheet, click **Extensions → Apps Script**.
2. Delete any existing code in the editor.
3. Paste the entire contents of `apps-script/Code.gs` from this repository.
4. In the left sidebar, open `appsscript.json` and replace its contents with `apps-script/appsscript.json`.
5. Click **Save**.

#### Configure Script Properties

These store your private settings securely — never hard-coded anywhere.

1. In Apps Script, click the gear icon **⚙ Project Settings**.
2. Scroll to **Script Properties** and add each of the following:

| Property | Value |
|----------|-------|
| `SPREADSHEET_ID` | Spreadsheet ID from Step 1 |
| `COORDINATOR_EMAIL` | Email address to receive schedule notifications |
| `GITHUB_USERNAME` | Your GitHub username (lowercase) |
| `PARISH_NAME` | Your parish name (used in email subject lines) |
| `SCRIPT_URL` | Leave blank for now — fill in after deploying below |

3. Click **Save script properties**.

#### Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear **⚙** next to "Select type" → choose **Web app**.
3. Set:
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
4. Click **Deploy** and authorize when prompted.
5. Copy the **Web app URL** (looks like `https://script.google.com/macros/s/AKfyc.../exec`).
6. Go back to Script Properties, set `SCRIPT_URL` to this URL, and save.

> **After any code change**, you must redeploy: Deploy → Manage deployments → edit the existing deployment → set version to **New version** → Deploy. The URL stays the same.

#### Initialize the Sheet Tabs

1. Return to your Google Sheet and refresh the page.
2. A **Lector System** menu will appear in the top bar.
3. Click **Lector System → Initialize Sheet Tabs**.
4. Five tabs are created: `Lectors`, `MassTimes`, `Availability`, `Schedule`, `Tokens`.

---

### Step 3 — Configure GitHub Pages

1. Fork or push this repository to GitHub.
2. Go to your repository → **Settings → Pages**.
3. Set source to **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. Click **Save**. Pages will be live at `https://YOUR_USERNAME.github.io/lector-scheduler/`.

#### Set the Apps Script URL in the Web Pages

1. Open `web/availability.html` in a text editor. Find:
   ```js
   const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';
   ```
2. Replace the placeholder with your Web app URL from Step 2.
3. Repeat for `web/swap.html`.
4. Commit and push both files.

---

### Step 4 — Add Your Lectors

In the **Lectors** tab:

| Name | Email | Active |
|------|-------|--------|
| Jane Smith | jane@example.com | TRUE |
| Bob Johnson | bob@example.com | TRUE |

Set **Active** to `FALSE` to pause a lector without deleting them.

---

### Step 5 — Set Up Mass Times

The **MassTimes** tab has two row types: **recurring** (repeats every matching weekday) and **one-time** (appears for a specific date only).

**Recurring Masses** — leave `SpecificDate` blank:

| DayOfWeek | Time  | Label           | MassType | LectorsNeeded | SpecificDate |
|-----------|-------|-----------------|----------|---------------|--------------|
| Saturday  | 17:00 | Saturday Vigil  |          | 2             |              |
| Sunday    | 08:00 | Sunday 8:00 AM  |          | 2             |              |
| Sunday    | 10:00 | Sunday 10:00 AM |          | 2             |              |

**One-time custom Masses** — set `SpecificDate` to `YYYY-MM-DD`:

| DayOfWeek | Time  | Label         | MassType | LectorsNeeded | SpecificDate |
|-----------|-------|---------------|----------|---------------|--------------|
|           | 19:00 | Special Mass  | Special  | 2             | 2026-12-24   |

> One-time rows only appear on lectors' availability calendars for the month the date falls in. Add them as needed and leave or delete them afterward. `DayOfWeek` is ignored when `SpecificDate` is set.

**Column reference:**

| Column | Description |
|--------|-------------|
| `DayOfWeek` | Full day name: `Sunday` through `Saturday`. Used for recurring rows. |
| `Time` | 24-hour format: `09:00`, `17:30`, etc. |
| `Label` | Name shown to lectors on the availability calendar |
| `MassType` | Optional badge text (e.g. `Special`, `School Mass`). Blank for a regular Mass. Shows as a colored badge on the calendar and in lector emails. |
| `LectorsNeeded` | Number of lectors required. Default is `2`. Use `1` for a weekday or school Mass. |
| `SpecificDate` | Blank for recurring. `YYYY-MM-DD` for a one-time Mass. |

> **Saturday evening Masses** automatically use the following Sunday's readings from USCCB.org (anticipated Sunday liturgy).

---

### Step 6 — Set Up Automatic Triggers

1. Click **Lector System → Set Up Monthly Triggers**.
2. Three triggers are created:
   - **16th of each month at 8 AM** — Availability request emails
   - **23rd of each month at 8 AM** — Auto-schedule generation
   - **Every Monday at 8 AM** — 1-week reminder emails

You only need to do this once. Re-running it safely replaces existing triggers.

---

## Monthly Coordinator Workflow

### Around the 16th
Nothing to do — emails go out automatically.

### Around the 23rd

1. You'll receive a **"Schedule Ready for Review"** email with a link to the Sheet.
2. Open the **Schedule** tab.
3. Review the auto-generated assignments. The system distributes lectors evenly across the month using a round-robin algorithm based on submitted availability.
4. Rows marked **NEEDS ATTENTION** had fewer available lectors than required — fill in Lector1 or Lector2 manually.
5. For any Mass where a deacon will be present, enter `TRUE` in the **DeaconMass** column. These rows are highlighted on the sign-in sheet, reminding Lector 2 to confirm the Prayers of the Faithful with the celebrant.
6. Click the **Status** cell for each row and choose **APPROVED** from the dropdown (options: `NEEDS ATTENTION`, `APPROVED`, `CANCELLED`).
7. When all rows are approved:
   - Click **Lector System → Publish Approved Schedule** to email everyone their assignments.
   - Click **Lector System → Print Sign-In Sheet** to open the printable sign-in sheet for the church.

### Sign-In Sheet

The print dialog produces a table formatted for placing in the church each month:

| Date & Time | Lector 1 | Sign In | Lector 2 | Sign In |
|-------------|----------|---------|----------|---------|
| May 3 · 8:00 AM | Jane Smith | _______ | Bob Johnson | _______ |

- Yellow rows = DeaconMass (Lector 2 reminder printed in footer)
- Sign-in columns are blank for lectors to fill in on the day

### If a Lector Requests a Swap

- You'll receive a notification email.
- All other active lectors are emailed simultaneously.
- When someone claims the slot, update the Schedule tab and confirm both parties by email.

---

## Manual Controls

All automated flows can be triggered manually from the **Lector System** menu:

| Menu Item | What it does |
|-----------|-------------|
| Send Availability Requests | Emails all active lectors their availability link for next month |
| Generate Schedule Now | Runs the scheduling algorithm and populates the Schedule tab |
| Publish Approved Schedule | Emails all lectors with APPROVED rows their assignments |
| Print Sign-In Sheet | Opens a print-ready sign-in sheet in a dialog |
| Send Reminder Emails | Sends 1-week reminders for upcoming Masses |
| Set Up Monthly Triggers | Creates/refreshes automatic time-based triggers |
| Initialize Sheet Tabs | Creates the 5 required tabs (safe to re-run) |

---

## Security & Privacy

- **All data stays in your Google account** — no third-party database. The Sheet, Apps Script, and Gmail are all yours.
- **No login system** — access is controlled by UUID tokens unique to each lector per month. Appropriate for a low-stakes internal tool.
- **GitHub Pages serves only HTML/CSS/JS** — no lector names, emails, or data ever touch the repo.
- **Script Properties** store all sensitive config (spreadsheet ID, coordinator email) — never hard-coded.

---

## Troubleshooting

**"No active lectors found"**
→ Check the Lectors tab. Active must be `TRUE` (the word, not a checkbox).

**Lectors see an error opening their link**
→ Confirm `APPS_SCRIPT_URL` in `web/availability.html` matches your deployed URL. After any code change, redeploy with a new version in Apps Script.

**Schedule tab is empty after generating**
→ Check that MassTimes has rows and lectors submitted availability. See Apps Script logs: View → Logs.

**Emails not sending**
→ Make sure you authorized the script during deployment. Check your Gmail Sent folder. Gmail personal accounts allow ~500 emails/day.

**Readings missing from emails**
→ USCCB.org may not have published that date's page yet. The email includes a direct link as fallback. Normal for dates more than a few weeks out.

**Status column has no dropdown**
→ Re-run **Generate Schedule Now** — the dropdown is applied automatically. Or select the Status column range and add data validation manually: `NEEDS ATTENTION`, `APPROVED`, `CANCELLED`.
