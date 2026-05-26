# Third-Party Notices

This project incorporates material from the projects listed below. Their
licenses are reproduced or referenced as required by their respective terms.

---

## pencilresearch/midi — MIDI CC & NRPN device catalogs

**Source:** <https://github.com/pencilresearch/midi>
**License:** Creative Commons Attribution-ShareAlike 4.0 International (CC-BY-SA-4.0)
**License text:** <https://creativecommons.org/licenses/by-sa/4.0/legalcode>

### What we use

A snapshot of the device CSV files from the pencilresearch/midi repository is
vendored under `vendor/pencilresearch-midi/`. We process those CSVs into JSON
files committed under `packages/catalog/devices/` via
`scripts/build-catalog.mjs`. Each generated JSON file includes a `_source` field
pointing back to the upstream CSV path for traceability.

The CSV data was curated by the pencilresearch/midi maintainers and the broader
MIDI community. Device-specific parameters within those files may reference
trademarks and parameter naming conventions owned by their respective synthesizer
manufacturers; those references remain the property of those manufacturers.

### How CC-BY-SA-4.0 applies here

- **Attribution.** This NOTICE constitutes attribution, alongside the `_source`
  references in each generated JSON file and the upstream URL above.
- **ShareAlike.** Both the vendored CSVs (`vendor/pencilresearch-midi/`) and the
  generated JSON catalogs (`packages/catalog/devices/`) are distributed under
  CC-BY-SA-4.0. Any redistribution of those files — including embedding them in
  a Lens Studio `.lspkg`, in an npm package, or in any other artifact — carries
  the same license.
- **Code is separate.** The TypeScript code that *uses* the catalog data
  (`packages/catalog/src/`, `scripts/build-catalog.mjs`, lens-side components)
  is licensed under this project's own license, not CC-BY-SA. CC-BY-SA applies
  only to the data files themselves.

### How to contribute corrections

If you find errors or omissions in the catalog data, please submit those
corrections **upstream** at <https://github.com/pencilresearch/midi> — that is
where new device coverage and fixes belong. After the upstream change is
merged, run `npm run build:catalog` (or the planned `refresh-catalog` script)
locally to pull the update into this repository.

---

## Acknowledgements

Thanks to the pencilresearch/midi maintainers and contributors for assembling
and curating this dataset. The Volca family, the NTS-1, the Matriarch, and
dozens of other synths are reachable from this library in large part because
that community did the patient documentation work.
