# pi-coding-fallback

A Pi extension that keeps a coding-fallback chain — `model_group_alias` and
`fallbacks` inside a LiteLLM router config — in step with that config's
`model_list`, ordered by the Artificial Analysis Intelligence Index.

```
/coding-fallback                       report drift, unranked models, unclassified hosts
/coding-fallback check                 the same, read-only
/coding-fallback sync                  refresh the free-model listing, then rewrite the generated blocks
/coding-fallback add                   the picker: choose an upstream, mark the models it serves
/coding-fallback add <model-id> <host-or-slug> [<group-name>]
                                       the same registration without the picker
```

Install:

```bash
pi install git:github.com/kijonggong/pi-coding-fallback@main
```

The extension reads and writes `<agent-dir>/litellm_config.yaml` by default;
`PI_CODING_FALLBACK_CONFIG` points it at another file, and
`PI_CODING_FALLBACK_FREE_REFRESH=off` keeps it off the network entirely.

Everything else — what the composer guarantees, what `add` refuses, the picker's
keys, the environment variables, and the limits — is in
[`extensions/coding-fallback/README.md`](extensions/coding-fallback/README.md).

Tests:

```bash
node --test extensions/coding-fallback/*.test.ts
```
