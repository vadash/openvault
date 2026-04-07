# Testing Subsystem (Vitest)

## THE TEST PYRAMID
- **Unit Tests:** Test pure math, data transforms, and text utilities by passing objects directly. **Zero `vi.mock()` allowed.** No `setupTestContext()`.
- **UI Structure Tests:** Parse `templates/settings_panel.html` via regex/string-matching to verify progressive disclosure layout. No JSDOM setup required.
- **Integration Tests:** Test pipeline wiring using `setupTestContext()`. 

## THE INTEGRATION BOUNCER RULE
- **Lock orchestrator tests.** Files like `extract.test.js`, `retrieve.test.js`, and `communities.test.js` are locked. 
- **Do not add permutations here.** If you add a new JSON schema field or formatting bucket, test the logic in `structured.test.js` or `formatting.test.js`. 
- **Limit orchestrator tests.** Keep to 3-5 maximum (Happy Path, Graceful Degradation, Fast-Fail).

## MOCKING BOUNDARIES
- **Never mock internal modules.** (Exceptions allowed only for isolated `embeddings.js` edge cases).
- **Control ST boundaries via `setupTestContext`.** Use `getDeps()` injection in `tests/setup.js` to fake `getContext`, `saveChatConditional`, and `fetch`.
- **Use `global.registerCdnOverrides()`.** Map CDN imports to local `node_modules` during tests. Re-invoke this after any `vi.resetModules()` call.

## TEST DATA
- **Use Factory Builders.** Import `buildMockMemory()` and `buildMockGraphNode()` from `tests/factories.js`. Do not use messy inline objects for structural tests.
- **Use inline objects for math tests.** When testing scoring logic, inline objects are preferred so the specific numbers being tested are overtly visible.
- **Use `vi.useFakeTimers()`.** Never wait for real `setTimeout` delays in test suites.

## STORE TESTS (chat-data)
- **Always provide `saveChatConditional` in deps.** `setupTestContext({ deps: { saveChatConditional: vi.fn() } })` — updateEntity/deleteEntity call this.
- **Reset graph data per test.** Set `data.graph = { nodes: {}, edges: {}, _mergeRedirects: {} }` in `beforeEach` to avoid cross-test leakage.
- **Use `buildMockGraphNode()` for entity nodes.** Never use inline objects — the factory sets required fields consistently.