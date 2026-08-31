# Keyboard Shortcuts

> **Modifier convention:** `Mod` = `Ctrl` on Windows/Linux, `Cmd` on macOS.
> Press `F1` or choose **Help → Keyboard Shortcuts** to open this reference
> inside the editor.

<!-- docs-site:exclude-start -->

> **Contributor note:** this document is the single source of truth for GitHub,
> the public docs site, and the in-app Help dialog. Help parses only
> `## Title {#id}` sections. The public site also removes blocks enclosed by the
> `docs-site:exclude` comments.

<!-- docs-site:exclude-end -->

Viritura has two editing modes:

- **Normal mode** — selection-based editing. Click a note, then apply changes.
- **Note input mode** — type notes directly. Toggle with `N`. The cursor advances after each entry.

Shortcuts below are grouped by where they apply.

---

<!-- docs-site:exclude-start -->

## Ergonomic philosophy

Viritura optimizes for **left hand on keyboard, right hand on mouse** — the dominant posture for selection-driven editing on modern laptops. This is a deliberate departure from peer applications:

- **Dorico** assumes both hands on the keyboard (caret-driven entry, MIDI / step-time).
- **Sibelius** assumes right hand on mouse + numpad cluster near the right hand (durations on the numpad, mouse for selection).
- **Viritura** keeps the right hand free for the mouse and concentrates high-frequency keys (durations `1`–`8`, mode toggles `N`/`Q`, voice picks `Alt+1`–`4`, transpose `Alt+↑/↓`) on the **left half of the keyboard**.

### Known ergonomic problems

The current shortcut set has several right-hand bindings that violate the design premise. Ranked by frequency × severity:

