# MystiX — Hero & Mystic Points for Pathfinder 2e

A Foundry Virtual Tabletop module for the **Pathfinder 2e** system that puts **Hero Points and Mystic Points on every character sheet, together**.

Mystic Points are a second, GM-awarded pool that works just like Hero Points: spend one to reroll a check, or use them for any Hero-Point-style ruling your table makes.

## Why

In current PF2e builds, the system's `mythic-points` resource is reserved for characters with a Mythic Calling — and when a character is mythic, the system **zeroes out their Hero Points**. The two pools are mutually exclusive. MystiX makes both available to every character, side by side.

## Features

- **Mystic Point pips** on every PF2e character sheet header, right next to Hero Points
- **Floating party HUD** — every character's Hero and Mystic Points at a glance, with GM quick-award (+/−) buttons
- **Auto-refresh** — optional settings refill everyone's Mystic Points when a new session starts or when each combat encounter begins (refill-to-full, or a fixed grant per encounter), with a per-character opt-out
- **Custom mystic effects** — configurable Mystic-Point-only powers (check bonuses, auto-stabilize, flavor messages) with their own chat cards, chosen by the spender from a picker dialog
- **GM award dialog** — right-click the pips to award or remove points, or set that character's pool size (0 hides the widget)
- **Reroll with Mystic Point** — right-click any chat card for a native reroll: the system's own reroll implementation handles message replacement, degree-of-success recalculation, and initiative syncing
- **Synced for everyone** — pips update live on all clients
- **Activity log** — a rolling log in the party HUD of who spent, was awarded, or gained Mystic Points (with timestamps), including which mystic effect was triggered and which check was rerolled, plus a filterable GM log viewer dialog
- **Macro API** — `game.mystix.*` for automations

## Installation

1. In Foundry, go to **Add-on Modules → Install Module**
2. Paste the manifest URL:
   `https://github.com/your-org/mystix/releases/latest/download/module.json`
3. Enable **MystiX** in your world's module settings

Requires Foundry VTT v13+ and the Pathfinder 2e game system (v7.1+).

## Usage

### As the GM

- **Award points:** right-click the Mystic Point pips on any character sheet (or use the Actors directory). Enter a positive number to award, negative to remove, and set that character's max pool size.
- **Party HUD:** toggle it with `Shift+H`, the 🜂 button in the token control bar, or the macro API. Every character's Hero and Mystic Points are shown together; the **+ / −** buttons next to each Mystic pool award or remove points instantly. Click a character's name to open their sheet.
- **Activity log:** the *Mystic Point Log* panel at the bottom of the party HUD records who spent, was awarded, or gained Mystic Points from refreshes — with timestamps and the user behind each change (so a player spend and a GM award are distinguishable). Effect triggers show the effect name (*triggered a mystic effect — Mystic Surge*), rerolls show the check (*rerolled a check — Strike*), and a refunded trigger after a failure is logged too, so the ledger always balances against the pools. It keeps the most recent 200 entries; the GM can clear it with the trash button. Player-side spends are relayed to the GM client, so there's a single authoritative log. GMs can also read or wipe it via macros:

```js
await game.mystix.log.clear();
const entries = game.mystix.log.get(); // newest first
game.mystix.log.view(); // open the GM log viewer dialog
```

- **Log viewer (GM):** open the full log from the 📋 button in the token control bar, the 📋 button on the party HUD header, or `game.mystix.log.view()`. A resizable dialog lists every entry with its full date and time and a detail column, and filters by **character**, **action type** (spend / award / remove / refresh / fixed grant / effect / reroll / refunded), and **user** — so you can answer "who spent what while I was running the shopkeep?" in two clicks. The filters combine, a live counter shows how many entries match, and the list updates by itself while the dialog is open. Your last-used filters are **remembered per user** (stored on your own user record) and restored whenever you reopen the viewer — later in the session or after a restart.

