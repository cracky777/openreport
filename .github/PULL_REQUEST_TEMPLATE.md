<!--
Thanks for this. The sections below are short on purpose — the only one that
really matters is the second.
-->

## What this changes

<!-- One or two sentences. If it closes an issue: "Closes #42". -->

## Why

<!--
The behaviour that was wrong, or the thing that was impossible. A reviewer who
understands the why can check whether the fix is the right one; a reviewer who
only sees the diff can only check that it compiles.
-->

## How you know it works

<!--
What you ran, or what you clicked. If you added a test, say what it fails on
when the fix is removed — a test that passes either way proves nothing.
-->

## Checklist

- [ ] `cd server && npm test`
- [ ] `cd client && npm test`
- [ ] `cd client && npm run lint`
- [ ] `npm run test:e2e` (only if you touched the editor, the canvas or the query path)
- [ ] The PR does one thing. If it does two, it is easier to review as two.
