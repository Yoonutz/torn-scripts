# Greasy Fork publisher

Puts a userscript from this repo on Greasy Fork and links it to the repo, with no clicks.
Greasy Fork has no API for creating scripts and its Cloudflare blocks cloud IPs, so this drives
a real Edge window on a home PC through Playwright.

```sh
cd tools/greasyfork && npm ci          # once; uses the installed Edge, no browser download
node gf.mjs login                      # once; sign in in the window that opens
node gf.mjs status                     # webhook state + every repo script's Greasy Fork state
node gf.mjs publish "Torn Event Reminder"
node gf.mjs sync "Torn Event Reminder"
```

`publish` is safe to rerun. It:

1. Checks the raw `.user.js` URL on `main` answers 200 (push first).
2. Finds the listing: one already syncing from that URL, else one of yours with the same `@name`
   (linked only if its version is not above the repo's, so users never roll back), else imports
   it on `/import` with sync type Automatic.
3. On the listing's Admin page sets the sync URL, points the default additional info at the
   folder's raw `greasyfork.md` (Markdown, `--markup html` to change) and presses
   **Update and sync now**.
4. Prints the sync notice and compares the served `@version` with the repo's.

After that every push that modifies the script or `greasyfork.md` syncs through the repo
webhook, and the first one flips the listing to Webhook. `status` reads the webhook state on
Greasy Fork and, when the `gh` CLI is signed in, on GitHub too.

The session lives in `~/.torn-greasyfork-profile` (override with `GF_PROFILE`), never in the repo.
`GF_BROWSER=chrome` uses Chrome instead of Edge. Background: `docs/greasyfork-github-sync.md`.
