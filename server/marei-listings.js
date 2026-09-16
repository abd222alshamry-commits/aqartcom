'use strict';
// Existing startup hooks and deployment opt-in remain compatible.
const directory = require('./office-listings');
module.exports = {
  batch: directory.enabledBatch,
  listings: directory.data.listings.filter(x => x.office === 'marei'),
  seedMareiListings: directory.seedOfficeListings,
  registerMareiListings: directory.registerOfficeListings
};
