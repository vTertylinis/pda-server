// dynamoService.js
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(ddb);

async function saveOrderToDynamo(order) {
  const yearMonth = new Date(order.timestamp || new Date()).toISOString().slice(0, 7);
  const params = {
    TableName: "Orders",
    Item: {
      yearMonth,
      orderTimestamp: order.timestamp || new Date().toISOString(),
      table: order.table,
      items: order.items,
    },
  };

  try {
    await docClient.send(new PutCommand(params));
  } catch (err) {
    console.error("Error saving order to DynamoDB:", err);
  }
}

async function saveCartToDynamo(cart) {
  const params = {
    TableName: "Carts",
    Item: {
      id: "cart",
      timestamp: new Date().toISOString(),
      data: cart,
    },
  };

  try {
    await docClient.send(new PutCommand(params));
  } catch (err) {
    console.error("Error saving cart to DynamoDB:", err);
  }
}

async function saveAnalyticsToDynamo(analytics) {
  const yearMonth = analytics.yearMonth || new Date().toISOString().slice(0, 7);
  const params = {
    TableName: "OrderAnalytics",
    Item: {
      yearMonth,
      totalOrders: analytics.totalOrders,
      totalRevenue: analytics.totalRevenue,
      averageOrderValue: analytics.averageOrderValue,
      mostPopularItems: analytics.mostPopularItems,
      dailyRevenue: analytics.dailyRevenue,
    },
  };

  try {
    await docClient.send(new PutCommand(params));
  } catch (err) {
    console.error("Error saving analytics to DynamoDB:", err);
  }
}

module.exports = { saveOrderToDynamo, saveCartToDynamo, saveAnalyticsToDynamo };
