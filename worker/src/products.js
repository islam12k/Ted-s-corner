// Your catalogue. The website shows these products; prices here are what customers pay (CAD).
// For each product, paste the AliExpress product ID (the number in the listing URL:
// aliexpress.com/item/1005001234567890.html -> "1005001234567890").
// sku_attr picks the variant (colour/size). Leave it "" to use the first variant; the
// /admin/product endpoint lists the exact sku_attr values for each listing.
// logistics is the AliExpress shipping method; /admin/freight shows the options for Canada.
// Photos come from AliExpress automatically unless you set image.

export const FREE_SHIPPING_OVER = 50;   // CAD
export const SHIPPING_FEE = 6.99;       // CAD, charged below the free-shipping amount

export const PRODUCTS = [
  { id: "sunset-lamp", aliexpress_id: "", sku_attr: "", logistics: "", price: 29.99, category: "Home", badge: "New",
    name: "Sunset Projection Lamp", desc: "Casts a warm golden-hour glow on any wall. USB-C powered, 180° head." },
  { id: "juice-blender", aliexpress_id: "", sku_attr: "", logistics: "", price: 34.99, category: "Kitchen",
    name: "Portable Juice Blender", desc: "380 ml cup, rechargeable, blends frozen fruit in about 30 seconds." },
  { id: "magsafe-stand", aliexpress_id: "", sku_attr: "", logistics: "", price: 24.99, category: "Tech", badge: "Trending",
    name: "MagSafe Desk Stand", desc: "Aluminium stand with a strong magnet ring. Rotates portrait to landscape." },
  { id: "led-strip", aliexpress_id: "", sku_attr: "", logistics: "", price: 27.99, category: "Home",
    name: "Smart LED Strip, 5 m", desc: "App and voice control, music sync, cut-to-length adhesive strip." },
  { id: "water-bottle", aliexpress_id: "", sku_attr: "", logistics: "", price: 32.99, category: "Outdoor",
    name: "Self-Cleaning Water Bottle", desc: "Insulated steel, 500 ml. UV cap runs a cleaning cycle every 4 hours." },
  { id: "pet-roller", aliexpress_id: "", sku_attr: "", logistics: "", price: 16.99, category: "Home", badge: "Under $20",
    name: "Pet Hair Remover Roller", desc: "Reusable, no sticky sheets. Works on sofas, car seats and bedding." },
  { id: "charging-cable", aliexpress_id: "", sku_attr: "", logistics: "", price: 14.99, category: "Tech",
    name: "3-in-1 Braided Charging Cable", desc: "USB-C, Lightning and Micro-USB tips on one 1.2 m nylon cable." },
  { id: "travel-pillow", aliexpress_id: "", sku_attr: "", logistics: "", price: 26.99, category: "Outdoor",
    name: "Memory Foam Travel Pillow", desc: "Rolls into its own pouch. Washable cover, adjustable chin strap." }
];
