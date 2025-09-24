//config/constants.js

require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5000,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  APP_MAIL_FROM: process.env.APP_MAIL_FROM,
  APP_MAIL_TO: process.env.APP_MAIL_TO,
  APP_PASSWORD: process.env.APP_PASSWORD,
  SECRET_HASH_SALT: process.env.SECRET_HASH_SALT
};