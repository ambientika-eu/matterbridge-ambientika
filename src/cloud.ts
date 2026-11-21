/**
 * @file src/cloud.ts
 * @description Client for the Ambientika cloud, the same one the Ambientika app uses.
 * @license MIT
 *
 *   POST /users/authenticate          { username, password } -> { id, jwtToken }
 *   GET  /house/houses-info           -> [{ houseId }]
 *   GET  /house/house-complete-info   ?houseId=  -> house with rooms and units
 *   GET  /device/device-status        ?deviceSerialNumber=  -> status packet
 *   POST /device/change-mode          { deviceSerialNumber, operatingMode, fanSpeed, humidityLevel, lightSensorLevel }
 *
 * Every request has a time limit: a request the cloud accepts and never answers
 * must not hold up the reading of the other units.
 */

export const DEFAULT_HOST = 'https://app.ambientika.eu:4521';
/** Seconds the plugin waits for one answer of the cloud. */
export const REQUEST_TIMEOUT_S = 20;
/** Longest answer that is still read (a status packet has a few hundred bytes). */
const MAX_BODY = 512 * 1024;

export const OPERATING_MODES = [
  'Smart',
  'Auto',
  'ManualHeatRecovery',
  'Night',
  'AwayHome',
  'Surveillance',
  'TimedExpulsion',
  'Expulsion',
  'Intake',
  'MasterSlaveFlow',
  'SlaveMasterFlow',
  'Off',
] as const;
/** Fan steps the cloud accepts in a command, in the order of their numbers. Night and Turbo are chosen by the unit itself. */
export const FAN_SPEEDS = ['Low', 'Medium', 'High'] as const;
export const HUMIDITY_LEVELS = ['Dry', 'Normal', 'Moist'] as const;
export const LIGHT_SENSOR_LEVELS = ['NotAvailable', 'Off', 'Low', 'Medium'] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];
export type FanSpeed = (typeof FAN_SPEEDS)[number];

/** A unit as the cloud lists it. */
export interface Unit {
  serial: string;
  name: string;
  role: string;
  zone: number | null;
  type: string;
  room: string;
  house: string;
}

/** The status packet of a unit as the cloud holds it. Values the plugin does not know are kept as reported. */
export interface UnitStatus {
  operatingMode: string;
  fanSpeed?: string;
  humidityLevel?: string;
  lightSensorLevel?: string;
  temperature?: number;
  humidity?: number;
  airQuality?: string;
  humidityAlarm?: boolean;
  filtersStatus?: string;
  nightAlarm?: boolean;
  deviceRole?: string;
  lastOperatingMode?: string;
  [key: string]: unknown;
}

/** The settings of one command. The cloud wants all of them at once. */
export interface UnitMode {
  operatingMode: string;
  fanSpeed: string;
  humidityLevel: string;
  lightSensorLevel?: string;
}

export type CloudErrorKind = 'auth' | 'http' | 'network' | 'timeout' | 'format';

export class CloudError extends Error {
  readonly status: number | null;
  readonly kind: CloudErrorKind;

  constructor(message: string, info: { status?: number | null; kind?: CloudErrorKind } = {}) {
    super(message);
    this.name = 'CloudError';
    this.status = info.status ?? null;
    this.kind = info.kind ?? 'http';
  }
}

/**
 * True for a JSON object (not an array, not null).
 *
 * @param {unknown} value - What the cloud sent.
 * @returns {boolean} Whether its fields can be read.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A few words of an error answer of the cloud, never a whole HTML page.
 *
 * @param {unknown} data - The answer of the cloud.
 * @returns {string} The words, or an empty text.
 */
function shortText(data: unknown): string {
  let text: unknown = data;
  if (isRecord(data)) text = data.message;
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.startsWith('<')) return '';
  return clean.slice(0, 120);
}

/**
 * The host as typed: spaces and slashes at the end do not count, https:// is assumed.
 *
 * @param {unknown} value - The host as typed.
 * @returns {string} The address of the cloud.
 */
export function cleanHost(value: unknown): string {
  let host = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  if (host === '') return DEFAULT_HOST;
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  return host;
}

