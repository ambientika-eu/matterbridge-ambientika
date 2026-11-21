// @ts-nocheck
'use strict';

/**
 * Local stand-in for the Ambientika cloud over real HTTP, for the tests.
 *
 * It answers the endpoints the adapter uses with the same checks as the real
 * server and keeps five units (two zones, Masters and Slaves). A test changes
 * values and switches on faults through the returned object.
 *
 * Login: kunde@example.com / geheim#1 äöü
 */

const http = require('http');

const MODES = ['Smart', 'Auto', 'ManualHeatRecovery', 'Night', 'AwayHome', 'Surveillance', 'TimedExpulsion', 'Expulsion', 'Intake', 'MasterSlaveFlow', 'SlaveMasterFlow', 'Off'];
const FANS = ['Low', 'Medium', 'High'];
const HUMS = ['Dry', 'Normal', 'Moist'];
const LIGHTS = ['NotAvailable', 'Off', 'Low', 'Medium'];

const USER = 'kunde@example.com';
const PASSWORD = 'geheim#1 äöü';

const UNITS = [
  // serial, name, role, zone
  ['A0B1C2D3E402', 'Flur', 'Master', 0],
  ['A0B1C2D3E401', 'Wohnzimmer', 'SlaveEqualMaster', 0],
  ['A0B1C2D3E403', 'Kinderzimmer', 'SlaveOppositeMaster', 0],
  ['A0B1C2D3E405', 'Gäste-Bad', 'SlaveEqualMaster', 0],
  ['A0B1C2D3E404', 'Schlafzimmer Eltern', 'Master', 1],
];

function fresh() {
  const units = new Map();
  for (const [serial, name, role, zone] of UNITS) {
    units.set(serial, {
      name,
      role,
      zone,
      fault: null,
      status: {
        operatingMode: 'Smart',
        fanSpeed: 'Medium',
        humidityLevel: 'Normal',
        lightSensorLevel: 'Low',
        temperature: 21,
        humidity: 55,
        airQuality: 'Good',
        humidityAlarm: false,
        filtersStatus: 'Good',
        nightAlarm: false,
        deviceRole: role,
        lastOperatingMode: 'Smart',
        packetType: 'DeviceStatus',
        deviceType: 'Smart',
        deviceSerialNumber: serial,
      },
    });
  }
  return { units, tokenNo: 1, outage: 'ok', log: [], counts: {} };
}

