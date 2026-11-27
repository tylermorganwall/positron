# POSIX clock map data

The runtime map is a small, offline SVG built from `posixClockMapData.ts`. No network requests or runtime geographic dependencies are used.

## Precision

The geographic IANA time-zone regions are sampled on a one-degree grid, at cell centers. This is finer than a screen pixel at the widget's normal map size. Borders and small islands are approximate. A map click selects the region shown, not a GPS-quality point-in-polygon lookup. If more than one boundary region covers the sampled point, the first returned zone is used. The adjacent time-zone selector is the authoritative way to choose an exact IANA zone, including tiny regions that do not appear at this scale. Runtime offsets and daylight-saving rules come from the application's `Intl` time-zone database, not this cartographic snapshot.

## Sources and licenses

- `landPath`: [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) public-domain land geometry, through [world-atlas 2.0.2](https://github.com/topojson/world-atlas) (Natural Earth 4.1.0, 1:110m).
- `zonePaths`: derived database, © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under the [Open Database License 1.0](ODbL-1.0.txt). Derived from [Timezone Boundary Builder](https://github.com/evansiroky/timezone-boundary-builder) via the pinned [`geo-tz` 8.1.11](https://www.npmjs.com/package/geo-tz/v/8.1.11) comprehensive time-zone database. The generated derivative database is included in full in `posixClockMapData.ts` under the same ODbL terms. Source database and tooling are available through that pinned npm package and the linked projects. These are geographic boundary data, not a statement about legal or territorial claims.
- The developer-only generator uses `geo-tz` (MIT), `world-atlas` (ISC), and `topojson-client` (ISC). Their code is not included in the runtime widget.

## Reproduce

Install the pinned build-time packages in a temporary directory, separate from the Positron checkout, then pass that directory to the generator:

```sh
mkdir -p /tmp/posix-map-data
npm install --prefix /tmp/posix-map-data --ignore-scripts --no-audit --no-fund geo-tz@8.1.11 world-atlas@2.0.2 topojson-client@3.1.0
node src/vs/editor/contrib/positronPosixClock/browser/media/generate-posix-clock-map.cjs /tmp/posix-map-data
```

The generated strings are deterministic with these package versions. Regeneration is not part of the normal application build.
