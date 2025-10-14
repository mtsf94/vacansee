const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const UAParser = require('ua-parser-js');
const nodemailer = require('nodemailer');
const nbhdConfig = require('../config/nbhd.json');
const {getAggregatedVisits, cleanOldLogs} = require('../utils/visitors');
require('dotenv').config();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_IPS = process.env.ADMIN_IPS;
const SECRET_HASH_SALT = process.env.SECRET_HASH_SALT;
// In-memory rate limit cache by IP
const failedAttempts = {}; // { [ip]: { count: Number, lastAttempt: timestamp, lockedUntil: timestamp } }
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOCKOUT_TIME_MS = 15 * 60 * 1000; // 15 minutes

//initialize supabase
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.DB_API_URL; // from dashboard
const supabaseKey = process.env.SB_SK;    // your secret key, set securely in environment variables

const supabase = createClient(supabaseUrl, supabaseKey);


if (!ADMIN_PASSWORD || !SECRET_HASH_SALT) {
  console.error('ERROR: ADMIN_PASSWORD and SECRET_HASH_SALT must be set in environment variables');
  process.exit(1);
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Helper: hash IP with secret salt (irreversible)
function hashIP(ip) {
  return crypto.createHmac('sha256', SECRET_HASH_SALT).update(ip).digest('hex');
}

// Helper: get IP respecting proxy headers
function getIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.connection.remoteAddress || req.socket.remoteAddress || req.ip;
}

// Helper: determine current language from query param
function getCurrentLang(req) {
  const supported = ['en', 'ca', 'es', 'zh'];
  const lang = req.query.lang;
  return (lang && supported.includes(lang)) ? lang : 'en';
}

// Translation function factory
const translations = require("../translations/translations.js");
function makeT(currentLang) {
  return (key) => (
    translations[currentLang]?.[key] ||
    translations['en']?.[key] ||
    key
  );
}

// Password protection middleware
const ALLOWED_IPS = ADMIN_IPS; // Replace with the allowed IP(s)
function passwordProtect(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  // IP check (as before)
  if (!ALLOWED_IPS.includes(clientIp)) {
    console.log("Unauthorized access from " + clientIp);
    return res.status(403).send('Access denied.');
  }

  // Check lockout
  const now = Date.now();
  const data = failedAttempts[clientIp] || {};

  if (data.lockedUntil && now < data.lockedUntil) {
    return res.status(429).send(`
      <p style="color:red;">Too many incorrect attempts. Try again later.</p>
    `);
  }

  // Password check
  if (req.method === 'POST') {
    const auth = req.body?.auth;
    if (auth === ADMIN_PASSWORD) {
      // Success: reset failed attempt count
      failedAttempts[clientIp] = { count: 0 };
      return next();
    } else {
      // Fail: increment count, set timestamps
      let count = (data.count || 0) + 1;

      if (count >= MAX_ATTEMPTS) {
        failedAttempts[clientIp] = {
          count,
          lockedUntil: now + LOCKOUT_TIME_MS
        };
        return res.status(429).send(`
          <form method="POST" action="${req.path}" style="margin:2em auto;max-width:300px;">
            <label>Password: <input type="password" name="auth" autofocus /></label>
            <button type="submit">Enter</button>
          </form>
          <p style='color:red;'>You have been temporarily locked out due to too many failed attempts. Please try again later.</p>
        `);
      } else {
        failedAttempts[clientIp] = {
          count,
          lastAttempt: now
        };
        return res.send(`
          <form method="POST" action="${req.path}" style="margin:2em auto;max-width:300px;">
            <label>Password: <input type="password" name="auth" autofocus /></label>
            <button type="submit">Enter</button>
          </form>
          <p style='color:red;'>Incorrect password (${count}/${MAX_ATTEMPTS}).</p>
        `);
      }
    }
  } else {
    // Show login form
    return res.send(`
      <form method="POST" action="${req.path}" style="margin:2em auto;max-width:300px;">
        <label>Password: <input type="password" name="auth" autofocus /></label>
        <button type="submit">Enter</button>
      </form>
    `);
  }
}

