//server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const { cleanOldLogs, aggregateDailyVisits } = require('./utils/visitors');


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

// Clean old logs daily at midnight
cron.schedule('0 0 * * *', async () => {
  const deletedCount = await cleanOldLogs();
  console.log('Cleaned old logs:', deletedCount);
});

// Aggregate visits daily at midnight
cron.schedule('5 0 * * *', async () => {
  await aggregateDailyVisits();
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
