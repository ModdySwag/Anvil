# 05 — Spec review (readiness gate)

Date: 2026-10-06 · Reviewer: Bob (Hermes) · Scope: the full package — `00-idea-capture` → `04-agent-build-handoff` + the nine research evidence files.

## Verdict: **PASS** — decisions recorded (§2); build started (Phase 0, 2026-10-06).

## 1. Gate checklist

| Criterion | Status | Note |
|---|---|---|
| Product goal clear | ✓ | One-liner + acid-heart positioning; concept grounded in the seed tabs and the market gap (T0/T4). |
| UI expectations clear enough to avoid generic output | ✓ | 02 is build-checkable: 7 screens, interaction grammar, palettes with computed ratios, states, flair ranking, anti-patterns. |
| Requirements testable | ✓ | Percentages, thresholds, laws, and numerics throughout (aliasing dBc, LUFS targets, swing math, accent-memory test). |
| Unresolved product decisions | ⚠ | §2 items 1–6 (name, money, v1 stretch, backend, embed, phase order) — defaulted in docs so P0–P1 can start. |
| Unresolved technical decisions | ⚠ | §3 list (voice-count-from-benchmark, iPad cap, MP3 module licence call, Workers limits at scale) — all have defaults + verification steps. |
| Acceptance criteria concrete | ✓ | 01 §13 + 04 §6, all evidence-based. |
| Done-means specific | ✓ | Frozen artifact + suite logs + screenshots + witness reports + live-verify + owner pass. |
| Fresh agent could build without obvious questions | ✓ with §2/§3 handed over | 04 §7 kickoff prompt included. |
| Testing/verification included | ✓ | Battery, suites to port, protocol, deploy loop (03 §5, 04 §5). |
| Non-goals prevent scope creep | ✓ | 01 §11 + explicit v1.x deferrals (granular, sampler, MTS, 4-op FM, collab rooms). |

## 2. Decisions — recorded 2026-10-06

1. **Name: Anvil** ✓ — locked; docs use it throughout.
2. **Monetisation: free** ✓ — instrument, packs and features all free; no monetisation at launch (fairness spine).
3. **Granular + sampler: into v1** ✓ — re-scoped; phase plan revised (03 §6, 04 §4); effort updated to ≈10–14 part-time weeks.
4. **Phase order: delegated** ✓ — locked as written, with the shared sample/grain core folded into P2–P3.
5. **Keyboard + MIDI: full 61-key piano dock + full Web MIDI in/out in v1** ✓ — owner directive 2026-10-07 ("must have… all the bells and whistles"); PF-grade port (`app_kb` + `app_midi`), note bus first-class, MIDI learn on the knob framework.
6. **Still open (later-phase):** P1 backend green-light (default Cloudflare Workers+D1+R2), embed stance (default links-only), CC0-only community rule (default yes at P2), MP3 export module (default: WAV + Opus at launch; MP3 optional).
7. **GOLDEN BUILD mandate (2026-10-07, owner directive — "build until completion", HIGH LEVEL INDUSTRY STANDARD EVERYTHING).** Locked scope beyond P1, built in waves without further check-ins: STORE with add-on packs + extra modules/synth additions; a **CODE** section with full user interaction and user code creation (PF codegen lineage); **full walkthrough system + help menu**; the full Pattern Forge-grade keyboard incl. **POPOUT**; as many and varied sound-manipulation knobs/racks/modules as can be integrated (industry-standard interaction; creative/outlandish extras welcome); store + synth feature-packed with many user-configurable variations; sound packs / loops / drum packs / varied sound generation; full **playback + RECORDING** system with varied, useful file I/O; **one-press STEM EXPORT** (per-part WAV renders, DAW-ready for Ableton/FL) if feasible; professional **synth-deck display** with program readouts; seamless **drum-machine ↔ synth** mix-and-match. Agent has discretion on clinical decisions; every wave stays battery-gated (lab → battery → frozen bytes); the final wave = deploy + live verify + owner's real-surface pass.

## 3. Options needing verification (before the thing they gate)

1. **Voice-count claim** — publish only after the T5 §7 proof-benchmark runs locally (worklet ring, voice ramp, underrun counters). No marketing number before the measurement.
2. **iPad Safari voice cap + behaviour** — matrix test on real hardware; degraded-but-honest tier.
3. **`file://` fallback tier smoke** — ScriptProcessor latency/voice cap measured; the family single-file promise holds.
4. **Cloudflare Workers+D1+R2 at real scale** — row-write limits (100k/day) against sync chattiness; batch writes; re-test at P6.
5. **AKWF + WaveEdit + FreePats licence re-checks at authoring time** — quote the files again when packs are built (licences can move; T8 verified 2026-10-06).
6. **x0xb0x MIT claim** — independent re-check before any reuse beyond reference (parent fetch was blocked 403; child-verified only).
7. **Freeverb tuning constants + Faust libfaust licence discrepancy** — resolve before either enters code (T5 dead-ends).
8. **Serum 2 wavetable frame-size spec** — confirm from the official guide before any marketing-copy claim.
9. **Dattorro damping/bandwidth defaults** — verify against the paper before hardcoding (T5 §15 footnote).
10. **Roland50.studio asset stance** — recorded all-rights-reserved (behaviour reference only); no asset reuse regardless of how good the click sounds idea is (recreate our own).

## 4. Residual risks (accepted, tracked)

Browser CPU on older machines (two-tier design + measured caps mitigate); scope size (phased plan; P0–P1 are small and decisive); content hours (580 presets ≈ 190–580 h — compressed by STARTER method + generators, sequenced across phases); community layer needs moderation (deferred to P2 with governance rules); Safari's late features (honest tier).

## 5. Review notes on the evidence base

All nine evidence files verified by the parent where load-bearing: counts match self-reports; spot-checks passed (Open303 MIT raw licence ✓; npm dittytoy MIT ✓; moddys.net X-Frame-Options DENY ✓; Serum 2 page figures ✓). Dead-ends are logged in-file and honoured here. The one known-context correction (ditty cosmic shimmer rate) is patched in T0 with a corrections log. Two child-verified claims carry flags (§3 items 6, 9).

## 6. Next steps

1. Owner: decisions §2 (a reply of "1–8, here's what I pick" is enough) → then I freeze the docs and prepare Phase 0 kickoff + the first lab tasks.
2. Non-blocking: start Phase 0 (foundations) immediately if wanted — nothing in §2/§3 touches the build pipeline, tap, harness, or theme tokens.
3. First owner-visible milestone: P1's **measured voice count + first acid sound in the browser** (the demo moment).
