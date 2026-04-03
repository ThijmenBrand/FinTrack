/**
 * AI-inferred auto-categorization script
 * Analyzes transaction descriptions and creates categorization rules
 */

const BASE_URL = "http://localhost:3000";

// Category IDs from the database
const CATS = {
  groceries: "50d45c6a-6536-4fb8-a68f-2e16d4822b50",
  dining: "dcc510d7-c2a1-4229-8799-4445079b0814",
  coffee: "19967fee-b921-40ec-9e9d-66f1adb1e83e",
  entertainment: "d1faf90e-dbb5-48d7-8f8b-534bc8f56b47",
  health: "5a9455d9-b3ed-4c20-b6d2-601b6171e437",
  housing: "9ceed17f-41ed-434c-bec5-b1144f566937",
  transfer: "bdb1b149-5218-4238-9aee-3d691a921fb6",
  other: "1d6d6e17-a8bd-414e-bc68-0a24a661ced8",
  salary: "1557a593-9cb9-4e19-9184-9d1122ce30a6",
  shopping: "0b36ac52-c782-4af6-a25a-d4d83d05a2bd",
  subscriptions: "5aead3a3-c67c-4db8-af56-092851856815",
  transport: "a0504eaa-0165-410b-a50e-ab9947e87096",
  utilities: "0a5735d7-0e4f-4de6-8858-973db6eb1fec",
};

// We'll create some new categories first
const NEW_CATEGORIES = [
  { name: "Drinks & Nightlife", color: "#a855f7", icon: null },
  { name: "Travel", color: "#06b6d4", icon: null },
  { name: "Personal Care", color: "#f472b6", icon: null },
  { name: "Government & Tax", color: "#64748b", icon: null },
  { name: "Income - Other", color: "#059669", icon: null },
];

