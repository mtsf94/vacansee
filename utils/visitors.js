//utils/visitors.js
const visitLog = [];
const aggregatedVisits = {};

// Aggregate total visitors and unique visitors
function aggregateVisit(visit, bucketUnit = 'hour') {
  const timeBucket = getTimeBucket(visit.time, bucketUnit);
  const b = visit.browser || 'Other';
  const o = visit.os || 'Other';
  const nb = visit.nbhd || 'Other';

  if (!aggregatedVisits[timeBucket]) {
    aggregatedVisits[timeBucket] = {
      totalCount: 0,
      uniqueVisitors: new Set(),    // store hashedIds
      browserCounts: {},
      osCounts: {},
      nbhdCounts: {}
    };
  }
  const bucket = aggregatedVisits[timeBucket];
  bucket.totalCount++;
  bucket.uniqueVisitors.add(visit.hashedId);
  bucket.browserCounts[b] = (bucket.browserCounts[b] || 0) + 1;
  bucket.osCounts[o] = (bucket.osCounts[o] || 0) + 1;
  bucket.nbhdCounts[nb] = (bucket.nbhdCounts[nb] || 0) + 1;
}

// Utility: get the current minute/hour/day/week for bucketing
function getTimeBucket(date, unit = 'hour') {
  const d = new Date(date);
  if (unit === 'minute') {
    d.setSeconds(0, 0, 0);
  } else if (unit === 'hour') {
    d.setMinutes(0, 0, 0);
  } else if (unit === 'day') {
    d.setHours(0, 0, 0, 0);
  } else if (unit === 'week') {
    // ISO week start Monday
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - day + 1);
    d.setUTCHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

// Helper: summarize counts, collapse < threshold into 'Other'
function summarizeCounts(counts, threshold = 10) {
  const result = {};
  let otherCount = 0;
  for (const [key, cnt] of Object.entries(counts)) {
    if (cnt < threshold) {
      otherCount += cnt;
    } else {
      result[key] = cnt;
    }
  }
  if (otherCount > 0) result['Other'] = otherCount;
  return result;
}

// Cleanup old raw logs (>30 days)
function cleanOldLogs(clean_after = 30 * 24 * 60 * 60 * 1000) {
  let deletedCount = 0 ;
  const cutoff = Date.now() - clean_after;
  while (visitLog.length && new Date(visitLog[0].time).getTime() < cutoff) {
    visitLog.shift();
    deletedCount++;
  }
  return deletedCount;
}

function subtractBucket(date, bucketUnit) {
  const copy = new Date(date);  
  if (bucketUnit === 'minute') {
    copy.setMinutes(copy.getMinutes() - 1, 0, 0, 0);
  } 
  else if (bucketUnit === 'hour') {
    copy.setHours(copy.getHours() - 1, 0, 0, 0);
  } else if (bucketUnit === 'day') {
    copy.setDate(copy.getDate() - 1);
    copy.setHours(0, 0, 0, 0);
  }
  else if (bucketUnit === 'week') {
    copy.setDate(copy.getDate() - 8);
    copy.setHours(0, 0, 0, 0);
  }
  // Add more units if needed
  return copy;
}

function makeAggregatedVisitsCSV(visitLog, bucketUnit = 'hour', threshold = 10) {
  const buckets = {};
  for (const visit of visitLog) {
    const time = getTimeBucket(visit.time, bucketUnit);
    const nbhd = visit.nbhd || "Other";
    const browser = visit.browser || "Other";
    const os = visit.os || "Other";
    const key = browser + "||" + os + "||" + nbhd;
    if (!buckets[time]) buckets[time] = {};
    buckets[time][key] = (buckets[time][key] || 0) + 1;
  }

  const csvRows = ["TimeBucket,Browser,OS,Nbhd,Count"];
  let grandTotal = 0;

  for (const [time, pairCounts] of Object.entries(buckets)) {
    let otherCount = 0;
    // Print only those above threshold
    for (const [pair, cnt] of Object.entries(pairCounts)) {
      if (cnt >= threshold) {
        const [browser, os, nbhd] = pair.split("||");
        csvRows.push(`${time},${browser},${os},${nbhd},${cnt}`);
        grandTotal += cnt;
      } else {
        otherCount += cnt;
      }
    }
    // Add an "Other" row per bucket if needed
    if (otherCount > 0) {
      csvRows.push(`${time},Other,Other,${otherCount}`);
      grandTotal += otherCount;
    }
  }

  return {
    csv: csvRows.join('\n'),
    totalvisits: grandTotal
  };
}

module.exports = {
  visitLog,
  aggregatedVisits,
  getTimeBucket,
  cleanOldLogs,
  aggregateVisit,
  summarizeCounts,
  subtractBucket,
  makeAggregatedVisitsCSV
};