interface RequestOptions {
  query?: Record<string, string | number>;
  body?: unknown;
  auth?: boolean;
}

export class AmbientikaCloud {
  readonly host: string;
  token: string | null = null;
  private readonly username: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private signingIn: Promise<void> | null = null;
  private readonly controllers = new Set<AbortController>();
  private closed = false;

  constructor(options: { username: string; password: string; host?: unknown; timeoutS?: number }) {
    this.username = options.username;
    this.password = options.password;
    this.host = cleanHost(options.host);
    this.timeoutMs = (options.timeoutS !== undefined && options.timeoutS > 0 ? options.timeoutS : REQUEST_TIMEOUT_S) * 1000;
  }

  /** Ends every request under way; nothing is sent afterwards. */
  close(): void {
    this.closed = true;
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
  }

  /**
   * One request with a time limit.
   *
   * @param {string} method - GET or POST.
   * @param {string} path - Path of the endpoint.
   * @param {RequestOptions} options - What to send.
   * @returns {Promise<unknown>} Parsed JSON, or null for an empty answer.
   */
  async request(method: string, path: string, options: RequestOptions = {}): Promise<unknown> {
    if (this.closed) throw new CloudError('the plugin is stopping', { kind: 'network' });
    const url = new URL(`${this.host}/${path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.auth !== false) headers.Authorization = `Bearer ${this.token}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    const limit = AbortSignal.timeout(this.timeoutMs);
    try {
      let res: Response;
      let text: string;
      try {
        res = await fetch(url, { method, headers, body, signal: AbortSignal.any([controller.signal, limit]) });
        text = await res.text();
      } catch (e) {
        if (limit.aborted && !controller.signal.aborted) {
          throw new CloudError(`no answer from the Ambientika cloud within ${Math.round(this.timeoutMs / 1000)} seconds`, { kind: 'timeout' });
        }
        const cause: unknown = e instanceof Error ? e.cause : undefined;
        const code = isRecord(cause) && typeof cause.code === 'string' ? cause.code : cause instanceof Error ? cause.message : undefined;
        throw new CloudError(`no connection to the Ambientika cloud (${code ?? (e instanceof Error ? e.message : String(e))})`, { kind: 'network' });
      }
      if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY);
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      let data: unknown = text === '' ? null : text;
      let parsed = false;
      if (text !== '' && type.includes('json')) {
        try {
          data = JSON.parse(text);
          parsed = true;
        } catch {
          if (res.status === 200) throw new CloudError('the Ambientika cloud sent an answer that cannot be read', { status: 200, kind: 'format' });
        }
      }
      if (res.status !== 200) {
        const words = shortText(data);
        throw new CloudError(`HTTP status ${res.status}${words ? `: ${words}` : ''}`, { status: res.status, kind: 'http' });
      }
      return parsed || data === null ? data : { text: data };
    } finally {
      this.controllers.delete(controller);
    }
  }

  /**
   * Signs in. Several callers at the same time share one sign-in.
   *
   * @returns {Promise<void>} Resolves when the token is there.
   */
  async signIn(): Promise<void> {
    this.signingIn ??= (async (): Promise<void> => {
      let data: unknown;
      try {
        data = await this.request('POST', 'users/authenticate', { auth: false, body: { username: this.username, password: this.password } });
      } catch (e) {
        if (e instanceof CloudError && e.status !== null && [400, 401, 403].includes(e.status)) {
          throw new CloudError('the Ambientika cloud did not accept e-mail address and password', { status: e.status, kind: 'auth' });
        }
        throw e;
      }
      const token = isRecord(data) ? data.jwtToken : undefined;
      if (typeof token !== 'string' || token === '') {
        throw new CloudError('the Ambientika cloud answered the sign-in without a token', { status: 200, kind: 'format' });
      }
      this.token = token;
    })().finally(() => {
      this.signingIn = null;
    });
    await this.signingIn;
  }