// Rules to create — [pattern, matchType, categoryKey]
// categoryKey references CATS or will be set after creating new categories
const RULES = [
  // === GROCERIES ===
  ["AH Strijp", "contains", "groceries"],
  ["Albert Heijn", "contains", "groceries"],
  ["BCK*PLUS", "contains", "groceries"],
  ["BCK*5835 EVH AH to Go", "contains", "groceries"],
  ["BCK*AH to go", "contains", "groceries"],
  ["BILLA DANKT", "contains", "groceries"],
  ["GG Strijp", "contains", "groceries"],
  ["HOFER DANKT", "contains", "groceries"],
  ["INTERSPAR", "contains", "groceries"],
  ["Intermarche", "contains", "groceries"],
  ["LIDL", "contains", "groceries"],
  ["Lidl", "contains", "groceries"],
  ["MAAS 1921", "contains", "groceries"],
  ["MAAS 1948", "contains", "groceries"],
  ["Nettorama", "contains", "groceries"],
  ["REWE", "contains", "groceries"],
  ["SPAR DANKT", "contains", "groceries"],
  ["Sligro", "contains", "groceries"],
  ["TGTG", "contains", "groceries"], // Too Good To Go

  // === DINING OUT / RESTAURANTS ===
  ["ASML-Albron", "contains", "dining"],
  ["ANNE AND MAX", "contains", "dining"],
  ["Bibl Eindhoven", "contains", "dining"],
  ["Brabantse Winter", "contains", "dining"],
  ["BCK*Eindhoven McAirpor", "contains", "dining"],
  ["BCK*Peppers", "contains", "dining"],
  ["CCV*SHB 3 BV", "contains", "dining"],
  ["De Smulhoek", "contains", "dining"],
  ["GJD B.V.", "contains", "dining"],
  ["KUNSTHAUSCAFE", "contains", "dining"],
  ["Lucifer Coffeeroasters", "contains", "coffee"],
  ["MARTIN AUER", "contains", "dining"],
  ["MarktbelangenEindhoven", "contains", "dining"],
  ["Mc Do", "contains", "dining"],
  ["RESTAURANT ODYSSEUS", "contains", "dining"],
  ["RELAY PLAZA", "contains", "dining"],
  ["Raimund Theater", "contains", "dining"], // bar at theater
  ["SELIM", "contains", "dining"],
  ["Senzer", "contains", "dining"],
  ["Stadspaviljoen", "contains", "dining"],
  ["SumUp  *KPUG Sourdough", "contains", "dining"],
  ["Turmcafe", "contains", "dining"],
  ["Vending Eindh Airp", "contains", "dining"],
  ["don boardservice", "contains", "dining"],

  // === DRINKS & NIGHTLIFE (new category) ===
  ["ESV Demos", "contains", "drinks"],
  ["Slijterij Brandewijn", "contains", "drinks"],
  ["SP VOLVIERS", "contains", "drinks"],
  ["Poppodium Nieuwe Nor", "contains", "drinks"],

  // === SHOPPING ===
  ["Action", "contains", "shopping"],
  ["ARKET", "contains", "shopping"],
  ["Arket", "contains", "shopping"],
  ["BCK*Jamin", "contains", "shopping"],
  ["BCK*Kiosk", "contains", "shopping"],
  ["BCK*1004 HM Kiosk", "contains", "shopping"],
  ["DM-FIL.", "contains", "shopping"], // DM drugstore
  ["Eurobazar", "contains", "shopping"],
  ["HEMA", "contains", "shopping"],
  ["Het Goed", "contains", "shopping"],
  ["Kruidvat", "contains", "shopping"],
  ["PWL Shop", "contains", "shopping"],
  ["Vinted", "contains", "shopping"],

  // === TRANSPORT ===
  ["OV-chipkaart", "contains", "transport"],
  ["Betaling OV-chipkaart", "contains", "transport"],
  ["Wijzigen automatisch opladen", "contains", "transport"],
  ["NS e-Tickets", "contains", "transport"],
  ["NLOV", "contains", "transport"], // OVpay
  ["www.ovpay", "contains", "transport"],
  ["ESSO", "contains", "transport"], // gas station
  ["Q8", "contains", "transport"], // gas station
  ["Station Clavier", "contains", "transport"], // gas station Belgium
  ["Flughafen Duesseldorf", "contains", "transport"],
  ["Eindhoven Airport", "contains", "transport"],
  ["Fietsdepot", "contains", "transport"], // bike depot
  ["Tanken", "contains", "transport"],
  ["Odido Aflossen", "contains", "subscriptions"], // phone plan payment
  ["Odido betaling", "contains", "subscriptions"],

  // === TRAVEL (new category) ===
  ["Flights on Booking.com", "contains", "travel"],
  ["NYX*OeBBInfrastruktur", "contains", "travel"], // Austrian train

  // === HOUSING ===
  ["Huur st", "contains", "housing"], // rent
  ["Restant huur", "contains", "housing"],
  ["periodieke opdracht", "contains", "housing"], // standing order for rent

  // === SUBSCRIPTIONS ===
  ["Amazon Prime", "contains", "subscriptions"],
  ["Apple ICloud+", "contains", "subscriptions"],
  ["Telefoon abonnement", "contains", "subscriptions"],
  ["Drago domein", "contains", "subscriptions"], // domain hosting
  ["Gandi order", "contains", "subscriptions"], // domain hosting
  ["Flitsmeister", "contains", "subscriptions"], // speed camera app
  ["Contributie", "contains", "subscriptions"], // membership dues

  // === SALARY ===
  ["ASML Netherlands B.V.-salaris", "contains", "salary"],
  ["LeadBot B.V.-Salaris", "contains", "salary"],

  // === GOVERNMENT & TAX (new category) ===
  ["BELASTINGDIENST", "contains", "gov"],
  ["ZORGTOESLAG", "contains", "gov"],

  // === INTERNAL TRANSFER ===
  ["Revolut**4150*", "contains", "transfer"],
  ["NL65BUNQ2113571374", "contains", "transfer"], // bunq top-up
  ["top-up", "contains", "transfer"],
  ["NL23ASNB0707892392", "contains", "transfer"], // joint account
  ["T.A. Brand", "contains", "transfer"], // self-transfer
  ["Geld", "exact", "transfer"], // just "Geld" = money transfer

  // === HEALTH ===
  ["VinkVink", "contains", "health"], // already exists
  ["Pearle Opticiens", "contains", "health"],

  // === PERSONAL CARE (new category) ===
  ["BCK*Traditions Kappers", "contains", "personalcare"], // barber

  // === ENTERTAINMENT ===
  ["CCV*GLOWGOLF", "contains", "entertainment"],
  ["First Vision", "contains", "entertainment"], // cinema
  ["Bibliotheek", "contains", "entertainment"],
  ["Stichting Helmond Spor", "contains", "entertainment"],

  // === INCOME - OTHER (new category) ===
  ["REFUND FROM Amazon", "contains", "income_other"],
  ["retour caution", "contains", "income_other"], // deposit return

  // === OTHER — Tikkie/WieBetaaltWat/PayPal/personal transfers ===
  ["AAB INZ TIKKIE", "contains", "other"],
  ["PAYPAL", "contains", "other"],
  ["Stichting Pay.nl", "contains", "other"],
  ["WieBetaaltWat", "contains", "other"],
  ["NYX*VendingWork", "contains", "other"], // vending machine
  ["SUMUP LTD", "contains", "other"],

  // Additional shopping
  ["Factuur:", "contains", "subscriptions"], // direct debit for subscriptions
];

