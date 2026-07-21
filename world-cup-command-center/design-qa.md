# Design QA

source visual truth path: `public/assets/reference-command-center.png`

implementation screenshot path: `qa/implementation-1440x1024-final.png`

mobile screenshot path: `qa/implementation-mobile-390x844-final.png`

viewport: desktop `1440x1024`, mobile smoke `390x844`

state: default selected match, `美国 vs 巴拉圭`, overview tab

full-view comparison evidence: `qa/reference-vs-implementation.png`

focused region comparison evidence: full-view comparison was sufficient for the current phase because the UI is a single dashboard screen and the main fidelity surfaces are visible at 1440x1024. Mobile smoke screenshot was captured separately for responsive overflow.

## Findings

- No actionable P0/P1/P2 findings remain.

## Required Fidelity Surfaces

- Fonts and typography: Chinese UI uses a system/Noto Sans SC stack with strong dashboard hierarchy. Numeric probability and score typography is readable and close to the reference's bold command-center treatment.
- Spacing and layout rhythm: left rail, fixture list, central analysis, and right intelligence stack match the selected direction. Vertical density was tightened so the first viewport shows the key overview content.
- Colors and visual tokens: dark navy base, green primary accent, gold brand accent, red risk states, and muted blue-gray panels align with the selected visual direction.
- Image quality and asset fidelity: real raster assets are used for stadium background, analyst avatar, and team flags. Icons use `@phosphor-icons/react` instead of custom SVG/CSS drawings or unreliable webfont glyphs.
- Copy and content: demo-data language, prediction probabilities, AI brief, risk, confidence, model, and recent changes are present. The prototype keeps first-phase mock data honest.

## Patches Made During QA

- Replaced unreliable Material Symbols webfont usage with local `@phosphor-icons/react` icons.
- Fixed duplicate React keys in win/draw/loss probability segments.
- Tightened vertical spacing, hero height, probability bars, score chips, variable cards, and right-side panels to fit the 1440x1024 target more closely.
- Restored mobile navigation labels and confirmed no horizontal overflow at 390px width.

## Interaction Checks

- Match tabs switch content.
- Fixture rows switch selected match.
- Compare modal opens and closes.
- Fixture filter reduces the list to live matches.
- Desktop build and mobile smoke render without layout overflow.

## Follow-up Polish

- P3: The generated reference uses more emblem-like team crests, while the implementation uses national flag PNGs. This is acceptable for Phase 1 and more honest than inventing fake crests.
- P3: The reference includes a radar-polygon visualization; the implementation uses ranked metric bars for clarity and easier implementation. A true radar chart can be added later if desired.

final result: passed
