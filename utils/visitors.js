// utils/visitors.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.DB_API_URL, process.env.SB_SK);

const CLEAN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

async function cleanOldLogs(clean_after = CLEAN_AFTER_MS) {
  const cutoff = new Date(Date.now() - clean_after).toISOString();
  const { data, error } = await supabase
    .from('visits')
    .delete()
    .lt('time', cutoff);
  if (error) {
    console.error('Error deleting old visits:', error);
    return 0;
  }
  return data ? data.length : 0;
}


async function aggregateDailyVisits() {
  const today = new Date();
  const since = new Date(today - 24 * 60 * 60 * 1000).toISOString();
  const dateStr = today.toISOString().slice(0, 10);

  const { data: visits, error } = await supabase
     .from('visits')
     .select('browser, os, lang')
     .gte('time', since)
     .limit(10000);
  if (error) {
    console.error('Error fetching visits for aggregation:', error);
    return;
  }

  const counts = {};
  for (const v of visits) {
    const key = `${v.browser||"NULL"}_${v.os||"NULL"}_${v.lang||"NULL"}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  // Combine small cells into “Other”
  for (const [key, value] of Object.entries(counts)) {
    if (value < 5) {
      delete counts[key];
      counts['Other_Other_Other'] = (counts['Other_Other_Other'] || 0) + value;
    }
  }
  
  const aggregatedData = Object.entries(counts).map(([key, value]) => {
    const [browser, os, lang] = key.split('_');
    return { date: dateStr, browser, os, lang, count: value };
  });

  const { error: insertError } = await supabase
    .from('persistent_visits')
    .insert(aggregatedData);

  if (insertError) {
    console.error('Error inserting aggregated data:', insertError);
  } else {
    console.log('Aggregated daily visits for', dateStr);
  }
}


async function logVisitToSupabase(visit) {
  const { hashedId, browser, os, lang, nbhd, time } = visit;

  const { data, error } = await supabase
    .from('visits')
    .insert([{ hashedId, browser, os, lang, nbhd, time }]);

  if (error) {
    console.error('Error inserting visit', error);
  }
}


module.exports = {
  // visitLog,
  // aggregatedVisits,
  // getTimeBucket,
  cleanOldLogs,
  // aggregateVisit,
  // summarizeCounts,
  // subtractBucket,
  // makeAggregatedVisitsCSV,
  logVisitToSupabase,
  aggregateDailyVisits
};