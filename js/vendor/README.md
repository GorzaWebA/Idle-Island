# Vendored libraries

| File | Library | Version | Licence |
| --- | --- | --- | --- |
| `three.min.js` | [three.js](https://threejs.org) | r159 (`three@0.159.0` on npm) | MIT, see `three.LICENSE` |

## Why the classic build

`three.min.js` is the last official *classic* (UMD) build, which defines a global `THREE`.
Newer releases ship only ES modules, and browsers refuse to load ES-module files from
`file://` pages. A classic script keeps `index.html` playable by double-clicking it.

## Local change

The original file starts with a `console.warn(...)` deprecation notice joined to the library by a
comma. That statement was replaced with `!` so the file stays a single valid expression and the
console stays clean. Nothing else was changed.

- Original: `package/build/three.min.js` from `three-0.159.0.tgz`
- Original SHA-256: `7b1c5d75b28d9de15042e2b374f83566d8c7146697af8fdeb4558b0fb528a585`
