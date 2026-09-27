# PENAI

An AI penetration testing assistant for **authorised engagements only**. It maps
a surface, runs probes, records findings with the evidence attached, and writes
a report — while refusing to touch anything that was not put in scope.

The terminal client is Go (Bubble Tea). The engine is TypeScript. They are
separate programs that talk over a pipe, so the interface can be replaced, the
engine can be scripted, and neither has to know much about the other.

```
┌──────────────────────┐   newline-delimited JSON    ┌────────────────────────┐
│  penai-tui  (Go)     │ ───── stdio, JSON-RPC ────► │  penai serve (Node)    │
│  Bubble Tea client   │ ◄─── events, results ────── │  policy, scope, tools  │
│  no logic of its own │                              │  agent, store, report  │
└──────────────────────┘                              └────────────────────────┘
```

## Why the split

The client owns presentation and nothing else. Every decision — is this target
allowed, is this tool safe to run unattended, does the model need a human — is
made in the core, over the same code path the headless commands use. A UI bug
cannot widen the scope, because the UI never holds the scope.

## Install

```bash
npm install
npm run build          # the core, into dist/
npm run build:tui      # the client, into bin/
```

Node 22.6 or newer for the core, Go 1.22 or newer for the client.

## Run

```bash
./bin/penai-tui                 # the terminal client
npm start -- doctor             # check configuration, tools and scope
npm start -- tools              # the tool catalogue
npm start -- report --format html --out report.html
```

The client finds the core next to itself, then in `dist/` relative to the working
directory, then on `PATH`. `PENAI_CORE` overrides all of it:

```bash
PENAI_CORE="bun run cmd/penai/main.ts" ./bin/penai-tui
```

## The client

| Key | What it does |
| --- | --- |
| `1` … `6` | console, scout, findings, scope, report, audit |
| `tab` / `shift+tab` | cycle views |
| `enter` | send the prompt, or run what is selected |
| `esc` | close a dialog, clear the prompt |
| `page up` / `page down` | scroll |
| `/` | list the commands inline; `enter` runs, `tab` completes |
| `ctrl+g` | start a command |
| `ctrl+p` | the model dialog — `←`/`→` switches source, `r` fetches the live list |
| `ctrl+k` or `?` | help |
| `ctrl+l` | clear the console |
| `ctrl+c` | quit |

Commands typed into the console. Typing `/` lists them inline with their
descriptions, and `↑`/`↓` choose. `enter` runs whatever is chosen - typed,
half-typed or just arrowed onto - in one press; `tab` takes the name without
running it, for when an argument is coming next:

```
/scope add 10.16.0.0/28 lab range      authorise a target
/scope rm tgt_1                        withdraw it
/mode safe|balanced|full              the execution ceiling
/run tcp_scan targets=10.0.0.1 ports=22,80,443
/finding title|high|asset|description  record one by hand
/status fnd_1 confirmed                triage
/report html report.html               export
/interrupt                             stop the agent
```

Anything that is not a command is a request to the agent, in plain language.

## Configuration

**Nothing is required.** With no configuration at all, PENAI talks to OpenCode
Zen's anonymous tier: it serves zero-cost models with no account and no key, by
sending the literal bearer token `public` that the gateway publishes for exactly
that purpose. A fresh install can run a turn before anyone has signed up for
anything.

The free tier is rate limited per model, so one free model can be busy while
another answers. `/model` lists the free ones and `r` refetches the live list.

Nothing is bundled, and the core reads only two things: environment variables and
its own config file.

| Variable | Meaning |
| --- | --- |
| `PENAI_API_KEY` | key for a paid endpoint; leave empty for the free tier |
| `PENAI_BASE_URL` | defaults to the free tier, `https://opencode.ai/zen/v1` |
| `PENAI_MODEL` | the model id; defaults to a free one |
| `PENAI_PROVIDER` | `openai` (default) or `anthropic` |
| `PENAI_DATA_DIR` | where engagement evidence is written |
| `PENAI_ENGAGEMENT` | the engagement name |
| `PENAI_MODE` | `safe`, `balanced` or `full` |
| `PENAI_DENY` | targets that are never allowed, whatever else says |
| `PENAI_ALLOW_SHELL` | `1` lets the model run allowlisted binaries |
| `PENAI_CORE` | how the client launches the core |

`penai model list` shows every source it can see, and where the key for each
came from. Keys are never printed in full.

The model dialog lists two kinds of source, and says which is which:

- **current** — the endpoint this machine is configured with.
- **catalog** — the bundled vendor list, offered for any vendor whose key is
  already in `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

It reads no other tool's configuration. Nothing is imported, so what the dialog
shows is exactly what PENAI has been told about this machine.

## The rules it will not break

1. **Nothing outside the scope runs.** Not by the agent, not by the operator, not
   by a tool that was handed a target by accident. A target is only in scope once
   it is a stored entry.
2. **Risk above the ceiling asks.** `safe` asks for everything. `balanced` runs
   safe and low risk unattended. `full` still asks about destructive tools.
3. **Every decision is recorded.** Allow, deny, ask — with the reason the engine
   gave and the command it would have run. The audit view is the same data the
   report is built from.
4. **A finding is only as good as its evidence.** Evidence, reproduction and
   remediation are required fields, not optional ones.
5. **No credentials in the repository, and none borrowed from another tool.**
   Configuration comes from the environment or PENAI's own config file. It does
   not go looking in other programs' configs for keys.

## Layout

```
ai/          model providers, transport, protocol, agent loop
cli/         headless commands and the JSON-RPC server
cmd/penai/   the core entry point
go/          the terminal client (Go, Bubble Tea)
  cmd/penai-tui/
  internal/client/     the stdio pipe
  internal/protocol/   the wire types
  internal/ui/app/     state, keys, views, dialogs
internal/    config, store, shared utilities
model/       the shared types
policy/      what may run, and when it must ask
report/      markdown, html, sarif, json
scope/       target classification and matching
test/        the core test suite
tools/       the tool registry, and net, web, tls, external
```

One concern per file, and a folder per feature. The client mirrors that: the
views, the chrome, the layout helpers and the key map are all separate files.

## Tests

```bash
npm run typecheck      # the core type-checks
npm test               # 51 core tests
npm run test:tui       # the client tests
npm run check:language # nothing is written in any language but English
```

The client tests include the layout invariants that matter in a full-screen
program: a frame is exactly as many rows and columns as the terminal, at every
size, and no escape sequence is ever cut in half.
