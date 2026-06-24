# Masthead LLM Copy And Kanban Lanes Plan

> Date: 2026-06-23
> Status: Optimized, not implemented
> Scope: OpenAI-backed plain-language copy, four-column lifecycle board, and corrected Needs action routing
> Optimization score: 94/100

## Objective

Make Masthead lifecycle-first and easier to read at a glance without weakening the live-session core.

Definition of done:

- Running sessions always appear in `Running`, even when they have approvals, questions, failed commands, risk, or conflict indicators.
- `Needs action` contains only ended sessions that require follow-up.
- The board is a four-column Kanban layout: `Running`, `Idle`, `Needs action`, `History`.
- Cards and modal headers use clear plain-language copy.
- OpenAI copy enrichment is server-side, sanitized, cached, timeout-bounded, and optional.
- The app remains useful with no OpenAI key or failed OpenAI requests.
- Tests, typecheck, build, dogfood, and browser verification pass.

## Non-Goals

- Do not let the LLM decide lifecycle, lane, urgency, completion, or outcome.
- Do not send raw transcripts, user prompts, full command output, full diffs, shell history, file contents, paths, env vars, or credentials to OpenAI.
- Do not call OpenAI from the browser.
- Do not store or commit API keys.
- Do not implement the future multi-agent support matrix in this change.
- Do not add an ended-outcome classifier yet; this change rewrites known facts into better language.

## Official OpenAI Docs Check

Docs checked before this plan:

- Responses API endpoint: `POST /v1/responses` from `https://developers.openai.com/api/reference/resources/responses/methods/create`
- Responses API OpenAPI spec for `https://api.openai.com/v1/responses`
- Structured Outputs guide: `https://developers.openai.com/api/docs/guides/structured-outputs`
- GPT-5 nano docs: `https://developers.openai.com/api/docs/models/gpt-5-nano`
- GPT-5.4 nano docs: `https://developers.openai.com/api/docs/models/gpt-5.4-nano`

Implementation decisions from docs:

- Use the Responses API.
- Send `model`, `instructions`, `input`, `max_output_tokens`, `store: false`, and `text.format`.
- Extract assistant `output_text`.
- Use structured JSON output via `text.format` where supported, then still validate locally.
- Default to GPT-5 nano because Tyler asked for it.
- Make the model configurable because current docs recommend GPT-5.4 nano for most new speed- and cost-sensitive workloads.

Pre-implementation gate:

- Re-check the current `text.format` shape in the official docs immediately before writing the OpenAI client.
- If the exact structured-output shape has changed, adapt the client and tests to the current Responses API shape before implementation continues.

## Security And Env Hygiene

The API key pasted into chat should be treated as exposed. Implementation must not copy it from chat into files, commands, test output, logs, docs, or browser-visible payloads. Use a rotated key in local env.

Tasks:

1. Update `.gitignore`.

   ```text
   .env
   .env.local
   .env.*.local
   ```

2. Add `.env.local.example`.

   ```text
   OPENAI_API_KEY=
   MASTHEAD_LLM_COPY=1
   MASTHEAD_OPENAI_MODEL=gpt-5-nano-2025-08-07
   ```

3. The local ingest server reads secrets only from `process.env`.

4. `/health` may expose non-secret LLM status only:

   ```json
   {
     "llmCopy": {
       "enabled": true,
       "configured": true,
       "model": "gpt-5-nano-2025-08-07",
       "cacheEntries": 12
     }
   }
   ```

5. Never expose API key values, prefixes, request headers, raw request bodies, or raw OpenAI errors in:

   - server logs
   - `/health`
   - `/events`
   - `/projection`
   - UI
   - tests
   - diagnostics

## Current Code Touchpoints

Core:

- `src/core/types.ts`: board/card/lane/copy contracts.
- `src/core/replay.ts`: deterministic projection, card construction, lane construction.
- `src/core/liveProjection.ts`: live projection envelope.
- `src/core/reviewDispositions.ts`: lane rebuild after review actions.
- `src/core/dogfood.ts`: release gates.
- `schemas/ui-projection.schema.json`: projection contract.

Server:

- `scripts/masthead-ingest-server.js`: `/projection`, `/health`, `/events`, `/ingest`.

App and UI:

