//utils/email.js
const nodemailer = require("nodemailer");

const { subtractBucket, visitLog, makeAggregatedVisitsCSV , getTimeBucket} = require('./visitors');

const sendEmail = async ({ subject, text, attachmentName, attachmentContent }) => {
  try {
    const smtpTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.APP_MAIL_FROM,
        pass: process.env.APP_PASSWORD
      }
    });

    const info = await smtpTransport.sendMail({
      from: process.env.APP_MAIL_FROM,
      to: process.env.APP_MAIL_TO,
      subject,
      text,
      attachments: [
        {
          filename: attachmentName,
          content: attachmentContent
        }
      ]
    });

    console.log("Message sent: %s", info.messageId);

  } catch (error) {
    console.error('Error sending email:', error)
  }
};
async function sendStatsEmail(bucketUnit = 'hour', intervalLabel = 'hourly') {
  const previousBucketDate = subtractBucket(new Date(), bucketUnit);
  const targetBucket = getTimeBucket(previousBucketDate, bucketUnit);

  const filteredVisits = visitLog.filter(v =>{
    return getTimeBucket(v.time, bucketUnit) === targetBucket
  });
  const aggregated = makeAggregatedVisitsCSV(filteredVisits, bucketUnit, 10);
  const subject = `Aggregated Visit Stats (${intervalLabel})`;
  const text = `Attached are the ${intervalLabel} aggregated website visit stats. Number of total page loads: ${aggregated.totalvisits}.`;
  await sendEmail({
    subject,
    text,
    attachmentName: `aggregated-visits-${intervalLabel}.csv`,
    attachmentContent: aggregated.csv
  });
}

module.exports = { sendEmail, sendStatsEmail };
