/**
 * SamleyGo menu add-ons ("Add extras" / "Make it a combo") — test suite.
 *
 *   npm run test:addons   (tsx scripts/menu_addons.test.ts)
 *
 * What is covered:
 *   1. The migration contract — the five tables, their constraints, the row
 *      level security, the insert-only snapshot and the indexes.
 *   2. Server-side pricing — the BEFORE trigger that throws the client's
 *      numbers away, the restaurant-ownership check, and the parent order's
 *      food subtotal that now counts its add-on lines.
 *   3. The cart maths, using the worked example from the specification:
 *      Fried rice GH₵45 ×1 + extra chicken GH₵15 ×1 + bottled water GH₵5 ×2
 *      ⇒ extras GH₵25.00, food subtotal GH₵70.00.
 *   4. Cart line identity — the same meal with a different combination of
 *      extras is a different line, and the same combination in a different
 *      pick order is the same line.
 *   5. Selection rules — required groups, minimums, maximums, sold-out
 *      extras and per-extra quantity caps.
 *   6. Which extras a meal offers, and which groups apply to it.
 *   7. Source scans of the screens: the extras picker, the cart's extras
 *      display and edit link, the checkout payload, the owner manager, the
 *      restaurant order card, the customer receipt and the reorder path.
 *
 * IMPORTANT: the database is still the authority. Every price here is
 * re-derived by `enforce_order_item_extra_pricing()` and `recalc_single_order()`
 * when the order is written; these tests lock down the client rules that must
 * agree with it, and the fact that no client code path can set a price.
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AddonCatalogShape,
  AddonSelection,
  CartExtra,
  addonsForMeal,
  cartFoodSubtotal,
  cartItemCount,
  cartLineKey,
  describeGroupHint,
  effectiveGroupMax,
  effectiveGroupMin,
  extrasSignature,
  extrasSubtotal,
  extrasToSelection,
  groupsForMeal,
  lineTotal,
  mealAddonView,
  normalizeCartItem,
  orderItemExtraPayload,
  selectionToExtras,
  ungroupedAddons,
  validateAddonSelection,
} from '../src/lib/addons';
import type { AddonGroup, MenuAddon, MenuItem, MenuItemAddonLink } from '../src/types/database';

// ---------------------------------------------------------------------------
// Tiny test runner (no extra dependencies)
// ---------------------------------------------------------------------------

let passed = 0;
const failures: { name: string; error: Error }[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, error: error as Error });
    console.error(`  \u2717 ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...segments: string[]) => readFileSync(path.join(ROOT, ...segments), 'utf8');

const MIGRATION = 'supabase/migrations/20261015_menu_addons.sql';

// ---------------------------------------------------------------------------
// Fixtures — real shapes, no invented prices beyond the specification example
// ---------------------------------------------------------------------------

const RESTAURANT = '11111111-1111-1111-1111-111111111111';
const OTHER_RESTAURANT = '22222222-2222-2222-2222-222222222222';

const makeMenuItem = (overrides: Partial<MenuItem> = {}): MenuItem => ({
  id: 'meal-fried-rice',
  restaurant_id: RESTAURANT,
  name: 'Fried Rice',
  price: 45,
  is_available: true,
  preparation_time_minutes: 20,
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:00:00Z',
  ...overrides,
});

const makeAddon = (overrides: Partial<MenuAddon> = {}): MenuAddon => ({
  id: 'addon-chicken',
  restaurant_id: RESTAURANT,
  name: 'Extra chicken',
  description: 'Grilled chicken breast',
  price: 15,
  is_available: true,
  is_archived: false,
  max_quantity: 10,
  offering: 'ALL',
  sort_order: 0,
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:00:00Z',
  ...overrides,
});

const WATER = makeAddon({
  id: 'addon-water',
  name: 'Bottled water',
  description: '500ml',
  price: 5,
  sort_order: 1,
});

const CHICKEN = makeAddon();

const EGG = makeAddon({
  id: 'addon-egg',
  name: 'Fried egg',
  price: 6,
  offering: 'SELECT',
  sort_order: 2,
});

const makeGroup = (overrides: Partial<AddonGroup> = {}): AddonGroup => ({
  id: 'group-drink',
  restaurant_id: RESTAURANT,
  name: 'Choose a drink',
  is_required: false,
  min_select: 0,
  max_select: 0,
  sort_order: 0,
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:00:00Z',
  ...overrides,
});

const catalogWith = (
  addons: MenuAddon[],
  groups: AddonGroup[] = [],
  optionsByGroup: Record<string, MenuAddon[]> = {},
  links: MenuItemAddonLink[] = []
): AddonCatalogShape => ({ addons, groups, optionsByGroup, links });

// ===========================================================================
// 1. The migration contract
// ===========================================================================

test('the add-on migration exists', () => {
  assert.ok(existsSync(path.join(ROOT, MIGRATION)), `${MIGRATION} is missing`);
});

test('it creates all five tables', () => {
  const sql = read(MIGRATION);
  for (const table of [
    'public.menu_addons',
    'public.addon_groups',
    'public.addon_group_items',
    'public.menu_item_addons',
    'public.order_item_extras',
  ]) {
    assert.ok(
      sql.includes(`create table if not exists ${table}`),
      `${table} is not created by the migration`
    );
  }
});

test('monetary and quantity columns are constrained, not free text', () => {
  const sql = read(MIGRATION);
  assert.ok(/price numeric\(10,2\) not null/.test(sql), 'menu_addons.price must be numeric(10,2)');
  assert.ok(
    /constraint menu_addons_price_check check \(price >= 0 and price <= 99999999\.99\)/.test(sql),
    'the add-on price range is not enforced'
  );
  assert.ok(
    /constraint menu_addons_max_quantity_check check \(max_quantity between 1 and 100\)/.test(sql),
    'the per-line quantity cap is not enforced'
  );
  assert.ok(
    /constraint order_item_extras_quantity_check check \(quantity between 1 and 100\)/.test(sql),
    'the snapshotted quantity is not enforced'
  );
  assert.ok(
    /constraint menu_addons_offering_check check \(offering in \('ALL', 'SELECT'\)\)/.test(sql),
    "the 'every meal / only these meals' switch is not enforced"
  );
  assert.ok(
    /constraint addon_groups_max_ge_min_check check \(max_select = 0 or max_select >= min_select\)/.test(sql),
    'a group may still claim a maximum below its minimum'
  );
});

test('the add-on snapshot cannot be invented or deleted out of history', () => {
  const sql = read(MIGRATION);
  assert.ok(
    /menu_addon_id uuid not null references public\.menu_addons\(id\) on delete restrict/.test(
      sql
    ),
    'order_item_extras.menu_addon_id must be NOT NULL and ON DELETE RESTRICT'
  );
  assert.ok(
    /constraint uq_menu_item_addon unique \(menu_item_id, menu_addon_id\)/.test(sql),
    'a meal may link the same extra twice'
  );
  assert.ok(
    /constraint uq_addon_group_item unique \(addon_group_id, menu_addon_id\)/.test(sql),
    'a group may offer the same extra twice'
  );
});

test('row level security is on for every new table', () => {
  const sql = read(MIGRATION);
  for (const table of [
    'menu_addons',
    'addon_groups',
    'addon_group_items',
    'menu_item_addons',
    'order_item_extras',
  ]) {
    assert.ok(
      sql.includes(`alter table public.${table} enable row level security;`),
      `RLS is not enabled on ${table}`
    );
    assert.ok(
      new RegExp(`create policy "[^"]*" on public\\.${table}\\s+for select`).test(sql),
      `${table} has no SELECT policy`
    );
  }
});

test('only the owning restaurant writes its add-ons', () => {
  const sql = read(MIGRATION);
  for (const table of ['menu_addons', 'addon_groups', 'addon_group_items', 'menu_item_addons']) {
    const policy = sql.slice(sql.indexOf(`on public.${table}`, sql.indexOf('create policy')));
    assert.ok(
      policy.includes('owner_id = auth.uid()'),
      `${table}'s write policy is not scoped to the restaurant owner`
    );
  }
});

test('the snapshot is INSERT-only: a placed order can never be repriced', () => {
  const sql = read(MIGRATION);
  const start = sql.indexOf('ORDER ITEM EXTRAS');
  const section = sql.slice(start > 0 ? start : 0);
  assert.ok(
    !/create policy "[^"]*" on public\.order_item_extras\s+for (update|delete)/i.test(section),
    'order_item_extras must have no UPDATE or DELETE policy'
  );
  assert.ok(
    /create policy "Customers can insert extras on their own order items"[\s\S]*?for insert with check \([\s\S]*?customer_id = auth\.uid\(\)/.test(
      section
    ),
    'only the ordering customer may add add-on lines'
  );
});

test('server-side add-on pricing is installed ahead of the table write', () => {
  const sql = read(MIGRATION);
  assert.ok(
    sql.includes('create or replace function public.enforce_order_item_extra_pricing()'),
    'the add-on pricing trigger function is missing'
  );
  assert.ok(
    /security definer\s+set search_path = public[\s\S]*?enforce_order_item_extra_pricing/.test(
      sql.slice(sql.indexOf('create or replace function public.enforce_order_item_extra_pricing()'))
    ),
    'the add-on pricing function must be SECURITY DEFINER with a pinned search_path'
  );
  assert.ok(
    /create trigger trg_order_item_extras_pricing\s+before insert or update on public\.order_item_extras/.test(
      sql
    ),
    'the pricing trigger must run BEFORE insert/update, so submitted numbers never land'
  );
});

test('the trigger discards every number the browser sends', () => {
  const sql = read(MIGRATION);
  assert.ok(sql.includes('new.addon_name := v_addon.name'), 'the submitted name is not replaced');
  assert.ok(sql.includes('new.unit_price := v_addon.price'), 'the submitted price is not replaced');
  assert.ok(
    sql.includes('new.subtotal := round(new.unit_price * new.quantity, 2)'),
    'the submitted line total is not recomputed'
  );
});

test('the trigger refuses an add-on from another restaurant or a sold-out one', () => {
  const sql = read(MIGRATION);
  assert.ok(
    sql.includes('v_addon.restaurant_id <> v_order_restaurant'),
    'a cross-restaurant add-on is not rejected'
  );
  assert.ok(
    sql.includes("'% is currently unavailable. Remove it to continue.'"),
    'a sold-out extra would still be ordered'
  );
  assert.ok(
    sql.includes("'% is no longer offered. Remove it to continue.'"),
    'an archived extra would still be ordered'
  );
  assert.ok(
    sql.includes("'Only % of % can be ordered per line'"),
    'the per-extra quantity cap is not enforced server-side'
  );
  assert.ok(
    sql.includes("'An add-on line must reference a real menu add-on'"),
    'a null reference could still carry an invented price'
  );
});

test("the parent order's food subtotal counts its add-on lines", () => {
  const sql = read(MIGRATION);
  const start = sql.indexOf('create or replace function public.recalc_single_order');
  const body = sql.slice(start, sql.indexOf('$$;', start));
  assert.ok(body.includes('order_item_extras'), 'recalc_single_order still counts meals only');
  assert.ok(
    body.includes('samleygo.internal_financial_write'),
    'recalc_single_order lost the internal-write flag that guards commission'
  );
  assert.ok(body.includes('if v_count = 0 then'), 'an order shell must keep its submitted subtotal');
});

test('every add-on change re-derives the order', () => {
  const sql = read(MIGRATION);
  for (const suffix of ['insert', 'update', 'delete']) {
    assert.ok(
      sql.includes(`trg_order_item_extras_recalc_${suffix}`),
      `the ${suffix} recalc trigger on order_item_extras is missing`
    );
  }
});

test('indexes cover every join the menus and receipts perform', () => {
  const sql = read(MIGRATION);
  for (const index of [
    'idx_menu_addons_restaurant',
    'idx_addon_groups_restaurant',
    'idx_addon_group_items_group',
    'idx_menu_item_addons_item',
    'idx_order_item_extras_item',
  ]) {
    assert.ok(sql.includes(index), `${index} is missing`);
  }
});

test('the migration is idempotent and adds nothing to the customer as a fee', () => {
  const sql = read(MIGRATION);
  assert.ok(/drop trigger if exists/.test(sql), 're-running the migration would fail on a trigger');
  assert.ok(
    /drop policy if exists/.test(sql),
    're-running the migration would fail on a policy'
  );
  assert.ok(
    !/delivery_fee|commission_rate|customer fee/i.test(
      sql.slice(sql.indexOf('order_item_extras'))
    ),
    'add-ons must never become a separate customer fee or a second commission'
  );
});

test('the add-on database checks file rolls back everything it does', () => {
  const checks = read('supabase/tests/menu_addons_checks.sql');
  assert.ok(checks.includes('begin;'), 'the checks file does not open a transaction');
  assert.ok(checks.includes('rollback;'), 'the checks file would commit its fixtures');
  assert.ok(
    checks.includes("raise exception 'FAIL -"),
    'the checks file has no way to report a broken rule'
  );
  assert.ok(
    checks.includes("PASS 6 - a doctored price is rewritten"),
    'the behavioural price-tampering check is missing'
  );
});

// ===========================================================================
// 2. Cart maths — the specification's worked example
// ===========================================================================

test('the worked example: GH₵45 meal + GH₵15 chicken + 2 × GH₵5 water', () => {
  const extras: CartExtra[] = [
    { addonId: CHICKEN.id, name: CHICKEN.name, unitPrice: 15, quantity: 1 },
    { addonId: WATER.id, name: WATER.name, unitPrice: 5, quantity: 2 },
  ];

  assert.equal(extrasSubtotal(extras), 25, 'extras subtotal must be GH₵25.00');

  const line = { menuItem: makeMenuItem(), quantity: 1, extras };
  assert.equal(lineTotal(line), 70, 'the line must total GH₵70.00');
  assert.equal(cartFoodSubtotal([line]), 70, 'the food subtotal must be GH₵70.00');
});

test('extras are priced by their own quantity, never scaled by the meal', () => {
  const extras: CartExtra[] = [
    { addonId: CHICKEN.id, name: CHICKEN.name, unitPrice: 15, quantity: 1 },
  ];
  const line = { menuItem: makeMenuItem(), quantity: 2, extras };

  // 2 × GH₵45 = GH₵90 for the meals, plus ONE GH₵15 extra.
  assert.equal(lineTotal(line), 105, 'the extra must not be multiplied by the meal quantity');
  assert.equal(cartFoodSubtotal([line]), 105);
  assert.equal(extrasSubtotal(extras), 15);
});

test('money is rounded to two decimals, like the server', () => {
  const extras: CartExtra[] = [
    { addonId: 'a', name: 'A', unitPrice: 0.335, quantity: 3 },
  ];
  assert.equal(extrasSubtotal(extras), 1.01, '0.335 × 3 rounds to 1.01, not 1.00 or 1.005');
  assert.equal(
    lineTotal({ menuItem: makeMenuItem({ price: 10.5 }), quantity: 1, extras }),
    11.51,
    'the meal and the extras each round once, then add'
  );
});

test('several lines and several extras add up into one food subtotal', () => {
  const items = [
    {
      menuItem: makeMenuItem(),
      quantity: 1,
      extras: [{ addonId: CHICKEN.id, name: CHICKEN.name, unitPrice: 15, quantity: 1 }],
    },
    {
      menuItem: makeMenuItem({ id: 'meal-jollof', name: 'Jollof', price: 40 }),
      quantity: 2,
      extras: [
        { addonId: WATER.id, name: WATER.name, unitPrice: 5, quantity: 2 },
        { addonId: 'addon-egg', name: 'Fried egg', unitPrice: 6, quantity: 1 },
      ],
    },
  ];

  // (45 + 15) + (80 + 10 + 6) = 156
  assert.equal(cartFoodSubtotal(items), 156);
  // 1 meal + 1 extra + 2 meals + 2 extras + 1 extra = 7 things in the cart
  assert.equal(cartItemCount(items), 7);
});

test('a cart with no extras behaves exactly as it did before the feature', () => {
  const items = [
    { menuItem: makeMenuItem(), quantity: 3 },
    { menuItem: makeMenuItem({ id: 'meal-x', price: 10 }), quantity: 1 },
  ];
  assert.equal(extrasSubtotal(undefined), 0);
  assert.equal(cartFoodSubtotal(items), 145);
  assert.equal(cartItemCount(items), 4, 'the badge still counts the meals');
});

// ===========================================================================
// 3. Cart line identity
// ===========================================================================

test('the same meal with different extras is a different cart line', () => {
  const withChicken = {
    menuItem: makeMenuItem(),
    quantity: 1,
    extras: [{ addonId: CHICKEN.id, name: CHICKEN.name, unitPrice: 15, quantity: 1 }],
  };
  const withEgg = {
    menuItem: makeMenuItem(),
    quantity: 1,
    extras: [{ addonId: 'addon-egg', name: 'Fried egg', unitPrice: 6, quantity: 1 }],
  };
  const plain = { menuItem: makeMenuItem(), quantity: 1 };

  assert.notEqual(cartLineKey(withChicken), cartLineKey(withEgg));
  assert.notEqual(cartLineKey(withChicken), cartLineKey(plain));
  assert.notEqual(cartLineKey(withEgg), cartLineKey(plain));
});

test('line identity ignores pick order and respects quantity', () => {
  const a = {
    menuItem: makeMenuItem(),
    quantity: 1,
    extras: [
      { addonId: CHICKEN.id, name: 'Extra chicken', unitPrice: 15, quantity: 1 },
      { addonId: WATER.id, name: 'Bottled water', unitPrice: 5, quantity: 2 },
    ],
  };
  const b = {
    menuItem: makeMenuItem(),
    quantity: 1,
    extras: [
      { addonId: WATER.id, name: 'Bottled water', unitPrice: 5, quantity: 2 },
      { addonId: CHICKEN.id, name: 'Extra chicken', unitPrice: 15, quantity: 1 },
    ],
  };
  const c = {
    menuItem: makeMenuItem(),
    quantity: 1,
    extras: [
      { addonId: CHICKEN.id, name: 'Extra chicken', unitPrice: 15, quantity: 2 },
      { addonId: WATER.id, name: 'Bottled water', unitPrice: 5, quantity: 2 },
    ],
  };

  assert.equal(cartLineKey(a), cartLineKey(b), 'picking the same things in another order is the same line');
  assert.notEqual(cartLineKey(a), cartLineKey(c), 'a different quantity is a different line');
  assert.equal(extrasSignature(undefined), '', 'a plain meal has an empty signature');
});

// ===========================================================================
// 4. The checkout payload and loading a persisted cart
// ===========================================================================

test('the checkout payload points every extra at a real add-on id', () => {
  const rows = orderItemExtraPayload('line-1', [
    { addonId: CHICKEN.id, name: 'Extra chicken', unitPrice: 15, quantity: 1 },
    { addonId: WATER.id, name: 'Bottled water', unitPrice: 5, quantity: 2 },
    { addonId: 'skip-me', name: 'Zero', unitPrice: 3, quantity: 0 },
  ]);

  assert.equal(rows.length, 2, 'a zero-quantity extra is never sent');
  assert.deepEqual(
    rows.map((row) => row.menu_addon_id),
    [CHICKEN.id, WATER.id]
  );
  assert.ok(
    rows.every((row) => row.order_item_id === 'line-1'),
    'each extra must name the line it belongs to'
  );
  assert.equal(rows[1].subtotal, 10, 'the row carries its own line total');
  assert.equal(orderItemExtraPayload('line-2', undefined).length, 0);
});

test('a cart saved before add-ons existed still loads', () => {
  const legacy = normalizeCartItem({
    menuItem: makeMenuItem(),
    quantity: 2,
    notes: 'no shito',
  });
  assert.ok(legacy, 'a pre-add-on cart line must survive');
  assert.equal(legacy!.quantity, 2);
  assert.equal(legacy!.notes, 'no shito');
  assert.equal(legacy!.extras, undefined, 'an empty extras list stays undefined');
  assert.equal(cartFoodSubtotal([legacy!]), 90);
});

test('a malformed or hostile cart line is dropped, never rendered with a fake price', () => {
  assert.equal(normalizeCartItem(null), null);
  assert.equal(normalizeCartItem({ quantity: 1 }), null, 'no dish, no line');
  assert.equal(normalizeCartItem({ menuItem: { id: 'x', price: 5 } }), null, 'no quantity');
  assert.equal(
    normalizeCartItem({ menuItem: { id: 'x', price: 5 }, quantity: 0 }),
    null,
    'a zero-quantity line'
  );

  const hostile = normalizeCartItem({
    menuItem: { id: 'x', price: 5 },
    quantity: 1,
    extras: [
      { addonId: '', name: 'Free chicken', unitPrice: -20, quantity: 1 },
      { addonId: 'ok', name: 'Water', unitPrice: 5, quantity: 2 },
      { addonId: 'bad-qty', name: 'Egg', unitPrice: 6, quantity: -1 },
    ],
  });
  assert.ok(hostile, 'the valid extra still loads');
  assert.equal(hostile!.extras!.length, 1, 'negative prices and empty ids are discarded');
  assert.equal(hostile!.extras![0].addonId, 'ok');
  assert.equal(extrasSubtotal(hostile!.extras), 10);
});

test('extra quantities are whole numbers', () => {
  const line = normalizeCartItem({
    menuItem: { id: 'x', price: 5 },
    quantity: 1,
    extras: [{ addonId: 'ok', name: 'Water', unitPrice: 5.5, quantity: 2.7 }],
  });
  assert.equal(line!.extras![0].quantity, 2);
  assert.equal(extrasSubtotal(line!.extras), 11);
});

// ===========================================================================
// 5. Selection rules
// ===========================================================================

const drinkOptions = [WATER, makeAddon({ id: 'addon-juice', name: 'Orange juice', price: 8, sort_order: 3 })];
const drinkGroup = { group: makeGroup(), options: drinkOptions };

test('a required group always needs at least one pick', () => {
  assert.equal(effectiveGroupMin(makeGroup({ is_required: true, min_select: 0 })), 1);
  assert.equal(effectiveGroupMin(makeGroup({ is_required: true, min_select: 3 })), 3);
  assert.equal(effectiveGroupMin(makeGroup({ is_required: false, min_select: 0 })), 0);
  assert.equal(effectiveGroupMax(makeGroup({ max_select: 0 })), 0, '0 means no maximum');
});

test('the group hint reads the way the customer needs it to', () => {
  assert.equal(describeGroupHint(makeGroup({ min_select: 1, max_select: 3 })), 'Choose 1\u20133');
  assert.equal(describeGroupHint(makeGroup({ min_select: 2, max_select: 2 })), 'Choose 2');
  assert.equal(describeGroupHint(makeGroup({ max_select: 2 })), 'Choose up to 2');
  assert.equal(describeGroupHint(makeGroup({ min_select: 2 })), 'Choose at least 2');
  assert.equal(describeGroupHint(makeGroup()), 'Optional');
  assert.equal(describeGroupHint(makeGroup({ is_required: true })), 'Choose at least 1');
});

test('an empty selection is legal for an optional group', () => {
  assert.equal(validateAddonSelection({}, [drinkGroup], drinkOptions), null);
  assert.equal(validateAddonSelection({}, [], [CHICKEN]), null);
});

test('a required group blocks the add with a plain sentence', () => {
  const required = { group: makeGroup({ is_required: true }), options: drinkOptions };
  const message = validateAddonSelection({}, [required], drinkOptions);
  assert.equal(message, 'Choose at least 1 option for Choose a drink.');
});

test('a group minimum and maximum are both enforced', () => {
  const threeDrinks = [
    WATER,
    drinkOptions[1],
    makeAddon({ id: 'addon-sprite', name: 'Sprite', price: 4, sort_order: 5 }),
  ];
  const strict = { group: makeGroup({ min_select: 2, max_select: 2 }), options: threeDrinks };

  assert.equal(
    validateAddonSelection({ [WATER.id]: 1 }, [strict], threeDrinks),
    'Choose at least 2 options for Choose a drink.'
  );
  assert.equal(
    validateAddonSelection(
      {
        [WATER.id]: 1,
        [threeDrinks[1].id]: 1,
        [threeDrinks[2].id]: 1,
      },
      [strict],
      threeDrinks
    ),
    'You can choose up to 2 options for Choose a drink.'
  );
  assert.equal(
    validateAddonSelection({ [WATER.id]: 1, [threeDrinks[1].id]: 1 }, [strict], threeDrinks),
    null
  );
});

test('a single-choice group names itself when a second option is picked', () => {
  const single = { group: makeGroup({ max_select: 1 }), options: drinkOptions };
  assert.equal(
    validateAddonSelection(
      { [WATER.id]: 1, [drinkOptions[1].id]: 1 },
      [single],
      drinkOptions
    ),
    'You can choose only 1 option for Choose a drink.'
  );
});

test('a sold-out extra cannot be added', () => {
  const soldOut = makeAddon({ id: 'addon-sold', name: 'Tilapia', is_available: false });
  assert.equal(
    validateAddonSelection({ [soldOut.id]: 1 }, [], [soldOut]),
    'Tilapia is currently unavailable.'
  );
});

test('an archived extra is never offered, so it can never be selected', () => {
  const meal = makeMenuItem();
  const result = addonsForMeal(meal, [CHICKEN, makeAddon({ id: 'gone', is_archived: true })], []);
  assert.deepEqual(
    result.map((addon) => addon.id),
    [CHICKEN.id]
  );
});

test('the per-extra quantity cap is enforced', () => {
  const limited = makeAddon({ id: 'addon-limited', name: 'Suya spice', max_quantity: 2 });
  assert.equal(
    validateAddonSelection({ [limited.id]: 3 }, [], [limited]),
    'You can add up to 2 × Suya spice.'
  );
  assert.equal(validateAddonSelection({ [limited.id]: 2 }, [], [limited]), null);
});

test('an extra that is not offered on this meal is refused', () => {
  assert.match(
    validateAddonSelection({ 'not-a-real-addon': 1 }, [], [CHICKEN]) ?? '',
    /not offered on this meal/
  );
});

test('the rules cover every option of the specification at once', () => {
  const requiredSingle = { group: makeGroup({ is_required: true, max_select: 1 }), options: drinkOptions };
  const all = [...drinkOptions, CHICKEN];

  // Nothing picked in a required group.
  assert.ok(validateAddonSelection({ [CHICKEN.id]: 1 }, [requiredSingle], all));
  // A valid pick satisfies it.
  assert.equal(validateAddonSelection({ [CHICKEN.id]: 1, [WATER.id]: 1 }, [requiredSingle], all), null);
});

// ===========================================================================
// 6. Which extras a meal offers, and which groups apply
// ===========================================================================

test("'every meal' extras appear everywhere; 'only these meals' need a link", () => {
  const meal = makeMenuItem();
  const links: MenuItemAddonLink[] = [
    {
      id: 'link-1',
      menu_item_id: meal.id,
      menu_addon_id: EGG.id,
      sort_order: 0,
      created_at: '2026-10-15T10:00:00Z',
    },
  ];

  const offered = addonsForMeal(meal, [CHICKEN, EGG], links);
  assert.deepEqual(
    offered.map((addon) => addon.id),
    [CHICKEN.id, EGG.id],
    'the default extra and the explicitly linked one are both offered'
  );

  const otherMeal = makeMenuItem({ id: 'meal-jollof' });
  const otherOffered = addonsForMeal(otherMeal, [CHICKEN, EGG], links);
  assert.deepEqual(
    otherOffered.map((addon) => addon.id),
    [CHICKEN.id],
    'an explicitly scoped extra is offered only on its meals'
  );
});

test('an extra from another kitchen is never offered', () => {
  const meal = makeMenuItem();
  const stranger = makeAddon({ id: 'addon-stranger', restaurant_id: OTHER_RESTAURANT });
  assert.deepEqual(addonsForMeal(meal, [CHICKEN, stranger], []), [CHICKEN]);
});

test('extras are offered in the order the restaurant set', () => {
  const meal = makeMenuItem();
  const ordered = addonsForMeal(meal, [WATER, CHICKEN], []);
  assert.deepEqual(
    ordered.map((addon) => addon.id),
    [CHICKEN.id, WATER.id],
    'sort_order wins, then the name'
  );
});

test('a group only appears on a meal that has one of its options', () => {
  const drinkGroupRecord = makeGroup();
  const proteinGroup = makeGroup({ id: 'group-protein', name: 'Add protein', sort_order: 1 });
  const protein = makeAddon({ id: 'addon-beef', name: 'Beef', offering: 'SELECT', sort_order: 4 });

  const meal = makeMenuItem();
  const links: MenuItemAddonLink[] = [
    {
      id: 'link-egg',
      menu_item_id: meal.id,
      menu_addon_id: EGG.id,
      sort_order: 0,
      created_at: '2026-10-15T10:00:00Z',
    },
  ];
  const mealAddons = addonsForMeal(meal, [CHICKEN, WATER, EGG, protein], links);

  const groups = groupsForMeal(
    [drinkGroupRecord, proteinGroup],
    {
      [drinkGroupRecord.id]: [WATER],
      [proteinGroup.id]: [protein],
    },
    mealAddons
  );

  assert.deepEqual(
    groups.map((entry) => entry.group.id),
    [drinkGroupRecord.id],
    'a group with no option on this meal is not shown'
  );
  assert.deepEqual(
    groups[0].options.map((option) => option.id),
    [WATER.id]
  );
});

test('the leftovers become the plain "Add extras" list', () => {
  const drinkGroupRecord = makeGroup();
  const meal = makeMenuItem();
  const mealAddons = addonsForMeal(meal, [CHICKEN, WATER], []);
  const groups = groupsForMeal([drinkGroupRecord], { [drinkGroupRecord.id]: [WATER] }, mealAddons);

  assert.deepEqual(
    ungroupedAddons(mealAddons, groups).map((addon) => addon.id),
    [CHICKEN.id]
  );
});

test('the meal view separates groups from loose extras', () => {
  const drinkGroupRecord = makeGroup();
  const catalog = catalogWith(
    [CHICKEN, WATER],
    [drinkGroupRecord],
    { [drinkGroupRecord.id]: [WATER] }
  );
  const view = mealAddonView(makeMenuItem(), catalog);

  assert.equal(view.mealAddons.length, 2);
  assert.equal(view.groups.length, 1);
  assert.deepEqual(
    view.loose.map((addon) => addon.id),
    [CHICKEN.id]
  );

  const empty = mealAddonView(makeMenuItem(), catalogWith([]));
  assert.equal(empty.mealAddons.length, 0, 'a kitchen with no extras shows no section at all');
  assert.equal(empty.groups.length, 0);
  assert.equal(empty.loose.length, 0);
});

// ===========================================================================
// 7. Turning a selection into cart extras
// ===========================================================================

test('a selection becomes cart extras, clamped to the restaurant\u2019s cap', () => {
  const limited = makeAddon({ id: 'addon-limited', name: 'Suya spice', price: 4, max_quantity: 2 });
  const selection: AddonSelection = {
    [CHICKEN.id]: 1,
    [limited.id]: 99,
    [WATER.id]: 0,
  };

  const extras = selectionToExtras(selection, [CHICKEN, WATER, limited]);
  assert.equal(extras.length, 2, 'a zero-quantity pick is not stored');
  assert.deepEqual(
    extras.map((extra) => extra.addonId),
    [CHICKEN.id, limited.id],
    'extras are stored in a stable order'
  );
  assert.equal(extras[1].quantity, 2, 'the quantity is clamped to max_quantity');
  assert.equal(extras[1].unitPrice, 4, 'the price on the cart line is the price on screen');
});

test('a selection round-trips back into the picker when the line is edited', () => {
  const extras: CartExtra[] = [
    { addonId: CHICKEN.id, name: CHICKEN.name, unitPrice: 15, quantity: 2 },
    { addonId: WATER.id, name: WATER.name, unitPrice: 5, quantity: 1 },
  ];
  assert.deepEqual(extrasToSelection(extras), {
    [CHICKEN.id]: 2,
    [WATER.id]: 1,
  });
  assert.deepEqual(extrasToSelection(undefined), {});

  const selection = extrasToSelection(extras);
  const rebuilt = selectionToExtras(selection, [CHICKEN, WATER]);
  assert.equal(cartLineKey({ menuItem: makeMenuItem(), quantity: 1, extras: rebuilt }), cartLineKey({ menuItem: makeMenuItem(), quantity: 1, extras }));
});

// ===========================================================================
// 8. Client contract — source scans
// ===========================================================================

test('the cart is keyed by line, and exposes an edit hook', () => {
  const cart = read('src/context/CartContext.tsx');
  assert.ok(cart.includes('cartLineKey'), 'the cart does not key its lines by meal + extras');
  assert.ok(cart.includes('updateLine'), 'the cart cannot replace a line when it is edited');
  assert.ok(cart.includes('normalizeCartItem'), 'a persisted cart is not validated on load');
  assert.ok(
    cart.includes('extras?: CartExtra[]'),
    'a cart line carries no extras'
  );
  assert.ok(
    !/localStorage\.setItem\([^)]*JSON\.stringify\(\{[^}]*price/.test(cart),
    'a price must never be written to storage by hand'
  );
});

test('the cart screen shows every extra, its quantity and its price', () => {
  const page = read('src/pages/customer/CartPage.tsx');
  assert.ok(page.includes('cartLineKey(item)'), 'cart lines are not addressed by line key');
  assert.ok(page.includes('updateQuantity(lineKey'), 'quantity changes do not target the line');
  assert.ok(page.includes('removeItem(lineKey)'), 'removal does not target the line');
  assert.ok(page.includes('lineTotal(item)'), 'the line total does not include the extras');
  assert.ok(page.includes('formatGHS(extra.unitPrice * extra.quantity)'), 'an extra shows no price');
  assert.ok(page.includes('&line='), 'a line cannot be opened for editing');
  assert.ok(page.includes('Edit extras'), 'the extras line offers no edit control');
});

test('checkout re-reads the extras, then attaches them to the right line', () => {
  const page = read('src/pages/customer/CartPage.tsx');
  const orderInsert = page.indexOf("from('orders')");
  const validate = page.indexOf('validateCartExtrasForCheckout');
  const extrasInsert = page.indexOf("from('order_item_extras')");

  assert.ok(validate > -1, 'checkout never re-reads the extras');
  assert.ok(orderInsert > -1, 'no order is created');
  assert.ok(extrasInsert > -1, 'the selected extras are never saved');
  assert.ok(
    validate < orderInsert,
    'the extras must be confirmed BEFORE any order exists, so nothing has to be cancelled'
  );
  assert.ok(extrasInsert > orderInsert, 'the extras are written onto the created order');
  assert.ok(
    page.includes('.select(\'id, menu_item_id\')'),
    'the generated line ids are needed to attach each extra to its own line'
  );
  assert.ok(page.includes('orderItemExtraPayload('), 'the checkout payload is built by hand');
  assert.ok(page.includes('if (extrasError)'), 'a failed extras write is swallowed silently');
});

test('the meal screen offers the extras section and validates before adding', () => {
  const page = read('src/pages/customer/RestaurantDetailPage.tsx');
  assert.ok(page.includes('<MealExtrasPicker'), 'the meal sheet has no extras section');
  assert.ok(
    page.includes('validateAddonSelection'),
    'the restaurant\u2019s rules are not checked before adding'
  );
  assert.ok(page.includes('extrasToSelection'), 'an existing line cannot seed the picker');
  assert.ok(page.includes('updateLine(editingLineKey'), 'editing does not replace the line');
  assert.ok(page.includes('next.delete(\'item\')'), 'closing the sheet leaves the deep link behind');
  assert.ok(
    page.includes("table: 'menu_addons'"),
    'a price or availability change does not reach an open menu'
  );
});

test('the extras picker uses the restaurant\u2019s own words and states availability', () => {
  const picker = read('src/components/customer/MealExtrasPicker.tsx');
  assert.ok(picker.includes('Make it a combo'), 'a required group has no combo heading');
  assert.ok(picker.includes('Add extras'), 'the plain extras list has no heading');
  assert.ok(picker.includes('Unavailable'), 'a sold-out extra is hidden instead of disabled');
  assert.ok(picker.includes('Required · '), 'a required group is not marked');
  assert.ok(picker.includes('disabled={!available}'), 'an unavailable extra can still be added');
  assert.ok(picker.includes('disabled={isMaxed}'), 'the quantity cap can be exceeded with the stepper');
  assert.ok(picker.includes('formatGHS(addon.price)'), 'an extra shows no price');
  assert.ok(picker.includes('mealAddons.length === 0) return null'), 'an empty section is rendered');
});

test('the owner manager writes only through the secured tables', () => {
  const page = read('src/pages/restaurant/RestaurantAddonsPage.tsx');
  for (const table of ['menu_addons', 'addon_groups', 'addon_group_items', 'menu_item_addons']) {
    assert.ok(page.includes(`from('${table}')`), `the manager never touches ${table}`);
  }
  assert.ok(page.includes('uploadRestaurantImage'), 'an extra cannot carry a photo');
  assert.ok(
    page.includes("offering: draft.offering"),
    'the every-meal / only-these-meals switch is not saved'
  );
  assert.ok(page.includes('is_archived'), 'an extra cannot be archived or restored');
  assert.ok(
    page.includes('Archive it instead'),
    'deleting a used extra must explain the restriction instead of failing silently'
  );
  assert.ok(page.includes('20261015_menu_addons.sql'), 'an un-migrated database is not explained');
});

test('the restaurant order card and the customer receipt show the full order', () => {
  const dashboard = read('src/pages/restaurant/RestaurantDashboard.tsx');
  assert.ok(
    dashboard.includes('extras:order_item_extras(*)'),
    'the kitchen never sees the extras it must cook'
  );
  assert.ok(
    /if \(!ordersData\)[\s\S]*?from\('orders'\)[\s\S]*?select\(\s*'\*, order_items\(\*\)/.test(
      dashboard
    ),
    'the dashboard would show no orders at all before the migration is applied'
  );
  assert.ok(dashboard.includes('extra.addon_name'), 'the kitchen sees no extra name');
  assert.ok(dashboard.includes('extra.quantity'), 'the kitchen sees no extra quantity');
  assert.ok(dashboard.includes('item.item_price'), 'the kitchen sees no unit price');

  const receipt = read('src/pages/customer/OrderDetailPage.tsx');
  assert.ok(receipt.includes("from('order_item_extras')"), 'the receipt never loads the extras');
  assert.ok(receipt.includes('extra.addon_name'), 'the receipt shows no extra name');
  assert.ok(
    receipt.includes('can no longer be'),
    'a confirmed order must say plainly that it cannot be edited'
  );
});

test('the checkout tells the kitchen how big the order is, in the existing notification', () => {
  const page = read('src/pages/customer/CartPage.tsx');
  assert.ok(
    /from\('notifications'\)[\s\S]{0,600}itemCount/.test(page),
    'the owner notification should say how many items are waiting'
  );
});

test('a reorder carries the extras it can still get, and reports the rest', () => {
  const reorder = read('src/lib/reorder.ts');
  assert.ok(reorder.includes("from('order_item_extras')"), 'a reorder drops the extras silently');
  assert.ok(reorder.includes('menu_addon_id'), 'a reordered extra is not pointed at a real add-on');
  assert.ok(
    /addon\.is_archived \|\|[\s\S]{0,40}!addon\.is_available/.test(reorder),
    'an unavailable extra would be reordered anyway'
  );
  assert.ok(
    reorder.includes('skipped.push(chosen.addonId)'),
    'a dropped extra is not reported to the customer'
  );
  assert.ok(reorder.includes('supabase.from(\'orders\').delete()'), 'a failed extras write leaves an order shell behind');
});

test('the checkout never sends a price the browser decided', () => {
  const page = read('src/pages/customer/CartPage.tsx');
  const orderInsert = page.slice(page.indexOf("from('orders')"), page.indexOf("from('order_items')"));
  assert.ok(
    !/delivery_fee/.test(orderInsert),
    'the delivery fee is priced by the database from the quote'
  );
  assert.equal(
    /item_price:.*parseFloat|item_price:.*Number\(/.test(orderInsert),
    false,
    'an item price must come from the stored menu item, not a parsed field'
  );
});

test('no client code can reach the service role key', () => {
  const page = read('src/pages/customer/CartPage.tsx');
  const catalog = read('src/lib/addonCatalog.ts');
  assert.equal(/SERVICE_ROLE/.test(page), false, 'CartPage must not hold a service-role key');
  assert.equal(/SERVICE_ROLE/.test(catalog), false, 'the add-on catalogue must not hold one');
});

test('the domain types describe the feature without inventing a price', () => {
  const types = read('src/types/database.ts');
  for (const name of ['MenuAddon', 'AddonGroup', 'OrderItemExtra', 'AddonOffering']) {
    assert.ok(types.includes(name), `${name} is missing from the domain types`);
  }
  assert.ok(/extras\?: OrderItemExtra\[\]/.test(types), 'an order line carries no extras snapshot');
  assert.ok(
    /interface OrderItemExtra \{[\s\S]*?unit_price: number[\s\S]*?quantity: number[\s\S]*?subtotal: number/.test(
      types
    ),
    'the snapshot must hold the name, the unit price, the quantity and the line total'
  );
});

test('the new page is registered, routable and hidden from the public header', () => {
  const app = read('src/App.tsx');
  assert.ok(app.includes('RestaurantAddonsPage'), 'the page is not imported');
  assert.ok(app.includes('path="/restaurant/addons"'), 'the page has no route');

  const shell = read('src/components/restaurant/RestaurantShell.tsx');
  assert.ok(shell.includes("to: '/restaurant/addons'"), 'the owner sidebar has no link to it');

  const navbar = read('src/components/common/Navbar.tsx');
  assert.ok(
    navbar.includes("startsWith('/restaurant/addons')"),
    'the public header would render over the owner shell'
  );
  const bottomNav = read('src/components/common/MobileBottomNav.tsx');
  assert.ok(
    bottomNav.includes("startsWith('/restaurant/addons')"),
    'the public bottom bar would render over the owner shell'
  );
});

test('a missing add-on table degrades to a plain menu, never a broken page', () => {
  const catalog = read('src/lib/addonCatalog.ts');
  assert.ok(catalog.includes('EMPTY_ADDON_CATALOG'), 'there is no empty-catalogue fallback');
  assert.ok(
    /does not exist|could not find table|schema cache/.test(catalog),
    'a missing table is not recognised as "not configured yet"'
  );
  assert.ok(/catch \{[\s\S]*?return EMPTY_ADDON_CATALOG;/.test(catalog), 'a thrown read is not caught');
  assert.ok(catalog.includes('supported:'), 'the screen cannot tell whether add-ons exist');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
