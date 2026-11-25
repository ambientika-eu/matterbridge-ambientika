/**
 * @file src/logic.ts
 * @description What is shown for the measured values of a unit: the plausibility check of the Ambientika MQTT Bridge.
 * @license MIT
 *
 * The same rules as in the Ambientika MQTT Bridge and in the integration
 * "Ambientika for Home Assistant", so all of them show the same values:
 * a single impossible reading is held back, a saturated humidity sensor
 * (above 100 %) reads 100 %.
 */

// Values outside the hard limits are never shown. A humidity reading below
// HUMIDITY_LOW_SUSPECT is shown only if dry air (below HUMIDITY_LOW_CONFIRM) was
// already seen: among the previous HUMIDITY_LOW_READINGS readings, or a shown dry
// reading within HUMIDITY_LOW_WINDOW_S. Meanwhile the last plausible value stands
// in, for at most PLAUSIBLE_HOLD_S; after that the value is unknown.
export const HUMIDITY_PLAUSIBLE = [1, 100] as const;
export const HUMIDITY_SATURATED = 100;
export const TEMPERATURE_PLAUSIBLE = [-40, 85] as const;
export const HUMIDITY_LOW_SUSPECT = 20;
export const HUMIDITY_LOW_CONFIRM = 25;
export const HUMIDITY_LOW_READINGS = 3;
export const HUMIDITY_LOW_WINDOW_S = 3600;
export const PLAUSIBLE_HOLD_S = 600;
/** A status identical to the one read before is the same packet handed out again, unless it has been the same for longer than this. */
export const DUPLICATE_PACKET_MAX_S = 120;

export type MeasuredKey = 'temperature' | 'humidity';

interface PlausibleState {
  last: number | null;
  t: number;
  bad: number;
  dry: boolean[];
  dryT: number | null;
  gone: boolean;
  out: [number | null, unknown] | null;
  logT: number | null;
  loud: boolean;
  sat: boolean;
  satLogT: number | null;
}

export interface MeasurementLog {
  info: (text: string) => void;
  debug: (text: string) => void;
}

/**
 * A finite number, or null.
 *
 * @param {unknown} value - What the cloud sent.
 * @returns {number | null} The number.
 */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * True when two status packets have the same fields with the same values.
 *
 * @param {Record<string, unknown>} a - One packet.
 * @param {Record<string, unknown>} b - The other packet.
 * @returns {boolean} Whether they are the same packet.
 */
function sameStatus(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k] || (Number.isNaN(a[k]) && Number.isNaN(b[k])));
}

export class Measurements {
  private readonly log: MeasurementLog;
  private readonly pollInterval: number;
  private readonly states = new Map<string, Partial<Record<MeasuredKey, PlausibleState>>>();
  private readonly lastStatus = new Map<string, [Record<string, unknown>, number]>();

  constructor(log: MeasurementLog, pollIntervalS: number) {
    this.log = log;
    this.pollInterval = Math.max(1, pollIntervalS || 30);
  }

  forget(serial: string): void {
    this.states.delete(serial);
    this.lastStatus.delete(serial);
  }

  /**
   * One status packet.
   *
   * @param {string} serial - Serial number of the unit.
   * @param {Record<string, unknown>} status - The packet of the cloud.
   * @param {number} now - Seconds.
   * @returns {{ temperature: number | null, humidity: number | null }} The values to show.
   */
  take(serial: string, status: Record<string, unknown>, now: number = Date.now() / 1000): { temperature: number | null; humidity: number | null } {
    const prev = this.lastStatus.get(serial);
    const fresh = !prev || !sameStatus(status, prev[0]) || now - prev[1] > DUPLICATE_PACKET_MAX_S;
    if (fresh) this.lastStatus.set(serial, [{ ...status }, now]);
    return {
      temperature: this.plausible(serial, 'temperature', status.temperature, fresh, now),
      humidity: this.plausible(serial, 'humidity', status.humidity, fresh, now),
    };
  }

