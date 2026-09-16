# V40 — Personalized Property Recommendations

- Personal recommendation profile from views, favorites, inquiries and saved searches.
- Recency-weighted signals and transparent confidence score.
- Personalized ranking by city, district, property type, transaction mode and price band.
- Market opportunity signal can boost under-market properties when V35 intelligence is available.
- New homepage section: "مقترحة لك" with match score and recommendation reasons.
- "لا يناسبني" feedback suppresses unwanted properties for 90 days.
- Endpoints: GET /api/me/recommendations, POST /api/me/property-events/:propertyId, POST /api/me/recommendations/rebuild.
- Cold-start behavior is explicit: recommendations improve as the user interacts.
- This is a transparent behavioral/content ranking engine; it does not claim certainty or a trained ML model.
