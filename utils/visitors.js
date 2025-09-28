//utils/visitors.js
// Cleanup old raw logs (>30 days) in Supabase
async function cleanOldLogs(clean_after = 30 * 24 * 60 * 60 * 1000) {
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


async function logVisitToSupabase(visit) {
  const { hashedId, browser, os, lang, nbhd, time } = visit;

  const { data, error } = await supabase
    .from('visits')
    .insert([{ hashedId, browser, os, lang, nbhd, time }]);

  if (error) {
    console.error('Error inserting visit', error);
  }
}

async function getAggregatedVisits() {
  const { data, error } = await supabase
  .from('aggregated_visits')
  .select('browser,count');

  if (error) {
    console.error('Error fetching aggregated visits', error);
    return null;
  }
  return data;
}

module.exports = {
  // visitLog,
  // aggregatedVisits,
  // getTimeBucket,
  // cleanOldLogs,
  // aggregateVisit,
  // summarizeCounts,
  // subtractBucket,
  // makeAggregatedVisitsCSV,
  logVisitToSupabase,
  getAggregatedVisits
};