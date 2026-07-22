# Design System: AI Skin Analysis

> Single source of truth for the app's visual language. **Apple-grade dark mode with a champagne-gold
> accent** — one theme, no light/dark toggle. Where this contradicts the generic "premium landing page"
> playbook (asymmetric heroes, inline-image headlines, high visual variance, perpetual motion), the
> clinical + Apple reading wins — this is a medical utility clinicians and patients trust, not a
> marketing site.

## 0. Calibration

| Axis | Score | Reading | Why |
|------|-------|---------|-----|
| **Density** | 2 / 10 | Art-Gallery Airy | Apple defers to content; a medical result must breathe, never crowd. |
| **Variance** | 3 / 10 | Predictable, mostly symmetric | Trust comes from calm order. Centered layouts are *allowed here* (overrides the anti-centered-hero rule, which targets marketing sites). |
| **Motion** | 4 / 10 | Restrained → Fluid | Quiet spring transitions and deferential reveals. No perpetual loops on a clinical screen — motion must never compete with a "see a professional" alert. |

Apple's three principles govern every decision: **Clarity** (legibility, precise semantics),
**Deference** (UI recedes, content leads), **Depth** (subtle layering communicates hierarchy).

## 1. Visual Theme & Atmosphere

A hushed, dark, premium interface — near-black canvas, graphite cards floating on faint white hairlines,
and a single restrained gold reserved for what matters. Think a dim, luxurious exam suite at night:
warm-metal accents on cool graphite. The mood is **calm authority** — expensive without shouting.
Elevation reads through progressively lighter graphite surfaces and hairline edges, not heavy shadow.
Gold is *rationed*: it marks the primary action, the active state, the confidence a result carries —
never decoration. The most important thing on any screen (a result, a referral, a disclaimer) is always
the most *settled* element, never the loudest.

## 2. Color Palette & Roles

Layered graphite neutrals + one champagne-gold accent. No pure black, no neon, no gradient text.

**Surfaces & ink**
- **Canvas** `#0B0B0D` — App background. Near-black graphite, never pure `#000000`.
- **Surface** `#161619` — Cards, sheets, inputs. First elevation.
- **Surface Raised** `#1F1F23` — Higher elevation: selected segment, popovers, hover.
- **Ink** `#F5F5F7` — Primary text (Apple dark label). ~19:1 on canvas.
- **Ink Secondary** `#A1A1A6` — Descriptions, metadata, captions (~8:1).
- **Ink Tertiary** `#6E6E73` — Disabled, placeholder, faint hints.
- **Hairline** `rgba(255,255,255,0.10)` — 1px borders / dividers.
- **Hairline Strong** `rgba(255,255,255,0.16)` — Input borders, emphasis edges.

**Accent — Champagne Gold (single accent, saturation held low)**
- **Gold** `#C9A24B` — Primary fill: CTAs, progress fill, active tab thumb (~7.5:1 on canvas).
- **Gold Bright** `#E4C36B` — Gold *text/icons/focus ring* on dark, where fill needs more contrast (~10:1).
- **Gold Ink** `#141210` — Text/label *on* a gold fill (dark-on-gold buttons).
- **Gold Wash** `rgba(201,162,75,0.14)` — Faint fill for inactive pills, selected-row tint.

**Semantic (medical — accessibility-critical, never decorative)**
- **Urgent** text `#FF6B60`, surface `rgba(255,69,58,0.14)`, border `rgba(255,69,58,0.34)`
- **Soon** text `#FFA23A`, surface `rgba(255,159,64,0.14)`, border `rgba(255,159,64,0.32)`
- **Routine** text `#C7C7CC`, surface `rgba(255,255,255,0.05)`, border `rgba(255,255,255,0.12)`

All text/background pairs meet **WCAG AA** (≥ 4.5:1 body, ≥ 3:1 large). Gold and the amber "Soon" state
are held visually distinct (muted champagne vs. brighter orange). Urgency is *never* signaled by color
alone — always paired with a text label ("Urgent").

## 3. Typography Rules

Authentic Apple type = **San Francisco via the native system stack** — sharper and lighter than shipping
a webfont. (This dodges the "no Inter" rule by using SF, not by adding a generic sans.)