- `src/app/App.tsx`: empty board, polling, selected session.
- `src/app/liveProjectionClient.ts`: envelope validation.
- `src/ui/SessionBoard.tsx`: lane rendering.
- `src/ui/SessionCard.tsx`: card copy.
- `src/ui/SessionDetailModal.tsx`: modal header/details.
- `src/ui/BoardSummary.tsx`: summary counts.
- `src/ui/filterBoard.ts`: searchable fields.
- `src/styles/masthead.css`: Kanban layout and responsive polish.

Tests:

- `src/core/__tests__/projection.test.ts`
- `src/core/__tests__/reviewDispositions.test.ts`
- `src/core/__tests__/dogfood.test.ts`
- `src/core/__tests__/ingestServer.test.ts`
- `src/ui/__tests__/liveBoard.test.tsx`
- `src/app/__tests__/liveProjectionClient.test.ts`

New modules:

- `src/core/sessionCopy.ts`: deterministic copy, sanitization, validator, cache key.
- `src/core/openaiSessionCopy.ts`: server-side Responses API client and parser.
- `src/core/__tests__/sessionCopy.test.ts`
- `src/core/__tests__/openaiSessionCopy.test.ts`

## Target Data Contract

Add plain copy fields while preserving raw state for filtering, diagnostics, and modal evidence.

```ts
export type SessionCopySource = "deterministic" | "llm" | "fallback";

export type SessionPlainCopy = {
  headline: string;
  status: string;
  reason: string;
  nextStep?: string;
  source: SessionCopySource;
};
```

Add `copy: SessionPlainCopy` to:

- `SessionCardView`
- `SessionDetailView`
- `ExpandedSessionView`

Do not remove existing fields:

- `stateLabel`
- `primaryStatus`
- `lifecycle`
- `attentionReason`
- `outcomeLabel`
- `endReason`

The UI renders `copy` first and moves raw fields into secondary details.

## Sanitized LLM Input Contract

Use a strict allowlist. Do not send raw attention titles because those can drift into user text, paths, or command names.

```ts
type SessionCopySignal =
  | "approval_waiting"
  | "user_reply_waiting"
  | "command_failed"
  | "repeated_failure"
  | "stalled"
  | "verification_missing"
  | "verification_stale"
  | "high_risk_change"
  | "conflict_detected";

type SessionCopyInput = {
  lifecycle: "running" | "idle" | "ended";
  primaryStatus:
    | "starting"
    | "planning"
    | "reading"
    | "editing"
    | "running_command"
    | "testing"
    | "waiting_for_approval"
    | "waiting_for_user"
    | "blocked"
    | "stalled"
    | "possibly_looping"
    | "failed"
    | "completed_unreviewed"
    | "completed_reviewed"
    | "abandoned"
    | "unknown";
  outcomeLabel?: "completed" | "needs_attention" | "blocked" | "failed" | "abandoned" | "unknown";
  endReason?: "completed" | "blocked" | "failed" | "needs_user" | "needs_approval" | "abandoned" | "unknown";
  signals: SessionCopySignal[];
  conflictCount: number;
  changedFileBucket: "none" | "one" | "few" | "many";
  lastActivityBucket: "just_now" | "recent" | "quiet" | "old";
  durationBucket: "short" | "medium" | "long";
  identityConfidence: "direct" | "correlated" | "shared_workspace" | "unattributed";
};
```

Sanitizer requirements:

- Convert counts into buckets where exact values are not needed for copy.
- Convert attention types into generic `signals`.
- Never include file paths, command strings, raw summaries, payload text, branch names, repo names, user names, or source event IDs.
- Unit tests must fail if sanitizer output contains `/`, `sk-`, `OPENAI_API_KEY`, `npm`, raw prompt-like phrases, or fixture payload summaries.

## LLM Output Contract

Expected model output:

```json
{
  "headline": "Still running",
  "status": "Working now",
  "reason": "This session is active and has recent activity.",
  "nextStep": "Open it if you want to inspect details."
}
```

Validation rules:

- `headline`: 2-48 chars.
- `status`: 2-64 chars.
- `reason`: 2-140 chars.
- `nextStep`: optional, max 100 chars.
- No agent/person names.
- No raw enum strings such as `completed_unreviewed`, `waiting_for_user`, `ended_review`, `needs_action`.
- No unsupported claims. Example: model output cannot say "completed" unless input lifecycle is `ended` and outcome is `completed`.
- No paths, commands, secrets, or URLs.
- If validation fails, return deterministic fallback.

