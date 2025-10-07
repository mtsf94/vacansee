
const fs = require('fs');
const turf = require('@turf/turf'); // install @turf/turf with npm

// Input/output paths
const inputGeojsonPath = '../archive/archive_data/Parcels Active and Retired_20250612.geojson';
const outputGeojsonPath = '../data/blocks.geojson';

// Load your parcel GeoJSON file with properties including block key
const parcels = JSON.parse(fs.readFileSync(inputGeojsonPath, 'utf8'));

// Group parcels by block key (first 4 chars of mapblklot)
const blocks = {};
for (const feature of parcels.features) {
  const mapblklot = feature.properties.mapblklot || '';
  const blockKey = mapblklot.slice(0, 4).toUpperCase();
  if (!blockKey) continue;
  if (!blocks[blockKey]) {
    blocks[blockKey] = [];
  }
  blocks[blockKey].push(feature);
}

const dissolvedBlockFeatures = [];

const totalBlocks = Object.keys(blocks).length;
let processedBlocks = 0;

console.log('Finished dissolving all blocks');

for (const blockKey in blocks) {
  processedBlocks++;
  if (processedBlocks % 10 === 0 || processedBlocks === totalBlocks) {
    console.log(`Processing block ${processedBlocks} of ${totalBlocks} (${(processedBlocks/totalBlocks * 100).toFixed(1)}%)`);
  }

  const blockFeatures = blocks[blockKey];

  // Flatten MultiPolygon features into individual Polygon features
  const polygonFeatures = [];
  blockFeatures.forEach(feat => {
    if (feat.geometry.type === 'Polygon') {
      polygonFeatures.push(feat);
    } else if (feat.geometry.type === 'MultiPolygon') {
      feat.geometry.coordinates.forEach(coords => {
        // Create polygon feature from each MultiPolygon part
        const poly = turf.polygon(coords, feat.properties);
        polygonFeatures.push(poly);
      });
    }
  });

  if (polygonFeatures.length === 0) continue;

  // Create FeatureCollection of polygons
  const fc = turf.featureCollection(polygonFeatures);

  let dissolved;
  try {
    dissolved = turf.dissolve(fc);
  } catch (err) {
    console.error(`Dissolve error for block ${blockKey}:`, err);
    continue;
  }

  // Assign properties to dissolved features
  dissolved.features.forEach(f => {
    f.properties = {
      block_key: blockKey,
      parcels_count: blockFeatures.length
      // You can add more aggregated properties here if needed
    };
  });

  dissolvedBlockFeatures.push(...dissolved.features);
}

// Output GeoJSON FeatureCollection for blocks
const blocksGeoJSON = turf.featureCollection(dissolvedBlockFeatures);

fs.writeFileSync(outputGeojsonPath, JSON.stringify(blocksGeoJSON));

console.log(`Block polygons GeoJSON created, ${dissolvedBlockFeatures.length} blocks written to ${outputGeojsonPath}`);