- **Sans (all UI + body):** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif`
- **Mono (numbers, confidence %, model IDs, timestamps):** `ui-monospace, "SF Mono", "SFMono-Regular", Menlo, monospace`
- **Serif:** none. Banned in this UI.

**Scale** (fluid via `clamp()`, hierarchy through *weight and color*, not size explosions):

| Token | Size | Weight | Tracking | Use |
|-------|------|--------|----------|-----|
| Display | `clamp(1.75rem, 4vw, 2.25rem)` | 700 | `-0.02em` | Screen title (one per view) |
| Title | `clamp(1.25rem, 2.5vw, 1.5rem)` | 600 | `-0.01em` | Result headline, section lead |
| Heading | `1.0625rem` | 600 | `-0.005em` | Card headers ("Top matches") |
| Body | `1rem` / 15px min | 400 | `0` | Prose, ≤ 65ch, relaxed leading |
| Caption | `0.8125rem` | 400/500 | `0` | Metadata, secondary ink |
| Mono-num | `0.875rem` | 500 | `0` | `tabular-nums` for all percentages |

Rules: one Display per screen · numbers always monospace + `tabular-nums` (confidence never jitters) ·
body capped at 65 characters · hierarchy by weight/color first, size last.

## 4. Component Stylings

- **Buttons.** Primary = **gold fill, gold-ink text**, `rounded-xl` (12px), no border, no glow. Secondary = surface-raised fill + hairline border, ink text. Tactile: `active:` scale `0.98` + `translateY(0.5px)`, spring back. Focus = 2px **gold-bright** ring at ~50%, offset 2px against canvas. Disabled = `opacity-40`. Min tap target 44px. Never a custom cursor, never an outer glow.
- **Cards / Sheets.** Surface graphite, `rounded-2xl` (16–20px), hairline border, soft dark shadow `0 1px 2px rgba(0,0,0,.4), 0 8px 30px rgba(0,0,0,.35)`. Elevation reads mostly through the lighter surface + hairline. Used *only* where it earns hierarchy — the primary result sits highest; supporting panels flatten to hairline dividers.
- **Segmented control** (Scan/History, Face/Close-up). Apple pill group: gold-wash track, a **surface-raised thumb that slides** between equal-width segments via `transform: translateX` (spring). Selected label ink, unselected secondary ink. Replaces today's two separate teal pills.
- **Inputs.** Label above (caption, ink-secondary), field surface-graphite with hairline-strong border, `rounded-xl`, ≥ 44px height, ink text, tertiary placeholder. Focus swaps border → gold + gold ring. Error below in Urgent text. No floating labels.
- **Confidence bars.** Track `rgba(255,255,255,0.08)` rounded-full, **gold fill**, width animates from 0 on mount (spring, staggered per row). Percentage right-aligned in mono `tabular-nums`.
- **Alerts (referral / disclaimer).** Semantic surface + hairline border + bold lead line. The referral alert is the calmest-but-clearest block on the result screen — settled, not shouting; legible without color (label + text carry it).
- **Loaders.** Skeleton shapes matching the exact result layout, with a slow graphite→lighter shimmer. **No circular spinners.**
- **Empty states.** A composed, centered prompt showing the next action ("Start a scan"), not bare "No data."

## 5. Layout Principles

- **Containment.** Content column `max-w-2xl` (reading) / `max-w-3xl` (results); centered `mx-auto`. Padding `px-4 sm:px-6`, vertical rhythm `clamp(2rem, 6vw, 4rem)`.
- **Grid over hacks.** Tailwind grid for the two-column result split (`grid-cols-1 md:grid-cols-2 gap-6`). No `calc()` percentage math.
- **Full-height.** `min-h-[100dvh]`, never `h-screen` (iOS Safari toolbar jump). *(Current code uses `min-h-screen` — migrate.)*
- **Spatial separation.** No overlapping / absolute-stacked content. Every element owns its zone; whitespace divides before a border does.
- **Symmetry is fine here.** Centered titles and single-column scan flows are on-brand for a calm clinical tool.

## 6. Responsive Rules

- **< 768px:** every multi-column layout collapses to one column (result split stacks: matches above, meaning below). No horizontal scroll — overflow is a critical failure.
- **Type:** headlines `clamp()`; body never below 15px.
- **Touch:** all controls ≥ 44px; segmented control and pills stay thumb-friendly.
- **Nav:** the top segmented control stays full-width, centered on mobile.
- **Spacing:** section gaps scale down via `clamp()`.

## 7. Motion & Interaction

- **Physics.** Spring feel `stiffness: 210, damping: 26` (crisp, weighty). CSS transitions `200–260ms`, `cubic-bezier(0.32, 0.72, 0, 1)`.
- **Reveals.** Views and result cards fade + rise `8px` on mount; lists stagger `40ms` per item. A settle, not a performance.
- **Interaction.** Buttons/pills press-scale; segmented thumb slides; confidence bars grow on mount.
- **No perpetual loops.** No infinite pulse/float on clinical screens. Shimmer exists *only* on skeleton loaders and stops the instant data lands.
- **Performance.** Animate **only** `transform` + `opacity`. Never `top/left/width/height`.
- **Accessibility (mandatory).** Honor `prefers-reduced-motion: reduce` — drop rise/stagger/scale to instant. Non-negotiable for a medical audience.

## 8. Anti-Patterns (Banned)

- No emojis anywhere in the UI.
- No `Inter` / generic webfont sans — SF via the system stack only.
- No serif fonts.
- No pure black `#000000` — canvas is graphite `#0B0B0D`, ink is `#F5F5F7`.
- No neon or outer-glow shadows; no purple/blue-neon "AI" aesthetic; gold is muted, never brassy-bright as fill.
- No gradient text on headings.
- No custom mouse cursors.
- No overlapping / absolute-stacked elements.
- No 3-equal-column card row (use the 2-column result split or stacked sections).
- No perpetual micro-motion on result/clinical screens.
- No circular spinners — skeletons only.
- No color-only status (urgency always carries a text label).
- No AI copy clichés ("Elevate", "Seamless", "Unleash", "Next-Gen").
- No generic placeholder names ("John Doe", "Acme") or fake round stats.
- No `h-screen` (use `min-h-[100dvh]`); no broken remote image links.
- No aesthetic change that reduces the legibility or prominence of a referral alert or disclaimer.
```