## Responses API Client Shape

Use native `fetch` from the local Node server. Keep this dependency-free unless the implementation hits a concrete SDK-only need.

```ts
await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    model,
    instructions: [
      "Rewrite Masthead session metadata into calm, plain English.",
      "Only restate the facts in the input.",
      "Do not infer lifecycle, outcome, urgency, identity, or completion.",
      "Do not mention raw enum names.",
      "Return only the requested JSON fields."
    ].join(" "),
    input: JSON.stringify(input),
    max_output_tokens: 180,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "masthead_session_copy",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["headline", "status", "reason"],
          properties: {
            headline: { type: "string" },
            status: { type: "string" },
            reason: { type: "string" },
            nextStep: { type: "string" }
          }
        }
      }
    }
  })
});
```

Client behavior:

- Injectable `fetch`, `apiKey`, `model`, timeout, and clock for tests.
- Timeout per request: 500 ms default.
- Use `AbortController`.
- Parse the first assistant `output_text`.
- Return deterministic fallback on timeout, non-200, missing output text, invalid JSON, or invalid copy.
- Record only non-secret failure categories: `not_configured`, `disabled`, `timeout`, `api_error`, `invalid_output`.

## Projection Enrichment Architecture

Keep pure projection deterministic.

1. `projectFixture` builds all cards, details, lanes, and deterministic `copy`.
2. `scripts/masthead-ingest-server.js` calls `projectLiveEvents`.
3. The server overlays LLM copy by session ID after deterministic projection is built.
4. The overlay updates:

   - `projection.cards[*].copy`
   - `projection.selectedSession.copy`
   - `projection.expandedSession.copy`

5. If LLM enrichment fails or times out, the deterministic projection is returned unchanged.

This prevents LLM latency or failure from hiding live sessions.

## Cache And Concurrency

Add an in-memory cache in the ingest server:

- Key: hash of sanitized `SessionCopyInput` plus copy schema version plus model id.
- Value: validated `SessionPlainCopy`.
- TTL: 10 minutes.
- Max entries: 500.
- In-flight request coalescing: repeated same-key requests share one promise.
- Max concurrent OpenAI requests per projection: 2.
- Per-projection enrichment budget: 500 ms total.

Cache invalidation:

- New sanitized input hash creates a new entry.
- Model change creates a new namespace.
- Schema version change creates a new namespace.

## Lane Semantics

Change lane IDs to four columns:

```ts
export type LifecycleLaneId = "running" | "idle" | "needs_action" | "history";
```

Column definitions:

- `Running`: active sessions currently running. This includes approvals, questions, failed commands, conflicts, and high-risk indicators while the session is still active.
- `Idle`: active sessions that have not ended but are quiet past the idle threshold.
- `Needs action`: ended sessions that need a human decision before they are safe to file away.
- `History`: ended sessions that are completed, reviewed, expected, dismissed, or otherwise no longer require action.

Route in this order:

```ts
function laneForCard(card, attentionQueue, conflicts) {
  if (card.lifecycle === "running") return "running";
  if (card.lifecycle === "idle") return "idle";
  if (endedSessionNeedsAction(card, attentionQueue, conflicts)) return "needs_action";
  return "history";
}
```

`endedSessionNeedsAction` must start with:

```ts
if (card.lifecycle !== "ended") return false;
```

Ended sessions need action when any of these are true:

- unresolved immediate attention item
- unresolved conflict evidence for that ended session
- `primaryStatus` is `failed`, `blocked`, `waiting_for_user`, or `waiting_for_approval`
- `outcomeLabel` is `needs_attention`, `blocked`, `failed`, or `unknown`
- `endReason` is `blocked`, `failed`, `needs_user`, `needs_approval`, or `unknown`
- no verification was observed and the session claims completion

Migration tasks:

