const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const net = require("net");
const iconv = require("iconv-lite");

const app = express();
const PORT = 4300;
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "carts.json");

// Enable CORS so Angular frontend can connect
app.use(cors());
app.use(bodyParser.json());

// In-memory cart store: { [tableId]: [cartItems] }
let carts = {};

// Load existing carts from file
function loadCarts() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      carts = JSON.parse(data);
      console.log("Loaded carts from file.");
    } catch (error) {
      console.error("Failed to load carts:", error);
      carts = {};
    }
  }
}

function savePrintedOrderToHistory(order) {
  const now = new Date();
  const yearMonth = now.toISOString().slice(0, 7); // "2025-08"
  const historyDir = path.join(__dirname, "orders");
  const filePath = path.join(historyDir, `${yearMonth}.json`);

  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir);
  }

  let history = [];
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, "utf8");
      history = JSON.parse(data);
    } catch (err) {
      console.error("Failed to read history file:", err);
    }
  }

  const record = {
    ...order,
    timestamp: now.toISOString(),
  };

  history.push(record);

  try {
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error("Failed to write order history:", err);
  }
}

function saveCarts() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(carts, null, 2));
  } catch (error) {
    console.error("Failed to save carts:", error);
  }
}
function wrapTextByWords(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxChars) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}
loadCarts();
// Auto-save carts every minute
setInterval(saveCarts, 60000);
const PRINTERS = {
  bar: "192.168.68.240",
  kitchen: "192.168.68.111",
  crepe: "192.168.68.114",
};
const MIN_LINES = 30;

// Set Code Page 737 (Greek)
const SET_CODEPAGE_737 = Buffer.from([0x1b, 0x74, 0x09]);

// Reset printer
const RESET_PRINTER = Buffer.from([0x1b, 0x40]);

// Get cart for a table
app.get("/cart/:tableId", (req, res) => {
  const tableId = req.params.tableId;
  res.json(carts[tableId] || []);
});

// Get all tables that have items in their cart
app.get("/cart", (req, res) => {
  const nonEmptyCarts = {};
  for (const tableId in carts) {
    if (carts[tableId]?.length > 0) {
      nonEmptyCarts[tableId] = carts[tableId];
    }
  }
  res.json(nonEmptyCarts);
});

// Add item to cart
app.post("/cart/:tableId", (req, res) => {
  const tableId = req.params.tableId;
  const item = req.body;

  // Assign unique ID and mark unprinted
  item.id = uuidv4();
  item.printed = false;
  item.timestamp = new Date().toISOString();

  if (!carts[tableId]) {
    carts[tableId] = [];
  }

  carts[tableId].push(item);
  saveCarts();
  res.json({ success: true, cart: carts[tableId] });
});

// Edit item in cart by index
app.put("/cart/:tableId/item/:index", (req, res) => {
  const { tableId, index } = req.params;
  const updatedItem = req.body;

  if (!carts[tableId] || !carts[tableId][index]) {
    return res.status(404).json({ success: false, message: "Item not found" });
  }

  carts[tableId][index] = updatedItem;
  saveCarts();
  res.json({ success: true, cart: carts[tableId] });
});

// Clear cart
app.delete("/cart/:tableId", (req, res) => {
  const tableId = req.params.tableId;
  delete carts[tableId];
  saveCarts();
  res.json({ success: true });
});

// Optional: remove one item (e.g., by index or ID)
app.delete("/cart/:tableId/item/:index", (req, res) => {
  const { tableId, index } = req.params;
  if (carts[tableId]) {
    carts[tableId].splice(index, 1);
    saveCarts();
  }
  res.json({ success: true, cart: carts[tableId] || [] });
});

// Move all items from one table's cart to another table's cart
app.post("/move-table-items", (req, res) => {
  const { fromTable, toTable } = req.body;

  if (!fromTable || !toTable) {
    return res.status(400).json({
      success: false,
      message: "Both fromTable and toTable are required",
    });
  }

  if (!carts[fromTable] || carts[fromTable].length === 0) {
    return res.status(404).json({
      success: false,
      message: `No items found in fromTable ${fromTable}`,
    });
  }

  if (!carts[toTable]) {
    carts[toTable] = [];
  }

  carts[toTable] = carts[toTable].concat(carts[fromTable]);
  delete carts[fromTable];

  saveCarts();

  res.json({
    success: true,
    fromTable,
    toTable,
    movedItemsCount: carts[toTable].length,
    cart: carts[toTable],
  });
});

