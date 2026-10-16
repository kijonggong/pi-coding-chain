# OpenRouter catalog filter

A Pi extension that narrows the OpenRouter model list to a chosen allowlist.

The extension replaces the OpenRouter model definitions with the models returned
by:

```text
https://pi.dev/api/models/providers/openrouter
```

and keeps only the families below visible. Everything else is hidden.

| Rule | Effect |
|---|---|
| id ends with `:free` | every free-tier model |
| id ends with `-alpha` | currently matches nothing in the live catalog |
| `deepseek/deepseek-v4.1-flash` and its tier variants (e.g. `:batch`) | 2 models |
| `auto`, `openrouter/auto` | Pi's virtual routing ids |

`deepseek/deepseek-v4-flash` (no `.1`) is a different family and stays hidden.

The allowlist applies to **every** catalog source, including the remote response
and both local fallbacks, because the fallback snapshots keep serving entries
after Pi's own catalog has dropped them.

## Retired models

Six models are no longer served by OpenRouter, checked against
`https://openrouter.ai/api/v1/models`, which lists every chat model OpenRouter
currently serves. They stay blocked even though they match an allowlist rule:

| Model | Why it is blocked |
|---|---|
| `stealth/space-bunny-alpha` | absent entirely, but the bundled and stored fallback catalogs still carry it and it matches the `-alpha` rule |
| `qwen/qwen3.8-27b:free` | the paid `qwen/qwen3.8-27b` is live, the `:free` tier is not |
| `minimax/minimax-m2.7:free` | paid id live, `:free` tier retired |
| `minimax/minimax-m3:free` | paid id live, `:free` tier retired |
| `z-ai/glm-5.2:free` | paid id live, `:free` tier retired |
| `inclusionai/ling-3.0-flash-fin:free` | paid id live, `:free` tier retired |

The other free models the allowlist exposes
(`dots-studio/dots-3-note-preview:free`, `inclusionai/ling-3.0-flash-sante:free`,
`liquid/lfm-2.5-2.6b:free`) are still served.

`https://openrouter.ai/api/v1/models` covers chat models only, so Pi's `image` and
`classifier` entries are never treated as retired.

Earlier versions were an exclude list (stale `minimax`/`z-ai` entries plus a
curated set of unsuitable free models). The allowlist plus the retired list
supersedes all of it.

If the remote request fails, the extension falls back to `models-store.json`,
then to the bundled catalog, with the allowlist applied. `PI_OFFLINE=1` skips the
network request.

## Turning the allowlist off

The allowlist replaces the provider's whole catalog, so the switch is
presence/absence rather than filter strength: `off` removes the override and Pi
composes the OpenRouter provider exactly as it would with the extension
uninstalled. Nothing else about the session changes, and no file outside the
agent directory is touched.

```text
/openrouter-catalog-filter          same as status
/openrouter-catalog-filter status   what is in force, and what it is keeping
/openrouter-catalog-filter off      stop overriding the catalog
/openrouter-catalog-filter on       narrow it again
/openrouter-catalog-filter reload   fetch the catalog again and reapply
/openrouter-catalog-filter list     the model ids the allowlist keeps
```

The argument is completed in the prompt, so the subcommands are discoverable.
The choice is kept in `openrouter-catalog-filter.json` under the agent directory
(`PI_OPENROUTER_FILTER_STATE` points the file elsewhere) and written atomically,
and `PI_OPENROUTER_FILTER=on|off` overrides it for one process without a UI.

**The default is `on`.** The extension was already narrowing the catalog before
it had a switch, so upgrading must not widen anyone's model list as a side
effect of the new state file not existing yet.

A value that could not be used is reported, never guessed: a broken state file
or a mistyped variable leaves the default in force and says so in the status
output, and a value the environment is holding is marked as such when the
command writes over it.

Two cautions, both about the environment rather than the code:

- **Two loaded copies fight.** If the installed package and a checkout passed
  with `-e` both provide this extension, the copy that registers the provider
  unconditionally wins, so an `off` written by the newer copy can be overridden
  by the older one. Update or remove the installed copy for the switch to be the
  only thing deciding.
- **`PI_OFFLINE=1` is not a switch.** It changes which source the list comes
  from (the stored snapshot or the bundled catalog instead of `pi.dev`); the
  allowlist is still applied on top of whichever source answers.

## Use

Install it as a Pi package:

```bash
pi install git:github.com/kijonggong/pi-openrouter-catalog-filter@main
pi update --extensions
```

Or copy this directory to the user extensions directory:

```text
~/.pi/agent/extensions/openrouter-catalog-filter/
```

Then restart Pi or run `/reload`. Verify with:

```bash
pi --list-models openrouter
```

The list is live, so what renders moves with the upstream catalog rather than
with this file. On 2026-10-17 it was 17 rows: 14 `:free`, 2 DeepSeek V4.1 Flash,
1 virtual routing id (`openrouter/auto`). An earlier revision of this README said
19; the rules are unchanged, the catalog is not. `/openrouter-catalog-filter
status` reports the current counts, including how many models the allowlist hid.
Removing the package (or the copied directory) restores Pi's normal catalog
composition — and so does `/openrouter-catalog-filter off`, without a reinstall.
