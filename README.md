# Lector Scheduling System

A low-cost, parish-owned lector scheduling system. Google Apps Script handles all backend logic. A static web app (GitHub Pages) handles the lector-facing UI. No paid services required.

---

## How the System Works

1. **16th of each month** — Lectors receive an email with a personal link to submit their availability for next month.
2. **23rd of each month** — The schedule is automatically generated and emailed to the coordinator for review.
3. **Coordinator approves** — Review the schedule in Google Sheets, make adjustments, then publish it with one click.
4. **Lectors are notified** — Each lector receives their assignments with scraped reading text and prep notes.
5. **1 week before each Mass** — Automatic reminder emails go out.
6. **Swaps** — Lectors can request a substitute via a link in their assignment email.

---

## Setup Guide

Follow these steps in order. Each step takes about 5–10 minutes.

---

### Step 1 — Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it something like **Lector Schedule**.
3. Copy the URL from your browser — you'll need the Spreadsheet ID from it.
   - The URL looks like: `https://docs.google.com/spreadsheets/d/`**`1aBcDeFgHiJkLmNoPqRsTuVwXyZ`**`/edit`
   - The bold part is your **Spreadsheet ID**. Save it.
4. Leave the sheet open — you'll run a setup script on it next.

---

### Step 2 — Set Up Google Apps Script

1. In your Google Sheet, click **Extensions → Apps Script**.
2. A new tab opens with a code editor. Delete any existing code in the editor.
3. Copy the entire contents of `apps-script/Code.gs` from this repository and paste it in.
4. Click the **+** next to "Files" and choose **Script**. Name it `appsscript` (no extension shown).
   - Actually, click the gear icon ⚙ next to "Project Settings" → paste the contents of `apps-script/appsscript.json` there instead.
   - Or: in the left sidebar, click the file named `appsscript.json` and replace its contents with the contents of `apps-script/appsscript.json`.
5. Click **Save** (the floppy disk icon or Ctrl+S / Cmd+S).

#### Configure Script Properties

These are your private settings — never hard-coded, stored securely by Google.

1. In Apps Script, click **Project Settings** (gear icon ⚙ in the left sidebar).
2. Scroll down to **Script Properties** and click **Add script property** for each of the following:

| Property Name       | Value                                      |
|---------------------|--------------------------------------------|
| `SPREADSHEET_ID`    | Your Spreadsheet ID from Step 1            |
| `COORDINATOR_EMAIL` | Your email address (receives schedule + notifications) |
| `GITHUB_USERNAME`   | Your GitHub username (lowercase)           |
| `PARISH_NAME`       | Your parish name (e.g., `St. Mary Parish`) |
| `SCRIPT_URL`        | Leave blank for now — you'll fill this in after Step 3 |
| `ANTHROPIC_API_KEY` | Optional — leave blank if not using        |

3. Click **Save script properties**.

#### Deploy as a Web App

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear icon ⚙ next to "Select type" and choose **Web app**.
3. Set:
   - **Description**: `Lector Scheduler v1`
   - **Execute as**: `Me` (your Google account)
   - **Who has access**: `Anyone` (this is required so lectors can submit availability without logging in)
4. Click **Deploy**.
5. Google will ask you to authorize the app — click **Authorize access**, choose your Google account, and click **Allow**.
6. Copy the **Web app URL** shown (looks like `https://script.google.com/macros/s/AKfyc.../exec`).
7. Go back to **Script Properties** and set `SCRIPT_URL` to this URL. Click **Save**.

#### Initialize the Sheet Tabs

1. Go back to your Google Sheet.
2. Refresh the page — a new menu item **"Lector System"** will appear in the top menu bar.
3. Click **Lector System → Initialize Sheet Tabs**.
4. Click **OK** when prompted to authorize.
5. Five tabs will be created: Lectors, MassTimes, Availability, Schedule, Tokens.

---

### Step 3 — Configure GitHub Pages

1. Push this repository to GitHub (or fork it).
2. Go to your repository on GitHub → **Settings → Pages**.
3. Under **Source**, select **Deploy from a branch**.
4. Set the branch to `main` (or `master`) and the folder to `/ (root)`.
5. Click **Save**.
6. GitHub Pages will be live at: `https://YOUR_GITHUB_USERNAME.github.io/lector-scheduler/`

#### Update the Apps Script URL in the Web Pages

You need to tell the web pages where your Apps Script lives.

1. Open `web/availability.html` in a text editor.
2. Find this line near the bottom:
   ```js
   const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';
   ```
3. Replace `YOUR_APPS_SCRIPT_URL_HERE` with your Web app URL from Step 2.
4. Repeat for `web/swap.html`.
5. Commit and push the changes:
   ```
   git add web/availability.html web/swap.html
   git commit -m "Configure Apps Script URL"
   git push
   ```

---

### Step 4 — Populate Your Lector Roster

In the **Lectors** tab of your Google Sheet:

| Name          | Email                    | Active |
|---------------|--------------------------|--------|
| Jane Smith    | jane@example.com         | TRUE   |
| Bob Johnson   | bob@example.com          | TRUE   |

- **Active**: Set to `TRUE` for lectors who should receive scheduling emails. Set to `FALSE` to pause them without deleting their record.

---

### Step 5 — Set Up Mass Times

In the **MassTimes** tab, list every regularly scheduled Mass. Each row represents one recurring weekly time slot.

