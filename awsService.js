// awsService.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const AWS = require("aws-sdk");
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
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
    ContentType: "application/json",
  };
  return s3.putObject(params).promise();
}

// === Specific functions for your API ===
function saveOrdersFolderToS3() {
  const ordersDir = path.join(__dirname, "orders");

  // Read all JSON files in the folder
  const files = fs
    .readdirSync(ordersDir)
    .filter((file) => file.endsWith(".json"));

  const uploads = files.map((file) => {
    const filePath = path.join(ordersDir, file);
    const fileContent = fs.readFileSync(filePath);

    return s3
      .putObject({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `orders/${file}`, // Keep same filename in S3
        Body: fileContent,
        ContentType: "application/json",
      })
      .promise();
  });

  return Promise.all(uploads);
}

function saveStatsToS3(stats) {
  return uploadJsonToS3(stats, `stats/${stats.yearMonth}.json`);
}

function saveCartsToS3(cartsData) {
  return uploadJsonToS3(cartsData, `carts/carts.json`);
}

module.exports = {
  saveStatsToS3,
  saveCartsToS3,
  saveOrdersFolderToS3
};
