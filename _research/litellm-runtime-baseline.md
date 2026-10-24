# LiteLLM Runtime Baseline — measurement run (2026-10-13)

**Verdict: PROXY NOT RUNNING. No runtime baseline could be captured.**

- Target: local LiteLLM proxy `http://127.0.0.1:4000` (master key `sk-litellm-local`).
- Workspace: `D:\repository\pi-openrouter-catalog-filter`.
- Scope: measurement only. The proxy was **not** started, stopped, or restarted; no proxy or config files were modified; **0 of the 2 permitted chat-completion requests were sent** (upstream quota untouched).
- File-boundary note: the run boundary said "do not create any file", while the deliverable explicitly required writing this report. Interpretation applied: the boundary protects the router/config environment; the only file created is this requested report (its `_research\` directory included).

## Step results

| Step | Check | Outcome | Raw values observed |
|---|---|---|---|
| 1 | Is `127.0.0.1:4000` listening? | **DONE — negative** (proxy not running) | `Test-NetConnection -ComputerName 127.0.0.1 -Port 4000 -InformationLevel Quiet` → `False` (warning: `TCP connect to (127.0.0.1 : 4000) failed`). Corroboration A — direct .NET TCP connect → `TCP_CONNECT_FAIL: ... "No connection could be made because the target machine actively refused it 127.0.0.1:4000"` (exception wrapper text rendered in Korean system locale). Corroboration B — `Get-NetTCPConnection -LocalPort 4000` → **no rows** (no listener). Corroboration C — no process with `litellm` in its command line; the only python processes found (PIDs **35180**, **41616**, started `2026-10-12 23:50:28`) belong to an unrelated project (`D:\repository\mileage_ticket_finder` mileage scanner). |
| 2 | `GET /v1/models` | **SKIPPED** — step-1 gate ("if nothing is listening, STOP … skip the rest") | **NOT OBSERVED** — HTTP status, model-id count, and presence of `coding-fallback` / `dashscope-coding-fallback` were not measured. |
| 3 | Read `C:\Users\airgu\.pi\agent\litellm_config.yaml` | **SKIPPED** — step-1 gate | **NOT OBSERVED** — `model_list` entry count and the first three `router_settings.fallbacks` entries were not measured. |
| 4 | `POST /v1/chat/completions` (`model: coding-fallback`) | **SKIPPED** — step-1 gate | **NOT OBSERVED** — no request sent; HTTP status, elapsed seconds, echoed `model`, `x-litellm-*` headers, assistant message: not measured. |
| 5 | Conditional second POST (`model: dashscope-coding-fallback`) | **SKIPPED** — not reached | **NOT OBSERVED**. |

## What could not be determined

Everything about the router's runtime behavior, specifically:

- Whether `coding-fallback` and `dashscope-coding-fallback` appear in `GET /v1/models` — **NOT OBSERVED** (proxy down; step skipped per the gate).
- The number of model ids the proxy exposes — **NOT OBSERVED**.
- Whether a chat completion via `coding-fallback` succeeds, its latency through the fallback chain, which upstream model actually serves it, which `x-litellm-*` headers it returns, and the assistant reply — **NOT OBSERVED** (no request sent; 0/2 allowed requests consumed).
- Static config facts (number of `model_list` entries; first three `router_settings.fallbacks` entries) — **NOT OBSERVED**; the step-1 gate said to skip the remaining steps, so the config file was not read either.

## Exact commands used (as executed, PowerShell)

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 4000 -InformationLevel Quiet   # -> False
try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 4000) } catch { $_.Exception.Message }   # -> "No connection could be made because the target machine actively refused it 127.0.0.1:4000"
Get-NetTCPConnection -LocalPort 4000                                            # -> no rows
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'litellm' } # -> no rows
```

## Environment observations (raw)

- Execution shell: Windows PowerShell; system locale rendered as Korean in error/timestamp text.
- `curl.exe 8.21.0` is available (checked as a candidate HTTP client; not used because steps 2–5 were skipped).

## Suggested follow-ups (not performed — outside this run's boundary)

1. Start the proxy (user action; this run was instructed not to): `uvx --with "litellm[proxy]" litellm --config C:\Users\airgu\.pi\agent\litellm_config.yaml --port 4000 --host 127.0.0.1`, then re-run this baseline for a real runtime baseline.
2. The static config facts (step 3) can be captured read-only at any time without the proxy; skipped this round only because the step-1 gate said to skip the rest.
