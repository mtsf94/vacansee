// saveNeighborhoodCentroids.js
const fs = require('fs');
const parse = require('csv-parse');

const rows = [];

fs.createReadStream('./data/Taxable_Commercial_Spaces_20250613.csv')
  .pipe(parse({ columns: true, trim: true }))
  .on('data', (row) => {
    rows.push(row);
  })
  .on('end', () => {
    console.log('CSV file successfully processed. Number of rows:', rows.length);
    // Here you can do your centroid calculation or save rows to JSON
  })
  .on('error', (error) => {
    console.error(error);
  });
// Group features by analysis_neighborhood
const neighborhoods = {};

geojson.features.forEach(feature => {
  const nbhd = feature.properties.analysis_neighborhood;
  const lng = parseFloat(feature.properties.centroid_longitude);
  const lat = parseFloat(feature.properties.centroid_latitude);
  if (!nbhd || isNaN(lng) || isNaN(lat)) return; // Skip invalid entries

  if (!neighborhoods[nbhd]) neighborhoods[nbhd] = [];
  neighborhoods[nbhd].push([lng, lat]);
});

// Calculate centroid for each neighborhood
const neighborhoodCentroids = {};

Object.keys(neighborhoods).forEach(nbhd => {
  const coords = neighborhoods[nbhd];
  const avgLng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
  const avgLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  neighborhoodCentroids[nbhd] = { centroid: [avgLng, avgLat] };
});

// Save the JSON to a file
const outputFilename = 'neighborhoodCentroids.json';
fs.writeFileSync(outputFilename, JSON.stringify(neighborhoodCentroids, null, 2), 'utf8');

console.log(`Saved neighborhood centroids to ${outputFilename}`);
