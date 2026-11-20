# Sonalogue design: the "Stage" look

Every Sonalogue product uses this look. The idea is **light on a dark stage**: a near-black room where only what matters lights up, the sound itself and the one thing you can act on.

Ready-made CSS: `docs/sonalogue-theme.css` in this repo. Copy it and the `src/fonts/` folder into the new app and build on top of it. Use the CSS variables; never type a hex color twice.

## 1. The five rules

1. **Dark stage, three steps.** Window background `#0A0C11`, panels and inputs `#0D1017`, buttons and menus `#131823`. Waveforms, spectrograms and meters sit one step *darker* than the window, on `#07090D`, so the sound glows.
2. **No green.** On and selected states use a quiet light grey (`#D9DEE7`, text `#0A0C11`), chosen chips and tabs a soft raised grey (`#273040`, border `#3A4557`). The main action (Play, Auto Fix, Generate, Deliver) carries the sound gradient. Violet `#C08CFF` marks the sound itself: EQ curves and points, selections, markers, the playhead glow. (Set by Paul Baraka, November 2026; Sonalogue and Sonalogue Deliver match.)
3. **Sound colors are for sound only.** Warm `#FF8A4C` → violet `#C08CFF` → cyan `#5BE3FF` (dark and deep to bright and airy). Use them for waveforms, meters, gradients and data. Never for buttons or text.
4. **Everything is round.** Buttons, chips, switches and control groups are full pills (`border-radius: 999px`). Fields are 10 px, menus 8 px, cards 12 px, canvases 10 px.
5. **Hairlines, not boxes.** Every border is 1 px `#1E232D`. No shadows except the violet glow on the play button and on focus.

## 2. Colors

| Role | Value | Variable |
|---|---|---|
| Window background | `#0A0C11` | `--bg` |
| Canvas (waves, meters) | `#07090D` | `--canvas` |
| Panels, inputs, pills | `#0D1017` | `--panel` |
| Buttons, menus | `#131823` | `--panel2` |
| Row hover | `#10161F` | `--hover` |
| Selected row | `#131D26` + violet edge | `--sel` |
| Active segment (quiet) | `#1A2532` | `--on` |
| Borders | `#1E232D` | `--line` |
| Border on hover | `#34404F` | `--line-hi` |
| Text | `#ECEFF5` | `--text` |
| Secondary text | `#9AA3B4` | `--dim` |
| Hints, footnotes | `#7A8394` | `--faint` |
| Axis labels on canvases | `#6B7383` | `--axis` |
| Accent (on, selected) | `#D9DEE7`, text `#0A0C11`; chosen chips `#273040` border `#3A4557`; marks violet `#C08CFF` | `--accent`, `--violet` |
| Text on accent | `#05241A` | `--acctext` |
| "On" button / good banner | bg `#0F2A22`, border `#1F5A47`, text `#B9F8E2` | `--ok-*` |
| Status: worked | `#8fc98f` | `--good` |
| Status: problem | `#e07a5f` (coral, never pure red) | `--warn` |
| Sound colors | `#FF8A4C`, `#C08CFF`, `#5BE3FF` | `--warm`, `--violet`, `--cyan` |

Pass, fail and close to the limit: **pass = light grey**, **fail = coral `#e07a5f`**, **close to the limit = warm `#FF8A4C`**.

## 3. Type

| Use | Font | Size and weight |
|---|---|---|
| Logo (all caps) | Unbounded | 15 px, 700, letter-spacing 0.09em |
| Big numbers (a LUFS reading, a score) | Unbounded | 24 px, 700 |
| Everything you read | Inter | 13 px, line height 1.4, features `cv11`, `ss01` |
| Sound name in the player | Inter | 15 px, 600 |
| Column headers, small labels | Inter | 10.5 px, 600, UPPERCASE, letter-spacing 0.12em, `--dim` |
| Numbers, times, dB, formats, sizes | JetBrains Mono | 12 px, 400 or 500 |
| Hints | Inter | 12 px, `--faint` |

All three fonts are bundled from `src/fonts/` (SIL Open Font License). Never load them from Google.

## 4. Components

- **Button:** pill, `--panel2` fill, 1 px `--line` border, padding 6 × 14. On hover the border goes to `#34404F` and the fill to `#182030`.
- **Main action:** the same pill filled with the sound gradient, `#0A0C11` text, weight 600. One per area, at most.
- **"On" toggle button** (Loop, EQ): raised grey `#273040`, white text, `#3A4557` border.
- **Play button:** 40 px circle filled with the sound gradient, with a soft violet glow (`0 0 18px rgba(192,140,255,.35)`).
- **Segmented switch** (List | Map): a pill track on `--panel`. The active segment is raised grey `#273040` with white text.
- **Control pill:** a label, slider, number and unit inside one `--panel` pill, 26 px tall. Numbers in mono. This is how all the edit controls look.
- **Switch** (never a checkbox): 28 × 16 track `#222A36`, 12 px knob `#9AA3B4`. When on: mint track, dark knob slid right. Animation 0.15 s.
- **Slider:** 4 px track `#222A36`, 14 px mint thumb with a faint mint halo that grows on hover.
- **Dropdown:** `--panel`, 8 px radius, small gray chevron on the right. No system arrow.
- **Text field:** `--panel`, 10 px radius. On focus: mint border plus a 3 px mint halo at 12%.
- **Selected list row:** a violet gradient fading in from the left (`rgba(192,140,255,.12)` → `#131D26` at 30%) plus a 2 px violet bar on the left edge.
- **Scrollbars:** 10 px wide and almost invisible (`#1C2330`). They brighten on hover and turn mint while dragging. No arrows.
- **Focus:** a 2 px mint outline, 2 px offset, for keyboard users.

## 5. Canvases (waves, spectrograms, meters)

- Background `#07090D`, 1 px `--line` border, 10 px radius.
- Grid lines `#141922`, axis labels `#6B7383` at 10 px.
- Waveforms take the sound's color: warm, violet or cyan along the dark-to-bright scale. When a sound has no color yet, use violet.
- Selection: mint wash at 10%, with 1 px mint edges.
- Playhead: white, with a violet glow (`shadowBlur 12`, `rgba(192,140,255,.95)`).
- Curves the user can grab (EQ, a loudness target line): 2 px mint line, with mint points showing dark numbers.
- Spectrogram palette, from quiet to loud: `#0B0C10` → `#34185C` (30%) → `#96286E` (55%) → `#E87838` (78%) → `#FFF4B0`.
- Frequency or level fills under a curve: violet, fading from 30% to 2% opacity.

## 6. Layout and spacing

- Bars (header, filters, footer): padding 10 × 16, gap 12, all on `--bg`, split by hairlines.
- Sidebar: 250 px, `--bg`, with a hairline on the right.
- Gaps: 6 px inside control rows, 8 to 12 px between groups.
- Nothing floats over the sound. Tools sit on a line above the canvas, never on it.
- Map and stage backgrounds can use a soft radial glow: `radial-gradient(circle at 50% 50%, #0F141C, #0A0C11 72%)`.

## 7. Motion

Only small, quick transitions: 0.12 s on hover color changes, 0.15 s on switches. No bouncing and no slide-ins. The sound moves; the interface stays still.

## 8. Words

Short, plain and human. Status lines say what happened, in plain words with real numbers: "Removed 60 Hz hum, raised the level by 2.5 dB (now -16 LUFS)." No em dashes, no hype words, no "AI-powered".
