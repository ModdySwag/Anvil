# T6 — Multi-user / sharing / community architecture (Anvil)

Date: 2026-10-06 · Author: Bob (Hermes), research subagent · Status: evidence file for the Anvil design doc (multi-user brief).
Method: web research (searches + page extracts, as-of 2026-10-06), plus a read-only probe of moddys.net (`curl -I`). Facts are cited per entry; anything not directly verified is labelled. Effort figures are estimates, not commitments.

## 0. Context inherited (do not re-derive)

- **Fairness spine (binding, ULTIMATE-PLAN.md §A4.1):** no credits · no metering · one-time unlocks · local-first (audio never uploaded) · open formats · CC0-first content with provenance manifests · no dark patterns. Any multi-user option below is scored against this.
- **Suite glue (D4):** one index + stable IDs + cross-app verbs + offline-first; Program C2 = SynthHub registry v2 (synths + content, manifest-driven submit/install); C4 = PF share → gallery → remix (the "biggest community lever found", E3 #8 Strudel Bakery).
- **Marketplace/community mechanics already researched:** E3 #5 (VCV Library registry blueprint), #8 (Strudel Bakery), #17 (Blender/ReaPack mechanics vs Obsidian trust failure), #18 (Atom sunset, marketplace supply-chain, forge concentration → mirrors + pinned installs + provenance).
- **Existing store tech (annex 05):** static `packs/index.json` store schema; content-addressed `.pfsound.zip` packs; sha256 manifests; IndexedDB install; `.htaccess` immutable caching; `file://` constraints (Firefox blocks IDB/localStorage on file://, OPFS throws, quota traps).
- **Hosting context probe (this session, read-only):** `HEAD https://moddys.net/` → `Server: Apache`, plus a rate-limit layer (`X-WS-RateLimit-Limit: 1000`); everything else static (ETag/Last-Modified). ` /forge/index.html` serves `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` → **third-party iframes of the app are blocked as served today** (matters for embed ideas, entry 10). **PHP/DB availability on moddys.net is unverified** — no write probe was run (read-only task); treat "PHP+SQLite works" as an assumption with a 10-minute verification plan (entry 17).

---

### 1. Audiotool — the cloud multiplayer DAW

Link(s): https://www.audiotool.com/product · https://www.audiotool.com/online-daw · https://www.audiotool.com/collaborate · https://www.audiotool.com/compare · https://www.audiotool.com/terms · third-party listing: https://indibloghub.com/ai-tools/tools/audiotool

**Core contribution:** The most complete working example of a browser DAW where accounts, cloud projects, real-time multiplayer and a remix/fork community are the product — and of how much backend that takes.

**KEY FACTS:**
- Marketing state (their pages, Oct 2026): "2M+ creators", "200K+ community presets", 37 built-in devices; "100% free, no ads"; "no track limits, no feature gates, no project-length caps"; projects live in the cloud and autosave; real-time multiplayer editing of the same project ("like a shared document for music"); fork/remix chain where **every remix links back to the original**.
- Free-tier comparison table they publish vs BandLab/Soundtrap/Soundation (claim): BandLab 16 tracks & ~15 min free, Soundtrap/Soundation feature-gated, Audiotool uncapped.
- Developer surface: **Nexus SDK** — project API "built on Protocol Buffers" defining every entity/action in the DAW (create/edit MIDI, audio, automation, devices); explicitly aimed at 3rd-party services, scripts, education apps.
- Conflicting details found: ToS §11 says "Most of AUDIOTOOL services are free of charge. Where there is a charge … prices … before the User begins"; a third-party listing describes a ~€6/mo Premium that unlocks **private projects**, higher-quality exports and more storage. Treat the paid-tier specifics as **unverified** (their current pages push "100% free"); the structural lesson (public-by-default free tier, paid privacy/exports) is consistent across both.

**Fold-in verdict:** REFERENCE — copy the *invite-link multiplayer session* + *remix-links-back-to-original* community chain (inputs to P3 and P2), and do NOT copy cloud-first storage or the public-by-default/paid-privacy lever; our spine is private-by-default, local-first, optional accounts. Home: P2/P3 design.

---

### 2. BandLab — the social/collab model (with Soundtrap as the gated contrast)

Link(s): https://blog.bandlab.com/forking-and-collaboration-on-bandlab-explained/ · https://help.bandlab.com/hc/en-us/articles/115002945253-How-do-I-invite-other-users-to-collaborate · https://help.bandlab.com/hc/en-us/articles/20758981227033-BandLab-Membership-FAQ · https://blog.bandlab.com/music-distribution-guide/ · https://bandlabtechnologies.com/news/bandlab-wins-peoples-voice-webby-award-best-user-experience-2026/ · https://www.billboard.com/business/tech/bandlab-100-million-users-report-1235637853/

**Core contribution:** A free, mobile-first social creation network: invite collaborators into a project, work live, fork other people's songs with enforced attribution — 100M+ creators at zero price for the core product.

**KEY FACTS:**
- "Over 100 million creators" (BandLab's own 2026 press materials; the 100M milestone dates from 2024, up from 60M in 2023); the company earns from artist services (distribution, promotion, memberships), not royalties on user music (Billboard: "doesn't receive royalties from music made on its platform").
- Collaboration: invite by username/email; **max 50 collaborators per project** (their blog); a fork button appears when a creator opts a song in ("publishing a song, by default, forking is not enabled"); enabling forking "is essentially granting other users a licence"; fork output is **always attributed to the original**, creator's name stays credited at the top. Revision/branch concept ("create a revision to begin the process"); Live Session works in real time on web.
- Membership adds distribution & 100%-earnings retention (80% if lapsed); free tier deficits are mostly gated features, and (per Audiotool's competitor table — competitor claim) ~16 tracks / ~15-min projects free vs 32 tracks paid. BandLab's own App Store copy says "free song cloud storage, unlimited multi-track projects" — **labels differ; treat track caps as competitor-claimed**.
- Splits/royalties: distribution earnings paid monthly; for performance royalties the documented flow is users registering with a PRO and submitting "song data and split details" manually — there is no built-in transparent split-payment rail.

**Fold-in verdict:** ADOPT — steal the exact fork mechanics: **opt-in per artefact, licence granted on opt-in, mandatory attribution chain back to the original** (fits CC0-first + credit-in-filename culture); copy invite-link collaboration for P3; skip the feed/social-graph. Home: P2 share/remix, P3 rooms.

---

### 3. Soundtrap — collaboration-first, education-anchored, feature-gated

Link(s): https://www.soundtrap.com/pricing · https://support.soundtrap.com/hc/en-us/articles/360023190973-What-are-the-differences-between-Soundtrap-s-subscription-plans · https://m.soundtrap.com/soundtrap-for-edu-home-0 · price aggregator: https://www.softwr.com/pricing/soundtrap (checked 2026-09-01)

**Core contribution:** Real-time multi-user collaboration sold to schools as the primary use case; shows both the education channel mechanics (rostering, COPPA/GDPR/FERPA, group collaboration) and the gated-free-tier pattern a fairness-spine product must avoid.

**KEY FACTS:**
- Consumer tiers (Softwr aggregation, 2026-09-01): Free, then $9.99 → $14.99 → $17.99/mo; free = "limited export quality and recording time". Real-time collaboration + autosave on all tiers (their EDU page).
- Education pricing (Soundtrap EDU page): $399/yr (Classroom, up to 50 users), $2,249/yr (School, up to 250), $4,999/yr (District, up to 500), additional seats $7.99–9.99 each; Google Classroom import, LMS (Canvas/Schoology) integrations, assignment sharing, "collaboration with 2 groups" on classroom tier.
- Compliance framing: "Guaranteed COPPA, GDPR, and FERPA compliant" (EDU page) — the reason schools can adopt at all. (Background: Spotify-owned; not re-verified this session.)

**Fold-in verdict:** REFERENCE — for P1/P2 keep the free tier *uncapped on creation* (exports/limits gating is exactly what Audiotool markets against and what our spine forbids); capture the education/institutional channel (group licences) as a future distribution path for the suite, not an architecture driver. Home: P1 pricing posture; EDU as later channel.

---

### 4. Splice — the sample/preset marketplace economics

Link(s): https://splice.com/plans · https://support.splice.com/en/articles/8652592-splice-plans-faq · https://support.splice.com/en/articles/12270038-splice-instrument-plans-and-pricing · https://splice.com/special-offer · creator-payout history: https://www.musicbusinessworldwide.com/music-making-platform-splice-has-paid-out-25m-to-music-creators/ · https://splice.com/blog/splice-creator-initiative/ · per-creator rates (anecdotal): https://www.reddit.com/r/Splice/comments/1kguutf/how_much_splice_pays_to_artists_per_downloaded/

**Core contribution:** The dominant reference for preset/sample marketplace pricing, credit mechanics and artist-payout framing (an "artist-to-artist marketplace" that has paid out tens of $M).

**KEY FACTS:**
- 2026 pricing (their pages): credits model — "All samples are one credit each. MIDI patterns and presets use up to three credits each"; credits roll over monthly; on cancel, remaining credits expire **28 days after the final billing period**; downloads are kept forever even after cancelling; add-on credits $4.99/100 up to 300 per period; plan shapes ≈ $12.99/mo entry-ish, $19.99/mo Creator-class, annual promo $120/yr; separate **Splice INSTRUMENT** plan does NOT use credits.
- Creator economy numbers (historical milestones, MBW/Splice blog): $10M paid by Oct 2018; $25M by Feb 2020; $36M cumulative by Sep 2020 — i.e. slow-burn five-figure-to-six-figure annual payouts across thousands of creators. Individual rates are **not published**; Reddit consensus: "no set rate — it's what the producer can negotiate", typical reported splits 50/50–60/40 for smaller labels. Treat as anecdote.
- Licensing: royalty-free for buyers, downloads licensed individually; the marketplace signature is *preview → credit → permanent licence record in your account*.

**Fold-in verdict:** REFERENCE — the credit/metering model is **against the fairness spine** (no credits, ever); the steal-able parts are (a) per-download permanent licence record, (b) 3-credit "preset costs more than a sample" tiering as a *quality* signal, (c) creator payouts only once volume exists — for us, free/CC0 packs first with a pay-once "Signature collection" lane later. Home: P2 store design / monetization watchlist.

---

### 5. ADSR + Loopcloud — the other two marketplace mechanics (credits-that-never-expire, DAW-synced preview)

Link(s): https://www.adsrsounds.com/samples/pricing/ · https://www.adsrsounds.com/credits/ · https://www.loopcloud.com/cloud/subscriptions/plans · https://www.loopcloud.com/cloud/subscriptions/annual_plans · third-party comparison: https://connectaitools.com/music-production/splice-vs-adsr-vs-loopmasters-pricing/ · price check page: https://www.itechguides.com/products/loopcloud/pricing/ (checked 2026-09-20)

**Core contribution:** Two refinements of the Splice model — ADSR's "purchased credits never expire, cancel keeps everything" fairness stance; Loopcloud's points + DAW-synced preview + similarity search as discovery, bundled with cloud storage.

**KEY FACTS:**
- **ADSR:** marketplace (per-pack purchase) **plus** "ADSR Orbit" subscription layer; "1 credit = 1 sound"; purchased credits **never expire, even if you cancel** (gifted/trial credits expire after 90 days); new users get 50 free credits; includes a Sample Manager app for DAW auditioning before committing credits.
- **Loopcloud (Loopmasters):** tiers $7.99/$11.99/$21.99 per month = 100/300/600 points + 5/50/250 GB cloud storage; annual $79.99/$119.99/$219.99 = 1200/3600/7200 points; access to "over 5 Million Sounds"; points download "sounds, presets and plugin expansions"; plugins include Loopcloud Sync/Sounds/DRUM/PLAY; the differentiators marketed are **DAW-synced preview with BPM & key match** and AI similarity search.
- Both keep *something* permanently (ADSR: credits; Splice: downloaded files; Loopcloud: points only while subscribed) — the "what survives cancellation" column is the most borrower-relevant line in all three.

**Fold-in verdict:** ADOPT the *preview-before-commit + permanent licence record + audition UI* patterns for the Anvil's own pack store pages; REFERENCE the subscription/points economics (not our model). "Audition a pack without installing it" (browser preview) is a cheap differentiator to spec into the store. Home: P2 store UX.

---

### 6. Patchstorage — patch sharing for VCV Rack / Pure Data / Organelle (upload flow + API)

Link(s): https://patchstorage.com/ · https://patchstorage.com/upload-a-patch/ · https://patchstorage.com/docs/api/beta/ · https://github.com/patchstorage/patchstorage-docs/wiki/Patchstorage-API · https://github.com/patchstorage/patchstorage-lv2-uploader

**Core contribution:** A live, working multi-platform patch library with a **documented write API** — the closest precedent to "SynthHub as a registry", including how submissions actually get in and revisioned.

**KEY FACTS:**
- Content: per-platform sections (VCV Rack ~9,270 patches / 570 followers observed on the homepage; Pure Data, plugdata, Organelle/Orac, LV2 plugin builds, MetaModule, etc.). Patches show **Category, Revision (e.g. "Revision: 0.0.1"), Modified date, author, followers** — i.e. versioned uploads with taxonomy, not a file dump.
- Upload: `/upload-a-patch/` requires login ("You have to login to proceed"); LV2 plugin binaries have a dedicated tool (`patchstorage-lv2-uploader`) that generates `*.tar.gz` + `patchstorage.json` and pushes via the API; note "Before uploading … ensure it wasn't uploaded by anyone else".
- **Beta API (current):** JWT auth via `POST /beta/auth/token` (token valid 7 days), `POST /beta/files` for artwork/patch files, `POST /beta/patches` to submit, `PUT /beta/patches/{id}` to edit, `GET /beta/patches*` to query; requires a `User-Agent` header; developer notifications newsletter for API consumers (they run a Discord for help). Alpha API deprecated & shut down 2023Q1. License/tag/category objects are first-class API schemas.
- Moderation details are **not publicly documented** on the pages read → treat as light-touch/community-managed; do not import claims about approval queues from it.

**Fold-in verdict:** ADOPT — this is the closest blueprint for the SynthHub public write API (token auth, files-then-object upload, revision field, licence taxonomy) and for one-account-per-creator submissions; our version adds the suite's validation tiers (schema+licence+sha256+engine-witness) and an explicit overt moderation policy. Home: P2.

---

### 7. VCV Library + Rack plugin toolchain — registry + CI gating (extends E3 #5)

Link(s): https://github.com/VCVRack/library (manifest/process — see E3 #5) · https://github.com/VCVRack/rack-plugin-toolchain · https://vcvrack.com/manual/Building · https://community.vcvrack.com/t/automated-building-and-releasing-plugins-on-github-with-github-actions/11364

**Core contribution:** Not just a manifest registry (E3 #5 covers name/author/license/versioned-commit curation) — a **cross-compile toolchain + GitHub Actions pattern** that makes "it builds, it's reproducible" an entry requirement. This is the CI model for validating submissions without a server.

**KEY FACTS:**
- `rack-plugin-toolchain`: cross-compiles plugins for Linux/Windows/macOS(x64+arm64) "with a single command" from a GNU/Linux environment; Docker-based build path (community Docker images, e.g. `ghcr.io/qno/rack-plugin-toolchain-win-linux`); the Rack manual: "Build for all architectures with one command using the VCV Rack Plugin Toolchain".
- Community GitHub Actions workflow (long-maintained thread, updated 2024): on every push/PR builds win-x64/lin-x64 (+mac) via the toolchain container, uploads artifacts, and **publishes a release only on a version tag (`refs/tags/v…`)** — the same "version-pinned + pushed commit hash" discipline the Library enforces for listings (E3 #5).
- Lesson: the registry itself never runs a build service; **the developer's free public-repo CI does the building**, and the Library verifies the pinned result. Zero registry-side compute cost.

**Fold-in verdict:** ADOPT — for SynthHub v2: submissions carry a manifest + a **CI-verified validation run** (schema/licence/hash/witness) executed on the contributor's public repo (GitHub Actions free for public repos) or on ours for the curated tier; never require our server to execute foreign content. Home: P2 pipeline.

---

### 8. Native Instruments User Library (Reaktor et al.) — the legacy hosted-library lesson

Link(s): https://community.native-instruments.com/discussion/51584/the-new-user-library-is-here · https://www.native-instruments.com/pages/user-libraries · https://community.native-instruments.com/discussion/49368/reaktor-user-library-unavailable · https://www.reddit.com/r/reaktor/comments/1vn3ff8/user_library_synths_repository/

**Core contribution:** A 20+ year user-content library (~4,000 Reaktor ensembles) that had to be re-platformed — with concrete evidence of link-rot, download outages and community workarounds (bulk-grab repos). The cautionary tale for any hosted registry without export/mirrors.

**KEY FACTS:**
- "The new User Library is here": unified space with search by developer/product, **comments, ratings, dedicated Most Downloaded and Top Rated tabs**; expanded beyond Reaktor to Kontakt/Guitar Rig/Absynth, "everything from the original library and archives has been fully migrated"; NI says it will "regularly feature" standout creations.
- Real-world friction, 2026: threads "Reaktor user library unavailable", "certain Reaktor .ens downloads are currently down" (staff acknowledged), Reddit reports of the library vanishing during a site migration (InMusic era) + community bulk-archival ("I grabbed the entire library using a github repo").
- Model: account-gated downloads, no licence plumbing beyond comments/ratings; content is freeware by convention, not by explicit per-item licence metadata.

**Fold-in verdict:** REFERENCE — steal ratings/download tabs and featured rotation (cheap P2 UX), but the operating lesson is ours already (E3 #18): **every registry item must be exportable + mirrored** (pack JSON + zip mirrored on moddys.net / R2, not only on GitHub); link-rot on a 20-year library is what happens otherwise. Home: P2 governance.

---

### 9. Elektronauts / Discourse — forum patterns (moderation by trust levels, files section, reciprocal feedback)

Link(s): https://www.elektronauts.com/faq · https://www.elektronauts.com/t/whats-with-the-new-user-trust-level-restrictions/43811 · https://elektronstaging.discoursehosting.net/t/place-for-uploading-patches-samples-templates/208076 · https://elektronstaging.discoursehosting.net/t/community-feedback-follow/83850 · https://meta.discourse.org/t/how-to-engage-new-users/265549

**Core contribution:** How a large gear community actually runs community ops: Discourse **trust levels** as the anti-spam/anti-abuse mechanism, a taggable Files section for patch/sample/template uploads, and ritual threads that make feedback reciprocal.

**KEY FACTS:**
- Elektronauts runs on Discourse (open-source forum, self-hostable, chat optional); its FAQ norms: browse before posting, use likes/flags instead of "+1", moderators "reserve the right to remove any content and any user account for any reason".
- **Trust levels** are the gate: new users can't download in some sections, are limited to ~1 image upload / ~3 posts-per-thread until promoted; the stated purpose is "sandboxing new users" so they "cannot accidentally hurt themselves, or other users"; levels rise automatically with reading/participation (and via the community). Confirmed by members in-thread — some friction is deliberate.
- Files pipeline: users share patches/samples/templates via a **Files/Media section with tags** (people asked for custom tags; not available — an editable tag taxonomy is a known gap we can fix).
- Ritual worth copying: "Community Feedback & Follow" — **"For every song you post, provide critical feedback to three other people"** (written norm, not enforced), explicitly designed so newcomers get listened to.

**Fold-in verdict:** ADOPT — don't build a social feed: stand up/maintain a Discourse (or equivalent) and use it as the comments/report/moderation surface for P2; adopt a **reciprocal-feedback ritual** and a fixed tag taxonomy for community uploads; steal trust-level *ideas* (rate-limit new-account publishing) without Discourse's download-lockout friction. Home: P2 community ops.

---

### 10. Share mechanics: dittytoy-style sound-state links, preset formats, QR and embed

Link(s): local `T0-tab-digest.md` §2–4 (dittytoy platform anatomy; raw captures in `research/tabs/raw/`) · https://dittytoy.net · suite format decisions: `ULTIMATE-PLAN.md` D1/B6 · PF store tech: `anchor 05-sound-pack-pipeline.md` · QR capacity: https://qr.technology/learn/qr-code-capacity/ + https://github.com/nayuki/QR-Code-generator + https://registry.npmjs.org/qrcode · moddys.net header probe (this session)

**Core contribution:** The zero-backend sharing layer: encode a *sound state* in a link (dittytoy proves it at 44.1 kHz with live sliders in the URL hash), plus the file formats that make the same state durable, plus how QR/embeds fit around that.

**KEY FACTS:**
- **dittytoy model (T0):** declared live params become UI sliders and ride in the **URL hash** (`#tune=-16,pattern=1,cutoff=.26,…`); "Sharing a *sound state* = sharing a link"; fork/remix buttons, likes, comments, browse-newest. License on ditties: CC BY-NC-SA 4.0 → techniques re-implemented clean-room only.
- **Formats (suite plan, already decided):** `.pfsynth.json` presets + `.wt`/`vawt` wavetables + `.scl`/`.kbm` tunings are canonical; Vital door = read `.vital` (pure JSON/ZIP; extract base64 wavetables), write `.vitaltable` + `clm ` chunk annotation; **suite-bank wrapper** (`.osb`-inspired single-file zip: presets + wavetables + manifest) for distribution; store tech: pack zip (stored audio + deflated JSON), `manifest.json` with per-file sha256, content-addressed file names, immutable caching (annex 05).
- **QR (the math):** QR byte mode holds max **2,953 bytes at version 40 / ECC L** (177×177 modules; 4,296 alphanumeric, 7,089 numeric at v40-L); **practical advice: keep URLs under ~100 chars** so phones scan them at small sizes. A synth patch JSON will exceed QR capacity — QR must encode a *short share URL*, never the patch. `qrcode` npm lib is MIT.
- **Embed reality check (probed):** moddys.net serves `/forge/index.html` with `X-Frame-Options: DENY` and `frame-ancestors 'none'` → the app cannot be iframed by third parties today. If embed is wanted (threads, blogs, itch-style pages), a dedicated `/forge/view/<id>` **player page** would need its own permissive frame headers (".htaccess" per-directory), rendering a shared pattern in read-only mode; the full studio stays un-embeddable. Deep links ("open patch in Forge") follow D4's cross-app verbs.
- Share-link design choice: short ids served from a static share page (`/forge/s/<id>.json` + viewer) scale better than giant hash URLs; hash-only links are the fallback for purely local/offline sharing (file export remains the canonical transfer, per spine).

**Fold-in verdict:** ADOPT — ship P0 with (a) patch-state JSON export/import, (b) copy-link share using a compact hash for local-only states and a static short-id share page once a host exists, (c) QR codes that encode only the short URL, (d) a read-only viewer page if embeds are wanted. The patch JSON defined here is the *same document* the P3 CRDT will sync — define it once. Home: P0 (core), P2 (viewer/embeds).

---

### 11. Pure local-first (no accounts) — IndexedDB profiles + file/URL sharing

Link(s): `annex 05-sound-pack-pipeline.md` (IDB/quota/file:// facts) · `ULTIMATE-PLAN.md` A4.1/D4 · E3 #6 (Cardinal: no phone-home) · E3 #11 (stable IDs)

**Core contribution:** The floor option: the synth works fully offline with per-user profiles stored in the browser and sharing done by files/links — zero servers, zero accounts, zero privacy surface. This is the baseline every phase must degrade to gracefully.

**KEY FACTS (measured on the PF host, annex 05):**
- IndexedDB works from `file://` in Chromium (write/read verified; quota reported 10,240 MB; `persisted:false`), but **Firefox blocks localStorage and IndexedDB on `file://`** → profiles must also work from RAM-only sessions with clear UI labels; Chromium = 60% of disk per origin; private mode ≈ nothing.
- OPFS `getDirectory()` throws `SecurityError` on `file://` — don't build on OPFS; `blob:` fetch works from `file://` (verified) so local packs/patches load; `crypto.subtle.digest('SHA-256')` available on `file://` (secure context) for hash verification.
- Export/import: the canonical artefacts are already files (patch JSON, `.wt`, zipped bank); a profile = a JSON manifest + IDB blobs, exportable as one zip; stable IDs come from content hashes (sha256) per the store schema.
- Privacy posture: no phone-home (Cardinal model, E3 #6); network is enrichment only (D4), which makes "no accounts" a *feature*, not a missing capability.

**Fold-in verdict:** ADOPT — this is P0 and the permanent fallback: profiles in IDB, export/import as files, share via link or file; every later cloud feature must be optional and reversible to this state. Home: P0 core.

---

### 12. Real-time collab tech: WebRTC data channels + Yjs / Automerge CRDTs

Link(s): https://github.com/yjs/y-webrtc · https://github.com/yjs/yjs/blob/main/README.md · https://beta.yjs.dev/ · https://automerge.org/ · https://github.com/automerge/automerge · https://github.com/automerge/automerge-repo-sync-server · https://unpkg.com/@automerge/automerge-repo@1.1.1/README.md

**Core contribution:** The two mature local-first sync stacks that make *shared patch state* a small project instead of a server product: Yjs (fastest CRDT, MIT, big provider ecosystem) and Automerge (MIT, "version control for your data", ships a sync server + IndexedDB storage).

**KEY FACTS:**
- **Yjs:** MIT; exposes shared types (Map/Array with CRDT merge); providers = `y-webrtc` (P2P, encrypted-over-untrusted-signaling via optional password; needs signaling servers — defaults are public instances; **caps at ~20 + rand(15) peers per document** because each peer connects to each other), `y-websocket` (needs a Node/other server; Hocuspocus is a maintained standalone server with SQLite persistence/auth; PartyKit a managed option), plus `y-indexeddb` for offline persistence; "in most cases use a network provider + a persistence provider".
- **Automerge:** MIT; JS + Rust implementations; "Automerge Repo" wrapper with pluggable network (websocket, BroadcastChannel) and storage (IndexedDB, nodefs) adapters; **automerge-repo-sync-server** is a small open-source Express/websocket server you can self-host (unsecured demo-grade, "reasonable way to run a public sync server"); per-doc URLs (`repo.create()` → URL) make sharing a doc id natural.
- Implications for us: sync **patch JSON as a CRDT document** (maps/arrays of params, a couple hundred floats + routing list) — tiny payloads, perfect fit; presence/cursors for "who's touching which knob" come nearly free (awareness protocol). Audio never crosses the wire (spine + physics, entry 13).

**Fold-in verdict:** ADOPT for P3 — Yjs + `y-webrtc` (password-encrypted rooms) with `y-indexeddb` persistence, matching P0's patch-JSON schema; a tiny VPS-hosted signaling/relay (or PartyKit) only if public signaling proves flaky. Automerge = the fallback if we ever want heavy version-history/branch UX. Home: P3 architecture.

---

### 13. Online-jam prior art: Ninjam/Jamtaba, Jamulus, Sonobus, Endlesss, BandLab live — the latency physics verdict

Link(s): https://news.ycombinator.com/item?id=31018600 (Jamulus/Sonobus/Ninjam mechanics; jammr shutdown note) · https://github.com/elieserdejesus/JamTaba · https://www.elektronauts.com/t/jamming-online-in-different-place-all-over-the-world-ninjam-jamtaba-koord-alternative/147820 · https://endlesss.fm/ · https://musictech.com/news/gear/tim-exile-endlesss-app-shut-down · https://jammr.net/

**Core contribution:** Two decades of attempts at real-time online music-making, and the honest verdict on what latency permits: either you *distort time* (Ninjam: play a bar behind), accept physical latency (Jamulus/Sonobus, in-city only), or you make it **loop-based / async** (Endlesss, BandLab). Also: the graveyard is full of server-dependent ventures.

**KEY FACTS:**
- **Ninjam/Jamtaba:** interval-based sync — your signal is deliberately delayed by a musical amount (e.g., 4 bars) before others hear it; HN: "not everyone can get used to the idea of playing one bar behind everybody else… it prevents rhythmic development and severely limits improvisation. For static beats and repetitive harmony it works great." Jamtaba (open-source, VST/AU/standalone) is the friendliest client.
- **Jamulus** (federated client-server) / **Sonobus** (P2P, free software): "work very well, at least as well as physics allow… close cities and even close countries are usually painless, as long as everyone's on Ethernet" — i.e. practical for LAN/metro, poor intercontinental. Sonobus is GPL — reference only per our rulebook.
- **jammr:** shut down; its farewell page points users to Jamtaba/NINJAM clients. **Endlesss:** shut down May 31 2024 (servers closed; users told to export stems) — **revived in 2026 by HabLab London (Imogen Heap's org)**, "bring the Endlesss core app back online", seeking sustainability, explicitly "not our business model to sell your data or your music".
- **BandLab:** real-time "Live Session" collaboration works (invite-based, max 50 collaborators) but is one feature of a 100M-user platform with a standing server budget; a small shop can't carry that for audio streams.
- Verdict for Anvil: **live audio jamming is out of scope** (spine: audio never uploaded; economics: server streams; physics: intercontinental latency). Feasible and cheap: **shared patch design sessions** (control-state CRDT, no audio), async remix via files/links, and — if ever wanted — local-network experiments.

**Fold-in verdict:** SKIP live-audio collaboration; REFERENCE the mechanics catalog. The Endlesss saga adds a P3 rule: any collab feature must export to files and survive the server dying (which P0's file format guarantees for free). Home: P3 scope guard.

---

### 14. Supabase — hosted Postgres+auth+storage+realtime (fastest path, pause trap)

Link(s): https://supabase.com/pricing · https://supabase.com/docs/guides/platform/free-project-pausing · https://whichdevtool.com/tools/supabase · https://www.activepieces.com/blog/supabase-pricing-free-tier-limits-pro-costs-egress

**Core contribution:** The most convenient batteries-included backend for P1: Postgres + Auth + Storage + Edge Functions + Realtime in one project, open-source and self-hostable (exit story), generous MAU — with one notorious free-tier trap (inactivity pause).

**KEY FACTS (as of late-2026 checks):**
- Free: 2 active projects, 500 MB database, 1 GB file storage, 5 GB egress/month, **50,000 MAU**, 500k edge-function invocations, 200 concurrent realtime connections; **projects pause after 7 days of inactivity** (warning email ~1 week ahead; restore within 1 year; ~30 s wake on resume); no automatic backups.
- Pro $25/mo/org: 8 GB disk, 250 GB egress, 100 GB storage, 100k MAU, daily backups; the pause is a paid-plan removal, not a bug.
- Forums/aggregators (matching docs) note "a few user requests to the database each day" staves off pausing — but any dead zone still means a cold start for the next visitor.
- Fit notes: EU regions available; per-item auth + row-level security match "accounts optional"; Postgres + `pg_dump` = clean exit; self-host stack is heavy (8 containers) if you ever leave.

**Fold-in verdict:** REFERENCE — viable P1 *fallback* if speed beats fit (auth out of the box), but the pause trap is unacceptable for a music tool people touch weekly at best; if chosen, add a keep-warm ping AND budget the $25/mo upgrade honestly, or plan the Cloudflare migration. Home: P1 option B.

---

### 15. Firebase — Spark plan (generous quotas, hard shut-off, Google gravity)

Link(s): https://firebase.google.com/pricing · https://firebase.google.com/docs/firestore/quotas · https://firebase.google.com/docs/database/usage/limits · https://firebase.google.com/docs/auth/limits · https://cloud.google.com/identity-platform/pricing · comparison: https://aiagencyplus.com/supabase-free-tier-limits/

**Core contribution:** The other classic free backend; useful here mainly as a priced contrast and a reminder of quota-shutoff semantics.

**KEY FACTS:**
- Spark (free): Firestore — 1 GiB stored, 50k document reads/day, 20k writes/day, 20k deletes/day, 10 GiB/mo egress; Realtime Database — 1 GB stored, ~10 GB/mo downloads, **100 simultaneous connections** on Spark (200k on Blaze); Cloud Storage — 5 GB, 1 GB/day downloads; Cloud Functions has a small no-cost tier then needs Blaze.
- If you exceed a Spark quota, "your project's usage of that specific product will be shut off for the remainder of that month" — no graceful pay-go option without attaching billing (Blaze).
- Auth: email/anonymous sign-in services are no-cost (Identity Platform Tier 1: 0–50k MAU $0.00; then $0.0055/MAU); phone auth SMS is **Blaze-only** and billed per SMS. Email-send quotas on Spark: ~150 password-reset emails/day, 5 email-link sign-ins/day — the low email-link cap is a real trap for magic-link designs.
- Exit: Firestore exports exist but are GCP-bound; no plain SQL; vendor gravity is the point.

**Fold-in verdict:** SKIP as primary (lock-in + monthly shutoff + no relational export don't fit the spine's portability demand); keep as a reference point only. If ever used: Firestore for ephemeral room state, never as the registry of record. Home: P1 rejected options.

---

### 16. Cloudflare Workers + D1 + R2 + KV (+ Pages) — the fit winner if a server is needed

Link(s): https://developers.cloudflare.com/workers/platform/limits/ · https://developers.cloudflare.com/workers/platform/pricing/ · https://developers.cloudflare.com/d1/platform/pricing/ · https://developers.cloudflare.com/kv/platform/limits/ · https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/ · https://developers.cloudflare.com/pages/platform/limits/ · https://developers.cloudflare.com/pages/functions/pricing/ · https://www.cloudflare.com/plans/

**Core contribution:** A free-tier server stack with the right properties for us: no inactivity pause, CORS-friendly APIs for a static site, zero-egress object storage (R2), SQL (D1) for a registry, KV for share documents, static assets served free/unlimited, and Durable Objects free tier for rooms.

**KEY FACTS:**
- **Workers free:** 100,000 requests/day (error 1027 when exceeded, resets midnight UTC); 10 ms CPU/invocation; up to 100 Workers; static-asset requests free & unlimited (individual asset ≤25 MiB).
- **KV free:** 100k reads/day, 1k writes/day, 1 GB storage, values ≤25 MiB.
- **D1 free:** 5 GB storage total, **5M rows read/day, 100k rows written/day** — and since 2026-09-01 these daily limits are *enforced* (queries error out until reset; email alerts). Paid: first 25 Bn rows read + 50 M rows written/month included, $5/mo Workers Paid.
- **R2 free:** 10 GB-month storage, 1 M Class A + 10 M Class B ops/month, **egress free** — ideal for pack/sound mirror with no bandwidth bill.
- **Pages free:** unlimited sites, seats, requests, bandwidth; 500 builds/month; 100 custom domains/project — a ready host for the synth + share/viewer pages if moddys.net ever moves or a CDN edge copy is wanted. Pages Functions requests share the 100k/day Workers quota.
- **Durable Objects free tier exists** (100k requests/day, 13k GB-s/day, SQL 50M rows read/100k written/day, 5 GB) — a natural fit for P3 presence/rooms if we want a first-party alternative to public Yjs signaling.
- Compliance/exit: plain SQL + object storage you can mirror; no pause semantics anywhere; limits fail "closed but recoverable" at midnight UTC.

**Fold-in verdict:** ADOPT — recommended P1/P2 backend: Workers (API) + D1 (accounts/ratings/search index) + R2 (pack/content mirror, zero egress) + KV or static JSON (share documents/index), all inside free tiers at our expected scale; upgrade is a single $5/mo Workers Paid step, not a $25 plan. Home: P1/P2 architecture.

---

### 17. PocketBase (VPS) vs PHP+SQLite (shared hosting) — the self-hosted lane

Link(s): https://pocketbase.io/faq/ · https://pocketbase.io/docs/going-to-production/ · https://github.com/pocketbase/pocketbase → license MIT · https://selfhostatlas.com/deploy/deploy-pocketbase-on-a-vps · https://docs.cpanel.net/knowledge-base/general-systems-administration/cpanel-php/ · https://www.siteground.com/kb/is_sqlite_supported · https://www.php.net/manual/en/ref.pdo-sqlite.php

**Core contribution:** Two ways to own the backend outright: one file on a $4–5 VPS (PocketBase), or nothing new at all if moddys.net's Apache can run PHP+SQLite. Both keep data in a single portable file — the strongest exit story on this list.

**KEY FACTS:**
- **PocketBase:** MIT; "open source backend in 1 file" — SQLite (WAL) + auth + file storage + realtime subscriptions (SSE) + admin dashboard; deploy = upload one binary, `pocketbase serve yourdomain.com` (built-in Let's Encrypt); "easily serve 10,000+ persistent realtime connections on a cheap $4 Hetzner CAX11 VPS (2vCPU, 4GB)"; needs a persistent host with binary execution (shared hosting can't run it); backup = copy `pb_data` (+ Litestream for streaming); 512 MB RAM minimum, ~30 MB idle.
- **PHP+SQLite on shared hosting:** cPanel's default PHP 8.4 package includes `pdo_sqlite`/`sqlite3` (cPanel docs list both); SiteGround: "SQLite and PDO_SQLite are supported on all of our servers"; some other hosts require enabling the extension in PHP Selector — so the assumption is "usually available, must be verified per host". PHP can serve a working REST API + auth for a registry this size; no realtime beyond polling/SSE hacks.
- **Our host:** moddys.net is Apache behind a rate-limit layer (probe, §0) — PHP capability **unknown-until-verified** (a single `phpinfo`-style probe file, to be placed by the owner/deploy path, answers it; read-only research did not test). If PHP exists, the P1/P2 API can live on the existing host at $0 incremental; if not, PocketBase on a VPS is the owned alternative at ~$4–6/mo.
- Trade-off: PocketBase gives realtime + admin UI + file storage for a few dollars but adds server-ops duty (systemd, TLS, updates, offsite backups — PocketBase stores settings incl. SMTP creds in the DB as plain JSON per its own docs, so treat `pb_data` as sensitive). PHP/SQLite is $0 but hand-rolled and static-host-grade (no SSE-first realtime, careful file-lock handling).

**Fold-in verdict:** ADOPT-conditional — recommend **PHP+SQLite as the $0 option only after a capability probe** (else Cloudflare per entry 16); recommend **PocketBase on a ~$5/mo VPS** as the "owner owns everything" lane if/when a dynamic component (P2 search/ratings, P3 signaling) justifies ops time. Home: P1/P2 option C.

---

### 18. GitHub-as-backend + jsDelivr — repo of pack JSONs, issues/PRs as the submission queue, accounts = GitHub

Link(s): https://docs.github.com/en/billing/concepts/product-billing/github-actions · https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits · https://docs.github.com/en/actions/reference/limits · https://github.com/jsdelivr/jsdelivr (README + Terms of Use) · https://www.jsdelivr.com/about

**Core contribution:** A $0 "backend" for exactly the SynthHub v2 shape: the registry is a public repo of manifests; submissions arrive as PRs/issue forms (GitHub accounts = the account system); free public-repo Actions run the validation (schema/licence/sha256/witness); jsDelivr serves the repo to the web as a production CDN with no bandwidth bill.

**KEY FACTS:**
- **GitHub free:** unlimited public repos/collaborators; **Actions minutes free & unlimited on public repos** (private: 2,000 min/mo free); repo guidance: on-disk ≤10 GB recommended, ≤3,000 entries/dir, ≤50 depth, ≤5,000 branches, ~15 reads/sec & 6 pushes/min recommended ceilings (fine for a manifest registry); anonymous API 60 req/hr (use jsDelivr/CDN for reads, not raw API).
- **jsDelivr:** free "for both personal and commercial use", "no limits on bandwidth or number of requests" (as long as you follow its rules); GitHub proxy soft limits: ~10,000 actively-accessed files per repo (100k files/repo ceiling), single file default max **20 MB** (GitHub-side), packages >150 MB unsupported; multi-CDN (Cloudflare+Fastly) with S3 origin backup; **"We do not guarantee … will always be available or uninterrupted"** (no warranty) — treat as cache, not as sole home.
- Submission flow that works with zero infrastructure: issue form (structured fields) → maintainer triage OR PR against `registry/<id>.json` → CI job validates (JSON schema, licence allowlist, sha256 re-hash of the referenced zip, engine-witness log) → merge = listing; malicious-content discipline from E3 #17/#18: no executable content, pinned hashes, review of every diff, human approval on the *curated* tier.
- Accounts caveat: "accounts = GitHub" excludes non-developer musicians (BandLab's audience); acceptable for a contributor-flavoured P2 *if* P0/P1 keep account-free paths for players.

**Fold-in verdict:** ADOPT — make this the P2 registry substrate: public repo as source of truth + CI validation + jsDelivr for serving + periodic mirror of the rendered index (and every pack zip we host) onto moddys.net/R2 for exit and its no-warranty gap. Never the only copy (E3 #18). Home: P2.

---

## S1. Tech options — scored (the decision table)

| Option | Cost/mo | Effort (est. days) | Capabilities | Fairness-spine fit | Portability / exit |
|---|---|---|---|---|---|
| Pure local-first (entry 11) | $0 | 4–7 (P0 build) | profiles, file/URL sharing, no discovery | ●●● perfect (no accounts, no uploads) | ●●● files + JSON |
| GitHub-as-backend + jsDelivr (18) | $0 | 5–10 | registry, submissions, CDN serving, CI validation; accounts = GitHub | ●●○ public data only; no metering; GitHub TOS caveat | ●●○ raw files yours; mirror needed (no-warranty) |
| Cloudflare Workers/D1/R2/KV (16) | $0 → $5 (Workers Paid) | 7–14 | API, SQL registry, object storage, rooms/presence, static hosting | ●●● no pause, no meters, egress-free, EU/edge | ●●● SQL export + R2 mirror |
| PHP+SQLite on moddys.net (17) | $0 (if PHP exists — unverified) | 5–15 | hand-rolled API/auth/ratings on existing host | ●●○ fine but hand-rolled; no realtime | ●●● single SQLite file |
| PocketBase on VPS (17) | ~$4–6 (Hetzner CAX11 class) | 2–4 deploy + ops | auth, files, realtime SSE, admin UI, all-in-one | ●●● self-owned, MIT, no third party | ●●● one directory (`pb_data`) |
| Supabase free (14) | $0 → $25 Pro | 3–7 | auth, Postgres, storage, realtime, fastest MVP | ●○○ pause trap; data leaves device to a vendor | ●●○ pg_dump; self-host is heavy |
| Firebase Spark (15) | $0 → Blaze | 3–7 | auth, Firestore/RTDB, storage | ●○○ quota shutoff; lock-in; email-link caps | ●○○ GCP-bound |

Ratings are judgments from the entries above; cost figures are the vendors' own published numbers checked 2026-10-06. Effort = build days estimate for our scope (a registry + optional accounts), not vendor onboarding time.

## S2. Community content pipeline (research item e) — the P2 design

Goal: submission → validation → listing in SynthHub v2, with moderation and feedback, at $0 server cost and exportable forever.

1. **Submission (two lanes).** Lane A "curated": structured GitHub issue form or PR against `registry/` (entry 18) — required fields: stable id (slug), title, author/credit string, licence (from allowlist), source URL, sha256 of the artefact(s), engine/protocol version target, witness artifact. Lane B "drop-in": pack uploaded to our own store pipeline (annex 05 schema: `index.json` + `*.pfsound.zip` content-addressed, immutable) — same manifest fields.
2. **Validation (the suite's own tiers, executed for free).** Tier A static: JSON-schema + range + naming + licence lint (CC0/PD preferred; CC-BY allowed with manifest; NC/ND and unlicensed = rejected; plan §5 rulebook). Tier B: sha256 recompute + engine-witness (headless render → level/spectral sanity; PF's apply→play→tap pattern) run in public-repo CI (GitHub Actions free for public repos, entry 18) or locally by the owner. Tier C: owner's live pass for the curated tier. Nothing lists without Tier A+B; curated badge requires C.
3. **Listing.** Render to `index.json` (static, no-backend) served from moddys.net + jsDelivr CDN copy (entry 16/18); optional D1 mirror only if dynamic search/ratings is wanted (entry 16). Every item ships manifest + provenance and stays mirrored (Reaktor lesson, entry 8; Atom lesson, E3 #18).
4. **Moderation basics.** Two visible tiers (Verified / Unverified) — VCV's curation rules adapted: no malware, no IP misuse, no unlicensed content (E3 #5); human review before merge for Verified; report button on every listing; takedown policy in writing; rate-limit new-account publishing (Discourse trust-level idea, entry 9); no executable content, ever (Obsidian lesson, E3 #17); diff-review every registry change.
5. **Ratings & comments — minimal scope.** Copy NI's cheap wins (downloads counter + likes + Top Rated/Most Downloaded tabs, entry 8) and **do not build a comment system**: link each item to a forum thread (VCV one-thread-per-plugin pattern, E3 #5; community lives on a Discourse, entry 9). This keeps moderation in one place and the store read-only/static.
6. **Governance.** CC0-first policy from plan B6: immutability (content-addressed files, versions are new files), credit-in-filename idiom, provenance manifest required, "third-party" section conventions; publishing = licence grant recorded in the PR (BandLab fork-opt-in semantics, entry 2); the whole registry exportable as one archive.

## S3. Phase table — P0 → P3

| Phase | Capability | Tech recommendation | Cost | Effort (est.) | Risks |
|---|---|---|---|---|---|
| **P0 — Local profiles + share links + file I/O** | Per-user profiles (IDB), patch/pack export-import (`.pfsynth.json`/bank zip), copy-link share (compact hash for local states), QR of short URLs, offline-first everything; define the patch JSON once (becomes the P3 CRDT doc) | Pure local-first (entry 11) + share mechanics (entry 10); no server | $0 | 4–7 days | Long-hash URLs vs share-page design; Firefox `file://` IDB block (RAM fallback + honest UI); QR must encode URLs not state (math, entry 10) |
| **P1 — Cloud accounts + libraries (optional)** | Optional account (email magic-link or passkey), personal cloud library of patches/packs, cross-device sync of *patch JSON only* (never audio), share pages with short ids + viewer | **Primary: Cloudflare Workers+D1+R2** (entry 16; no pause, free egress, $5 upgrade step). Fallback: Supabase free for auth speed (entry 14) with keep-warm ping + planned migration | $0 in free tier; $5/mo if Workers paid needed; $25/mo only on the Supabase path | 10–15 days (CF) / 6–10 (Supabase) | Auth UX/privacy stance drift; D1 row-write limits (100k/day) if sync is chatty — batch writes; keep local-first default (accounts optional, export always) |
| **P2 — Community store + registry (SynthHub v2)** | Submission pipeline (issue form/PR + drop-in lane), CI validation (schema/licence/sha256/engine-witness), static index + CDN mirror, Verified/Unverified tiers, downloads/likes, forum-linked comments, QR/embed viewer page | GitHub-as-backend + jsDelivr (entry 18) + static store schema (annex 05) + optional D1 search mirror; forum: Discourse (entry 9) | $0 (public repo + jsDelivr); moderation labour only; R2 mirror ≤10 GB free (entry 16) | 15–25 days | GitHub non-dev friction (accept for contributors; players stay account-free); moderation load; licence laundering (allowlist + provenance); link-rot → mirror everything (entry 8) |
| **P3 — Collab (patch-design sessions)** | Shared live patch design: 2–4 people in a room editing the same patch state (CRDT), presence/cursors, room links; async remix already covered by P0/P2 files; **no live audio** | Yjs + y-webrtc (password-encrypted rooms) with y-indexeddb persistence (entry 12); signaling on public instances first, move to a ~$5 VPS (or Durable Objects, entry 16) if flaky | $0 with public signaling (unreliable); $5/mo VPS for owned signaling; PartyKit free tier as managed alt | 10–20 days | Sync edge cases (undo/awareness); room auth/abuse; expectation-setting ("collab ≠ online jam" — entry 13); server-dependent collab dies like Endlesss unless files remain canonical (entry 13) |

## S4. Final recommendation

**"Local-first, thin, portable server" — build the phases in order, and never let any phase break P0.**

1. **P0 now ($0):** profiles + file I/O + link sharing + QR. This is also the future collab document format — one schema, three consumers (share, store, sync).
2. **P1 when wanted, Cloudflare-first:** Workers + D1 + R2 + KV inside free tiers; accounts optional, syncs patch JSON only (audio never leaves the device — the spine and the business model), and every artefact remains exportable to P0 files. Supabase is acceptable only as a fast MVP with eyes open to the pause/upgrade economics.
3. **P2 as a GitHub+jsDelivr registry:** the only "community backend" needed at this scale is a public repo + free CI + a CDN; add D1 search or PocketBase only when data proves the need. The differentiator vs every precedent researched: **validation is generous and automatic (schema/licence/hash/witness), governance is CC0-first and transparent, and everything is mirrored** — the anti-fragile version of VCV/Patchstorage.
4. **P3 collab = patch-design sessions, not audio:** Yjs rooms sync control state; physics and the spine rule live audio out. Endlesss' shutdown→rescue arc is the cautionary tale: our collab survives its own servers because files are canonical.
5. **Costs stay near $0** through P2 at expected volumes; the only realistic spends are a $4–6/mo VPS (P3 signaling / PocketBase lane) and moderation time. This preserves the A4 doctrine (one-time pricing, no metering) — infrastructure that can't bill users can't tempt us to.

## S5. Owner decisions requested

1. **Account stance:** none / optional-cloud / required for community — recommend optional-cloud only (P1 onwards), with anonymous local use always full-featured.
2. **Identity for P1 accounts:** email magic-link, passkey, or GitHub OAuth (GitHub = zero build but excludes non-devs) — recommend email magic-link primary + GitHub as contributor convenience.
3. **P1 backend pick:** Cloudflare (recommended, fit) vs Supabase free (faster MVP, pause trap) — the choice determines ~$0 vs ~$25/mo at the pause-avoidance step.
4. **Data policy:** what may leave the device — recommend: patch JSON, pack manifests, licence/credit strings, pseudonymous counters. Never: audio, user files, any metering data.
5. **Registry governance:** licence allowlist enforcement (CC0/PD + CC-BY with manifest; reject NC/ND/unlicensed), Verified vs Unverified tiers, and who moderates — recommend owner + Bob with a written takedown policy.
6. **Community monetization stance:** free/CC0-first for community content; paid "Signature" collections stay first-party (A4.3) — confirm no community marketplace payments in v1.
7. **moddys.net capability probe:** run the one-file PHP/`pdo_sqlite` check before committing to either the PHP lane or Cloudflare (assumption currently unverified; entry 17).
8. **P3 scope + budget ceiling:** confirm "patch-design rooms only (no live audio)" and approve a ~$5/mo VPS if/when owned signaling or PocketBase is wanted, or keep everything free-tier.
9. **Embed stance:** do we want third-party iframes of a read-only viewer (requires relaxing frame headers on a `/view/` path only, probe §0), or links-only sharing? Recommend viewer+embed at P2, studio never framed.

## Dead ends

- `patchstorage.com/docs/api/beta/` first extract attempt: keyless extract backend returned HTTP 429 (rate limit) — retried once and succeeded; no data lost.
- `patchstorage.com/faq/` and `patchstorage.com/about/` are **not static pages** — both resolved to unrelated patch detail pages ("FAQ - Voltage Therory", "About Phase"); Patchstorage moderation policy is not published on the pages read → omitted rather than guessed.
- Audiotool pricing/FAQ pages not directly loaded (product/collaborate/online-daw/compare/terms snippets used instead); the third-party "€6/mo Premium" claim remains **unverified** and is labelled as such.
- `userlibrary.native-instruments.com` not fetched directly; used the NI community announcement thread + NI pages + user reports (download outages stated by NI staff in-thread).
- Splice individual creator payout rates: not published anywhere official — Reddit anecdotes only ("no set rate"; "60/40 or 50/50 typical") → kept as anecdote, not fact.
- Loopcloud creator-revenue-share terms: not found within the attempt budget → omitted.
- Firebase Auth Spark specifics for email/password vs Identity Platform pricing: the pricing page defers to "Other Authentication services" → used Identity Platform tier table (0–50k MAU = $0) + Auth limits page (email-send caps) instead.
- moddys.net PHP/DB capability: not probed (read-only task forbids writing a probe file) → flagged as an owner verification item (S5 #7).

---

```json
{"file": "C:\\Users\\Moddy\\anvil\\research\\multiuser\\T6-multi-user-architecture.md", "items_count": 18, "dead_ends": ["patchstorage.com/docs/api/beta first fetch HTTP 429 (retried, recovered)", "patchstorage.com/faq and /about are not static pages (resolved to patch detail pages)", "Audiotool paid-tier details unverified (third-party €6/mo claim only)", "NI userlibrary.native-instruments.com not fetched directly", "Splice per-creator payout rates not published (anecdotes only)", "Loopcloud creator revenue-share terms not found", "Firebase Auth email/password zero-cost specifics absent from pricing page", "moddys.net PHP/DB capability unverified (read-only task)"]}
```
