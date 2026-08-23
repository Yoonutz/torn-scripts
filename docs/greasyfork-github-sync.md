# Greasy Fork: publishing a userscript and auto-updating it from GitHub

How a userscript kept in a GitHub repository gets onto Greasy Fork, and how a `git push` then
republishes it with no manual step. Facts were checked against the Greasy Fork help pages and the
Greasy Fork source (`JasonBarnabe/greasyfork`) on 2026-08-23. The hazards in section 6 come from
real publishes and are not documented anywhere official.

Placeholders used throughout: `<user>` GitHub account or org, `<repo>` repository name,
`<branch>` the branch Greasy Fork syncs from, `<path>` the file path inside the repo,
`<script-id>` the numeric id in the Greasy Fork listing URL, `<user-id>` the numeric Greasy Fork
account id.

## 1. The script file

One `.user.js` file per script, committed on `<branch>`. The file must start with a metadata
block:

```js
// ==UserScript==
// @name         My Script
// @namespace    my-namespace
// @version      1.0.0
// @description  One sentence on what it does.
// @author       Author Name
// @match        https://example.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// @run-at       document-idle
// ==/UserScript==
```

Keys Greasy Fork requires or cares about (help page "Script meta keys"):

| Key                                         | Role                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@name`, `@description`                     | Listing title and subtitle. `@name:xx` / `@description:xx` add translations. A new version without `@description` inherits the previous one.                                   |
| `@namespace`                                | Combined with `@name` to identify an installed script. Change it and every user's manager sees a different script. Greasy Fork warns on change.                                |
| `@version`                                  | Mozilla version format. Must strictly increase on every code change; managers only update to a _higher_ number. Greasy Fork warns if it does not increase.                     |
| `@match` / `@include`                       | At least one. Only sites the script is actually for.                                                                                                                           |
| `@license`                                  | Optional but expected; SPDX id (`MIT`). Without it the listing shows "no license".                                                                                             |
| `@require`, `@resource`                     | External code only from the allowed CDN list, Greasy Fork libraries, or the same origin the script runs on. SRI hashes (Tampermonkey format) allowed.                          |
| `@antifeature`                              | Mandatory disclosure for anything that benefits the author (tracking, ads, miners).                                                                                            |
| `@downloadURL`, `@updateURL`, `@installURL` | **Ignored / rewritten.** Greasy Fork strips `@installURL` and sets `@downloadURL` and `@updateURL` to its own URLs, so installs from Greasy Fork only update from Greasy Fork. |

Code rules that can get a listing deleted:

- No minified or obfuscated code. Bundles must keep whitespace and variable names. 2 MB cap.
- Primary functionality must be in the code posted on Greasy Fork, not fetched from elsewhere.
- No unrelated keywords or sites in metadata to game search; no `@match` for sites it does not support.
- Update checks in the script itself: at most once a day.
- Greasy Fork normalises CRLF to LF on every posted version.

## 2. First publish

Two ways; both need a Greasy Fork login (`https://greasyfork.org/en/users/sign_in`, GitHub login works).

**A. Import from the raw URL (preferred, sets up sync in one go).**

1. Open `https://greasyfork.org/en/import`.
2. Paste the raw URL of the file, one per line. It must point at a **branch**, never a commit:

   ```text
   https://raw.githubusercontent.com/<user>/<repo>/<branch>/<path>
   ```

   Spaces in `<path>` are written as `%20`.

3. Sync type: **Automatic** ("it will be periodically checked for updates"). Manual means only
   when you trigger it.
4. Click **Import**. The result page lists imported scripts, scripts needing a description, and
   failures.

**B. Post code by hand** (`https://greasyfork.org/en/script_versions/new`), then link it to the
repo later via the Admin tab (section 3). Use this only if the listing already exists.

## 3. Linking an existing listing to the repo

Per script, not per repo. Each listing needs its own sync URL.

1. Script page → **Admin** tab → section **Source Syncing**.
2. Paste the raw URL (branch form, as above) into the URL field.
3. Pick **Automatic**. "Webhook" cannot be chosen here; Greasy Fork switches to it by itself on
   the first matching push.
4. Click **Update and sync**. The page then shows "Last successful sync was …" or the sync error.

**Before linking, make sure the repo file is at or above the listing's current `@version`.**
Sync accepts a lower version and rolls the public listing back. Version history with ids:
`https://greasyfork.org/en/scripts/<script-id>/versions`.

Once linked, **the repo is the only place to edit**. The web editor warns "Any updates you make
to the code here will be overwritten when syncing", and it means it.

## 4. The GitHub webhook

One webhook per GitHub repo covers every linked script owned by the same Greasy Fork account.

**On Greasy Fork** (`https://greasyfork.org/en/users/webhook-info`, login-gated):