async function createCategory(name, color) {
  const res = await fetch(`${BASE_URL}/api/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color }),
  });
  const data = await res.json();
  return data.id;
}

async function createRule(pattern, matchType, categoryId) {
  const res = await fetch(`${BASE_URL}/api/categories/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pattern,
      categoryId,
      matchType,
      applyToExisting: true,
    }),
  });
  const data = await res.json();
  return data;
}

async function main() {
  console.log("=== Auto-Categorization Script ===\n");

  // Step 1: Create new categories
  console.log("Creating new categories...");
  const newCatIds = {};
  for (const cat of NEW_CATEGORIES) {
    const id = await createCategory(cat.name, cat.color);
    console.log(`  Created: ${cat.name} (${id})`);
    newCatIds[cat.name] = id;
  }

  // Map friendly keys to IDs
  const catMap = {
    ...CATS,
    drinks: newCatIds["Drinks & Nightlife"],
    travel: newCatIds["Travel"],
    personalcare: newCatIds["Personal Care"],
    gov: newCatIds["Government & Tax"],
    income_other: newCatIds["Income - Other"],
  };

  // Step 2: Create rules and apply to existing transactions
  console.log("\nCreating categorization rules...");
  let totalApplied = 0;

  for (const [pattern, matchType, catKey] of RULES) {
    const categoryId = catMap[catKey];
    if (!categoryId) {
      console.log(`  SKIP: No category found for key "${catKey}"`);
      continue;
    }
    const result = await createRule(pattern, matchType, categoryId);
    if (result.applied > 0) {
      console.log(`  ✓ "${pattern}" (${matchType}) → ${catKey}: ${result.applied} transactions`);
      totalApplied += result.applied;
    } else {
      console.log(`  - "${pattern}" (${matchType}) → ${catKey}: 0 new matches`);
    }
  }

  console.log(`\n=== Done! Applied categories to ${totalApplied} transactions ===`);

  // Step 3: Check remaining uncategorized
  const { createClient } = require("@libsql/client");
  const client = createClient({ url: "file:data/finance.db" });
  const stats = await client.execute(
    "SELECT count(*) as total, count(category_id) as categorized FROM transactions"
  );
  const { total, categorized } = stats.rows[0];
  console.log(`\nFinal stats: ${categorized}/${total} transactions categorized (${Math.round(categorized/total*100)}%)`);

  const uncategorized = await client.execute(
    "SELECT DISTINCT description FROM transactions WHERE category_id IS NULL ORDER BY description"
  );
  if (uncategorized.rows.length > 0) {
    console.log(`\nRemaining uncategorized (${uncategorized.rows.length} unique descriptions):`);
    uncategorized.rows.forEach((r) => console.log(`  - ${r.description}`));
  }
}

main().catch(console.error);