  /**
   * The value to show for a measured value.
   *
   * @param {string} serial - Serial number of the unit.
   * @param {MeasuredKey} key - Which value.
   * @param {unknown} value - The reading.
   * @param {boolean} fresh - False when the packet is the one of the reading before.
   * @param {number} now - Seconds.
   * @returns {number | null} The value, null when unknown.
   */
  plausible(serial: string, key: MeasuredKey, value: unknown, fresh: boolean, now: number): number | null {
    if (value === null || value === undefined) return null;
    let unit = this.states.get(serial);
    if (!unit) {
      unit = {};
      this.states.set(serial, unit);
    }
    const st = (unit[key] ??= { last: null, t: 0, bad: 0, dry: [], dryT: null, gone: false, out: null, logT: null, loud: true, sat: false, satLogT: null });
    if (st.bad === 0) st.loud = st.logT === null || now - st.logT >= 3600;
    const note = (text: string): void => (st.loud ? this.log.info(text) : this.log.debug(text));
    const expired = st.last !== null && now - st.t > PLAUSIBLE_HOLD_S;
    const unknownNow = (): null => {
      if (!st.gone && st.last !== null) note(`${key} of ${serial}: no plausible value for ${Math.round(PLAUSIBLE_HOLD_S / 60)} min - shown as unknown`);
      st.gone = true;
      st.out = [null, value];
      return null;
    };
    if (!fresh && st.out !== null && (st.out[1] === value || (Number.isNaN(st.out[1]) && Number.isNaN(value)))) {
      // The same packet as last time: the decision is repeated.
      if (st.bad === 0 || !expired) return st.out[0];
      return unknownNow();
    }
    const [low, high] = key === 'humidity' ? HUMIDITY_PLAUSIBLE : TEMPERATURE_PLAUSIBLE;
    let v = finite(value);
    if (key === 'humidity' && v !== null && v > high) {
      if (!st.sat) {
        const loud = st.satLogT === null || now - st.satLogT >= 3600;
        const text = `${key} ${v} from ${serial} above ${high} % - sensor saturated, shown as ${HUMIDITY_SATURATED} %`;
        if (loud) {
          this.log.info(text);
          st.satLogT = now;
        } else {
          this.log.debug(text);
        }
      }
      st.sat = true;
      v = HUMIDITY_SATURATED;
    } else if (v !== null) {
      st.sat = false;
    }
    let ok = v !== null && v >= low && v <= high;
    let why = `outside ${low}..${high}`;
    if (ok && v !== null && key === 'humidity') {
      const window = Math.max(HUMIDITY_LOW_WINDOW_S, 6 * this.pollInterval);
      const seenDry = st.dry.some(Boolean) || (st.dryT !== null && now - st.dryT <= window);
      if (v < HUMIDITY_LOW_SUSPECT && !seenDry) {
        ok = false;
        why = `below ${HUMIDITY_LOW_SUSPECT} % without dry air in the last ${HUMIDITY_LOW_READINGS} readings or ${Math.round(window / 60)} min`;
      }
      st.dry.push(v < HUMIDITY_LOW_CONFIRM);
      while (st.dry.length > HUMIDITY_LOW_READINGS) st.dry.shift();
      if (ok && v < HUMIDITY_LOW_CONFIRM) st.dryT = now;
    }
    if (ok) {
      if (st.bad) note(`${key} of ${serial} plausible again (${JSON.stringify(value)}) after ${st.bad} held-back value(s)`);
      Object.assign(st, { last: v, t: now, bad: 0, gone: false, out: [v, value] });
      return v;
    }
    if (st.bad === 0) {
      note(`${key} ${JSON.stringify(value)} from ${serial} held back (${why}) - showing the last plausible value ${st.last} meanwhile`);
      if (st.loud) st.logT = now;
    }
    st.bad += 1;
    if (st.last !== null && !expired) {
      st.out = [st.last, value];
      return st.last;
    }
    return unknownNow();
  }
}