1. **Accidentals (`-`, `=`, `\`, `0` plus `Shift` variants).** Top-right corner of the keyboard. High-frequency during note entry. **Severity: high.**
2. **Augmentation dot (`.`) and grace toggle (`/`).** Right-hand bottom row. `.` is high-frequency during note entry (dotted rhythms are common); `/` is moderate. **Severity: high (`.`), low (`/`).**
3. **Rest insertion (`0`) in note input.** Sits on the same right-hand top-row cluster as the accidentals — same lift cost, even higher frequency. **Severity: high.**
4. **Vim-style cursor keys (`H` prev event, `J` next measure) in note input.** Right-hand home row. Low frequency (arrow keys still work, these are aliases), and the vim-style cluster is intentional — only flagged here so it's not mistakenly held up as a model for new bindings. **Severity: low.**
5. **Longer-duration keys (`6` whole, `7` breve, `8` maxima).** Right side of the number row. `6` shows up occasionally; `7`/`8` are rare. **Severity: low.**
6. **Right-side radial menus (`Shift+H` breath/fermata, `Shift+M` time signature, `Shift+O` ornaments).** Two-handed chord anyway, and these aren't note-entry-loop actions. **Severity: low.**

Candidates for fixing the high-severity ones (accidentals, `.`, `0`):

- Reassign to a left-hand cluster (e.g. modifier + `Z`/`X`/`C`/`V`), keeping the current keys as aliases for Sibelius muscle memory.
- A single left-hand cycler key that walks `♭♭ → ♭ → ♮ → ♯ → ♯♯` instead of three independent keys.
- Move accidental application onto the mouse: right-click radial or scroll-wheel gesture on a selected note.

No decision yet; flagged here so the next person touching note-entry ergonomics knows these are real gaps, not stylistic preferences.

---

## Mouse buttons

Documenting mouse bindings here because they're a frequent source of "why did that happen?" reports and the `<canvas>` doesn't surface them anywhere visible.

| Button                   | Action                                 | Status                  |
| ------------------------ | -------------------------------------- | ----------------------- |
| Left (button 0)          | Select / drag / paint (mode-dependent) | shipped                 |
| Middle (button 1)        | Pan viewport (drag)                    | shipped                 |
| Right (button 2)         | Context menu                           | shipped                 |
| Thumb back (button 3)    | Toggle note input mode                 | shipped, **see issues** |
| Thumb forward (button 4) | _(unbound)_                            | reserved                |

### Known issues with thumb-back (button 3)

This binding has multiple problems and is on the audit list:

1. **Browser back navigation conflict.** On most browsers, button 3 navigates back. The current implementation calls `e.preventDefault()` on `pointerdown` / `mousedown` only (see [`InputCursor.tsx`](../../apps/editor/src/components/InputCursor.tsx) and [`canvasHandlers.ts`](../../apps/editor/src/components/ScoreCanvas/canvasHandlers.ts)) — but browser navigation typically fires on `mouseup` / `auxclick`. Whether navigation is actually suppressed is browser- and focus-state-dependent; users running the desktop shell never see it, but in-browser users can hit cases where note input toggles **and** the page navigates away.
2. **Double-bound.** The same button is handled in two places (`InputCursor` pointerdown listener + `ScoreCanvas` React mousedown handler). They currently do the same thing, but it's invisible coupling — change one and behavior diverges.
3. **Undocumented until now.** Power feature with no surface anywhere in the UI or help dialog. Users who don't have a 5-button mouse never discover it; users who do discover it accidentally while losing browser state.
4. **No symmetric forward binding.** Button 4 (thumb forward) is unbound, so the "toggle" framing on button 3 isn't reinforced by a paired action — it's just a hidden single shortcut.

Audit actions:

- Add `onAuxClick` handler that `preventDefault`s button 3 alongside button 1, so navigation is suppressed regardless of which event the browser fires on.
- Consolidate to one binding site (drop the `InputCursor` pointerdown listener; let `ScoreCanvas` own all mouse-button routing).
- Decide: keep as a hidden power-feature with a documented opt-out (`settings.mouse.thumbBackToggleNoteInput`) for users who'd rather have browser back? Or drop it entirely and free the button for something more discoverable?

---

<!-- docs-site:exclude-end -->

## Global {#global}

Always available. Browser-style shortcuts (clipboard, save, undo, etc.) fire even while typing in a text field; mode shortcuts (like `N`) are suppressed in text inputs.

| Key               | Action                                        |
| ----------------- | --------------------------------------------- |
| `F1`              | Open this help dialog                         |
| `Esc`             | Exit note input / unselect annotation / clear |
| `Mod+Space`       | Open jump bar (command palette)               |
| `Mod+O`           | Open project folder                           |
| `Mod+Shift+O`     | Open standalone MNX file                      |
| `Mod+S`           | Save                                          |
| `Mod+Shift+S`     | Save as                                       |
| `Mod+P`           | Publish                                       |
| `Mod+Z`           | Undo                                          |
| `Mod+Y`           | Redo                                          |
| `Mod+Shift+Z`     | Redo (alternate)                              |
| `Mod+A`           | Select all                                    |
| `Mod+C`           | Copy                                          |
| `Mod+X`           | Cut                                           |
| `Mod+V`           | Paste                                         |
| `Mod+=` / `Mod++` | Zoom in                                       |
| `Mod+-`           | Zoom out                                      |
| `Mod+0`           | Reset viewport                                |
| `Mod+\`           | Toggle side panels                            |
| `N`               | Toggle note input mode                        |
| `Space`           | Play / pause (suppressed in note input)       |
| `Alt+1` … `Alt+4` | Switch active voice (1–4)                     |
| `Alt+C`           | Toggle condensing popover                     |

In the jump bar, type `m125` or `b125` to go to measure 125. Type `rA` or
`r125` to go to the rehearsal mark with that label.

---

## Normal Mode {#normal}

Selection-based editing. Use these when **not** in note input mode.

### Navigation

| Key                    | Action                              |
| ---------------------- | ----------------------------------- |
| `←` / `→`              | Previous / next event               |
| `Ctrl+←` / `Ctrl+→`    | Previous / next measure             |
| `Shift+←` / `Shift+→`  | Extend selection by one event       |
| `Shift+↑` / `Shift+↓`  | Extend selection to adjacent staff  |
| `Alt+←` / `Alt+→`      | Cycle between annotations on event  |
| `↑` / `↓`              | Move between staves                 |
| `Home` / `End`         | First / last event in measure       |
| `Alt+Page Up`          | Previous score or part              |
| `Alt+Page Down`        | Next score or part                  |
| `Delete` / `Backspace` | Replace selected event(s) with rest |

### Transposition

| Key                           | Action                       |
| ----------------------------- | ---------------------------- |
| `Alt+↑` / `Alt+↓`             | By diatonic step             |
| `Alt+Shift+↑` / `Alt+Shift+↓` | By chromatic step (semitone) |
| `Mod+Alt+↑` / `Mod+Alt+↓`     | By octave                    |

### Editing

| Key       | Action                                                                         |
| --------- | ------------------------------------------------------------------------------ |
| `S`       | Toggle slur from selection                                                     |
| `T`       | Toggle tie to next note                                                        |
| `F`       | Flip the selected item's direction or above/below placement                    |
| `R`       | Repeat selection (copy and paste immediately after)                            |
| `Q`       | Enter note input with chord-mode lock (A–G adds to chord instead of advancing) |
| `.`       | Toggle augmentation dot on selected note                                       |
| `Shift+T` | Set tempo at selection                                                         |
| `Shift+X` | Add staff text                                                                 |

### Duration (change selected note)

| Key | Duration     |
| --- | ------------ |
| `1` | 32nd note    |
| `2` | 16th note    |
| `3` | Eighth note  |
| `4` | Quarter note |
| `5` | Half note    |
| `6` | Whole note   |
| `7` | Breve        |
| `8` | Maxima       |

### Accidentals (apply to selection)

| Key       | Action                                         |
| --------- | ---------------------------------------------- |
| `-`       | Flat                                           |
| `=`       | Sharp                                          |
| `0`       | Natural                                        |
| `Shift+-` | Step accidental down (e.g. flat → double-flat) |
| `Shift+=` | Step accidental up (e.g. sharp → double-sharp) |

### Radial Menus (Shift + key)

Each opens a radial menu near the selection.

| Key       | Menu                                                  |
| --------- | ----------------------------------------------------- |
| `Shift+A` | Articulations (staccato, accent, tenuto, marcato, …)  |
| `Shift+B` | Barlines (cycle type); type `+n` to append n measures |
| `Shift+C` | Clefs                                                 |
| `Shift+D` | Dynamics                                              |
| `Shift+E` | Ornaments / expressions                               |
| `Shift+F` | Fingerings                                            |
| `Shift+H` | Breath marks / fermatas                               |
| `Shift+M` | Time signatures                                       |
| `Shift+O` | Ornaments                                             |
| `Shift+R` | Repeats                                               |
| `Shift+3` | Tuplets                                               |
| `Shift+4` | Time signatures (alias)                               |
| `Shift+5` | Key signatures                                        |

---

## Note Input Mode {#noteInput}

Active after pressing `N`. Most letter keys enter notes directly; the cursor advances after each entry (unless chord-mode lock is on — see `Q`).

### Pitches

| Key                   | Action                       |
| --------------------- | ---------------------------- |
| `A` – `G`             | Enter note at nearest octave |
| `Shift+A` – `Shift+G` | Add note to current chord    |
| `Q`                   | Toggle chord-mode lock       |

### Durations

| Key | Duration                |
| --- | ----------------------- |
| `1` | 32nd note               |
| `2` | 16th note               |
| `3` | Eighth note             |
| `4` | Quarter note            |
| `5` | Half note               |
| `6` | Whole note              |
| `7` | Breve                   |
| `8` | Maxima                  |
| `.` | Toggle augmentation dot |
| `/` | Toggle grace-note entry |

### Rests, Ties, Accidentals

| Key       | Action                  |
| --------- | ----------------------- |
| `0`       | Insert rest             |
| `T`       | Tie to previous note    |
| `S`       | Begin slur to next note |
| `-`       | Flat                    |
| `=`       | Sharp                   |
| `\`       | Natural                 |
| `Shift+-` | Step accidental down    |
| `Shift+=` | Step accidental up      |
| `Z`       | Double flat             |
| `X`       | Double sharp            |

### Cursor

| Key                           | Action                                       |
| ----------------------------- | -------------------------------------------- |
| `←` / `→`                     | Move cursor by one event                     |
| `↑` / `↓`                     | Move cursor between staves / instruments     |
| `Alt+↑` / `Alt+↓`             | Transpose entered note by diatonic step      |
| `Alt+Shift+↑` / `Alt+Shift+↓` | Transpose entered note by chromatic semitone |
| `Mod+Alt+↑` / `Mod+Alt+↓`     | Transpose entered note by octave             |
| `Space`                       | Advance cursor without entering anything     |
| `H`                           | Previous event                               |
| `J`                           | Next measure                                 |
| `Backspace`                   | Delete previous event                        |
| `Delete`                      | Delete current event                         |
| `Esc` / `N`                   | Exit note input mode                         |

### Tuplets & Voices

| Key               | Action             |
| ----------------- | ------------------ |
| `Shift+T`         | Open tuplet menu   |
| `Alt+1` … `Alt+4` | Switch input voice |

---

## Picture Activity {#picture}

Available only while the Picture activity is open. These bindings unregister
when another activity is selected, so they do not replace notation shortcuts.

| Key                 | Action                                       |
| ------------------- | -------------------------------------------- |
| `M`                 | Add a marker at the current picture playhead |
| `Shift+Click`       | Add a marker directly at the clicked frame   |
| Click marker region | Select that interval for tempo solving       |
| Drag marker         | Move an existing marker to another frame     |
| Double-click marker | Edit the marker label                        |

---

<!-- docs-site:exclude-start -->

## Reservation Policy

This section is for contributors adding new bindings. It is **not** rendered in the in-app help dialog (the parser only picks up sections with an `{#id}` heading).

### Policy

- Prefer single-key bindings in `normal` / `noteInput` contexts.
- Do not require more than one modifier key for primary actions.
- Avoid browser-reserved shortcuts where keydown capture is unreliable.
- Keep high-frequency actions on easy single keys.
- Any change that introduces or modifies bindings MUST first update the reservation tables below. If a conflict surfaces, update this file first, then implement.
- `KeyboardRegistry` throws at startup on duplicate `(key, context)` pairs — keep the tables in sync with `apps/editor/src/keyboard/editorBindings.ts`.

### Reserved single keys (normal context unless noted)

These keys are claimed for the listed commands. Some are shipped today (see tables above); others are reserved for upcoming work and should not be repurposed.

| Key | Reserved for                                                    | Status                                                                   |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `A` | `note.accidentalDisplay.courtesy` (toggle courtesy accidental)  | reserved                                                                 |
| `B` | `barline.cycleType` (single-press cycle on a barline selection) | reserved                                                                 |
| `C` | `clef.insertChange` (insert clef change at selection)           | reserved                                                                 |
| `D` | `directions.editAtSelection` (edit text directions)             | reserved                                                                 |
| `E` | `repeat.toggleEnd` (end-repeat barline)                         | reserved                                                                 |
| `F` | `cursor.advanceEvent` (vim-style next event)                    | shipped (flip selection); planned to move to cursor when vim layer ships |
| `G` | `markings.editAdvanced` (open markings inspector)               | reserved                                                                 |
| `H` | `cursor.previousEvent`                                          | shipped (note input only)                                                |
| `I` | `chord.addThirdAbove`                                           | reserved                                                                 |
| `J` | `cursor.nextMeasure`                                            | shipped (note input only)                                                |
| `K` | `notation.color.edit`                                           | reserved                                                                 |
| `L` | `slur.editAdvanced` (open slur inspector)                       | reserved                                                                 |
| `M` | `picture.addMarker`                                             | shipped (Picture activity only)                                          |
| `O` | `layout.editOverrides`                                          | reserved                                                                 |
| `P` | `edit.toggleDot`                                                | reserved (today the bound key is `.`)                                    |
| `Q` | `noteInput.chordLock`                                           | shipped                                                                  |
| `R` | `repeat.toggleStart` / repeat selection                         | shipped (repeat selection)                                               |
| `S` | `connector.slur`                                                | shipped                                                                  |
| `T` | `connector.tie`                                                 | shipped                                                                  |
| `U` | `edit.toggleRest`                                               | reserved                                                                 |
| `V` | `chord.addFifthAbove`                                           | reserved                                                                 |
| `W` | `repeat.editEnding`                                             | reserved                                                                 |
| `X` | `connector.clear`                                               | reserved                                                                 |
| `Y` | `tie.editAdvanced`                                              | reserved                                                                 |

### Reserved modifier combinations

| Key                | Reserved for                          | Status  |
| ------------------ | ------------------------------------- | ------- |
| `Alt+1` … `Alt+4`  | `voice.select1`–`voice.select4`       | shipped |
| `Alt+C`            | `condensing.popover`                  | shipped |
| `Mod+Alt+M`        | `measures.add`                        | shipped |
| `Shift+T` (normal) | `tempo.set` (note input: tuplet menu) | shipped |
| `Shift+X` (normal) | `staffText.add`                       | shipped |

### Reserved radial-menu keys

The radial-menu category routing lives in `buildNormalModeBindings` in [`apps/editor/src/keyboard/editorBindings.ts`](../../apps/editor/src/keyboard/editorBindings.ts). Update both the table in "Radial Menus" above and the routing list there when adding a category.

### Adding a new binding — checklist

1. Search this file for the key — if it appears under "Reserved", coordinate with the owner of that command before reusing it.
2. Add the binding to `editorBindings.ts` in the appropriate `build*Bindings`
   function. Activity-lifetime bindings instead belong in a `use*Shortcuts`
   hook mounted by that activity. Use the existing `(key, context)` convention.
3. Add a row to the matching `## {#id}` table above so it shows up in the in-app help.
4. If the new binding is for an upcoming command and not yet implemented, add a row to the "Reserved single keys" or "Reserved modifier combinations" table with status `reserved`.
5. Run `pnpm --filter @viritura/editor test` — the `KeyboardRegistry` startup check will fail on `(key, context)` conflicts.

<!-- docs-site:exclude-end -->
