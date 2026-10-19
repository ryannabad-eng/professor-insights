# Professor detection fixture tests

These dependency-free tests run the real `extractPageContext` and `addCandidate`
functions from `detector.js` against small portal fixtures. They also verify that
the toolbar injection is capable of reaching PeopleSoft's `ptifrmtgtframe`.

Run them from the extension directory:

```powershell
node --test .\tests\detection.test.mjs
```

The fixtures intentionally describe desired behavior, so a parser or frame gap
appears as a failing test. Add a sanitized fixture when a new portal layout is
reported; do not copy private student data into this directory.

Coverage:

- PeopleSoft classic `MTG_INSTR` fields
- PeopleSoft Fluid label/value markup
- accessible `aria-label` cards
- multiple instructors inside one field
- modern `Faculty` / `data-testid` cards
- current Cal Poly Material UI instructor grids
- instructor names supplied only through an ARIA label
- PeopleSoft target-content iframe reachability

The DOM facade implements only what the production detector uses: `body.innerText`,
the current instructor selector list, and element `textContent`. It is not a
general-purpose browser DOM replacement.