  /**
   * A request with the token. A sign-in that has expired is renewed once.
   *
   * @param {string} method - GET or POST.
   * @param {string} path - Path of the endpoint.
   * @param {RequestOptions} options - What to send.
   * @returns {Promise<unknown>} The answer.
   */
  async authed(method: string, path: string, options: RequestOptions = {}): Promise<unknown> {
    if (this.token === null) await this.signIn();
    const used = this.token;
    try {
      return await this.request(method, path, options);
    } catch (e) {
      if (!(e instanceof CloudError) || (e.status !== 401 && e.status !== 403)) throw e;
      // Several requests may find out at the same time: one sign-in for all of them.
      if (this.token === used) this.token = null;
      if (this.token === null) await this.signIn();
      return this.request(method, path, options);
    }
  }

  /**
   * All units of the account, over all houses and rooms.
   *
   * @returns {Promise<Unit[]>} The units.
   */
  async units(): Promise<Unit[]> {
    const houses = await this.authed('GET', 'house/houses-info');
    if (!Array.isArray(houses)) throw new CloudError('the list of houses cannot be read', { status: 200, kind: 'format' });
    const units: Unit[] = [];
    const seen = new Set<string>();
    const text = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 120) : '');
    for (const entry of houses as unknown[]) {
      const houseId = isRecord(entry) ? (entry.houseId ?? entry.id) : undefined;
      if (typeof houseId !== 'number' && typeof houseId !== 'string') continue;
      const house = await this.authed('GET', 'house/house-complete-info', { query: { houseId } });
      if (!isRecord(house) || !Array.isArray(house.rooms)) continue;
      for (const room of house.rooms as unknown[]) {
        if (!isRecord(room) || !Array.isArray(room.devices)) continue;
        for (const d of room.devices as unknown[]) {
          if (!isRecord(d) || typeof d.serialNumber !== 'string' || d.serialNumber.trim() === '') continue;
          const serial = d.serialNumber.trim();
          if (seen.has(serial)) continue;
          seen.add(serial);
          units.push({
            serial,
            name: text(d.name),
            role: text(d.role),
            zone: typeof d.zoneIndex === 'number' && Number.isInteger(d.zoneIndex) ? d.zoneIndex : null,
            type: text(d.deviceType),
            room: text(room.name),
            house: text(house.name),
          });
        }
      }
    }
    return units;
  }

  /**
   * The status packet of one unit as the cloud holds it.
   *
   * @param {string} serial - Serial number of the unit.
   * @returns {Promise<UnitStatus>} The status packet.
   */
  async status(serial: string): Promise<UnitStatus> {
    const data = await this.authed('GET', 'device/device-status', { query: { deviceSerialNumber: serial } });
    if (!isRecord(data) || typeof data.operatingMode !== 'string') {
      throw new CloudError('the status packet cannot be read', { status: 200, kind: 'format' });
    }
    return { ...data, operatingMode: data.operatingMode };
  }

  /**
   * Sets mode, fan step, humidity level and light sensor of a unit.
   *
   * @param {string} serial - Serial number of the unit.
   * @param {UnitMode} mode - The settings by name; without a light sensor level the unit keeps its own.
   * @returns {Promise<void>} Resolves when the cloud has accepted the command.
   */
  async changeMode(serial: string, mode: UnitMode): Promise<void> {
    const op = (OPERATING_MODES as readonly string[]).indexOf(mode.operatingMode);
    const fan = (FAN_SPEEDS as readonly string[]).indexOf(mode.fanSpeed);
    const hum = (HUMIDITY_LEVELS as readonly string[]).indexOf(mode.humidityLevel);
    if (op < 0 || fan < 0 || hum < 0) throw new CloudError('this combination cannot be sent', { kind: 'format' });
    const body: Record<string, unknown> = { deviceSerialNumber: serial, operatingMode: String(op), fanSpeed: fan, humidityLevel: hum };
    const light = mode.lightSensorLevel === undefined ? -1 : (LIGHT_SENSOR_LEVELS as readonly string[]).indexOf(mode.lightSensorLevel);
    if (light >= 0) body.lightSensorLevel = light;
    await this.authed('POST', 'device/change-mode', { body });
  }
}
