# Google Apps Script local setup

This folder is configured to work with Google Apps Script using `clasp`.

## What is already set up

- Local `npm` project
- Local `@google/clasp` dependency
- `src/` as the Apps Script root directory
- Package scripts for the common `clasp` commands

## Connect this folder to your existing Apps Script project

1. Authenticate with Google:

   ```powershell
   npm run login
   ```

2. Find your Apps Script `scriptId` in the browser URL or project settings.

3. Create `.clasp.json` in the project root with this content:

   ```json
   {
     "scriptId": "YOUR_SCRIPT_ID",
     "rootDir": "src"
   }
   ```

4. Pull the remote project into `src/`:

   ```powershell
   npm run pull
   ```

## Daily workflow

- Pull latest remote changes: `npm run pull`
- Push local changes to Apps Script: `npm run push`
- Check pending changes: `npm run status`
- Open the Apps Script project in the browser: `npm run open`

## Notes

- `.clasp.json` is ignored so your script ID stays local to this machine.
- `.clasprc.json` is ignored because it contains authentication details.
- Once you pull the project, edit the files under `src/` from VS Code.
