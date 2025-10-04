/*
merge_and_frontage.js
This program merges GeoJSON parcels with tax data, and estimates street frontage using parcel boundaries
*/
const fs = require('fs');
const csv = require('csv-parser');
const haversine = require('haversine-distance');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');


//path to the relevant data files
const geojsonPath = '../archive/archive_data/Parcels Active and Retired_20250612.geojson';
const csvPath = '../data/Taxable_Commercial_Spaces_20250613.csv';
const outputPath2 = '../data/parcels_with_frontage.geojson';

// Reduce ending file size by dropping some properties from feature.properties and/or each vacancy_by_year entry
const PROPERTIES_TO_REMOVE = [
  "from_address_num", "project_id_drop", "police_district", "supdistpad",
  "date_map_alt", "odd_even", "zoning_code", "zoning_district", "analysis_neighborhood",
  "pw_recorded_map", "date_map_add", "data_loaded_at", "supdist", "planning_district",
  "project_id_alt", "date_map_drop", "supname", "planning_district_number",
  "project_id_add", "date_rec_drop", "police_company", "numbertext", "supervisor_district",
  "data_as_of", "in_asr_secured_roll", "date_rec_add", "active", "longitude", "latitude",
  "location_point"
];

// Utility: pad block/lot with leading zeros if needed
function padBlock(block) { return block.padStart(4, '0'); }
function padLot(lot) { return lot.padStart(3, '0'); }

// Utility: read CSV
function readCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', data => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

// Utility: read GeoJSON
function readGeoJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Utility: get block/lot key from feature
function getBlockLotKey(feature) {
  const block = padBlock(String(feature.properties.block_num || feature.properties.block || '').trim());
  const lot = padLot(String(feature.properties.lot_num || feature.properties.lot || '').trim());
  return `${block}-${lot}`;
}

// Utility: extract repeated info from CSV row
function extractRepeatedInfo(row) {
  return {
    block: padBlock(String(row.block || '').trim()),
    lot: padLot(String(row.lot || '').trim()),
    parcelnumber: row.parcelnumber,
    parcelsitusaddress: row.parcelsitusaddress,
    longitude: row.longitude,
    latitude: row.latitude,
    location_point: row.location_point,
    analysis_neighborhood: row.analysis_neighborhood,
    supervisor_district: row.supervisor_district
  };
}

// fields to exclude from yearly records
const FIELDS_TO_EXCLUDE = [
  'block', 'lot', 'parcelnumber', 'parcelsitusaddress',
  'longitude', 'latitude', 'location_point',
  'analysis_neighborhood', 'supervisor_district', 
  'ban', 'linaddress', 'lin', 'block_num', 'lot_num', 'parcelnumber'
];

//  process CSV rows for a year, excluding fields
function processYearRows(yearRows) {
  const ownerVals = [];
  const tenantVals = [];
  const subtenantVals = [];
  let baseRecord = {};

  yearRows.forEach(row => {
    const { filertype, tax_multiplier, ...rest } = row;
    // Exclude the repeated fields
    const filteredRest = Object.fromEntries(
      Object.entries(rest).filter(([key]) => !FIELDS_TO_EXCLUDE.includes(key))
    );
    if (Object.keys(baseRecord).length === 0) {
      const { entity, ...filteredWithoutEntity } = filteredRest;
      baseRecord = { ...filteredWithoutEntity };
    }
    if ((filertype || '').trim().toUpperCase() === 'OWNER') {
      ownerVals.push(filteredRest.entity || filteredRest.owner || 'OWNER');
    } else if ((filertype || '').trim().toUpperCase() === 'TENANT') {
      tenantVals.push('TENANT');
      // for tenants and subtenants, excluding entity name from processed file
      // tenantVals.push(filteredRest.entity || filteredRest.tenant || 'TENANT');
    } else if ((filertype || '').trim().toUpperCase() === 'SUBTENANT') {
      tenantVals.push('SUBTENANT');
      // tenantVals.push(filteredRest.entity || filteredRest.subtenant || 'SUBTENANT');
    }
  });

  if (ownerVals.length === 1) baseRecord.owner = ownerVals[0];
  else if (ownerVals.length > 1) baseRecord.owner = ownerVals;
  if (tenantVals.length === 1) baseRecord.tenant = tenantVals[0];
  else if (tenantVals.length > 1) baseRecord.tenant = tenantVals;
  if (subtenantVals.length === 1) baseRecord.subtenant = subtenantVals[0];
  else if (subtenantVals.length > 1) baseRecord.subtenant = subtenantVals;
  delete baseRecord.filertype;
  delete baseRecord.tax_multiplier;

  // Drop unwanted properties from each yearly record
  for (const prop of PROPERTIES_TO_REMOVE) {
    delete baseRecord[prop];
  }
  return baseRecord;
}

