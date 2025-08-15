// awsService.js
require('dotenv').config();
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  region: process.env.AWS_REGION
});

/**
 * Uploads JSON data to S3
 * @param {Object} data - The JSON object to upload
 * @param {string} key - The file path/key in the bucket
 */
function uploadJsonToS3(data, key) {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json'
  };
  return s3.putObject(params).promise();
}

// === Specific functions for your API ===

function saveStatsToS3(stats) {
  return uploadJsonToS3(stats, `stats/${stats.yearMonth}.json`);
}

function saveCartsToS3(cartsData) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return uploadJsonToS3(cartsData, `carts/carts-${timestamp}.json`);
}

module.exports = {
  saveStatsToS3,
  saveCartsToS3
};
