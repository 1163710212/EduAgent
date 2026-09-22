# Educational raster artwork

## Current: independent cinematic video backgrounds

Create uses the supplied Mindloop prompt's full-viewport looping MP4 treatment,
with its original full-color rendering, responsive cinematic fit and lifecycle
guards. Its former pale veil and bottom fade are removed. Solve uses the supplied recreation prompt's third,
night-garden Philosophy
video at a 92%-of-viewport fit with softly blended edges, pointer parallax and
focused-answer calming. This avoids unnecessary enlargement of its 4:3 source.
Review uses the separately supplied Foldcraft MP4 as a full-cover cinematic
background with a 70% horizontal focal point. All three scenes now fall back to
their own deep neutral color rather than the retired white optical plate. See
[asset sources, exact built-in image_gen prompt and integration](OPTICAL-BACKGROUND.md).
Previous toy-style kit/folio prototypes and v1 master images remain inactive
recovery assets.

## Historical v1 (inactive)

The following describes the earlier implementation, not the current runtime.

These three original illustrations were generated with the **built-in image_gen
tool**, not the CLI/API fallback. They are decorative educational imagery, not
score-dependent rewards or certificates. This section documents the retired v1
direction; the active Create module no longer includes an architectural photo.

| Page   | Master artwork            | Delivered artwork          |
| ------ | ------------------------- | -------------------------- |
| Create | `reading-book-v1.png`     | `reading-book-v1.webp`     |
| Solve  | `knowledge-planet-v1.png` | `knowledge-planet-v1.webp` |
| Review | `learning-badge-v1.png`   | `learning-badge-v1.webp`   |

All files live in `backend/app/static/assets/education/`. The 1254×1254 RGBA PNGs
are the selected, unmodified generator outputs, copied into the repository.
640×640 WebP delivery variants retain transparency and total approximately 113 KB.
The HTML uses `<picture>` with WebP and a PNG fallback; explicit image dimensions
reserve layout before decoding. No runtime image-generation service is required.

## Final prompts

### reading-book-v1

```text
Generate one educational website illustration: a refined open blue hardcover book with curved ivory pages and a teal ribbon bookmark, two paper leaves floating above it. Premium soft 3D editorial illustration, satin ceramic finish, soft lighting, restrained blue #5988d8, teal #42aeb9 and lavender #939bd8 palette. Centered isolated subject, square composition, generous padding, genuine transparent RGBA background. No floor, no scene, no text, no watermark. PNG illustration for an educational coding app, readable at 200px.
```

### knowledge-planet-v1

```text
Generate one educational website illustration: a small blue-teal glass knowledge planet with one elegant tilted ivory orbital ring, a tiny blue pencil and two lavender starlets floating beside the orbit. The sphere has a subtle understated geometric grid, not continents. Premium restrained soft 3D editorial illustration, satin ceramic and frosted glass materials, soft studio lighting from upper left; pale ivory, desaturated cornflower blue #5988d8, teal #42aeb9, lavender #939bd8. Centered isolated subject, three-quarter view, square composition, generous transparent padding. Genuine transparent RGBA background, no white background or checkerboard baked into image, no environment, no floor or pedestal, no large cast shadow. No text, letters, numbers, logos or watermark. This single cohesive sophisticated illustration represents exploring coding concepts and practicing logic. PNG for an educational coding app, readable at 200px.
```

### learning-badge-v1

```text
Generate one educational website illustration: a refined blue graduation cap with an ivory tassel floating above a circular teal learning medal embossed with one simple ivory five-point star and two short lavender ribbon tails. The cap and medal form a single cohesive compact illustration, no extra objects. Premium restrained soft 3D editorial illustration, satin ceramic and frosted glass materials, soft studio lighting from upper left; pale ivory, desaturated cornflower blue #5988d8, teal #42aeb9 and lavender #939bd8. Centered isolated subject, three-quarter view, square composition, generous transparent padding. Genuine transparent RGBA background, no white background or checkerboard baked into image, no environment, no floor or pedestal, no large cast shadow. No text, letters, numbers, logos or watermark. Friendly sophisticated learning reflection artwork, not a specific grade or exam certification. PNG for an educational coding app, readable at 200px.
```

## Delivery variants

Reproduce the non-creative format/size optimization with ImageMagick:

```sh
convert reading-book-v1.png -resize 640x640 -define webp:alpha-quality=100 -quality 90 reading-book-v1.webp
convert knowledge-planet-v1.png -resize 640x640 -define webp:alpha-quality=100 -quality 90 knowledge-planet-v1.webp
convert learning-badge-v1.png -resize 640x640 -define webp:alpha-quality=100 -quality 90 learning-badge-v1.webp
```

Keep the generated alpha channel; do not flatten onto a colored background.
Version future replacements rather than overwriting these master PNGs.

## Animation integration

`js/ui/educational-art.js` enhances the reserved artwork regions independently of
challenge APIs and workflow state. CSS transforms animate the images, orbital
accents and soft shadows; fine-pointer tilt is clamped and frame-coalesced.

The shared `eduagent:ambient-state` event supplies only the decorative playback
state. A hidden browser tab freezes illustration motion as well as the background;
there is no manual pause button or persisted manual-pause state.
Reduced motion, hidden tabs, page suspension and offscreen artwork pause playback.
Missing scripts leave static artwork; missing images remove only decoration.

`js/ui/knowledge-generation.js` reuses the reading-book WebP during creation;
the surrounding code/practice cards are native HTML/CSS, not new raster assets.
`js/ui/scene-transition.js` reuses each page's decoded artwork for the optional
forward handoff. Neither effect requires new images, image services or changes
to challenge/evaluation data.

`book-page.svg` is a small hand-authored vector paper face, not an AI-generated
bitmap or replacement for the master book illustration. `js/ui/book-pages.js`
places two double-sided leaves over the existing book with spine-aligned 3D
hinges and independent rising paper slips. The original raster is the fallback
if the vector or script is unavailable; reduced motion hides only these layers.

The retired `js/ui/create-depth.js` moved the original-photo wrapper and foreground
artwork during scroll. `js/ui/solve-focus.js` supplies
a decorative calm state while either answer input has focus. The optional
`js/ui/review-badge.js` unfolds/illuminates the existing learning badge after an
evaluation is rendered, disperses light briefly and removes its transient nodes.
It does not derive badges from grades or modify evaluation values.
