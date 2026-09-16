# Attribution — Syrian locality names

Names and governorate relationships adapted from OpenSyria Data Geography:
https://github.com/Open-Syria/data-geography

Snapshot commit: b4364ee892351671450f873c2e48901ae37a84be (README identifies latest release as v0.1.5).
Data license: Creative Commons Attribution 4.0 International:
https://creativecommons.org/licenses/by/4.0/

Transformations: retained Arabic locality and governorate names; grouped by governorate; removed exact duplicate names within each governorate; sorted in Arabic. 7,605 source localities become 7,599 name choices. No claim of complete or live administrative coverage. Damascus city neighborhoods may be entered manually.

Upstream source attributions and URLs are preserved in geography-provenance/sources.json; original record-level references are preserved in geography-provenance/localities.json and governorates.json. These are documentation files and are not exposed by the public file server.

OpenSyria sources include UN OCHA/HDX populated places, GeoNames, Wikidata and geoBoundaries. See the source-specific license and notes in the preserved sources file.

To regenerate from the same OpenSyria snapshot, run:
node scripts_generate_syria_locations.js /path/to/data syria-localities.js