| DayOfWeek | Time  | Label              | IsTriduum |
|-----------|-------|--------------------|-----------|
| Saturday  | 17:00 | Saturday Vigil     | FALSE     |
| Sunday    | 08:00 | Sunday 8:00 AM     | FALSE     |
| Sunday    | 10:00 | Sunday 10:00 AM    | FALSE     |
| Sunday    | 12:00 | Sunday Noon        | FALSE     |
| Thursday  | 19:00 | Holy Thursday      | TRUE      |
| Friday    | 15:00 | Good Friday        | TRUE      |
| Saturday  | 20:30 | Easter Vigil       | TRUE      |

- **DayOfWeek**: Full day name — `Sunday`, `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`
- **Time**: 24-hour format — `09:00`, `17:30`, etc.
- **Label**: Descriptive name shown to lectors
- **IsTriduum**: `TRUE` for Holy Thursday, Good Friday, and Easter Vigil — these are visually flagged for lectors

---

### Step 6 — Set Up Automatic Triggers

1. In your Google Sheet, click **Lector System → Set Up Monthly Triggers**.
2. This creates three automatic schedules:
   - **16th of each month at 8 AM** — Availability request emails sent to all active lectors
   - **23rd of each month at 8 AM** — Schedule auto-generated, coordinator notified
   - **Every Monday at 8 AM** — Reminder emails sent to lectors with Masses that week

> You only need to do this once. If you re-run it, old triggers are safely replaced.

---

## Monthly Workflow (Coordinator)

Once set up, here's what you do each month:

### Around the 16th
Nothing — emails go out automatically. You'll see them in your Sent folder.

### Around the 23rd
1. You'll receive an email: **"Your schedule is ready for review"** with a link to the Sheet.
2. Open the **Schedule** tab.
3. Review each row. The system auto-assigns two lectors per Mass.
4. Any row marked **NEEDS ATTENTION** means fewer than 2 lectors were available — assign manually.
5. Make any changes you like (swap lectors, adjust assignments).
6. When you're satisfied with a row, change its **Status** column from `PENDING APPROVAL` to `APPROVED`.
7. When all rows are approved, click **Lector System → Publish Approved Schedule**.
8. Lector notification emails go out immediately.

### If a Lector Requests a Swap
- You'll receive a notification email.
- All other lectors have already been emailed.
- When someone replies to claim the slot, update the **Schedule** tab manually and confirm both lectors by email.

---

## Adding or Removing Lectors

- **Add a lector**: Add a row to the **Lectors** tab with their name, email, and `TRUE` for Active.
- **Pause a lector**: Change their Active column to `FALSE`. They won't receive emails but their history is preserved.
- **Remove a lector**: Delete their row from the Lectors tab.

---

## Running Things Manually

All automated flows can also be triggered manually from the **Lector System** menu in your Google Sheet:

| Menu Item | What it does |
|-----------|--------------|
| Send Availability Requests | Emails all active lectors their availability link for next month |
| Generate Schedule Now | Runs the scheduling algorithm for next month |
| Publish Approved Schedule | Emails all lectors their APPROVED assignments |
| Send Reminder Emails | Sends 1-week reminders for upcoming Masses |
| Set Up Monthly Triggers | Creates/refreshes the automatic time-based triggers |
| Initialize Sheet Tabs | Creates the 5 required tabs (safe to re-run) |

---

## Readings & Prep Notes

- Reading text is scraped verbatim from **USCCB.org** — it is never generated or paraphrased.
- Prep notes are scraped verbatim from **lectorprep.org** — never generated or paraphrased.
- If scraping fails for a date (e.g., the liturgical page isn't published yet), the email includes a direct link to the page instead.

---

## File Structure

```
lector-scheduler/
├── apps-script/
│   ├── Code.gs             — All backend logic (copy into Apps Script editor)
│   └── appsscript.json     — OAuth scopes manifest (paste into appsscript.json in editor)
├── web/
│   ├── availability.html   — Lector availability calendar (GitHub Pages)
│   ├── swap.html           — Swap request page (GitHub Pages)
│   └── confirm.html        — Confirmation screen (GitHub Pages)
└── README.md               — This guide
```

---

## Troubleshooting

**"No active lectors found"**
→ Check the Lectors tab. Make sure the Active column says `TRUE` (not `Yes` or `true`).

**Lectors get an error opening their link**
→ Verify the `APPS_SCRIPT_URL` constant in `web/availability.html` matches your deployed Web app URL exactly. Redeploy Apps Script if you've made code changes (Deploy → Manage deployments → edit → update version).

**Schedule tab is empty after generation**
→ Check that the MassTimes tab has rows and that lectors submitted availability. Run the script manually and check Apps Script logs (View → Logs) for errors.

**Emails not sending**
→ Apps Script uses Gmail via your Google account. Make sure you authorized the script. Check your Gmail Sent folder. Gmail has a daily send limit (~500 emails/day for personal accounts).

**Readings not appearing in emails**
→ USCCB.org or lectorprep.org may not have published the liturgical page yet for that date. The email will include a direct link instead. This is normal for dates more than a few weeks out.

---

## Privacy & Security

- Token links are single-use by design (re-submission is allowed via the same token, but tokens are unique per lector per month).
- No passwords or login system — security is through obscurity of UUID tokens, appropriate for a low-stakes parish application.
- All data lives in your own Google Sheet and Google account — no third-party database.
- The Anthropic API key (if used) is stored in Script Properties — never in the code or web pages.