async function startFakeCloud(listenPort = 0) {
  let S = fresh();
  const hanging = new Set();

  const log = (kind, more) => S.log.push(Object.assign({ t: Date.now(), kind }, more));
  const count = (kind) => {
    S.counts[kind] = (S.counts[kind] || 0) + 1;
  };
  const token = () => `tok-${S.tokenNo}`;

  const send = (res, status, body, type) => {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const headers = { 'Content-Length': Buffer.byteLength(text) };
    if (text) headers['Content-Type'] = type || (typeof body === 'string' ? 'text/plain' : 'application/json; charset=utf-8');
    res.writeHead(status, headers);
    res.end(text);
  };
  const hang = (res) => hanging.add(res); // accepted, never answered

  const gate = (req, res) => {
    if (S.outage === '500') return (send(res, 500, { message: 'Internal Server Error' }), true);
    if (S.outage === 'hang') return (hang(res), true);
    if (req.headers.authorization !== `Bearer ${token()}`) {
      log('unauthorized', { path: req.url });
      return (send(res, 401, { message: 'Unauthorized' }), true);
    }
    return false;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body;
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      } catch {
        body = null;
      }
      const route = `${req.method} ${url.pathname}`;

      if (route === 'POST /users/authenticate') {
        count('auth');
        if (S.outage === '500') return send(res, 500, { message: 'Internal Server Error' });
        if (S.outage === 'hang') return hang(res);
        const ok = body && body.username === USER && body.password === PASSWORD && S.outage !== 'refuse-auth';
        log('auth', { user: body && body.username, ok: !!ok });
        if (!ok) return send(res, 400, { message: 'Username or password is incorrect' });
        return send(res, 200, { id: 7, jwtToken: token() });
      }
      if (route === 'GET /house/houses-info') {
        count('houses');
        if (gate(req, res)) return;
        return send(res, 200, [{ houseId: 1 }]);
      }
      if (route === 'GET /house/house-complete-info') {
        count('house');
        if (gate(req, res)) return;
        const devices = [...S.units.entries()].map(([serial, u], i) => ({
          id: i + 1,
          deviceType: 'Smart',
          serialNumber: serial,
          userId: 7,
          name: u.name,
          role: u.role,
          zoneIndex: u.zone,
          installation: 'Wall',
          roomId: 1,
        }));
        return send(res, 200, {
          userId: 7,
          id: 1,
          name: 'Zuhause',
          zones: [],
          hasZones: true,
          hasDevices: true,
          address: '',
          latitude: 46.4,
          longitude: 11.2,
          rooms: [{ id: 1, name: 'Haus', houseId: 1, userId: 7, devices }],
        });
      }
      if (route === 'GET /device/device-status') {
        const serial = url.searchParams.get('deviceSerialNumber') || '';
        count('status');
        S.counts[`status:${serial}`] = (S.counts[`status:${serial}`] || 0) + 1;
        if (gate(req, res)) return;
        const u = S.units.get(serial);
        if (!u) return send(res, 404, 'Device not found');
        if (u.fault === '404') return send(res, 404, 'Status packet not found');
        if (u.fault === '500') return send(res, 500, { message: 'boom' });
        if (u.fault === 'hang') return hang(res);
        if (u.fault === 'garbage') return send(res, 200, '{"operatingMode": "Smart", "fanSp', 'application/json');
        if (u.fault === 'html') return send(res, 200, '<html><body>502 Bad Gateway</body></html>', 'text/html');
        return send(res, 200, u.status);
      }
      if (route === 'POST /device/change-mode') {
        count('change-mode');
        if (gate(req, res)) return;
        const b = body && typeof body === 'object' ? body : {};
        const u = S.units.get(b.deviceSerialNumber);
        const int = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
        const ok =
          !!u &&
          typeof b.operatingMode === 'string' &&
          /^([0-9]|1[01])$/.test(b.operatingMode) &&
          int(b.fanSpeed, 2) &&
          int(b.humidityLevel, 2) &&
          // older clients send no light sensor level; the unit keeps its own then
          (!('lightSensorLevel' in b) || int(b.lightSensorLevel, 3));
        log('change-mode', { serial: b.deviceSerialNumber, body: b, ok });
        if (!ok) return send(res, 500, { message: 'Value was either too large or too small for an unsigned byte' });
        if (u.fault) return send(res, 200); // accepted for a silent unit; it just never lands
        const st = u.status;
        const old = st.operatingMode;
        st.operatingMode = MODES[Number(b.operatingMode)];
        if (st.operatingMode !== old) st.lastOperatingMode = old;
        st.fanSpeed = FANS[b.fanSpeed];
        st.humidityLevel = HUMS[b.humidityLevel];
        if ('lightSensorLevel' in b) st.lightSensorLevel = LIGHTS[b.lightSensorLevel];
        return send(res, 200);
      }
      if (route === 'GET /device/reset-filter') {
        count('reset-filter');
        if (gate(req, res)) return;
        const serial = url.searchParams.get('deviceSerialNumber') || '';
        const u = S.units.get(serial);
        log('reset-filter', { serial, known: !!u });
        if (!u) return send(res, 404, 'Device not found');
        if (u.role === 'Master' && !u.fault) u.status.filtersStatus = 'Good'; // only a Master's counter clears
        return send(res, 200);
      }
      log('UNEXPECTED', { method: req.method, path: url.pathname });
      return send(res, 404, 'not part of the API');
    });
  });
  await new Promise((r) => server.listen(listenPort, '127.0.0.1', r));
  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    USER,
    PASSWORD,
    serials: UNITS.map((u) => u[0]),
    /** the calls that change or fail something */
    get log() {
      return S.log;
    },
    get counts() {
      return S.counts;
    },
    clear() {
      S.log = [];
      S.counts = {};
    },
    unit(serial) {
      return S.units.get(serial);
    },
    set(serial, values) {
      Object.assign(S.units.get(serial).status, values);
    },
    fault(serial, fault) {
      S.units.get(serial).fault = fault;
      if (!fault) this.release();
    },
    rename(serial, name) {
      S.units.get(serial).name = name;
    },
    addUnit(serial, name, role, zone) {
      const template = fresh().units.get(UNITS[0][0]);
      template.name = name;
      template.role = role;
      template.zone = zone;
      template.status.deviceRole = role;
      template.status.deviceSerialNumber = serial;
      S.units.set(serial, template);
    },
    removeUnit(serial) {
      S.units.delete(serial);
    },
    /** ok | 500 | hang | refuse-auth */
    outage(mode) {
      S.outage = mode;
      if (mode !== 'hang') this.release();
    },
    /** invalidates the token: the client has to sign in again */
    expire() {
      S.tokenNo++;
    },
    /** ends the requests that were accepted and never answered */
    release() {
      for (const res of hanging) res.destroy();
      hanging.clear();
    },
    reset() {
      this.release();
      S = fresh();
    },
    async stop() {
      this.release();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

module.exports = { startFakeCloud, MODES, FANS, HUMS, LIGHTS };
