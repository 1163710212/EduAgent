# Optical study background v2

## Selected asset and sources

`optical-study-v2.png` is the unmodified 1536×1024 selected output of the built-in
image_gen tool (not the CLI/API fallback). `optical-study-v2.webp` is the desktop
delivery image (~57 KB); `optical-study-v2-mobile.webp` is a 960×640 variant (~21 KB).
The optical image remains only as an unreferenced historical asset. The former
WebGL renderer and its white runtime plate have been removed. Create, Solve and
Review now use separate looping-video treatments with deep neutral fallback colors.

Art direction was informed by the clear-glass optical sculpture, reflected light
and negative space in the MotionSites ConSentinel preview captured read-only with
the user-authorized mimas1 Chromium. The public preview is recorded video, not
evidence of a reusable live 3D component. No MotionSites image/video was copied
into this project and no claim is made about its upstream stock library.

Verified source libraries suitable for future additions:

- [Poly Haven Studio Small 09](https://polyhaven.com/a/studio_small_09): neutral
  studio HDRI useful for lighting a future real 3D glass scene. Assets are
  [CC0](https://polyhaven.com/license).
- [ambientCG Paper 002](https://ambientcg.com/view?id=Paper002): paper PBR material
  useful for future modeled pages. Assets are CC0 as documented on the asset page.

These two libraries were researched, not downloaded or incorporated into v2.
The selected background is a new original generated still life, not their asset.

## Final prompt (built-in tool)

```text
Use case: product-mockup. Asset type: premium photorealistic environment background plate for an educational coding application, landscape 1536x1024. Primary request: a museum-quality editorial still life about learning, discovery and optics, suitable as a very large subtle website background behind real text and forms. Scene/backdrop: pearl-white infinity studio with pale cool grey atmosphere. Subject: on the lower left perimeter, an elegant REAL open blank ivory-paper book with thin natural curled pages and fine linen binding, photographed at a three-quarter low angle, oversized and partly cropped at the extreme left edge; on the upper right perimeter, a large polished clear borosilicate glass optical sphere and one thin elliptical glass ring, partly cropped at the right edge, realistic refracted studio reflections and delicate silver-blue rim highlights. A single restrained translucent glass sheet floats near the lower right perimeter. Composition: 65 percent central negative space absolutely empty and light pearl grey, objects concentrated on outer edges so the center remains usable for UI. Wide cinematic photograph, exquisite real-world paper grain and smooth clear glass, physically accurate subtle caustic light on the floor, neutral monochrome with restrained icy-blue reflections. Lighting: large softboxes, directional grazing light, deep clear crisp reflections but no harsh black shadows, expensive fine-art photographic feel. NO cartoon, no illustration, no clay/plastic toys, no cute characters, no pencils, no stars, no badges, no neon, no visible text, no logos, no watermark, no UI. This is a new original physical still-life composition, not a copy of any website asset.
```

## Format optimization

```sh
convert optical-study-v2.png -quality 86 optical-study-v2.webp
convert optical-study-v2.png -resize 960x640 -quality 82 optical-study-v2-mobile.webp
```

## Integration

`optical-background.css` owns only the active video layers. The obsolete
`js/ui/background.js`, `js/ui/optical-renderer.js`, poster references and generic
white optical layer have been removed from the runtime chain.

Background is root z-index 0, main/footer are 1, header remains in normal flow.
The Create module has no former architectural photo, wash or photo credit. It now
sits at 20% opacity over a full-color, looping MP4 background based on the supplied
Mindloop prompt. Wide displays combine a synchronized blurred cover layer with a
sharp contained layer so the original 1.27:1 frame remains visible without empty
bands. `js/ui/video-background.js` pauses both for hidden/reduced-motion states,
adds fine-pointer parallax and falls back to its deep neutral surface. Review uses
the prompt-supplied Foldcraft MP4 with `object-fit: cover` and a 70% horizontal
focal point. `js/ui/review-video-background.js` pauses it for hidden, offscreen and
reduced-motion states and falls back to its own deep neutral surface. Both original
text/form layout and real report score values remain independent. Solve uses the
prompt's third Philosophy video with full-cover placement and a 56% vertical focal
point chosen for its 4:3 night-garden composition. Its dedicated
`js/ui/solve-video-background.js` provides mouse parallax and lifecycle guards;
answer focus slows playback to 0.45×, dims and desaturates the scene, and restores
normal playback when focus leaves the answer.

Hidden tabs, page suspension and reduced motion pause every video module. Touch
and coarse pointers receive no decorative parallax. Historic optical and v1
cartoon image files remain retained solely for provenance and are not referenced
by any runtime page.
