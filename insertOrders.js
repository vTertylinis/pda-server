// insertOrders.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

// === DynamoDB Client ===
const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const ddbDocClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "Orders";

// === Insert Orders into DynamoDB ===
async function insertOrdersFromFile(filePath) {
  const fileContent = fs.readFileSync(filePath, "utf8");
  let orders = [];

  try {
    orders = JSON.parse(fileContent);
    if (!Array.isArray(orders)) {
      throw new Error("File must contain an array of orders");
    }
  } catch (err) {
    console.error("❌ Failed to parse JSON:", err);
    process.exit(1);
  }

  // Extract year-month from file name (e.g., 2025-08.json → 2025-08)
  const fileName = path.basename(filePath, ".json");
  const yearMonth = fileName;

  for (const order of orders) {
    if (!order.timestamp) {
      console.warn("⚠️ Skipping order without timestamp:", order);
      continue;
    }

    const params = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        yearMonth: yearMonth,              // partition key
        orderTimestamp: order.timestamp,   // sort key
        table: order.table,
        items: order.items,
      },
    });

    try {
      await ddbDocClient.send(params);
      console.log(`✅ Inserted order from table ${order.table} at ${order.timestamp}`);
    } catch (err) {
      console.error("❌ Failed to insert order:", err);
    }
  }
}

// === Run the script ===
const ordersFile = path.join(__dirname, "orders", "2025-08.json");
insertOrdersFromFile(ordersFile).then(() => {
  console.log("🎉 Done inserting orders!");
});
