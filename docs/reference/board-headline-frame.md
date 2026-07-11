# Board Headline Frame Contract

`BoardHeadlineFrame` is the internal protocol/type name for headlines rendered on the product's
Now cards. “Board” in this reference does not name a separate product surface.

Masthead Board cards render a single headline from a structured `BoardHeadlineFrame`:

```text
<Subject>: <disposition>.
```

The model extracts the frame. Masthead renders the final string.

## Fields

| Field | Purpose |
| --- | --- |
| `subject` | Smallest concrete work object supported by evidence |
| `disposition` | Current concrete state or relationship of work around the subject |
| `state` | `active`, `blocked`, `needs_verification`, `paused`, `completed`, `failed`, `waiting`, or `unknown` |
| `subjectKind` | Work-object category such as `feature`, `component`, `bug`, `test`, `settings`, or `docs` |
| `confidence` | `high`, `medium`, or `low` |
| `evidence` | Short evidence strings copied or tightly paraphrased from normalized session facts |

## Board API

`SessionCardView` exposes:

- `headline`: rendered headline view, including `source`, `status`, and optional frame metadata.
- `headlineInput`: compact evidence packet used for frame extraction.
- `headlineRefresh`: latest refresh metadata for the card.

The Board API does not expose the former plain-copy fields.

## LLM-First Behavior

When `MASTHEAD_LIVE_COPY` is enabled and `OPENAI_API_KEY` is configured, Board headline generation is LLM-first:

- visible running cards schedule frame extraction in the background,
- cards render the last successful LLM headline when one exists,
- cards render a pending headline while waiting for the first successful LLM result,
- invalid output, timeouts, and provider errors do not synthesize local prose as successful LLM output.

Offline deterministic headline generation is allowed only when live LLM headline access is unavailable or explicitly disabled. Offline headlines are marked with `source: "offline"`.

## Evidence Rule

A frame may mention only facts present in normalized rows, source metadata, file effects, command/tool records, checkpoints, latest feedback summaries, transcript snippets approved for use, or durable enrichment linked to those inputs.

Forbidden content includes raw JSON, shell commands, URLs, local absolute paths, secrets, commit hashes, raw directives, and generic claims such as “recent activity” or “session update.”