// === Printing Functions ===

function sendToPrinter(ip, text, title = "", retryCount = 5, attempt = 1) {
  const socket = new net.Socket();

  socket.connect(9100, ip, () => {
    const reset = Buffer.from([0x1b, 0x40]);
    const setCodePage = Buffer.from([0x1b, 0x74, 0x09]);
    const CENTER_ALIGN = "\x1B\x61\x01";
    const LEFT_ALIGN = "\x1B\x61\x00";

    let header = CENTER_ALIGN;

    if (title) {
      header += "\x1B\x45\x01"; // Bold on
      header += "\x1D\x21\x11"; // Double size
      header += title + "\n";
      header += "\x1D\x21\x00"; // Normal size
      header += "\x1B\x45\x00"; // Bold off
      header += "\n";
    }

    const lines = text.split("\n");
    const padLines = Math.max(0, MIN_LINES - lines.length);
    const paddedText = text + "\n".repeat(padLines);
    const centeredText = CENTER_ALIGN + paddedText;
    const footer = "\n\n\n\x1D\x56\x01";

    const content = iconv.encode(header + centeredText + footer, "cp737");
    const bufferToSend = Buffer.concat([reset, setCodePage, content]);

    socket.write(bufferToSend, () => {
      socket.end();
    });
  });

  socket.on("error", (err) => {
    console.error(`Error printing to ${ip} (attempt ${attempt}):`, err.message);

    if (attempt < retryCount) {
      setTimeout(() => {
        sendToPrinter(ip, text, title, retryCount, attempt + 1);
      }, 2000); // Retry after 1 second
    } else {
      console.error(`Failed to print to ${ip} after ${retryCount} attempts.`);
    }
  });
}

function routeAndPrintOrder(order) {
  const grouped = {}; // { printerKey: [items] }

  for (const item of order.items) {
    const printerKey = item.printer;
    if (!printerKey || !PRINTERS[printerKey]) continue;

    if (!grouped[printerKey]) {
      grouped[printerKey] = [];
    }
    grouped[printerKey].push(item);
  }

  for (const printerKey of Object.keys(grouped)) {
    const items = grouped[printerKey];

    const lines = [
      "\x1B\x45\x01" + `Τραπέζι: ${order.table}` + "\x1B\x45\x00",
      "---------------------",
      ...items.flatMap((item, index) => {
        const itemLines = [
          "\x1B\x45\x01" +
            "\x1D\x21\x11" +
            `${item.name}` +
            "\x1D\x21\x00" +
            "\x1B\x45\x00",
        ];

        if (item.coffeePreference)
          itemLines.push(
            "\x1D\x21\x11" + `Ρόφημα: ${item.coffeePreference}` + "\x1D\x21\x00"
          );

        if (item.coffeeSize)
          itemLines.push(
            "\x1D\x21\x11" + `Size: ${item.coffeeSize}` + "\x1D\x21\x00"
          );

        if (item.extras?.length) {
          const extrasLine = item.extras.map((extra) => extra.name).join(", ");
          const wrappedLines = wrapTextByWords(extrasLine, 16); // Adjust maxChars for your printer

          for (const line of wrappedLines) {
            itemLines.push("\x1D\x21\x11" + line + "\x1D\x21\x00");
          }
        }

        if (item.comments)
          itemLines.push(
            "\x1D\x21\x11" + `Σχόλια: ${item.comments}` + "\x1D\x21\x00"
          );

        if (item.price) itemLines.push(`Τιμή: ${item.price}`);

        const joinedItemLines = itemLines.join("\n");

        if (index < items.length - 1) {
          return [
            joinedItemLines,
            "----------------------------------------------",
          ];
        } else {
          return [joinedItemLines];
        }
      }),
      "---------------------",
      new Date().toLocaleString(),
    ];

    sendToPrinter(PRINTERS[printerKey], lines.join("\n"), "ORDER");
  }
  //  Additional full-table print for 'crepe' printer
  if (PRINTERS.crepe) {
    let total = 0;

    const fullOrderLines = [
      "\x1B\x45\x01" + `Τραπέζι: ${order.table}` + "\x1B\x45\x00",
      "---------------------",
      ...order.items.flatMap((item, index) => {
        const itemLines = [
          "\x1B\x45\x01" +
            "\x1D\x21\x11" +
            `${item.name}` +
            "\x1D\x21\x00" +
            "\x1B\x45\x00",
        ];

        if (item.coffeePreference)
          itemLines.push(
            "\x1D\x21\x11" + `Ρόφημα: ${item.coffeePreference}` + "\x1D\x21\x00"
          );

        if (item.coffeeSize)
          itemLines.push(
            "\x1D\x21\x11" + `Μέγεθος: ${item.coffeeSize}` + "\x1D\x21\x00"
          );

        if (item.extras?.length) {
          const extrasLine = item.extras.map((extra) => extra.name).join(", ");
          const wrappedLines = wrapTextByWords(extrasLine, 32); // Adjust maxChars for your printer

          for (const line of wrappedLines) {
            itemLines.push("\x1D\x21\x11" + line + "\x1D\x21\x00");
          }
        }

        if (item.comments)
          itemLines.push(
            "\x1D\x21\x11" + `Σχόλια: ${item.comments}` + "\x1D\x21\x00"
          );

        if (item.price) {
          total += Number(item.price);
          itemLines.push(`Τιμή: ${item.price.toFixed(2)}`);
        }

        const joinedItem = itemLines.join("\n");

        if (index < order.items.length - 1) {
          // Add divider after each item except last
          return [joinedItem, "----------------------------------------------"];
        } else {
          return [joinedItem];
        }
      }),
      "\x1D\x21\x11" + "---------------------" + "\x1D\x21\x00",
      "\x1D\x21\x11" + `ΣΥΝΟΛΟ: ${total.toFixed(2)}` + "\x1D\x21\x00",
      "\x1D\x21\x11" + new Date().toLocaleString() + "\x1D\x21\x00",
    ];

    sendToPrinter(PRINTERS.crepe, fullOrderLines.join("\n"), "FULL ORDER");
  }
}

