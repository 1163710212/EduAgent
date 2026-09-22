# Motion mini

`motion-mini.mjs` is a self-contained, minified ESM bundle of **Motion 13.4.0**'s
`motion/mini` entry. It is served locally; no animation CDN, npm install, or
frontend build is needed to run EduAgent.

- Official usage: https://motion.dev/docs/animate
- Source: https://github.com/motiondivision/motion
- Resolved packages: motion 13.4.0, framer-motion 13.4.0, motion-dom 13.3.0,
  motion-utils 13.3.0, tslib 2.8.1.
- Generated with esbuild 0.21.5, bundle/minify, ESM output, ES2020 target.

To regenerate, install the above versions in a temporary directory and bundle
its `node_modules/motion/dist/es/mini.mjs` entry into `motion-mini.mjs` using
esbuild's `--bundle --minify --format=esm --target=es2020` options.

The wrapper in `js/ui/motion.js` lazy-loads the library, respects reduced motion,
and leaves all UI content usable if it fails to load. See `LICENSE.txt` for
upstream license notices.

## Optical background

The current background uses the project's native WebGL renderer in
`js/ui/optical-renderer.js`, not another vendor library. The former tsParticles
bundle and build entry have been removed. Raster imagery is local and versioned;
see [asset sources and final prompt](../assets/education/README.md).
