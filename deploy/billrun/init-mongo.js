// ============================================================================
// MongoDB Initialization Script for BillRun — CloudPhone11
// Creates required collections and indexes for telecom billing
// ============================================================================

db = db.getSiblingDB("billrun");

// Create collections
db.createCollection("accounts");
db.createCollection("subscribers");
db.createCollection("lines");        // CDR records
db.createCollection("bills");        // Invoices
db.createCollection("plans");
db.createCollection("rates");
db.createCollection("balances");
db.createCollection("autorenew");
db.createCollection("audit");

// Create indexes for performance
db.accounts.createIndex({ "aid": 1 }, { unique: true });
db.subscribers.createIndex({ "sid": 1 }, { unique: true });
db.subscribers.createIndex({ "aid": 1 });
db.lines.createIndex({ "aid": 1, "urt": -1 });
db.lines.createIndex({ "sid": 1, "urt": -1 });
db.lines.createIndex({ "type": 1, "urt": -1 });
db.lines.createIndex({ "billrun_key": 1 });
db.bills.createIndex({ "aid": 1, "billrun_key": -1 });
db.plans.createIndex({ "name": 1 });
db.rates.createIndex({ "key": 1 });
db.balances.createIndex({ "aid": 1, "sid": 1 });
db.autorenew.createIndex({ "aid": 1 });

// ─── Insert default CloudPhone11 service plans ─────────────────────────────

db.plans.insertMany([
  {
    name: "starter",
    description: "CloudPhone11 Starter Plan",
    price: 9.99,
    currency: "USD",
    period: "month",
    services: ["voice_500min", "did_1", "sms_100"],
    rates: {
      voice: { rate: 0.015, unit: "second", min_charge: 0 },
      sms: { rate: 0.008, unit: "message" },
      did_rental: { rate: 4.99, unit: "month" },
    },
    included: {
      voice_minutes: 500,
      sms_count: 100,
      did_count: 1,
    },
    overage: {
      voice: 0.02,
      sms: 0.01,
    },
    active: true,
    created: new Date(),
  },
  {
    name: "business",
    description: "CloudPhone11 Business Plan",
    price: 24.99,
    currency: "USD",
    period: "month",
    services: ["voice_unlimited", "did_3", "sms_500", "video", "ivr", "recording"],
    rates: {
      voice: { rate: 0.01, unit: "second", min_charge: 0 },
      sms: { rate: 0.006, unit: "message" },
      did_rental: { rate: 3.99, unit: "month" },
    },
    included: {
      voice_minutes: -1,  // unlimited
      sms_count: 500,
      did_count: 3,
    },
    overage: {
      sms: 0.008,
    },
    active: true,
    created: new Date(),
  },
  {
    name: "enterprise",
    description: "CloudPhone11 Enterprise Plan",
    price: 49.99,
    currency: "USD",
    period: "month",
    services: ["voice_unlimited", "did_10", "sms_unlimited", "video", "ivr", "recording", "mvno_sim", "priority_support"],
    rates: {
      voice: { rate: 0.008, unit: "second", min_charge: 0 },
      sms: { rate: 0.004, unit: "message" },
      did_rental: { rate: 2.99, unit: "month" },
    },
    included: {
      voice_minutes: -1,
      sms_count: -1,
      did_count: 10,
    },
    active: true,
    created: new Date(),
  },
]);

// ─── Insert default rating rules ───────────────────────────────────────────

db.rates.insertMany([
  // Domestic voice rates (US)
  { key: "voice_domestic_us", type: "voice", prefix: "1", rate: 0.01, unit: "second", description: "US Domestic Voice" },
  // International voice rates (examples)
  { key: "voice_intl_uk", type: "voice", prefix: "44", rate: 0.025, unit: "second", description: "UK International Voice" },
  { key: "voice_intl_de", type: "voice", prefix: "49", rate: 0.028, unit: "second", description: "Germany International Voice" },
  { key: "voice_intl_au", type: "voice", prefix: "61", rate: 0.035, unit: "second", description: "Australia International Voice" },
  { key: "voice_intl_sg", type: "voice", prefix: "65", rate: 0.022, unit: "second", description: "Singapore International Voice" },
  { key: "voice_intl_th", type: "voice", prefix: "66", rate: 0.03, unit: "second", description: "Thailand International Voice" },
  // SMS rates
  { key: "sms_domestic", type: "sms", prefix: "1", rate: 0.008, unit: "message", description: "Domestic SMS" },
  { key: "sms_international", type: "sms", prefix: "*", rate: 0.015, unit: "message", description: "International SMS" },
  // DID rental rates
  { key: "did_us_local", type: "did", country: "US", did_type: "local", rate: 4.99, unit: "month", description: "US Local DID" },
  { key: "did_us_tollfree", type: "did", country: "US", did_type: "toll_free", rate: 9.99, unit: "month", description: "US Toll-Free DID" },
  { key: "did_uk_local", type: "did", country: "GB", did_type: "local", rate: 5.99, unit: "month", description: "UK Local DID" },
]);

print("CloudPhone11 BillRun database initialized successfully.");
print("Default plans: starter ($9.99), business ($24.99), enterprise ($49.99)");
print("Rating rules loaded for voice, SMS, and DID billing.");
