# MedoMusic animation plans

| # | Plan | Severity | Status |
| --- | --- | --- | --- |
| 001 | Gate hover motion and keep it compositor-only | HIGH | TODO |
| 002 | Scope compositor promotion to active motion | MEDIUM | TODO |
| 003 | Replace global reduced-motion overrides with targeted feedback | MEDIUM | TODO |

Recommended order: 001, 003, then 002. Plans are independent, but 001 and 003
both touch the hover and reduced-motion sections of `src/styles.css`, so execute
them together or re-read the second plan against the updated file before editing.