module.exports = function (app) {
  const websiteName = "VacanSee";
  const websiteNameMap = "the VacanSee map";
  const langTexts = {
    en: 'English',
    // ca: 'EN(DEV)',
    // es: 'Español',
    // zh: '中文'
  };
const logvisit = async function(req, page= null){      
      const ip = getIP(req);
      const hashedId = hashIP(ip);

      const ua = req.headers['user-agent'] || '';
      const parser = new UAParser(ua);
      const browserName = parser.getBrowser().name || 'Other';
      const osName = parser.getOS().name || 'Other';

      const nbhdKey = req.query.nbhd || "all";
      const nbhd = nbhdKey && nbhdConfig[nbhdKey] ? nbhdConfig[nbhdKey] : {'name': 'all'};
      const currentLang = getCurrentLang(req);
      const visit = {
        hashedId,
        browser: browserName,
        os: osName,
        lang: currentLang,
        nbhd: page || nbhd.name,
        time: new Date().toISOString()
      };
      // Log visit to Supabase table `visits`
      const { error } = await supabase
        .from('visits')
        .insert([visit]);
      return error;
    }
  app.get('/', async (req, res) => {
    try {
    const error = await logvisit(req);
    if (error) {
      console.error('Supabase insert error:', error);
    } 
    const currentLang = getCurrentLang(req); 
    const t = makeT(currentLang);
    const nbhdKey = req.query.nbhd || "all";
    const nbhd = nbhdKey && nbhdConfig[nbhdKey] ? nbhdConfig[nbhdKey] : null;
      
    res.render('pages/aboutmap.ejs', {
      t,
      websiteName,
      websiteNameMap,
      currentLang,
      offerTour: true,
      translationsForClient: logvisittranslations[currentLang] || {},
      langTexts,
      neighborhood: nbhd  
    });
      } catch (err) {
    console.error('Error in / route:', err);
    res.status(500).send('Internal Server Error');
  }
  });

app.get('/ping', (req, res) => {
  res.sendStatus(200);
});


  app.get('/embed/map', (req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    next();
  }, (req, res) => {
    const currentLang = getCurrentLang(req);
    const t = makeT(currentLang);
      const nbhdKey = req.query.nbhd || "all";
    const nbhd = nbhdKey && nbhdConfig[nbhdKey] ? nbhdConfig[nbhdKey] : null;
  
    res.render('pages/embed-map.ejs', {
      t,
      currentLang,
      websiteName,
      websiteNameMap,
      translationsForClient: translations[currentLang] || {},
      langTexts,
      neighborhood: nbhd  
    });
  });

  app.get('/privacy', async (req, res) => {
    try {
    const error = await logvisit(req, page="privacy");
    if (error) {
      console.error('Supabase insert error:', error);
    } 
    const currentLang = getCurrentLang(req);
    const t = makeT(currentLang);
    res.render('pages/privacy_rev081225.ejs', {
      t,
      currentLang,
      websiteName,
      offerTour: false,
      translationsForClient: translations[currentLang] || {},
      langTexts
  
    });} catch (err) {
    console.error('Error in / route:', err);
    res.status(500).send('Internal Server Error');
  }
  });


  // Admin routes for viewing raw logs and aggregated stats - protected

  app.get('/admin/visits', passwordProtect, (req, res) => {
    // GET shows login form (handled by passwordProtect)
  });

  app.post('/admin/visits', passwordProtect, (req, res) => {
    const currentLang = 'en'; // or add language param with getCurrentLang(req)
    res.render('pages/viewvisitor.ejs', { visits: visitLog });
  });
app.get('/admin/aggregated-visits', passwordProtect, async (req, res) => {
});
app.post('/admin/aggregated-visits', passwordProtect, async (req, res) => {
  const aggregatedData = await getAggregatedVisits();
  res.json(aggregatedData);
});

};
