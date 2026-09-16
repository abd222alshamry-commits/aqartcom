# V38 — Automatic Geocoding & Map Coverage

- Automatic geocoding queue for active properties missing latitude/longitude.
- Uses address + district + city with configurable country hint.
- Configurable geocoder endpoint; defaults to OpenStreetMap Nominatim.
- Conservative request delay (1100 ms by default) and max 50 properties per manual batch.
- Stores success/failure/manual geocoding audit records and confidence.
- Admin dashboard shows map coverage percentage and missing properties.
- Manual latitude/longitude correction endpoint and UI.
- Existing V37 heatmap automatically benefits as coordinates are filled.

Production note: for high-volume usage configure a commercial/self-hosted geocoder and follow the provider usage policy.
