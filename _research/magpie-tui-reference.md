# Magpie TUI Reference: Routing & Fallback Configuration

> **Source Analysis**: Repository [`yetone/magpie`](https://github.com/yetone/magpie)  
> **Commit Analyzed**: `fa22bc64676e230a71b45a40e7fee2ca750bb4dd`  
> **Target Framework**: Bubble Tea (`github.com/charmbracelet/bubbletea`) + Lip Gloss (`github.com/charmbracelet/lipgloss`)

---

## 1. Overview & System Context

Magpie is an open-source local gateway and configuration manager for AI coding agents (Claude Code, OpenAI Codex, Cline, OpenCode, etc.). It exposes an OpenAI- and Anthropic-compatible proxy on localhost and provides a multi-view terminal user interface (TUI) to configure agents, providers, routing groups, usage tracking, sessions, and agent instructions.

In Magpie, routing and fallback configuration centers on **Routing Groups** (`internal/provider/group.go:1-22, 148-250`):
- A group aggregates multiple models across one or more providers into a single virtual target exposed as `group/<id>` (e.g. `group/opus-anywhere`) or `auto/<model>` for auto-discovered models.
- When an agent targets a group, the gateway evaluates requests against an ordered fallback chain of member models, dynamic pattern hits, and conditional routing rules.
- The TUI implementation is housed primarily in `internal/tui/routing.go` (724 lines), integrating with the global application shell in `internal/tui/tui.go` and `internal/tui/pages.go`.

---

## 2. Screens and Navigation Flow

### Top-Level Navigation Shell

Magpie organizes its interface into six numbered pages (`internal/tui/pages.go:30-40`, `internal/tui/tui.go:416-430`):
1. `agents` (agent config, model bindings, profiles)
2. `providers` (API keys, endpoints, balance checks)
3. `routing` (routing groups, fallback chains, rules)
4. `usage` (token & cost summaries, quota windows)
5. `sessions` (conversation histories & filter logs)
6. `library` (custom instructions & skill configs)

Pressing keys `1`–`6`, or `[` (previous) and `]` (next), switches pages instantaneously from anywhere in list mode (`internal/tui/tui.go:419-430`).

### Routing Navigation Hierarchy

```
[Page 3: Groups List] (modeList)
   │
   ├── [n] ──► [New Group Prompt] (modeAsk) ──► [Initial Model Picker] (modePick)
   │                                                     │ (select model)
   │                                                     ▼
   │                                          (Create & Save Group)
   │
   ├── [↵ / Space] ──► [Group Detail View] (modeGroup)
   │                      │
   │                      ├── [a] ──────► [Member Picker Modal] (modePick)
   │                      │
   │                      ├── [n] ──────► [Add Rule Prompt] (modeAsk)
   │                      │
   │                      ├── [↵ / e] ──► [Edit Rule Prompt] (modeAsk)
   │                      │
   │                      ├── [c] ──────► [Classifier Model Picker] (modePick)
   │                      │
   │                      ├── [f/x/l/R] ► [Property Input Prompts] (modeAsk)
   │                      │
   │                      └── [Esc / q] ──► Return to [Groups List]
   │
   └── [q / Esc] ──► Exit Application
```

### Screen Modes & Views

1. **Groups List View (`modeList`)** (`internal/tui/routing.go:552-610`):
   - Displays all active groups and removed auto-detected groups.
   - For each group, shows cursor `▸`, group name, reference ID (`group/<id>`), member count, active routing strategy, affinity, rule count, and a preview of the fallback chain (`m1 → m2 → m3`).
2. **Group Creation Pipeline (`modeAsk` -> `modePick`)** (`internal/tui/routing.go:138-144, 225-261`):
   - Pressing `n` opens a single-line input prompt for the group name (`"the group's name, e.g. opus-anywhere"`).
   - Upon pressing `Enter`, Magpie transitions immediately to `modePick` to require the user to choose the group's first model before creating the group.
3. **Group Detail View (`modeGroup`)** (`internal/tui/routing.go:612-683`):
   - Displays breadcrumb header (`◉ magpie › routing › <group name>`).
   - Displays group metadata: reference, routing algorithm, session affinity, context limit, reasoning levels, and family tag.
   - Renders a unified vertical list containing:
     - **Members list**: The fallback chain (`1  provider/model-a`, `2  provider/model-b`).
     - **Pattern hits**: Dynamic catalog matches (`*.free` -> `3 models`).
     - **Rules**: Ordered conditional overrides (`1  agents=codex → use provider/model-c`).
     - **Classifier**: Assigned intent classifier model (if intent rules exist).
4. **Member / Model Picker (`modePick`)** (`internal/tui/routing.go:225-261`, `internal/tui/tui.go:911-961`):
   - Interactive fuzzy search modal listing available models across configured providers and existing groups (for nested routing).
   - Excludes self-references and models already in the group (`internal/tui/routing.go:192-223`).
5. **Rule Editor Modal (`modeAsk`)** (`internal/tui/routing.go:302-321`):
   - Freeform text input field (char limit 400) pre-populated with existing rule text on edit.
   - Displays comprehensive multi-line syntax hint (`ruleHint`) and lists active group members.

---

## 3. Key Bindings Reference

### Group List View (`modeList`)

| Key Binding | Action | Code Citation |
|---|---|---|
| `j`, `↓` | Navigate to next group | `internal/tui/routing.go:128-132` |
| `k`, `↑` | Navigate to previous group | `internal/tui/routing.go:133-137` |
| `n` | Create a new routing group | `internal/tui/routing.go:138-144` |
| `↵` (Enter), `Space` | Open selected group details | `internal/tui/routing.go:165-167` |
| `o` | Cycle routing strategy for selected group | `internal/tui/routing.go:168-169` |
| `d` | Delete selected group (requires double-tap confirm) | `internal/tui/routing.go:170-183` |
| `u` | Restore previously removed auto-discovered group | `internal/tui/routing.go:151-158` |
| `r` | Reload groups and provider states | `internal/tui/tui.go:376-384` |
| `1`–`6`, `[`, `]` | Switch between top-level pages | `internal/tui/tui.go:417-430` |
| `q`, `Esc` | Quit Magpie | `internal/tui/tui.go:373-375` |

### Group Detail View (`modeGroup`)

| Key Binding | Action | Code Citation |
|---|---|---|
| `j`, `↓` | Move selection down across members and rules | `internal/tui/routing.go:391-394` |
| `k`, `↑` | Move selection up across members and rules | `internal/tui/routing.go:395-398` |
| `J`, `Shift+↓` | Move selected member or rule down in priority | `internal/tui/routing.go:370-387, 399-400` |
| `K`, `Shift+↑` | Move selected member or rule up in priority | `internal/tui/routing.go:370-387, 401-402` |
| `a` | Add model / member to fallback chain | `internal/tui/routing.go:403-404` |
| `n` | Add new conditional routing rule | `internal/tui/routing.go:405-406` |
| `↵` (Enter), `e` | Edit selected rule (when cursor on rule) | `internal/tui/routing.go:407-410` |
| `d` | Remove selected member or rule (double-tap confirm) | `internal/tui/routing.go:500-538` |
| `E` | Cycle fixed reasoning effort on selected member | `internal/tui/routing.go:417-439` |
| `F` | Toggle fast mode on selected member | `internal/tui/routing.go:423-433` |
| `c` | Pick/change intent classifier model | `internal/tui/routing.go:411-416` |
| `o` | Cycle group routing strategy | `internal/tui/routing.go:440-441` |
| `s` | Cycle conversation session affinity | `internal/tui/routing.go:442-443` |
| `f` | Set/clear family visibility tag | `internal/tui/routing.go:444-452` |
| `x` | Set custom context token limit | `internal/tui/routing.go:453-471` |
| `l` | Set reasoning levels offered to agents | `internal/tui/routing.go:472-484` |
| `R` | Rename group ID slug | `internal/tui/routing.go:485-499` |
| `q`, `Esc` | Return to Group List | `internal/tui/routing.go:389-390` |

### Two-Line Contextual Footer

The detail view renders a dual-line keybinding footer at the base of the terminal (`internal/tui/tui.go:796-800`):
```text
  ↑↓ model / rule  J K move  a add model  n new rule  ↵ edit rule  d take out  esc back
  E effort  F fast  c classifier  o routing  s stays  x context  l levels  f family  R rename
```

---

## 4. Fallback Chain / Provider Order Mechanics

### Visual Representation of the Chain

The group view lays out the fallback order directly in the UI (`internal/tui/routing.go:631-647`):
- Header annotation explicitly clarifies semantics:  
  `"models · the first that can take a request gets it"`
- Each member is drawn with its 1-based order index:
  ```text
  ▸ 1  anthropic/claude-3-7-sonnet · fast
    2  openrouter/anthropic/claude-3.5-sonnet
    3  bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0
  ```
- Fast mode status (`· fast`) and pattern origin (`· by pattern`) are highlighted alongside model IDs.

### Reordering Mechanism (`J` / `K`)

Reordering members and rules uses vim-style shifted keys `J` (`Shift+Down`) and `K` (`Shift+Up`) (`internal/tui/routing.go:370-387`):
- Bound to an inline swap helper `move(by int)`.
- Enforces boundary protection: cursor cannot move outside list limits (`to < 0 || to >= all`).
- Respects category boundaries: a member cannot be swapped across into the rule section (`(to >= n) != onRule`).
- Immediately executes array swap in memory and dispatches an asynchronous `saveGroup` command.
- The flash status updates instantly with feedback (e.g. `"anthropic/claude-3.5-sonnet moved"`).

### Adding Members

Triggered via `a` (`internal/tui/routing.go:225-261`):
- Gathers member options via `memberOptions(skip, self)`.
- Automatically excludes models currently in the group and filters out recursive references (`self`).
- Allows nesting other routing groups (`"group · " + e.Name`), enabling composite fallback hierarchies.
- Appends the picked model to `g.Members` and saves.

### Removing Members & Cascade Protection

Triggered via `d` (`internal/tui/routing.go:500-538`):
- **Single-member guardrail**: If `len(g.Members) == 1`, Magpie blocks removal with flash message:  
  `"a group needs a model in it · d on the routing list removes the group"`.
- **Two-step confirmation**: Requires pressing `d` twice. If the member is referenced by any conditional rules, the confirmation warning explicitly alerts the user:  
  `"press d again to take <id> out and its rules"`.
- **Rule cascading clean-up**: Upon second `d`, both the member and all rules referencing that member are automatically deleted (`g.Members = slices.DeleteFunc(...)`, `g.Rules = slices.DeleteFunc(...)`).

### Routing Strategies (`o` Key)

Pressing `o` cycles through the supported load-balancing and routing algorithms (`internal/tui/routing.go:37-57`, `internal/provider/routing.go:23-35`):
- `""` (**smart**): Default gateway routing; considers allowances, rate limits, renewal times, and decay.
- `provider.Ordered` (**in order**): Strict priority fallback; requests always hit member 1 first until failure/rate limit, then fall back to member 2.
- `provider.Rotate` (**rotate**): Round-robin rotation across members.
- `provider.LeastUsed` (**least used**): Routes to member with the least decayed token usage.
- `provider.Pace` (**weekly pace**): Balances usage against weekly allowance renewal rates.
- `provider.Weighted` (**by weight**): Distributes requests according to configured integer weights.
- `provider.FreeFirst` (**free first**): Routes to zero-cost models before spending quota.
- `provider.Manual` (**manual**): Locks every request to a specifically pinned member (`g.Picked()`).

### Session Affinity / Stickiness (`s` Key)

Pressing `s` cycles how sticky a client conversation is to a specific provider route (`internal/tui/routing.go:67-79`, `internal/provider/group.go:49-66`):
- `""` (**stays auto**): Keeps affinity as long as vendor prompt caching remains effective.
- `session` (**stays the session**): Keeps all turns in a conversation on the same backend account.
- `turn` (**stays a turn**): Binds only during a single turn; subsequent turns may route elsewhere.
- `off` (**never stays**): Disables stickiness completely; every request is independently routed.
- `strict` (**stays strictly**): Never moves away even when account is resting or rate-limited; returns upstream error directly.

---

## 5. Validation, Confirmation, and Save Behaviour

### Validation Pipeline (`internal/provider/group.go:1191-1320`)

Whenever `saveGroup` is executed, Magpie runs exhaustive validation before persisting to disk:
1. **Slug Sanity**: Group ID is normalized to lowercase letters, digits, dots, and dashes (`GroupSlug(g.Name)`).
2. **Non-Empty Invariant**: A group must contain at least one member or matching pattern (`len(g.Members) == 0 && len(g.Match) == 0` returns error).
3. **No Self-Reference or Cycles** (`internal/provider/group.go:1332-1357`):
   - `groupsInGroup` checks transitive group inclusion.
   - Detects cycles: e.g. if `group-b` includes `group-a`, `group-a` cannot include `group-b`.
   - Generates informative error paths: `"sub can't be in parent: parent is in it already (sub ⊃ mid ⊃ parent), so parent would be in itself"`.
   - Restricts nesting depth to `maxNest = 5`.
4. **Classifier Integrity**:
   - A rule specifying an `intent` requires `g.Classifier` to be configured (`internal/provider/group.go:1300-1302`).
   - A group cannot classify for itself (`g.Classifier == GroupPrefix + g.ID` is forbidden).
   - Effort `auto` requires a classifier model.
5. **Rule Syntax Validation** (`internal/provider/ruleparse.go:89-213`):
   - Rules are parsed into key-value tokens (`use=<model>`, `tokens=200k`, `time=09:00-18:00`, `days=mon-fri`, `folders=~/work`, `pause=<model>`).
   - Unrecognized keywords trigger explicit syntax errors (`UnknownRuleWord`).

### Confirmation Flow (Two-Step Double Tap)

Rather than opening blocking modal dialogs for deletions, Magpie uses a **transient double-tap confirmation pattern** (`internal/tui/routing.go:124-126, 170-183, 367-369, 501-537`):
- `m.confirm` holds a string identifier for the pending destruction (`"group/<id>"`, `"member/<id>"`, or `"rule/<index>"`).
- **First press**: Sets `m.confirm` and displays an actionable warning in `m.flash` (e.g. `"press d again to remove opus-anywhere"`).
- **Second press**: If the next key is `d`, the deletion executes immediately.
- **Interruption**: Pressing any key other than `d` instantly resets `m.confirm = ""`, safely aborting the operation without error.

### Save Architecture (`saveGroup`)

All modifications follow a functional command pattern (`internal/tui/routing.go:83-96`):
- `saveGroup(id string, change func(*provider.Group) error, done string) tea.Cmd`
- Encapsulates:
  1. Locating the in-memory group.
  2. Mutating the group via `change(&g)`.
  3. Calling `provider.SaveGroup(g)`.
  4. Returning a `flashMsg` message to update status indicators.
- Handled completely outside the main UI rendering thread via Bubble Tea commands (`tea.Cmd`).

---

## 6. Configuration Persistence Architecture

### Storage File Paths & Modes (`internal/appdir/appdir.go:201-245`, `internal/provider/provider.go:455`)

Magpie computes its configuration root dynamically via `appdir.Config()`:
- **Portable Mode**:
  - Triggered if a directory named `data` or a file named `.portable` exists beside the Magpie executable.
  - Path: `<exe_dir>/data/providers.json`.
- **Installed Mode**:
  - Respects `$XDG_CONFIG_HOME/magpie/providers.json` if set.
  - Defaults to `~/.config/magpie/providers.json` across all platforms (Linux, macOS, and Windows).

### File Format & Schema (`internal/provider/provider.go:550-575`, `internal/provider/group.go:148-250`)

Configuration is stored in formatted JSON (`json.MarshalIndent(f, "", "  ")`). The root object contains `providers` and `groups`:

```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "key": "sk-ant-..."
    }
  ],
  "groups": [
    {
      "id": "sonnet-fallback",
      "name": "Sonnet Fallback",
      "members": [
        "anthropic/claude-3-7-sonnet",
        "openrouter/anthropic/claude-3.5-sonnet"
      ],
      "routing": "order",
      "affinity": "session",
      "patience": 60,
      "firstToken": 15,
      "rules": [
        {
          "use": "openrouter/anthropic/claude-3.5-sonnet",
          "tokens": 150000
        }
      ]
    }
  ]
}
```

### Atomic & Crash-Safe Persistence (`internal/provider/provider.go:550-575`)

Magpie guarantees disk consistency through a multi-stage write pipeline:
1. **Dynamic member stripping**: Temporary catalog-matched models (`g.Matched`) are filtered out prior to marshaling (`f.Groups[i].stored()`); only user-configured static members (`Members`) and patterns (`Match`) are stored.
2. **Last-Good Backup** (`lastgood.Keep(p, validProviders, 0o600)`): Copies the existing file to a backup snapshot before writing.
3. **Atomic Replace (`writePrivate`)**: Writes JSON to a temporary file in the same directory and executes an atomic OS rename over `providers.json` with file permissions `0o600`.
4. **Cache Invalidation** (`catalog.Touched()`): Signals the runtime gateway and agent catalog to refresh cached routes.

---

## 7. Short Code Excerpts of Key TUI Components

### 1. In-Place Reordering with Boundary Check (`internal/tui/routing.go:370-387`)

```go
move := func(by int) (tea.Model, tea.Cmd) {
	to := m.gsel + by
	if to < 0 || to >= all || (to >= n) != onRule {
		return m, nil
	}
	from := m.gsel
	m.gsel = to
	if onRule {
		return m, saveGroup(g.ID, func(g *provider.Group) error {
			g.Rules[from-n], g.Rules[to-n] = g.Rules[to-n], g.Rules[from-n]
			return nil
		}, fmt.Sprintf("rule %d moved to %d", from-n+1, to-n+1))
	}
	return m, saveGroup(g.ID, func(g *provider.Group) error {
		g.Members[from], g.Members[to] = g.Members[to], g.Members[from]
		return nil
	}, g.Members[from]+" moved")
}
```

### 2. Functional Save Command Wrapper (`internal/tui/routing.go:83-96`)

```go
func saveGroup(id string, change func(*provider.Group) error, done string) tea.Cmd {
	return func() tea.Msg {
		g, ok := findGroup(id)
		if !ok {
			return flashMsg{text: "no group " + id}
		}
		if err := change(&g); err != nil {
			return flashMsg{text: err.Error()}
		}
		if err := provider.SaveGroup(g); err != nil {
			return flashMsg{text: err.Error()}
		}
		return flashMsg{text: done, ok: true}
	}
}
```

### 3. Visual Group List & Active Fallback Preview (`internal/tui/routing.go:586-608`)

```go
notes := []string{fmt.Sprintf("%d model%s", len(g.Members), plural(len(g.Members))), groupRouting(g)}
if g.Affinity != "" {
	notes = append(notes, staysName(g.Affinity))
}
if len(g.Rules) > 0 {
	notes = append(notes, fmt.Sprintf("%d rule%s", len(g.Rules), plural(len(g.Rules))))
}
members := strings.Join(g.Members, " → ")
line += "  " + sText.Render(strings.Join(notes, " · "))
if room := m.w - lipgloss.Width(line) - 4; room > 10 {
	line += "  " + sMuted.Render(trunc(members, room))
}
b.WriteString(line + "\n")
```

### 4. Double-Tap Delete Confirmation with Cascade Warning (`internal/tui/routing.go:523-537`)

```go
if m.confirm != "member/" + id {
	m.confirm = "member/" + id
	m.flash, m.flashOK = "press d again to take "+id+" out", false
	if slices.ContainsFunc(g.Rules, func(r provider.Rule) bool { return r.Use == id }) {
		m.flash += " and its rules"
	}
	return m, nil
}
m.confirm = ""
m.gsel = clamp(m.gsel, all-1)
return m, saveGroup(g.ID, func(g *provider.Group) error {
	g.Members = slices.DeleteFunc(g.Members, func(x string) bool { return x == id })
	g.Rules = slices.DeleteFunc(g.Rules, func(r provider.Rule) bool { return r.Use == id })
	return nil
}, id+" taken out")
```

### 5. Domain-Specific Rule Parsing (`internal/provider/ruleparse.go:90-109`)

```go
for _, w := range words {
	k, v, hasV := strings.Cut(w, "=")
	k = strings.ToLower(strings.TrimSpace(k))
	switch k {
	case "use", "model", "to":
		id, err := GroupMember(g, v)
		if err != nil {
			return r, 0, "", err
		}
		r.Use = id
	case "pause", "skip":
		id, err := GroupMember(g, v)
		if err != nil {
			return r, 0, "", err
		}
		r.Use, r.Pause = id, true
	case "tokens", "context", "longer":
		n, err := ParseTokens(v)
		if err != nil {
			return r, 0, "", err
		}
		r.Tokens = n
```

### 6. Atomic File Persistence (`internal/provider/provider.go:550-570`)

```go
func store(f file) error {
	p := Path()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	f.Groups = slices.Clone(f.Groups)
	for i := range f.Groups {
		f.Groups[i] = f.Groups[i].stored()
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	if err := lastgood.Keep(p, validProviders, 0o600); err != nil {
		return err
	}
	if err := writePrivate(p, append(b, '\n')); err != nil {
		return err
	}
	catalog.Touched()
	return nil
}
```

---

## 8. UX Patterns Worth Copying

1. **Unified Vertical List for Mixed Entities**: Magpie flattens members and conditional rules into a single continuous vertical cursor list. Users navigate from member 3 directly to rule 1 using ordinary `j`/`k` motions, eliminating clumsy tab switching or pane toggles.
2. **Immediate In-Place Reordering (`Shift+J`/`Shift+K`)**: Reordering fallback priority does not require opening an "edit order" mode or dialog. The user navigates to an element and immediately shifts it with `J` or `K`, with live visual feedback and immediate persistence.
3. **Non-Modal Double-Tap Confirmation**: Destructive actions (deleting groups, members, or rules) require pressing `d` twice in succession. Any intervening keystroke clears the confirmation state. This avoids disruptive confirmation dialogs while keeping operations completely keyboard-fluid.
4. **Context-Sensitive Cascade Warnings**: When removing a member that is referenced in conditional routing rules, the confirmation prompt dynamically updates to warn that dependent rules will also be pruned (`"press d again to take <id> out and its rules"`).
5. **Two-Stage Creation Funnel**: Group creation binds name input directly into the member picker (`n` -> type name -> `Enter` -> fuzzy pick first model). This enforces the structural invariant that empty groups never exist.
6. **Visual Inline Pipeline Summaries**: In the top-level group list, Magpie renders a truncated pipeline preview (`modelA → modelB → modelC`) in available terminal width, allowing users to inspect active fallback chains without drilling down into each group.
7. **Human-Readable Natural Cycle Labels**: Strategy cycling (`o`) and affinity cycling (`s`) render concise, humanized phrases in headers and lists (`"in order"`, `"stays the session"`, `"weekly pace"`) rather than raw internal enum strings.
8. **Dynamic Pattern Expansion alongside Explicit Chains**: Groups support both fixed member chains and dynamic pattern expressions (`*.free`), allowing fallback chains to absorb newly released catalog models automatically.

---

## 9. Patterns to adopt for a Pi-extension TUI

Below are key design patterns directly applicable to a Pi-extension terminal UI for filtering OpenRouter catalogs and configuring fallback routing:

- **1. Adopt Unified Single-List Navigation for Fallbacks & Filters**: Place the primary provider/model fallback sequence and conditional filter overrides in a single contiguous vertical list so arrow keys (`j`/`k`) traverse the entire pipeline without switching panes.
- **2. Implement Shift-Key Reordering (`J`/`K`) for Fallback Priority**: Allow users to bump provider priority up or down instantly using `Shift+Down` / `Shift+Up` (`J`/`K`), recalculating fallback priority in-memory and persisting configuration immediately.
- **3. Utilize Double-Tap Destructive Confirmation**: Replace blocking popup confirmation modals with a transient two-step double-tap pattern (`d` once to arm with a status bar alert, `d` again to execute, any other key to disarm).
- **4. Enforce Non-Empty Invariant via Sequential Creation**: When creating a new route filter or fallback group, chain the name prompt directly into the catalog picker so a filter is never created in an invalid zero-model state.
- **5. Provide Live Truncated Pipeline Previews**: In the master list view, calculate remaining terminal width and render an inline arrow summary (`providerA → providerB → providerC`) to give instant visibility into the fallback hierarchy.
- **6. Cycle Algorithms via Single-Key Toggles (`o` / `s`)**: Avoid nested dropdown menus for routing strategies (`ordered`, `lowest-latency`, `lowest-cost`, `round-robin`); allow cycling through valid modes with a single hotkey, updating visual state instantly.
- **7. Embed Domain Syntax Hints in Freeform Filter Bars**: When allowing users to input complex filter/routing conditions (e.g. `latency<200ms`, `context>100k`, `cost<free`), display the full syntax and token examples directly below the input prompt.
- **8. Adopt Atomic Rename-Based Configuration Writes**: Guard against corrupted JSON states during IDE restarts or concurrent agent requests by writing updates to a temporary sibling file and performing an atomic OS rename with restrictive permissions (`0o600`).
