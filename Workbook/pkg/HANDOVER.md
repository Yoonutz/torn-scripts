# HANDOVER — The Covenant Chronicles (immersive web comic reader)

Hand this whole folder to Claude Code. It contains the working reader, reusable
asset files, the extraction/upscale pipeline, and a data model ready for multiple books.

---

## 1. What this is

An immersive, self-contained web comic reader. A grim post-apocalyptic comic
("The Covenant Chronicles", chapter I) is read page-by-page with a 3D page-turn,
sitting inside a living dystopian scene (parallax ruined-city background, rain-on-glass,
ash, fog, lightning, grain, scanlines). Built as ONE portable HTML file with everything
base64-embedded.

Working build: `reader_reference.html` (open in any browser, no server, no deps).

Owner preferences (carry forward):
- Terse "caveman" replies: drop articles, short fragments, copy-paste-ready, no
  version-history recaps, no unsolicited caveats. Corrections are blunt and frequent.
- Bugfixes preferred as standalone find/replace instructions over rewritten files.
- GUI-over-terminal when in the Claude Code desktop app.
- Self-contained single-file output has been the constraint so far (see §6 — recommend
  changing this for the multi-book version).

---

## 2. Current state — what works

- 29 comic panels extracted from a single 1024x1536 source page, tight-cropped
  (no black gutter slivers), FSRCNN x4 super-resolved.
- Reader: cover (page 0) + 7 comic pages. Page 0 cover is transparent so the city IS
  the cover art, with a decode-scramble title.
- 3D page-flip (curl for interior, stiffer "hard" flip for the cover), tap-zones,
  arrow keys, swipe, progress ticks, frosted controls, live clock status strip.
- **Justified fit layout** (the hard-won part — do not regress, see §5): panels keep
  true aspect ratio, tile with even 9px gutters, scale-to-fit, center. No letterbox
  gaps, no crop.
- Scene: parallax camera (drift + zoom-breath + mouse), rain-on-glass droplets with
  runners/trails, ash motes, fog, lightning, grain, scanlines, vignette flicker.
- Respects `prefers-reduced-motion`.

---

## 3. THE TWO REQUESTED NEXT FEATURES (do these first)

### 3a. Split the first page → standalone landing
Currently the title is page 0 of the flipbook. Pull it out into a separate **landing
view** shown before the reader: just **series title + short bio + ENTER button**.
ENTER transitions into the reader (or into the library once >1 book — see 3b).

Data already provided in `books.json` → `series.title`, `series.tagline`, `series.bio`.

### 3b. Multiple books — plan the architecture now
Target app = three views:

```
LANDING  ──ENTER──▶  LIBRARY  ──pick book──▶  READER  ──back──▶  LIBRARY
(title,              (grid of book              (current flip
 bio, button)         covers w/ chapter)         reader, per book)
```

- With one book, ENTER may go straight to READER; keep LIBRARY in the flow for when
  more are added.
- Each book = one entry in `books.json` → `books[]`. Adding a book = run the pipeline
  (§4) on a new source page, drop assets in `assets/<book-id>/`, append a `books[]`
  entry. No engine changes.

---

## 4. Asset pipeline (reproducible)

To add a new comic page/book from a source image:

```
# 1. detect + tight-crop panels (verify the overlay!)
python tools/extract_panels.py source_page.png work/<book-id>
open work/<book-id>/_overlay.png        # MUST eyeball this — detection is heuristic

# 2. super-resolve panels (low-res source art needs this)
python tools/upscale.py work/<book-id> assets/<book-id>
#    models/FSRCNN_x4.pb required — download URL is in tools/upscale.py docstring

# 3. add a books[] entry referencing assets/<book-id>/pN_M.webp + ar values
#    (ar = width/height from work/<book-id>/layout.json)
```

Pipeline notes / gotchas:
- Source art is LOW RES (~1024px page; panels 87–568px wide). That is the hard ceiling
  — super-res reconstructs edges, it cannot invent detail. The tiny speech-bubble panels
  stay a touch soft. For genuinely crisp output, regenerate the comic at higher res
  upstream.
- EDSR x4 looks slightly better than FSRCNN on the tiny panels but is ~90s/panel on CPU
  (no GPU here). FSRCNN x4 is sub-second and was used for the shipped build. Both are
  CPU `cv2.dnn_superres`. Real-ESRGAN would beat both but its models are gated behind
  Hugging Face / Git-LFS (blocked in the sandbox we built this in).
- `extract_panels.py` thresholds were tuned for this art's black gutters. New art with
  different gutter darkness / borderless panels will need threshold tweaks or manual
  band overrides — always check `_overlay.png`.

---

## 5. Layout engine — DO NOT REGRESS

This took many iterations. The naive approaches all failed:
- Equal-cell CSS grid + `object-fit:contain` → huge black voids (mismatched aspects).
- Forcing the comic to fill a rigid 3:4 page → boxes stop matching panel aspect →
  `contain` letterboxes every panel → ragged dark gaps bleed the scene through.

