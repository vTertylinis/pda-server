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
function saveCarts() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(carts, null, 2));
  } catch (error) {
    console.error("Failed to save carts:", error);
  }
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

// === Printing Functions ===

function sendToPrinter(ip, text, title = "") {
  const socket = new net.Socket();
  socket.connect(9100, ip, () => {
    const reset = Buffer.from([0x1b, 0x40]); // Initialize printer
    const setCodePage = Buffer.from([0x1b, 0x74, 0x09]); // Set code page 737 (Greek)

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

    // Pad short receipts
    const MIN_LINES = 30;
    const lines = text.split("\n");
    const padLines = Math.max(0, MIN_LINES - lines.length);
    const paddedText = text + "\n".repeat(padLines);

    // Apply center alignment to entire body text
    const centeredText = CENTER_ALIGN + paddedText;

    const footer = "\n\n\n\x1D\x56\x01";

    const content = iconv.encode(header + centeredText + footer, "cp737");
    const bufferToSend = Buffer.concat([reset, setCodePage, content]);

    socket.write(bufferToSend, () => {
      socket.end();
    });
  });

  socket.on("error", (err) => {
    console.error(`Error printing to ${ip}:`, err.message);
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
      `Τραπέζι: ${order.table}`,
      "---------------------",
      ...items.map((item) => {
        const itemLines = [
          "\x1B\x45\x01" +
            "\x1D\x21\x10" +
            `- ${item.name}` +
            "\x1D\x21\x00" +
            "\x1B\x45\x00",
        ];

        if (item.coffeePreference)
          itemLines.push(`  Ρόφημα: ${item.coffeePreference}`);
        if (item.coffeeSize) itemLines.push(`  Size: ${item.coffeeSize}`);
        if (item.extras?.length) {
          itemLines.push("  Υλικά:");
          for (const extra of item.extras) {
            itemLines.push(`    - ${extra.name} `);
          }
        }
        if (item.comments) itemLines.push(`  Σχόλια: ${item.comments}`);
        if (item.price) itemLines.push(`  Τιμή: ${item.price}`);

        return itemLines.join("\n");
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
      `Τραπέζι: ${order.table}`,
      "----- ΠΛΗΡΗΣ ΠΑΡΑΓΓΕΛΙΑ -----",
      ...order.items.map((item) => {
        const itemLines = [
          `- [${item.printer?.toUpperCase() || "N/A"}] ${item.name}`,
        ];

        if (item.coffeePreference)
          itemLines.push(`  Ρόφημα: ${item.coffeePreference}`);
        if (item.coffeeSize) itemLines.push(`  Μέγεθος: ${item.coffeeSize}`);
        if (item.extras?.length) {
          itemLines.push("  Υλικά:");
          for (const extra of item.extras) {
            itemLines.push(`    - ${extra.name}`);
          }
        }
        if (item.comments) itemLines.push(`  Σχόλια: ${item.comments}`);
        if (item.price) {
          total += Number(item.price);
          itemLines.push(`  Τιμή: ${item.price.toFixed(2)}`);
        }

        return itemLines.join("\n");
      }),
      "---------------------",
      `ΣΥΝΟΛΟ: ${total.toFixed(2)}`,
      new Date().toLocaleString(),
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

  // Mark printed items
  unprintedItems.forEach((item) => (item.printed = true));

  res.json({
    status: "Printed new items",
    printedCount: unprintedItems.length,
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Cart API server running at http://localhost:${PORT}`);
});
