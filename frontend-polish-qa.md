# Frontend polish verification — independent cinematic workflow scenes

## Current scope

- Header, main and footer share a centered 90% available-page width at every
  breakpoint; the former 1360px cap and fixed mobile side-gutter overrides are gone.
- The header is now a transparent, borderless normal-flow brand lockup aligned to
  the same 90% grid. The full-width white panel, shadow, blur and `AI ready`
  status element were removed from all three pages; no empty right-side placeholder
  remains. A one-pixel fading rule balances wide layouts, disappears below 520px,
  and the logo gets a restrained fine-pointer hover lift. Reduced-motion users do
  not receive that transform. A versioned stylesheet URL invalidates the former
  white-header browser cache.
- Static descriptive text was pared back on all pages, particularly Solve's
  duplicated labels, introduction, answer hints and submission description.
  Real challenge instructions, code, counters, file/session controls and full
  evaluation feedback are retained. Create keeps deliberate heading/form spacing;
  Solve's answer composer fills its column without a large gap above submission.
- Create → Solve → Review remains independent and one-way, with unchanged API
  contracts, persisted drafts, submission payloads and evaluation values.
- `workflow-theme.css` now gives all three pages one visual system: a transparent
  white brand rail, cyan step capsule, deep ocean-glass primary shell, ice-white
  work surface, blue-to-cyan forward action, shared 28/16px radius scale and one
  shadow hierarchy. Each video keeps its own art direction without changing the
  product identity between steps.
- Removed active cartoon illustrations, floating formula glyphs, kit/file-orbit/
  notebook click controls and their obsolete enhancement modules. Original raster
  masters remain available for recovery; the former tsParticles dependency is gone.
- Create now uses the Mindloop prompt's autoplaying, muted, looping MP4 as a fixed
  root background. Wide screens use a full, sharp contained composition over a
  synchronized soft-focus cover layer; narrower screens use a 60% vertical focal
  point and restrained 1.06 overscan. The sharp wide-screen composition is anchored
  at 30% of page width and translated upward by 10% of viewport height; narrow-screen
  horizontal focus remains 60%, keeping the animated subjects left of the form.
  Its height extends to 112% so the shifted layer's physical bottom edge stays
  outside the viewport. The former pale veil and bottom fade were removed so the
  source video retains its original contrast and color.
- Solve now uses the supplied recreation prompt's third Philosophy video: a
  cinematic night garden rendered behind the original workspace. The 4:3 source
  occupies 92% of the viewport with no secondary scale-up; a dark color-matched
  field and radial edge fade blend the remaining margin into the page. Its 56%
  vertical focal point keeps the illuminated plants visible across viewports.
  Fine-pointer movement adds restrained background-only parallax. Focusing either
  answer slows playback to 0.45×, dims and desaturates the scene, then restores it
  when the learner leaves the answer field.
- Review now uses the prompt-supplied Foldcraft looping MP4 as a full-viewport,
  full-cover background with a 70% horizontal focal point. The former pale veil is
  removed; glass content surfaces provide legibility without fogging the video.
- Review content uses the shared ocean-glass palette also applied to Create and
  Solve. The outer report shell is a dark translucent glass layer; feedback and
  next-step surfaces use cool frosted panels, and the score ring carries the
  cyan/blue highlight into the content hierarchy.
  Key body text measures approximately 6.79:1 contrast and dark-shell headings
  approximately 16.3:1 against their representative surfaces. Pointer-responsive
  rims use the same palette and do not move content or intercept input.
- The Create module no longer contains the architectural photo, wash, photo credit
  or photo-depth behavior. Its remaining neutral background tint is 20% opaque;
  text/form layout stays stable above that layer.
- Focused Solve input keeps its existing soft spotlight; original answer and draft
  values are untouched. Reduced motion pauses the video and touch receives no
  pointer parallax.
- Review's video module is presentation-only; it never reads or modifies score,
  feedback, session or workflow data.
- Successful forward steps use 180 ms outgoing / 260 ms incoming background-only
  handoffs. Single-use session markers are consumed; reload does not replay them.
- Header stays in normal document flow, with no fixed/sticky header or pause control.
- All video modules pause for hidden pages, page suspension and reduced-motion
  preference. Every scene falls back to its own neutral dark surface. The former
  white optical plate, poster references and inactive WebGL modules were removed,
  so no white animated layer remains beneath the current videos.

## Reference and provenance

MotionSites was inspected read-only through the user-authorized local Chromium on
mimas1. The ConSentinel glass preview informed material style and negative space;
its preview is recorded video, not evidence of a reusable interactive component.
No copyrighted gallery media was shipped. Poly Haven studio lighting and ambientCG
paper materials were researched as CC0 sources; this implementation instead uses
one original generated still life. See [source links and exact built-in image_gen
prompt](backend/app/static/assets/education/OPTICAL-BACKGROUND.md).

The prompt-supplied Create MP4 is an external, cacheable 21.1 MB CloudFront asset.
The Solve Philosophy video is a 10.97 MB, 1664×1244 H.264 asset running at 24 fps
for about 10 seconds per loop.
The Review MP4 is a separate 7.6 MB, 1920×1080 H.264 asset running at 24 fps for
about eight seconds per loop. All sources were verified directly. Desktop WebP
(~57 KB), mobile WebP (~21 KB) and the PNG master remain local only as unreferenced
historical assets. No new JavaScript animation dependency was added.

## Latest verification

- Backend/static regression suite: 32 passed; one pre-existing Pydantic deprecation
  warning. API/domain coverage and the independent one-way pages remain intact.
- Authorized mimas1 Chromium checks for the Solve replacement passed at 1920px
  and 390px. The third prompt video loaded and advanced at the verified 92%
  viewport fit; fine-pointer parallax changed only the video transform, while answer
  focus produced the verified `calm` state, 0.45× playback, 0.55 brightness and
  0.62 saturation. No horizontal overflow was introduced.
- Authorized mimas1 Chromium checks for the Review replacement passed at 1920px
  and 390px. The supplied MP4 loaded as real video, advanced playback time,
  remained autoplaying/muted/looping/inline and produced no horizontal overflow.
- Create, Solve and Review were visually captured at 1920×1000 and 390×844 after
  the shared theme was applied. Desktop and mobile layouts retained their intended
  hierarchy, readable controls and single-column responsive stacking.
- Create and Review were recaptured after removing their pale video overlays. The
  videos now retain direct blacks, highlights and color separation while the glass
  content surfaces remain readable; Solve was intentionally unchanged.
- Computed styles confirmed the Create module remains at 20% background opacity,
  both primary videos use `object-fit: cover`, Review uses the requested 70%
  horizontal focal point, and page content stays above a pointer-inert z-index-0
  background. Review's rendered score remained 88/100 during visual verification;
  the new glass palette remained readable at both checked breakpoints.

Reproduce with [frontend instructions](backend/tests/frontend/README.md) and
`python -m pytest -q` from `backend/`. Focused screenshots are stored in
`/tmp/eduagent-solve-fit-{1920,390}.png` and
`/tmp/eduagent-review-foldcraft-{1920,390}.png`. APIs in browser checks use
intercepted responses, so this is a frontend regression check rather than a live
model test.