**Correct approach (shipped):** justified rows at *true* aspect ratios, then measure-and-fit.

1. `bestPartition(panels)` groups a page's panels (in reading order, contiguous) into
   rows. Cost = panel-area uniformity (CV) + row-balance + ≤3-per-row cap + a
   log-ratio term keeping the block's aspect near the page's. Brute-forces all
   contiguous partitions (panels/page ≤ ~6, so ≤32 options).
2. Each row gets `data-sa` = sum of its panels' aspect ratios.
3. `fitPage(el)` measures the page-inner box and sets each row height =
   `(W - gaps) / sumAr`. This makes every panel box EXACTLY its image aspect →
   `object-fit:contain` shows the full panel with zero gap and zero crop.
4. If the stack is taller than the page, scale W (and heights) down to fit; center.
   Result: clean tiled comic block, even gutters, scaled + centered, scene as margin.
5. Re-fit on resize and on every flip (`fitAll()` / `fitPage()`).

Within a row: `img { flex: <ar> 1 0 }` → widths ∝ aspect ratio. Row height fixed by
fitPage. Box aspect = ar exactly. Keep this invariant.

Shipped per-page groupings: P1 2+2, P2 2+1, P3 3+2, P4 1+2+2, P5 2+3, P6 2+2, P7 1+1+1.

---

## 6. Recommended refactor for Claude Code

The shipped file is one ~3.3MB HTML with everything base64-embedded. Fine for a single
portable artifact, wrong for a growing multi-book site. Recommended structure:

```
covenant-reader/
  index.html            # 3 views: landing / library / reader shell
  styles.css            # scene + reader + ui (lift from reader_reference.html <style>)
  engine.js             # bestPartition, fitPage, flip, scramble, scene (rain/ash/camera)
  books.json            # data model (provided; series + books[])
  assets/
    covenant-ch1/
      background.webp
      p1_1.webp ... p7_3.webp   # 29 panels (provided)
  tools/
    extract_panels.py   # provided
    upscale.py          # provided
  models/               # FSRCNN_x4.pb (download per upscale.py docstring; gitignore it)
```

- Reference values from `reader_reference.html`: tuned constants live there —
  `PAGE_A = 0.74` (page-inner aspect target), gutter `g = 9`, flip easings, fx z-indexes,
  scramble timing, droplet counts. Copy them over verbatim.
- Keep it dependency-free vanilla JS unless there's a reason not to.
- Asset files now exist (not base64) — reference them by URL from books.json.

---

## 7. Data model (books.json — provided)

```json
{
  "series": { "title": "...", "tagline": "...", "bio": "..." },
  "books": [
    {
      "id": "covenant-ch1",
      "title": "The Covenant Chronicles",
      "chapter": "Chapter I",
      "subtitle": "The Crows Wanted Proof",
      "bio": "They stole from the innocent...",
      "background": "assets/covenant-ch1/background.webp",
      "pages": [ { "panels": [ { "src": "assets/covenant-ch1/p1_1.webp", "ar": 0.909 }, ... ] }, ... ]
    }
  ]
}
```

`ar` = panel width/height; the layout engine needs it. `pages[]` order = reading order;
`panels[]` within a page = left-to-right reading order.

---

## 8. Roadmap (priority order)

1. Refactor shipped HTML → index.html + styles.css + engine.js + books.json (§6).
2. Landing view: series title + bio + ENTER (§3a).
3. Library view: grid of book covers (use each book's background + title + chapter),
   click → reader for that book (§3b).
4. Reader reads the selected book from books.json (drop the old base64 cover-as-page-0;
   cover becomes a per-book intro plate or fold straight into page 1).
5. "Add a book" path documented for the owner (run §4 pipeline, append books[]).
6. Optional polish: per-book theming, bookmark/last-page memory (localStorage —
   note: localStorage is NOT supported inside Claude.ai artifacts, but IS fine in a
   real deployed site, which this will be), share links, keyboard help overlay.

---

## 9. Known constraints / gotchas log

- Self-contained artifact previously required base64 — dropping that for a real project.
- localStorage/sessionStorage work in a deployed site but NOT in Claude.ai artifacts.
- `prefers-reduced-motion` path must stay (disables flip/scene/scramble).
- Bug we hit and fixed (watch for regressions): a `let beads` declared *after* a
  `resize()` call that used it → temporal-dead-zone ReferenceError that silently killed
  the whole scene script. Declare state before first use.
- Child-safety / content: comic is fictional post-apoc violence, fine; keep it fictional.

---

## 10. Files in this handover

- `reader_reference.html` — current working single-file build (open to see target behavior).
- `books.json` — data model, book 1 populated.
- `assets/covenant-ch1/` — 29 upscaled panel webps + background.webp.
- `tools/extract_panels.py`, `tools/upscale.py` — the pipeline.
- `HANDOVER.md` — this file.

Models (FSRCNN_x4.pb etc.) are NOT bundled (large); download URLs are in
`tools/upscale.py`.
