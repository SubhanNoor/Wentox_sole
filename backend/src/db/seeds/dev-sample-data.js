// DEV/TEST DATA ONLY — never run this against a client's real database.
//
// npm run seed:dev — separate from npm run seed (which only seeds the admin user + reference
// chart-of-accounts data, safe for a fresh production install). This script populates realistic
// sample business data (regions, cities, an adda, a vendor, categories, products with color
// variants and real production stock, customers) by calling the REAL service layer — not raw SQL
// — so every auto-created linked business account, generated code, and validation rule fires
// exactly as it would through the real UI. Needed to make Sale Bill/Sale Return testable before
// their own System Setup pages (Customers, Products, etc.) are wired to the backend.
//
// Idempotent: every service already blocks/soft-key-matches on an ACTIVE duplicate name, so
// re-running this is safe — it just resolves existing rows instead of erroring, except where
// noted (products key on name+vendor, stock production always adds a fresh movement).

const regionsService = require('../../services/regions.service');
const citiesService = require('../../services/cities.service');
const addasService = require('../../services/addas.service');
const vendorsService = require('../../services/vendors.service');
const categoriesService = require('../../services/categories.service');
const productsService = require('../../services/products.service');
const stockService = require('../../services/stock.service');
const customersService = require('../../services/customers.service');
const repository = {
  regions: require('../../repositories/regions.repository'),
  cities: require('../../repositories/cities.repository'),
  addas: require('../../repositories/addas.repository'),
  vendors: require('../../repositories/vendors.repository'),
  categories: require('../../repositories/categories.repository'),
  products: require('../../repositories/products.repository'),
  customers: require('../../repositories/customers.repository'),
};

const ADMIN_USER_ID = 1; // seeded by npm run seed — used as created_by on stock movements

async function ensure(findFn, createFn, label) {
  const existing = await findFn();
  if (existing) {
    console.log(`  already exists: ${label}`);
    return existing;
  }
  const created = await createFn();
  console.log(`  created: ${label}`);
  return created;
}

async function seed() {
  console.log('Seeding dev sample data (NOT for production use)...\n');

  console.log('Regions & cities:');
  const region = await ensure(
    () => repository.regions.findByName('Punjab'),
    () => regionsService.create({ name: 'Punjab' }),
    'region Punjab'
  );
  const city = await ensure(
    () => repository.cities.findByName('Lahore'),
    () => citiesService.create({ name: 'Lahore', region_id: region.region_id }),
    'city Lahore'
  );

  console.log('Adda:');
  const adda = await ensure(
    () => repository.addas.findByName('Badami Bagh Adda'),
    () => addasService.create({ name: 'Badami Bagh Adda', region_id: region.region_id, city_id: city.city_id }),
    'adda Badami Bagh Adda'
  );

  console.log('Vendor:');
  const vendor = await ensure(
    () => repository.vendors.findByNameAndPhone('Decent Polyurethane', '0300-1234567'),
    () => vendorsService.create({ name: 'Decent Polyurethane', phone: '0300-1234567', city_id: city.city_id }),
    'vendor Decent Polyurethane'
  );

  console.log('Categories:');
  const jogger = await ensure(
    () => repository.categories.findByName('Jogger Sole (PU)'),
    () => categoriesService.create({ name: 'Jogger Sole (PU)' }),
    'category Jogger Sole (PU)'
  );
  const slipper = await ensure(
    () => repository.categories.findByName('Slipper Sole (EVA)'),
    () => categoriesService.create({ name: 'Slipper Sole (EVA)' }),
    'category Slipper Sole (EVA)'
  );

  console.log('Products + color variants + production stock:');
  const productSpecs = [
    { name: 'Jogger Sole 101', category: jogger, packing: 12, salePrice: 470, colors: ['Black', 'White'] },
    { name: 'Jogger Sole 102', category: jogger, packing: 12, salePrice: 480, colors: ['Black'] },
    { name: 'Casual Slipper 551', category: slipper, packing: 12, salePrice: 260, colors: ['Brown', 'Black'] },
  ];

  const variants = []; // { article_id, variant_id, color, name }
  for (const spec of productSpecs) {
    const product = await ensure(
      () => repository.products.findByNameAndVendor(spec.name, vendor.vendor_id),
      () => productsService.create({
        name: spec.name,
        category_id: spec.category.category_id,
        vendor_id: vendor.vendor_id,
        packing: spec.packing,
        sale_price: spec.salePrice,
      }),
      `product ${spec.name} (vendor ${vendor.name})`
    );

    for (const color of spec.colors) {
      // resolveOrCreate is naturally idempotent (finds-or-creates by article_id+color).
      const result = await stockService.logProduction(
        {
          article_id: product.article_id,
          color,
          packing: spec.packing,
          movement_date: new Date().toISOString().split('T')[0],
          input_qty: 20,
          input_unit: 'CARTONS',
        },
        ADMIN_USER_ID
      );
      console.log(`  stocked: ${spec.name} / ${color} — +${result.qty_pairs} pairs (variant ${result.variant_id})`);
      variants.push({ article_id: product.article_id, variant_id: result.variant_id, color, name: spec.name });
    }
  }

  console.log('Customers:');
  const customerSpecs = [
    { name: 'Ahmed Footwear (LHR)', region_id: region.region_id, city_id: city.city_id },
    { name: 'Karachi Boot House (KHI)', region_id: region.region_id, city_id: city.city_id },
    { name: 'Malik Traders (HYD)', region_id: region.region_id, city_id: city.city_id },
  ];
  const customers = [];
  for (const spec of customerSpecs) {
    const customer = await ensure(
      () => repository.customers.findByName(spec.name),
      () => customersService.create(spec),
      `customer ${spec.name}`
    );
    customers.push(customer);
  }

  console.log('\nSeed complete. Summary:');
  console.log(`  region_id=${region.region_id}, city_id=${city.city_id}, adda_id=${adda.adda_id}, vendor_id=${vendor.vendor_id}`);
  console.log(`  variants: ${variants.map((v) => `${v.name}/${v.color}=#${v.variant_id}`).join(', ')}`);
  console.log(`  customers: ${customers.map((c) => `${c.name}=#${c.customer_id} (ba_id=${c.ba_id})`).join(', ')}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed:dev failed:', err.message);
    process.exitCode = 1;
  });
