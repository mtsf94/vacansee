//server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const { cleanOldLogs, aggregatedVisits } = require('./utils/visitors');
const { SETPORT } = require('./config/constants');

var PORT     = process.env.PORT || 8080;

//update this to change the aggregation timeframe and to turn aggregation off
const aggregateWord= 'day';
const performAggregation = true;

const app = express();
app.set('view engine', 'ejs');
app.set('trust proxy', true);
app.set('views', path.join(__dirname, 'views'));

const corsOptions = {
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use(express.urlencoded({ extended: true }));

require('./app/routes.js')(app);

const cron = require('node-cron');

// Run cleanOldLogs every hour on the hour, keeping old visit logs for 30 days max
cron.schedule('0 0 * * *', () => {
  const deletedCount = cleanOldLogs(clean_after = 30 * 24 * 60 * 60 * 1000);
  console.log('Cleaned old logs - hourly cron job. Removed '+deletedCount+' logs.');
});

const aggregateWordLevel= aggregateWord+ '-level';

let cronCommand = '* * * * *';

if (aggregateWord === 'minute'){
  cronCommand = '* * * * *';
}
if (aggregateWord === 'hour'){
  cronCommand = '0 * * * *';
}
if (aggregateWord === 'day'){
  cronCommand = '0 0 * * *';
}
if (aggregateWord === 'week'){
  cronCommand = '0 0 * * 0';
}

if (performAggregation){ 
  // Run sendStatsEmail every hour on the hour (or change schedule as needed)
  cron.schedule(cronCommand, async () => {
    // try {
    //   await sendStatsEmail(aggregateWord, aggregateWordLevel);
    //   // Clear aggregatedVisits after emailing
    //   Object.keys(aggregatedVisits).forEach(bucket => { delete aggregatedVisits[bucket]; });
    //   console.log('Sent '+aggregateWordLevel+' stats email and cleared aggregation');
    // } catch (err) {
    //   console.error('Error sending '+aggregateWordLevel+' stats email:', err);
    // }
  });
 
}
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