1. Click **Generate** (or **Regenerate**) to get the secret. Regenerating invalidates the old one.
2. Note the payload URL shown. It is the `api.` host:

   ```text
   https://api.greasyfork.org/users/<user-id>/webhook
   ```

   The bare `greasyfork.org` host sits behind Cloudflare and answers every delivery with 403.

**On GitHub** (docs: "Creating webhooks"): repo → **Settings** → **Webhooks** → **Add webhook**.

| Field        | Value                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload URL  | the `api.greasyfork.org` URL above                                                                                                                       |
| Content type | `application/json`                                                                                                                                       |
| Secret       | the generated secret                                                                                                                                     |
| Events       | **Just the push event**. For release-only publishing: "Let me select individual events", untick Pushes, tick Releases (only `published` releases count). |
| Active       | checked                                                                                                                                                  |

Save. GitHub sends a `ping`; Greasy Fork answers 200 with `Webhook successfully configured.`
Keep the secret in a local, untracked file. Never commit it.

## 5. What happens on a push

From `app/controllers/concerns/webhooks.rb` and `lib/github.rb`:

1. Greasy Fork checks `X-Hub-Signature` (HMAC-SHA1 of the body with your secret). Mismatch → 403.
   That is the only cause of a 403 from the `api.` host.
2. Event must be `ping`, `push`, or `release`; anything else → 406.
3. For a push it walks every commit's **`modified`** file list. Added or removed files are
   ignored, so a brand-new file never publishes through the webhook; import it first (section 2).
4. Each modified path is expanded into the URL forms it matches against the listing's sync URL:

   ```text
   https://raw.githubusercontent.com/<user>/<repo>/<branch>/<path>
   https://raw.githubusercontent.com/<user>/<repo>/refs/heads/<branch>/<path>
   https://github.com/<user>/<repo>/raw/<branch>/<path>
   https://github.com/<user>/<repo>/raw/refs/heads/<branch>/<path>
   https://github.com/<user>/<repo>/releases/latest/download/<file>   (release events only)
   ```

   Spaces in the path may be `%20` or `+`; both variants are tried.

5. Matching scripts are re-synced from git at the pushed commit. The first webhook hit flips
   the sync type from Automatic to **Webhook**.
6. Response is JSON with `updated_scripts` and `updated_failed`. `"No scripts found."` with 200
   means the hook works but no listing has that file as its sync URL.
7. **The commit messages become the version's changelog, verbatim.** Every commit in the push,
   subject and body, joined together. There is no way to edit a published changelog afterwards;
   Greasy Fork exposes no route for it.

## 6. Hazards not in the official docs

- **One commit per push, no body.** Two commits in one push glue into one changelog; a body
  publishes internal notes to users. Squash before pushing.
- **Write the commit message as listing copy.** It is public, permanent, and shown under the
  version number.
- **Never put tool attributions or trailers in commits.** They land on the public listing and
  cannot be removed.
- **Version must beat the highest number ever published, not just the previous one.** A stray
  high version (for example a test build pushed as `1.0.0`) freezes every user who updated to
  it until a higher release exists. Check `/versions` before choosing a number.
- **Repo behind the listing = downgrade.** Bring the file up to date before linking or pushing.
- **Verify against Greasy Fork, not the GitHub raw URL.** GitHub's raw CDN caches for minutes;
  the webhook fires instantly, so Greasy Fork is often ahead of `raw.githubusercontent.com`.

## 7. Verifying a publish

```sh
curl -sL -A "Mozilla/5.0" https://greasyfork.org/scripts/<script-id>/code/script.user.js
```

Check the `@version` line, grep for a string unique to the new code, confirm the old line is
gone, and run `node --check` on the download. The served file differs from the repo copy in
exactly two lines, the injected `@downloadURL` and `@updateURL`; any other diff is real.

Redeliver the last push without a new commit: GitHub → repo → **Settings** → **Webhooks** →
the hook → **Recent Deliveries** → **Redeliver**. Via API:
`POST /repos/<user>/<repo>/hooks/<hook-id>/deliveries/<delivery-id>/attempts` (delivery ids
exceed float precision, so read them with grep, not `jq`).

## Sources

- <https://greasyfork.org/en/help/meta-keys>
- <https://greasyfork.org/en/help/code-rules>
- <https://greasyfork.org/en/help/external-scripts>
- <https://greasyfork.org/en/help/rewriting>
- <https://github.com/JasonBarnabe/greasyfork> - `app/views/users/webhook_info.html.erb`,
  `app/views/import/index.html.erb`, `app/views/scripts/_sync.html.erb`,
  `app/controllers/concerns/webhooks.rb`, `lib/github.rb`, `config/locales/en.yml`
- <https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks>