// Remove unwanted properties from a feature's properties object
function pruneProperties(obj) {
  for (const prop of PROPERTIES_TO_REMOVE) {
    delete obj[prop];
  }
}

// Helper: get edges from feature geometry (returns {edges, indexMap})
function getEdgesWithIndices(feature) {
  const result = [];
  const indexMap = new Map(); 
  if (!feature.geometry?.coordinates) return { edges: [], indexMap };
  let ring = null;
  if (feature.geometry.type === 'Polygon') {
    ring = feature.geometry.coordinates[0];
  } else if (feature.geometry.type === 'MultiPolygon') {
    ring = feature.geometry.coordinates[0][0];
  }
  if (!ring) return { edges: [], indexMap };
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i].map(coord => Number(coord.toFixed(6)));
    const b = ring[i + 1].map(coord => Number(coord.toFixed(6)));
    // Always store edge as [a,b], not sorted, to preserve direction
    const key = a.join(',') + '|' + b.join(',');
    result.push([a, b]);
    indexMap.set(key, i); // edge from i to i+1
  }
  return { edges: result, indexMap };
}

// First pass: count unique edges and collect mapblklot->feature for frontage calculation
console.log('Counting unique edges...');
const edgeCounts = new Map();
const seenMapBlkLot = new Set();
const featureMap = new Map();

