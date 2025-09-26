//utils/visitors.js

const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();
const supabaseUrl = process.env.DB_API_URL; // from dashboard
const supabaseKey = process.env.SB_SK;    // your secret key, set securely in environment variables

const supabase = createClient(supabaseUrl, supabaseKey);


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
  logVisitToSupabase,
  getAggregatedVisits
};