- Remove `ended_review` from `LifecycleLaneId`.
- Remove `ended_review` from all lane arrays.
- Remove or deprecate `summary.endedToReview`; prefer no deprecated field unless a test or UI consumer still needs it.
- Update `emptyLiveBoard` in `src/app/App.tsx`.
- Update `schemas/ui-projection.schema.json`.
- Update `src/app/liveProjectionClient.ts` validation.
- Update `src/core/reviewDispositions.ts` so reviewed, dismissed, and expected terminal sessions land in `history`.
- Update `src/core/dogfood.ts` to assert four lanes and no active session in `Needs action`.

## UI Design Plan

Board:

- `SessionBoard.tsx` renders four columns in fixed order: Running, Idle, Needs action, History.
- Desktop: four columns.
- Tablet: two columns.
- Mobile: one column.
- Column headers show count and a short plain-language label.
- Empty lanes are compact and quiet.
- No card expansion; clicking opens `SessionDetailModal`.

Cards:

- Primary text:

  - `session.copy.headline`
  - `session.copy.status`
  - `session.copy.reason`

- Secondary facts:

  - last activity
  - duration
  - changed file bucket or count
  - subtle indicators for attention/conflict/risk/degraded attribution

- Do not foreground raw lifecycle/status enums.

Modal:

- Header uses `session.copy`.
- Keep lifecycle, outcome, attention, conflict, evidence, timeline, and workspace facts below the header.
- Show copy source only in a small diagnostics row, not on the card.
- Preserve safe actions and existing evidence trust model.

Search/filter:

- Update `filterBoard.ts` so search includes plain copy fields plus existing title/project/technical fields.

CSS:

```css
.session-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

@media (max-width: 1180px) {
  .session-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .session-board {
    grid-template-columns: 1fr;
  }
}
```

Visual constraints:

- Running: restrained green accent.
- Idle: neutral or blue accent.
- Needs action: restrained red/yellow accent.
- History: muted neutral.
- No large decorative blocks.
- No nested cards.
- Text must fit in cards and buttons across desktop and mobile.

## Implementation Sequence

### Phase 1: Contracts And Failing Tests

Edit:

- `src/core/types.ts`
- `src/core/__tests__/projection.test.ts`
- `src/core/__tests__/reviewDispositions.test.ts`
- `src/app/__tests__/liveProjectionClient.test.ts`
- `src/ui/__tests__/liveBoard.test.tsx`

Add failing tests for:

- exactly four lanes
- running session with approval stays in `running`
- running session with failed command stays in `running`
- running session with active conflict stays in `running`
- idle session with attention stays in `idle`
- ended failed/blocked/needs-attention session goes to `needs_action`
- ended completed/reviewed/expected/dismissed session goes to `history`
- projection schema accepts `copy` and rejects `ended_review`

Exit condition:

- Targeted tests fail for the expected reasons only.

### Phase 2: Lane Routing And Schema Migration

Edit:

- `src/core/replay.ts`
- `src/core/reviewDispositions.ts`
- `src/core/liveProjection.ts` if summary shape changes
- `src/app/App.tsx`
- `src/app/liveProjectionClient.ts`
- `schemas/ui-projection.schema.json`
- `src/core/dogfood.ts`

Implement:

- four-lane type and arrays
- `endedSessionNeedsAction`
- deterministic `copy` placeholder on all projected cards/details
- updated empty board
- updated dogfood gates

Exit condition:

```bash
npm test -- --run src/core/__tests__/projection.test.ts src/core/__tests__/reviewDispositions.test.ts src/app/__tests__/liveProjectionClient.test.ts
```

### Phase 3: Deterministic Plain-Language Copy

Add:

- `src/core/sessionCopy.ts`
- `src/core/__tests__/sessionCopy.test.ts`

Implement:

- `toSessionCopyInput`
- `buildDeterministicSessionCopy`
- `validateSessionCopy`
- `sessionCopyCacheKey`
- sanitizer tests that prove no raw path, command, prompt, payload, secret, or raw attention title is emitted

Integrate deterministic copy into `toCard` and `toDetail`.

Exit condition:

```bash
npm test -- --run src/core/__tests__/sessionCopy.test.ts src/core/__tests__/projection.test.ts
```

### Phase 4: Server-Side OpenAI Copy Enrichment

Add:

- `src/core/openaiSessionCopy.ts`
- `src/core/__tests__/openaiSessionCopy.test.ts`

Edit:

- `scripts/masthead-ingest-server.js`
- `src/core/__tests__/ingestServer.test.ts`

