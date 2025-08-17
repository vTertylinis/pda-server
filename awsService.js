// awsService.js
require("dotenv").config();
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Uploads JSON data to S3
 * @param {Object} data - The JSON object to upload
 * @param {string} key - The file path/key in the bucket
 */
async function uploadJsonToS3(data, key) {
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json; charset=utf-8",
    Metadata: {}
  });
  return s3.send(command);
}

// === Specific functions for your API ===
async function saveOrdersFolderToS3() {
  const ordersDir = path.join(__dirname, "orders");
  const files = fs.readdirSync(ordersDir).filter((f) => f.endsWith(".json"));

  const uploads = files.map((file) => {
    const filePath = path.join(ordersDir, file);
    const fileContent = fs.readFileSync(filePath, "utf8");

    let orders = [];
    try {
      orders = JSON.parse(fileContent);
      if (Array.isArray(orders)) {
        orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }
    } catch (err) {
      console.error(`❌ Failed to parse ${file}:`, err);
    }

    const sortedContent = JSON.stringify(orders, null, 2);

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `orders/${file}`,
      Body: sortedContent,
      ContentType: "application/json; charset=utf-8"
    });

    return s3.send(command);
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
  saveOrdersFolderToS3,
};