// === Order Print Endpoint ===
app.post("/print-unprinted/:tableId", (req, res) => {
  const tableId = req.params.tableId;
  const cart = carts[tableId];

  if (!cart || cart.length === 0) {
    return res.status(404).json({ error: "No items to print" });
  }

  // Filter unprinted items
  const unprintedItems = cart.filter((item) => !item.printed);

  if (unprintedItems.length === 0) {
    return res.json({ status: "No new items to print" });
  }

  // Compose order object to reuse your routeAndPrintOrder function
  const order = {
    table: tableId,
    items: unprintedItems,
  };

  // Print them
  routeAndPrintOrder(order);
  //  Save printed order to history
  savePrintedOrderToHistory(order);

  // Mark printed items
  unprintedItems.forEach((item) => (item.printed = true));

  res.json({
    status: "Printed new items",
    printedCount: unprintedItems.length,
  });
});

//sum function
function getOrderStats(yearMonth) {
  const filePath = path.join(__dirname, "orders", `${yearMonth}.json`);

  if (!fs.existsSync(filePath)) {
    return { error: "No data for this month" };
  }

  let history;
  try {
    history = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return { error: "Failed to read order history" };
  }

  let totalRevenue = 0;
  let totalOrders = history.length;
  let itemCounts = {};
  let dailyStats = {}; // { day: { revenue, orders } }

  for (const order of history) {
    let orderTotal = 0;

    for (const item of order.items || []) {
      const price = Number(item.price) || 0;
      orderTotal += price;

      if (!itemCounts[item.name]) {
        itemCounts[item.name] = { count: 0, revenue: 0 };
      }
      itemCounts[item.name].count += 1;
      itemCounts[item.name].revenue += price;
    }

    totalRevenue += orderTotal;

    const day = order.timestamp?.slice(0, 10); // YYYY-MM-DD
    if (!dailyStats[day]) dailyStats[day] = { revenue: 0, orders: 0 };
    dailyStats[day].revenue += orderTotal;
    dailyStats[day].orders += 1;
  }

  const mostPopularItems = Object.entries(itemCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, stats]) => ({
      name,
      count: stats.count,
      revenue: stats.revenue.toFixed(2),
    }));

  return {
    yearMonth,
    totalOrders,
    totalRevenue: totalRevenue.toFixed(2),
    averageOrderValue: totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : "0.00",
    mostPopularItems,
    dailyRevenue: Object.entries(dailyStats)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, stats]) => ({
        day,
        revenue: stats.revenue.toFixed(2),
        orders: stats.orders
      })),
  };
}

// === Endpoint to get monthly stats ===
app.get("/order-stats/:yearMonth", (req, res) => {
  const { yearMonth } = req.params; // format "YYYY-MM"
  const stats = getOrderStats(yearMonth);
  res.json(stats);
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Cart API server running at http://localhost:${PORT}`);
});