async function mergeGeoJSONWithCSV() {
  const geojson = readGeoJSON(geojsonPath);
  const csvRows = await readCSV(csvPath);

  // Build CSV lookup: key = block-lot, value = { [year]: [rows] }
  const csvLookup = {};
  for (const row of csvRows) {
    const block = padBlock(String(row.block || '').trim());
    //adding uppercase conversion here to handle inconsistent uppercase vs lowercase across years
    const lot = padLot(String(row.lot || '').trim().toUpperCase());
    const key = `${block}-${lot}`;
    const year = String(row.taxyear).trim();
    if (!csvLookup[key]) csvLookup[key] = {};
    if (!csvLookup[key][year]) csvLookup[key][year] = [];
    csvLookup[key][year].push(row);
  }

  // Merge CSV data into all GeoJSON features
  const mergedFeatures = geojson.features.map(feature => {
    const key = getBlockLotKey(feature);
    if (csvLookup[key]) {
      // There is CSV data for this parcel
      const years = Object.keys(csvLookup[key]).sort();
      // Extract repeated info from first CSV row and merge into properties
      const firstRow = csvLookup[key][years[0]][0];
      feature.properties = { ...feature.properties, ...extractRepeatedInfo(firstRow) };
      // Build vacancy_by_year, excluding repeated fields and dropping unwanted properties
      const byYear = {};
      years.forEach(year => {
        byYear[year] = processYearRows(csvLookup[key][year]);
      });
      feature.properties.vacancy_by_year = byYear;
    } else {
      // if there is no vacancy data, want to still ensure vacancy_by_year is present for consistency
      feature.properties.vacancy_by_year = {};
    }

    // Prune unwanted properties from the top level
    pruneProperties(feature.properties);

    // Also prune from each yearly record in vacancy_by_year
    if (feature.properties.vacancy_by_year && typeof feature.properties.vacancy_by_year === 'object') {
      for (const year of Object.keys(feature.properties.vacancy_by_year)) {
        pruneProperties(feature.properties.vacancy_by_year[year]);
      }
    }
    return feature;
  });

// Helper: get block key (first 4 chars of mapblklot)
function getBlockKey(feature) {
  return feature.properties.blklot.slice(0, 4);
}

  // Group features by block
  const blockGroups = mergedFeatures.reduce((acc, f) => {
    const byYear = f.properties?.vacancy_by_year;
    // Check if vacancy_by_year exists and has at least one year with a non-empty property  
    const isNonEmpty = byYear && Object.values(byYear).some(yearObj => {
      return Object.values(yearObj).some(val => val !== "" && val !== null && val !== undefined);
    });
    if (!isNonEmpty) return acc; // skip this feature

    const blk = getBlockKey(f);
    if (!acc[blk]) acc[blk] = [];
    acc[blk].push(f);

    return acc;
  }, {});

  // Calculate block statistics: blk_filed and blk_total per block and year
  const blockStats = {};
  for (const blk in blockGroups) {
    const featuresInBlock = blockGroups[blk];
    blockStats[blk] = {
      blk_total: featuresInBlock.length,
      blk_filed_by_year: {}
    };
    // Collect all years across this block’s features
    const yearsSet = new Set();
    featuresInBlock.forEach(f => {
      if (f.properties.vacancy_by_year) {
        Object.keys(f.properties.vacancy_by_year).forEach(y => yearsSet.add(y));
      }
    });
    const years = [...yearsSet];
    years.forEach(year => {
      const filedCount = featuresInBlock.reduce((count, f) => {
        const filedValue = f.properties.vacancy_by_year?.[year]?.filed || "NO";
        return count + (filedValue.toUpperCase() === "YES" ? 1 : 0);
      }, 0);
      blockStats[blk].blk_filed_by_year[year] = filedCount;
    });
  }

  // Add blk_filed and blk_total to each feature's vacancy_by_year
  mergedFeatures.forEach(feature => {
      const { edges, indexMap } = getEdgesWithIndices(feature);
      edges.forEach(edge => {
        // Use sorted edge for undirected uniqueness
        const key = [edge[0].join(','), edge[1].join(',')].sort().join('|');
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      });

    const blk = getBlockKey(feature);
    const stats = blockStats[blk];
    if (!stats) return;
    const byYear = feature.properties.vacancy_by_year || {};
    Object.keys(byYear).forEach(year => {
      byYear[year].blk_filed = String(stats.blk_filed_by_year[year] || 0);
      byYear[year].blk_total = String(stats.blk_total);
    });
  });
const mergedFeatures2 = mergedFeatures.map(feature => {
  //converting to upper case to handle properties with inconsistent case
  const mapblklot =  (feature.properties.mapblklot) ?  feature.properties.mapblklot.toUpperCase() : feature.properties.mapblklot; 
  if (!featureMap.has(mapblklot)) featureMap.set(mapblklot, feature);

  //only map each lot/block once
  if (seenMapBlkLot.has(mapblklot)) return feature;
  seenMapBlkLot.add(mapblklot);

  const { edges, indexMap } = getEdgesWithIndices(feature);
   
  let frontage = 0;
    const frontageEdgeIndices = [];
    edges.forEach((edge, i) => {
      // Use sorted edge for undirected uniqueness
      const key = [edge[0].join(','), edge[1].join(',')].sort().join('|');
      // frontage edges will have edgeCount of 1 since they are not adjacent to other properties
      // note that properties wiithout vacancy_by_year are included at this point for the purpose of shared edge counting 
      // even though they will be filtered out
      if ((edgeCounts.get(key) || 0) === 1) {
        // This edge is a frontage edge; record its index
        const forwardKey = edge[0].join(',') + '|' + edge[1].join(',');
        const idx = indexMap.get(forwardKey);
        if (typeof idx === 'number') frontageEdgeIndices.push(idx);

        // Calculate frontage length in feet
        const [pt1, pt2] = edge;
        const distanceMeters = haversine(
          { latitude: pt1[1], longitude: pt1[0] },
          { latitude: pt2[1], longitude: pt2[0] }
        );
        frontage += distanceMeters * 3.28084;
      }
    });
    feature.properties.street_frontage_ft = Number(frontage.toFixed(2));
    feature.properties.frontageEdgeIndices = frontageEdgeIndices;
    // Remove any old frontageEdges property if present
    delete feature.properties.frontageEdges;
    return feature;
});


const mergedFeatures3 = mergedFeatures2.filter(feature =>{
  // Only keep features with non-empty vacancy_by_year
    const vby = feature && feature.properties && feature.properties.vacancy_by_year;
    return (
      vby &&
      typeof vby === 'object' &&
      !Array.isArray(vby) &&
      Object.keys(vby).length > 0
    ) 
});

const outputStream2 = fs.createWriteStream(outputPath2);
  outputStream2.write('{\n  "type": "FeatureCollection",\n  "features": [\n');
  mergedFeatures3.forEach((feature, index) => {
    // Write the feature without pretty spacing
    outputStream2.write(JSON.stringify(feature));

    // if not last feature, add comma
    if (index < mergedFeatures3.length - 1) {
      outputStream2.write(',');
    }
  });
  outputStream2.write('  ]\n}\n');
  outputStream2.end();
  console.log(`Merged GeoJSON written to ${outputPath2}`);
}

mergeGeoJSONWithCSV().catch(console.error);