- **Summary view:** toggle *Entries* / *Summary* at the top of the viewer. The summary groups the log into play sessions (split whenever 30 minutes pass with no activity) and shows, per character per session: the **net Mystic Point change** (green +, red −), total spent vs. gained, and the start → end pool. Filtering by character narrows the summary to that character; action and user filters are ignored in this view since raw pool values would otherwise be misleading. The view choice is remembered with your filters. **Export:** *Copy* puts the filtered entries on your clipboard and *Download CSV* saves a `mystix-log-YYYY-MM-DD.csv` file — both export exactly what the filters show (RFC 4180 CSV with ISO timestamps plus locale date/time, action labels, pool values, detail, and user), ready for post-session review in any spreadsheet.
- The world default max (Settings → MystiX → *Default Max Mystic Points*) applies to characters that haven't had an explicit max set.
- **Skip auto-refresh:** the award dialog's *Skip auto-refresh* checkbox excludes that character from the automatic refreshes below — useful for story reasons, an absent player, or a character whose pool should stay frozen. The party HUD shows a ⏸ badge on opted-out characters. Manual awarding and spending are never affected.
- **Auto-refresh:** enable *Refresh Mystic Points on Session Start* (refills everyone once per calendar day when the world loads — reloading mid-session won't top anyone up again) and/or *Refresh Mystic Points on Encounter Start*. Refreshed characters are announced in chat.
- **Encounter refresh style:** choose how each combat's refresh works (Settings → MystiX → *Encounter Refresh Style*):
  - *Refill to full* — every pool tops up to its max at the start of each combat.
  - *Fixed grant per encounter* — each combat grants a set number of points (the *Fixed Encounter Grant* setting), accumulating toward each character's max instead of resetting it. Great for attrition-based play: a party that spends everything still only gains, never overshoots, and hoarders gain nothing. Both styles announce who gained what in chat.

### As a player

- **Spend on a reroll:** right-click your check's chat card → *PF2E | Reroll with Mystic Point*. One point is spent and the reroll replaces the card, just like the system's Hero Point reroll.
- **Trigger a mystic effect:** left-click the Mystic pips on your sheet (or in the party HUD). If your GM configured more than one effect, a picker shows them with one-line summaries; pick one, spend one, and the effect's chat card announces it to the table.
- **Spend freely:** with no effects configured, left-click still spends a plain point for any table-ruled use.

### Custom effects (GM)

Open **Custom Mystic Effects** via the wand button in the token control bar or the ⚙ button on the party HUD. Three effect types ship:

| Type | What it does |
|---|---|
| **Check bonus** | Grants a real PF2e effect item — a FlatModifier circumstance bonus to all checks — for a configurable number of rounds |
| **Auto-stabilize** | Removes the dying condition (hero-point-style rescue) |
| **Chat message** | Posts the card; nothing mechanical — for table-ruled effects |

Two effects ship enabled by default: *Mystic Surge* (+2 to checks for 1 round) and *Mystic Mending* (auto-stabilize). Rename them, change values, disable them, or add your own.

### Macro API

```js
// Current pool for an actor
game.mystix.get(actor);                        // { value, max }

// Award or remove
await game.mystix.award(actor, 2);
await game.mystix.award(actor, -1);

// Set value and/or max explicitly
await game.mystix.set(actor, { value: 1, max: 3 });

// Spend one (returns false if empty)
await game.mystix.spend(actor);

// Open the GM award dialog
game.mystix.openAwardDialog(actor);

// Toggle the party HUD (all users)
game.mystix.toggleHUD();

// Refill everyone to full now (GM only, announces in chat)
await game.mystix.refreshAll();

// Run the encounter refresh in the configured style (GM only)
await game.mystix.refreshEncounter();

// Fixed grant with explicit amounts, ignoring the world settings
await game.mystix.refreshFixed({ grant: 1, announce: false });

// Per-actor auto-refresh opt-out
game.mystix.getSkipRefresh(actor);                    // → boolean
await game.mystix.setSkipRefresh(actor, true);

// Custom effects
const enabled = game.mystix.effects.list();          // [{key, name, type, ...}]
await game.mystix.effects.trigger(actor, "bonus-next-check"); // spend + apply + card
await game.mystix.effects.chooser(actor);            // open the picker dialog
game.mystix.effects.manager();                       // open the GM manager
```

## Storage

Mystic Points are stored per-actor in `flags.mystix`, deliberately separate from the system's `mythic-points` resource. This means:

- No conflict with the system's mythic Calling logic or the mythic proficiency-swap on rerolls
- Pools persist on the actor and survive world transfer
- Deleting the module leaves no actor data behind except the flag scope

## Homebrew rules text

If you want a rules blurb for your game notes:

> **Mystic Points.** In addition to Hero Points, each character can carry Mystic Points, awarded by the GM for the same kinds of memorable play. A character can spend a Mystic Point for anything a Hero Point can do — rerolling a check, stabilizing from dying, or other effects at the GM's discretion. Mystic Points don't refresh automatically; they accumulate only as the GM awards them.

## Development

The module's core pool logic is covered by dependency-free unit tests using Node's built-in test runner (Node 18+):

```bash
cd mystix
npm install   # no-op; there are no dependencies
npm test                   # runs tests/*.test.js via node --test
npm run check              # syntax-check scripts + validate JSON manifests
```

CI (`.github/workflows/ci.yml`) runs both on every push to `main` and on pull requests.

### Releasing

Publishing a release is tag-driven (`.github/workflows/release.yml`):

1. Set the version in `module.json` (and `package.json`) — e.g. `0.3.0`
2. **Add a `### [0.3.0] — date` entry to the Changelog above** (newest first). The release workflow refuses to publish a version with no changelog entry, so the listing always stays current.
3. Commit and push, then tag and push the tag:

   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

4. The workflow verifies the tag matches `module.json`'s version, checks the changelog, runs the test suite, zips `module.json`, `scripts/`, `styles/`, `lang/`, `templates/`, and `README.md` into `module.zip`, and publishes a GitHub Release. Auto-generated notes are thin without PRs — paste the new changelog bullets into the release notes (`gh release edit vX.Y.Z --notes "..."`) so the GitHub release matches the listing.

The zip is directly installable in Foundry: point its manifest URL at your repo's `module.json` (as in the Installation section) and players can install any published version.

## Changelog

Changelog entries use the format Foundry's package listing expects: one `### [x.y.z] — date` heading per release, newest first, with human-readable bullet points.

### [0.2.8] — 2026-09-21

- The GM log viewer **remembers your last-used filters** (character, action, user, view) per user, restoring them on reopen
- New **Summary view**: per-session, per-character net Mystic Point change with spent/gained totals and start → end pools; sessions split automatically after 30 minutes of inactivity
- Fixed a `Number(null)` coercion that mis-tallied relayed player spends in summaries

### [0.2.6] — 2026-09-20

- **Export the activity log**: copy to clipboard or download RFC 4180 CSV (`mystix-log-YYYY-MM-DD.csv`, Excel-friendly BOM), honoring the active filters
- Effect triggers and Mystic rerolls are logged with their detail (effect name / check)
- Manifest URLs point at the live repository; the release workflow ships `module.json` as a release asset so Foundry's installer can always find it

### [0.2.4] — 2026-09-20

- New **GM log viewer** dialog: every entry with full timestamps, filterable by character, action type, and user, with a live match counter; opens from the token control bar, the party HUD, or `game.mystix.log.view()`
- The HUD's collapsed log header shows the total entry count

### [0.2.3] — 2026-09-20

- New **Mystic Point activity log**: a rolling, timestamped record of spends, awards, and refreshes in the party HUD, kept in world settings with a single authoritative copy via a GM-side socket relay
- Macro API: `game.mystix.log.get()` / `log.clear()`

### [0.2.2] — 2026-09-20

- **Encounter refresh style** setting: refill to full *or* a fixed grant per combat that accumulates toward each character's max — great for attrition-based play
- Garbage-proof grant settings: negative/non-numeric values are treated as zero

### [0.2.1] — 2026-09-20

- Per-actor **Skip auto-refresh** opt-out in the award dialog, with a ⏸ badge in the party HUD
- Pool writes now use dot-path flag updates so sibling flags (like the opt-out) are never clobbered

### [0.2.0] — 2026-09-20

- **Custom mystic effects**: a GM-managed registry of Mystic-Point-only powers — check bonuses (real PF2e FlatModifier effect items), auto-stabilize (removes dying), or chat-message-only — chosen by the spender from a picker, announced with styled chat cards, refunded on failure
- Everything earlier (0.1.x): coexisting Hero/Mystic pools with sheet pips, GM award dialog, the party tracker HUD, chat-card Mystic rerolls, session/encounter auto-refresh, and the macro API

## Compatibility

- Foundry VTT v13 / v14 (ApplicationV2 era)
- Pathfinder 2e system v7.1+
- Should coexist with Hero Point Deck modules — MystiX doesn't touch the Hero Point pool

## License

MIT