Implement:

- env config
- Responses API client
- structured JSON parsing
- local validation
- fallback behavior
- timeout
- in-memory TTL cache
- in-flight coalescing
- max concurrency
- non-secret `/health` LLM status

Exit condition:

```bash
npm test -- --run src/core/__tests__/openaiSessionCopy.test.ts src/core/__tests__/ingestServer.test.ts
```

No test should require a real OpenAI API key or make a real network call.

### Phase 5: Kanban UI And Copy-First Presentation

Edit:

- `src/ui/SessionBoard.tsx`
- `src/ui/SessionCard.tsx`
- `src/ui/SessionDetailModal.tsx`
- `src/ui/BoardSummary.tsx`
- `src/ui/filterBoard.ts`
- `src/styles/masthead.css`
- `src/ui/__tests__/liveBoard.test.tsx`

Implement:

- four-column Kanban layout
- copy-first card text
- modal copy header
- raw technical details moved below the fold
- search includes copy fields
- responsive CSS

Exit condition:

```bash
npm test -- --run src/ui/__tests__/liveBoard.test.tsx
```

### Phase 6: Docs, Release Gates, And Full Verification

Edit:

- `.gitignore`
- `.env.local.example`
- `docs/release-gates.md`

Run:

```bash
npm test -- --run
npm run typecheck
npm run build
npm run dogfood
```

Browser verification with the Codex in-app Browser plugin:

1. Start live app:

   ```bash
   npm run dev
   ```

2. Open `http://127.0.0.1:5173`.
3. Confirm the current live Codex session appears in `Running`.
4. Confirm running sessions with attention indicators do not move to `Needs action`.
5. Confirm terminal follow-up cases appear in `Needs action`.
6. Confirm completed/reviewed/expected/dismissed sessions appear in `History`.
7. Verify desktop four-column, tablet two-column, and mobile one-column layouts.
8. Confirm no secret appears in UI, server logs, `/health`, `/events`, or `/projection`.

## Risk Controls

Risk: OpenAI request delays hide live sessions.

- Mitigation: deterministic projection returns first; LLM overlay is timeout-bounded and optional.

Risk: sanitized input accidentally includes sensitive text.

- Mitigation: allowlist input contract, bucketed counts, no raw titles, no raw summaries, sanitizer tests with leak probes.

Risk: LLM invents outcome or urgency.

- Mitigation: validator rejects unsupported claims; LLM output cannot drive lanes.

Risk: lane migration breaks review dispositions.

- Mitigation: explicit tests for reviewed, dismissed, expected terminal sessions landing in `History`.

Risk: stale clients or schemas accept `ended_review`.

- Mitigation: update `schemas/ui-projection.schema.json`, client validation, dogfood, and tests.

Risk: API key leaks through debug output.

- Mitigation: no raw request logging, non-secret diagnostics only, `.env.local` ignored, tests assert no key-like strings in envelopes.

## Acceptance Criteria

- `Needs action` contains zero running or idle sessions.
- Running sessions with approvals, questions, failed commands, conflicts, or risk indicators remain in `Running`.
- Ended sessions requiring human follow-up appear in `Needs action`.
- Completed/reviewed/expected/dismissed ended sessions appear in `History`.
- The board is a responsive four-column Kanban layout.
- Cards and modal headers use plain-language copy.
- OpenAI copy enrichment uses sanitized metadata only, `store: false`, server-side key access, cache, timeout, and fallback.
- The app works with `MASTHEAD_LLM_COPY=0`, missing `OPENAI_API_KEY`, OpenAI timeout, and invalid OpenAI output.
- Full verification commands pass.

## Optimizer Notes

Rubric:

- Goal fit and lifecycle semantics: 20
- OpenAI safety and docs compliance: 20
- Implementation specificity and sequencing: 20
- Test and verification coverage: 15
- UI/product clarity: 15
- Risk controls and operability: 10

Score trajectory:

- Initial plan: 82/100
- Round 1: 91/100 after adding explicit sequencing, schema/client touchpoints, and stricter privacy controls.
- Round 2: 94/100 after adding cache concurrency, non-secret health status, sanitizer leak probes, and phase exit conditions.
- Round 3: 94/100 plateau; remaining improvements would be implementation detail rather than plan quality.
