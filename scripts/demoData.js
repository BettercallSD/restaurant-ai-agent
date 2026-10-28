/**
 * Fills a running server with SAMPLE activity for today so the dashboard has something to show
 * in a demo: a few phone-call sessions (scripted transcripts + the real tool calls those
 * conversations would make), plus walk-in bookings and orders entered by staff.
 *
 * Everything goes through the public HTTP API, so it exercises the same validation, pricing,
 * table allocation and ai_actions logging as real traffic. The transcripts are scripted sample
 * data, not live AI conversations.
 *
 *   npm run demo:data                     # against http://localhost:3000
 *   BASE_URL=https://... npm run demo:data
 */
const crypto = require('crypto');

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = `${BASE_URL}/api/v1`;
const STAFF_EMAIL = process.env.DEMO_STAFF_EMAIL || 'owner@himalayanbites.test';
const STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD || 'ChangeMe123!';

async function call(method, path, { token, body, idempotencyKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const message = json.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`;
    throw new Error(`${method} ${path} failed - ${message}`);
  }
  return json;
}

const todayIn = (timeZone, offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

function phoneFor(n) {
  return `+97798${String(10000000 + n * 7919).slice(-8)}`;
}

class Call {
  constructor(restaurantId, customerPhone) {
    this.restaurantId = restaurantId;
    this.customerPhone = customerPhone;
  }

  async start() {
    const res = await call('POST', `/restaurants/${this.restaurantId}/sessions`, {
      body: { customerPhone: this.customerPhone, channel: 'voice' },
    });
    this.sessionId = res.session.id;
    this.token = res.aiToken;
    return this;
  }

  say(role, content) {
    return call('POST', `/restaurants/${this.restaurantId}/sessions/${this.sessionId}/messages`, {
      token: this.token,
      body: { role, content },
    });
  }

  tool(name, body = {}) {
    return call('POST', `/ai/tools/${name}`, { token: this.token, body });
  }

  patch(state) {
    return call('PATCH', `/restaurants/${this.restaurantId}/sessions/${this.sessionId}`, { token: this.token, body: { state } });
  }

  end(status = 'COMPLETED') {
    return call('POST', `/restaurants/${this.restaurantId}/sessions/${this.sessionId}/end`, { token: this.token, body: { status } });
  }
}

async function main() {
  const login = await call('POST', '/auth/login', { body: { email: STAFF_EMAIL, password: STAFF_PASSWORD } });
  const staffToken = login.token;
  const restaurantId = login.restaurants[0].restaurantId;
  const { restaurant } = await call('GET', `/restaurants/${restaurantId}`);
  const { categories } = await call('GET', `/restaurants/${restaurantId}/menu`);
  const menu = categories.flatMap((c) => c.items);
  const item = (prefix) => {
    const found = menu.find((i) => i.name.startsWith(prefix) && i.isAvailable);
    if (!found) throw new Error(`Menu item "${prefix}" not found or unavailable`);
    return found;
  };

  // Book on today if there are still bookable slots, otherwise tomorrow. The availability check
  // doubles as a sample call: someone asks what's free, then hangs up.
  const today = todayIn(restaurant.timezone);
  let date = today;
  const enquiry = await new Call(restaurantId, phoneFor(0)).start();
  await enquiry.say('ai', `Namaste! Thank you for calling ${restaurant.name}. How can I help you?`);
  await enquiry.say('customer', 'What times do you have for two people?');
  let { times } = await enquiry.tool('find-alternative-times', { date, partySize: 2 });
  if (times.length < 4) {
    date = todayIn(restaurant.timezone, 1);
    ({ times } = await enquiry.tool('find-alternative-times', { date, partySize: 2 }));
  }
  await enquiry.say('ai', `For ${date === today ? 'today' : 'tomorrow'} I have ${times.slice(0, 3).join(', ')} and more. Shall I book one?`);
  await enquiry.say('customer', "I'll check with my friend and call back.");
  await enquiry.end('ABANDONED');
  const slot = (i) => times[Math.min(times.length - 1, Math.floor(((i + 1) * times.length) / 6))];

  console.log(`Sample data for ${restaurant.name}: reservations on ${date}, orders on ${today} (${restaurant.timezone})`);

  // Call 1: English booking, straight through.
  {
    const c = await new Call(restaurantId, phoneFor(1)).start();
    const time = slot(0);
    await c.say('ai', `Namaste! Thank you for calling ${restaurant.name}. How can I help you?`);
    await c.say('customer', `Hi, can I book a table for 4 at ${time}?`);
    await c.tool('check-table-availability', { date, time, partySize: 4 });
    await c.say('ai', 'Yes, we have a table for 4 then. Can I get a name for the booking?');
    await c.say('customer', 'Sharma.');
    const res = await c.tool('create-reservation', {
      customerName: 'Sharma', customerPhone: c.customerPhone, date, time, partySize: 4, idempotencyKey: crypto.randomUUID(),
    });
    await c.patch({ intent: 'reservation', customerName: 'Sharma', date, time, partySize: 4, reservationId: res.reservationId });
    await c.say('ai', `You're booked, Sharma: a table for 4 at ${time}. See you then!`);
    await c.end();
    console.log(`  call 1: reservation for Sharma, 4 people at ${time}`);
  }

  // Call 2: Nepali / English mix, asks about momo, then orders.
  {
    const c = await new Call(restaurantId, phoneFor(2)).start();
    const momo = item('Chicken Momo');
    const chowmein = item('Chicken Chowmein');
    await c.say('ai', `Namaste! ${restaurant.name}. Ke sahayog garna sakchhu?`);
    await c.say('customer', 'Dai, chicken momo cha? Price kati ho?');
    await c.tool('check-item-availability', { menuItemId: momo.id });
    await c.say('ai', `Cha! ${momo.name} Rs ${momo.priceCents / 100} ho.`);
    await c.say('customer', 'Ok, duita momo ra euta chowmein pathaunu na. Takeaway, naam Karki.');
    const res = await c.tool('create-order', {
      customerName: 'Karki',
      customerPhone: c.customerPhone,
      items: [{ menuItemId: momo.id, quantity: 2 }, { menuItemId: chowmein.id, quantity: 1 }],
      idempotencyKey: crypto.randomUUID(),
    });
    await c.patch({ intent: 'order', orderId: res.orderId, totalCents: res.totalCents });
    await c.say('ai', `Order confirmed: 2 chicken momo and 1 chicken chowmein, total Rs ${res.totalCents / 100}. Dhanyabad!`);
    await c.end();
    console.log(`  call 2: takeaway order, Rs ${res.totalCents / 100}`);
  }

  // Call 3: requested time is full, takes an alternative. Fill every table at that time first.
  {
    const busy = slot(2);
    const { tables } = await call('GET', `/restaurants/${restaurantId}/tables`);
    for (const [i, t] of tables.entries()) {
      await call('POST', `/restaurants/${restaurantId}/reservations`, {
        token: staffToken,
        idempotencyKey: crypto.randomUUID(),
        body: { customer: { name: `Walk-in group ${i + 1}`, phone: phoneFor(20 + i) }, date, time: busy, partySize: t.capacity },
      });
    }
    const c = await new Call(restaurantId, phoneFor(3)).start();
    await c.say('ai', `Namaste! Thank you for calling ${restaurant.name}. How can I help you?`);
    await c.say('customer', `Table for 2 at ${busy}, please.`);
    const check = await c.tool('check-table-availability', { date, time: busy, partySize: 2 });
    if (check.available || check.alternatives.length === 0) {
      throw new Error(`Expected ${busy} to be full with alternatives offered; got ${JSON.stringify(check)}`);
    }
    const alt = check.alternatives.find((t) => t > busy) || check.alternatives[0];
    await c.say('ai', `Sorry, ${busy} is fully booked. I can offer ${alt} instead. Would that work?`);
    await c.say('customer', `Yes, ${alt} is fine. Name is Thapa.`);
    const res = await c.tool('create-reservation', {
      customerName: 'Thapa', customerPhone: c.customerPhone, date, time: alt, partySize: 2, idempotencyKey: crypto.randomUUID(),
    });
    await c.patch({ intent: 'reservation', customerName: 'Thapa', date, time: alt, partySize: 2, reservationId: res.reservationId });
    await c.say('ai', `Done, Thapa: table for 2 at ${alt}.`);
    await c.end();
    console.log(`  call 3: ${busy} was full, booked Thapa at ${alt} instead`);
  }

  // Call 4: books, then cancels on a later call.
  {
    const time = slot(4);
    const book = await new Call(restaurantId, phoneFor(4)).start();
    await book.say('customer', `Table for 6 at ${time}, name Rai.`);
    await book.tool('check-table-availability', { date, time, partySize: 6 });
    const res = await book.tool('create-reservation', {
      customerName: 'Rai', customerPhone: book.customerPhone, date, time, partySize: 6, idempotencyKey: crypto.randomUUID(),
    });
    await book.say('ai', `Booked, Rai: table for 6 at ${time}.`);
    await book.end();

    const cancel = await new Call(restaurantId, phoneFor(4)).start();
    await cancel.say('customer', 'Hello, I need to cancel my booking for tonight.');
    const found = await cancel.tool('get-reservation', { customerPhone: cancel.customerPhone });
    await cancel.say('ai', `I found your booking for ${found.partySize} at ${found.time}. Shall I cancel it?`);
    await cancel.say('customer', 'Yes please.');
    await cancel.tool('cancel-reservation', { reservationId: res.reservationId });
    await cancel.say('ai', 'Your reservation is cancelled. Hope to see you another time!');
    await cancel.end();
    console.log(`  call 4+5: Rai booked for 6 at ${time}, then cancelled`);
  }

  // Call 6: unsupported request, handed to staff.
  {
    const c = await new Call(restaurantId, phoneFor(6)).start();
    await c.say('customer', 'Can I book the whole restaurant for a wedding party of 80 people?');
    await c.tool('transfer-to-human', { reason: 'Private event for 80 guests exceeds normal booking capacity' });
    await c.say('ai', "That's a big celebration! Let me connect you to our manager who handles private events.");
    await c.end();
    console.log('  call 6: wedding enquiry transferred to staff');
  }

  // A walk-in order entered by staff.
  await call('POST', `/restaurants/${restaurantId}/orders`, {
    token: staffToken,
    idempotencyKey: crypto.randomUUID(),
    body: {
      customer: { name: 'Gurung', phone: phoneFor(7) },
      items: [{ menuItemId: item('Dal Bhat').id, quantity: 2 }, { menuItemId: item('Masala Chiya').id, quantity: 2 }],
    },
  });
  console.log('  staff: walk-in order for Gurung');

  console.log(`\nDone. Open ${BASE_URL}/dashboard/ (sign in as ${STAFF_EMAIL}).`);
  if (date !== today) console.log(`Today's slots were nearly gone, so reservations are on ${date}: pick that date to see them.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
