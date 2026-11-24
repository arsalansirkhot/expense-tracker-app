# Expense Tracker

Personal expense tracker for Android. Data lives in a Google Sheet.

- `apps-script/` JSON API (standalone Google Apps Script) that reads and writes the Sheet.
- `docs/` The app itself (web app, served by GitHub Pages at https://arsalansirkhot.github.io/expense-tracker-app/).
- `android/` Thin APK that opens the web app full screen. Built by GitHub Actions.

Changes to `docs/` go live on the next app open. No reinstall needed.

## 1. Apps Script setup (one time, about 5 minutes)

This is a new, separate script. Your existing Sheet web app keeps working.

1. Go to https://script.google.com and click **New project**. Name it `Expense API`.
2. Delete the sample code in `Code.gs` and paste in [`apps-script/Code.gs`](apps-script/Code.gs). Save.
3. Click **Project Settings** (gear icon, left side). Under **Script Properties** click **Add script property** twice:
   - `SHEET_ID` = `1WT49r40kTFauQ4hn02QSfz6RW-1PBO4v6vmirq1y9LY`
   - `API_TOKEN` = a long random password you make up (e.g. 30+ letters and digits). Keep it; you'll type it into the app once.
   Click **Save script properties**.
4. Back in **Editor**, pick `testSetup` in the function dropdown and click **Run**. Approve the permissions prompt
   (Google shows "unverified app" because it is your own script: click **Advanced** > **Go to Expense API**).
   The log should list your Modes, Accounts and Expense Types.
5. Click **Deploy** > **New deployment**. Click the gear next to "Select type" > **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

"Anyone" only means the URL is reachable. Every request must carry your `API_TOKEN`, so nobody can read or write your Sheet without it.

**Updating the script later:** paste the new code, then **Deploy** > **Manage deployments** > pencil icon > Version: **New version** > **Deploy**. The URL stays the same.

### Recurring expenses (optional)

If your old script already posts the "Recurring" rows automatically, skip this.
Otherwise run `setupDailyTrigger` once in the editor. It posts due rows every morning around 6 AM and sets "Last Posted".

## 2. Install the app on your phone

1. On your phone, open https://github.com/arsalansirkhot/expense-tracker-app/releases/latest and download `Expenses.apk`.
2. Open it. Android asks to allow installs from your browser: allow it, then **Install**.
3. Open **Expenses**. On first launch it shows Settings: paste the Web app URL and your API token, then **Save and test**.

You can also skip the APK and use the web app directly in Chrome (menu > **Add to Home screen**).

## Notes

- The APK signing key (`android/app/release.keystore`) is committed so every build installs over the previous one. Fine for a personal sideloaded app; don't publish this APK to a store.
- Export: History tab > **Export** > this month or all. In the Android app the CSV downloads through your browser (check Downloads).
- Offline: adds made without signal are saved on the phone and synced when back online.
- Sharing with someone else: they need their own copy of the Sheet and their own Apps Script deployment; the same APK works, they just enter their own URL and token.
