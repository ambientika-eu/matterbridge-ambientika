/**
 * @file src/module.ts
 * @description Matterbridge plugin for Ambientika ventilation units with heat recovery.
 * @license MIT
 *
 * The plugin signs in to the Ambientika cloud with the e-mail address and the
 * password of the Ambientika app and exposes every unit of the account to
 * Matter as a fan with temperature, humidity and air quality.
 *
 * Maintained by Südwind GmbH, the manufacturer of Ambientika.
 */

import {
  airQualitySensor,
  type BasePlatformConfig,
  bridgedNode,
  fan,
  humiditySensor,
  MatterbridgeDynamicPlatform,
  MatterbridgeEndpoint,
  type PlatformMatterbridge,
  powerSource,
  temperatureSensor,
} from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import { AirQuality, BridgedDeviceBasicInformation, FanControl, ModeSelect, RelativeHumidityMeasurement, TemperatureMeasurement } from 'matterbridge/matter/clusters';

import {
  AmbientikaCloud,
  CloudError,
  DEFAULT_HOST,
  FAN_SPEEDS,
  HUMIDITY_LEVELS,
  LIGHT_SENSOR_LEVELS,
  OPERATING_MODES,
  type Unit,
  type UnitMode,
  type UnitStatus,
} from './cloud.js';

export type AmbientikaPlatformConfig = BasePlatformConfig & {
  username?: string;
  password?: string;
  pollInterval?: number;
  operatingModeSelect?: boolean;
  host?: string;
  whiteList?: string[];
  blackList?: string[];
};

/** Times in seconds. An object, so that the tests can shorten them. */
export const TIMING = {
  /** between two readings of all units, when the settings say nothing else */
  pollS: 30,
  pollMinS: 10,
  pollMaxS: 3600,
  /** between two readings of the list of units (new units, new names) */
  unitsIntervalS: 600,
  /** until the next try after the cloud could not be reached: first, and longest */
  retryFirstS: 15,
  retryMaxS: 300,
  /** until the next sign-in after the cloud did not accept e-mail address and password */
  retryRejectedS: 1800,
  /** after a command until the unit is read again; the unit needs that long to report */
  afterCommandS: 4,
  /** a controller often writes several attributes for one tap; they are sent as one command */
  collectCommandS: 0.3,
  /** the plugin waits that long for one answer of the cloud */
  requestS: 20,
};
/** How many units are asked for their status at the same time. */
const REQUESTS_AT_ONCE = 10;
/** Readings without a status in a row after which a unit is shown as not reachable. */
const OFFLINE_AFTER = 3;
const SLAVE_ROLES = new Set(['SlaveEqualMaster', 'SlaveOppositeMaster']);
/** Name of the stored list of units: the units are there at once after a restart, also while the cloud is away. */
const STORED_UNITS = 'units';

/** The names of the operating modes as a controller shows them. */
const MODE_LABELS: Record<(typeof OPERATING_MODES)[number], string> = {
  Smart: 'Smart',
  Auto: 'Auto',
  ManualHeatRecovery: 'Manual heat recovery',
  Night: 'Night',
  AwayHome: 'Away',
  Surveillance: 'Surveillance',
  TimedExpulsion: 'Timed expulsion',
  Expulsion: 'Expulsion',
  Intake: 'Intake',
  MasterSlaveFlow: 'Flow master to slave',
  SlaveMasterFlow: 'Flow slave to master',
  Off: 'Off',
};

const AIR_QUALITY: Record<string, AirQuality.AirQualityEnum> = {
  VeryGood: AirQuality.AirQualityEnum.Good,
  Good: AirQuality.AirQualityEnum.Fair,
  Medium: AirQuality.AirQualityEnum.Moderate,
  Poor: AirQuality.AirQualityEnum.Poor,
  Bad: AirQuality.AirQualityEnum.VeryPoor,
};

/**
 * What a unit is doing, as Matter sees a fan.
 * Off is the operating mode Off. Auto stands for the modes in which the unit
 * chooses its fan step itself (Smart and Auto). In every other mode the fan
 * mode is the fan step.
 *
 * @param {UnitStatus} status - The status packet of the unit.
 * @returns {{ fanMode: FanControl.FanMode, percent: number }} Fan mode and the speed in percent.
 */
export function fanOf(status: UnitStatus): { fanMode: FanControl.FanMode; percent: number } {
  if (status.operatingMode === 'Off') return { fanMode: FanControl.FanMode.Off, percent: 0 };
  const step = status.fanSpeed === 'Low' || status.fanSpeed === 'Night' ? 1 : status.fanSpeed === 'High' || status.fanSpeed === 'Turbo' ? 3 : 2;
  const percent = step === 1 ? 33 : step === 2 ? 66 : 100;
  if (status.operatingMode === 'Smart' || status.operatingMode === 'Auto') return { fanMode: FanControl.FanMode.Auto, percent };
  return { fanMode: step === 1 ? FanControl.FanMode.Low : step === 2 ? FanControl.FanMode.Medium : FanControl.FanMode.High, percent };
}

interface UnitState {
  unit: Unit;
  device?: MatterbridgeEndpoint;
  status?: UnitStatus;
  failures: number;
  /** undefined = not known yet */
  reachable?: boolean;
  lastFan?: string;
  lastLight?: string;
  /** readings are skipped until then: a command was sent and the unit has not reported yet */
  holdUntil: number;
  /** what a controller asked for and has not been sent yet */
  wanted?: { operatingMode?: string; fanMode?: FanControl.FanMode };
  wantedTimer?: NodeJS.Timeout;
  /** commands run one after the other */
  queue: Promise<void>;
  slaveNoted?: boolean;
}

/**
 * This is the standard interface for Matterbridge plugins.
 *
 * @param {PlatformMatterbridge} matterbridge - An instance of MatterBridge.
 * @param {AnsiLogger} log - The logger of the plugin.
 * @param {AmbientikaPlatformConfig} config - The platform configuration.
 * @returns {AmbientikaPlatform} The platform.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: AmbientikaPlatformConfig): AmbientikaPlatform {
  return new AmbientikaPlatform(matterbridge, log, config);
}

export class AmbientikaPlatform extends MatterbridgeDynamicPlatform {
  declare config: AmbientikaPlatformConfig;
  private cloud?: AmbientikaCloud;
  readonly units = new Map<string, UnitState>();
  private timer?: NodeJS.Timeout;
  private readonly timers = new Set<NodeJS.Timeout>();
  private unitsReadAt = 0;
  private retryS = TIMING.retryFirstS;
  private signedIn = false;
  private configured = false;
  private stopped = false;
  private allSilentLogged = false;
  private readonly intervalS: number;

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: AmbientikaPlatformConfig) {
    super(matterbridge, log, config);

    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.11.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.11.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }
    const typed = Number(config.pollInterval);
    this.intervalS = Number.isFinite(typed) && typed > 0 ? Math.min(TIMING.pollMaxS, Math.max(TIMING.pollMinS, typed < 1 ? typed : Math.round(typed))) : TIMING.pollS;
  }

  override async onStart(reason?: string): Promise<void> {
    this.log.info(`Starting platform ${this.config.name}: ${reason ?? ''}`);
    await this.ready;
    await this.clearSelect();

    // The units of the last run are there at once, also while the cloud cannot be reached:
    // a controller would otherwise drop them and forget their rooms and automations.
    const stored = this.context ? await this.context.get<Unit[]>(STORED_UNITS, []) : [];
    for (const unit of Array.isArray(stored) ? stored : []) {
      if (typeof unit?.serial === 'string' && unit.serial !== '') await this.addUnit(unit);
    }

    const username = (this.config.username ?? '').trim();
    const password = this.config.password ?? '';
    if (username === '' || password === '') {
      this.log.warn('Please enter the e-mail address and the password of the Ambientika app in the settings of the plugin. Nothing is read until then.');
      return;
    }
    this.cloud = new AmbientikaCloud({ username, password, host: this.config.host, timeoutS: TIMING.requestS });
    if (this.cloud.host !== DEFAULT_HOST) this.log.info(`Using the cloud address ${this.cloud.host}`);
    this.log.info(`Signing in to the Ambientika cloud as ${username}, reading the units every ${this.intervalS} seconds`);
    await this.connect();
  }

  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.configured = true;
    // The attributes are persisted by Matterbridge: bring them up to date with what was read meanwhile.
    for (const state of this.units.values()) {
      if (state.status) await this.show(state, state.status);
      if (state.reachable !== undefined) await this.showReachable(state, state.reachable);
    }
  }

  override async onShutdown(reason?: string): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const state of this.units.values()) if (state.wantedTimer) clearTimeout(state.wantedTimer);
    this.cloud?.close();
    await super.onShutdown(reason);
    this.log.info(`Shutting down platform ${this.config.name}: ${reason ?? ''}`);
    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
  }

  private later(fn: () => void, seconds: number): void {
    if (this.stopped) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, seconds * 1000);
    this.timers.add(t);
  }

  private schedule(fn: () => Promise<void>, seconds: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      fn().catch((e: unknown) => {
        if (this.stopped) return;
        this.log.warn(`Unexpected error, trying again in a minute: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        this.schedule(fn, 60);
      });
    }, seconds * 1000);
  }

  private label(state: UnitState): string {
    return state.unit.name ? `${state.unit.name} (${state.unit.serial})` : state.unit.serial;
  }

  /**
   * Creates the Matter device of a unit and registers it, once.
   *
   * @param {Unit} unit - The unit as the cloud lists it.
   * @returns {Promise<UnitState | undefined>} The state of the unit, undefined when it is not exposed.
   */
  private async addUnit(unit: Unit): Promise<UnitState | undefined> {
    const known = this.units.get(unit.serial);
    if (known) {
      known.unit = unit;
      return known;
    }
    const name = unit.name || `Ambientika ${unit.serial}`;
    this.setSelectDevice(unit.serial, name, undefined, 'hub');
    if (!this.validateDevice([name, unit.serial])) return undefined;

    const device = new MatterbridgeEndpoint([fan, bridgedNode, powerSource], { id: unit.serial }, this.config.debug)
      .createDefaultBridgedDeviceBasicInformationClusterServer(
        name.slice(0, 32),
        unit.serial,
        this.matterbridge.aggregatorVendorId,
        'Südwind',
        `Ambientika ${unit.type || 'ventilation unit'}`.slice(0, 32),
      )
      .createDefaultPowerSourceWiredClusterServer()
      .createDefaultFanControlClusterServer(FanControl.FanMode.Off, FanControl.FanModeSequence.OffLowMedHighAuto, 0, 0);
    if (this.config.operatingModeSelect !== false) {
      device.createDefaultModeSelectClusterServer(
        'Operating mode',
        OPERATING_MODES.map((mode, index) => ({ label: MODE_LABELS[mode], mode: index, semanticTags: [] })),
        0,
        0,
      );
    }
    device.addRequiredClusterServers();
    device.addChildDeviceType('Temperature', temperatureSensor).createDefaultTemperatureMeasurementClusterServer(null, -4000, 8000).addRequiredClusterServers();
    device.addChildDeviceType('Humidity', humiditySensor).createDefaultRelativeHumidityMeasurementClusterServer(null, 0, 10000).addRequiredClusterServers();
    device.addChildDeviceType('AirQuality', airQualitySensor).createDefaultAirQualityClusterServer(AirQuality.AirQualityEnum.Unknown).addRequiredClusterServers();

    const state: UnitState = { unit, device, failures: 0, holdUntil: 0, queue: Promise.resolve() };
    this.units.set(unit.serial, state);

    // What a controller sets. Changes the plugin makes itself come without a fabric and are not commands.
    device.subscribeAttribute(
      FanControl,
      'fanMode',
      (newValue, _oldValue, context) => {
        if (context.fabric === undefined) return;
        this.want(state, { fanMode: newValue });
      },
      device.log,
    );
    device.addCommandHandler('changeToMode', ({ request }) => {
      const mode = OPERATING_MODES[request.newMode];
      if (mode !== undefined) this.want(state, { operatingMode: mode });
    });

    await this.registerDevice(device);
    return state;
  }

  /**
   * Signs in and reads the list of units; tries again later when that fails.
   *
   * @returns {Promise<void>} Resolves when the first reading is done or the next try is scheduled.
   */
  private async connect(): Promise<void> {
    if (!this.cloud || this.stopped) return;
    try {
      await this.cloud.signIn();
      await this.readUnits();
    } catch (e) {
      if (this.stopped) return;
      await this.lost(e);
      return;
    }
    this.retryS = TIMING.retryFirstS;
    this.signedIn = true;
    this.log.notice(`Signed in to the Ambientika cloud, ${this.units.size} unit${this.units.size === 1 ? '' : 's'}`);
    await this.poll();
  }

  /**
   * The cloud is not available: everything not reachable, next try later.
   *
   * @param {unknown} error - Why.
   * @returns {Promise<void>} Resolves when the next try is scheduled.
   */
  private async lost(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const rejected = error instanceof CloudError && error.kind === 'auth';
    const wait = rejected ? TIMING.retryRejectedS : this.retryS;
    if (rejected) {
      this.log.error(`${message}. Please check them in the settings of the plugin (the same as in the Ambientika app). Next try in ${Math.max(1, Math.round(wait / 60))} minutes.`);
    } else if (this.signedIn || this.retryS === TIMING.retryFirstS) {
      this.log.warn(`Ambientika cloud: ${message}. Trying again, first in ${wait} seconds.`);
    } else {
      this.log.debug(`Ambientika cloud: ${message}. Next try in ${wait} seconds.`);
    }
    if (!rejected) this.retryS = Math.min(TIMING.retryMaxS, this.retryS * 2);
    this.signedIn = false;
    this.allSilentLogged = this.units.size > 1;
    for (const state of this.units.values()) await this.showReachable(state, false);
    if (this.cloud) this.cloud.token = null;
    this.schedule(async () => this.connect(), wait);
  }

  private async readUnits(): Promise<void> {
    if (!this.cloud) return;
    const list = await this.cloud.units();
    this.unitsReadAt = Date.now();
    const seen = new Set<string>();
    for (const unit of list) {
      seen.add(unit.serial);
      const before = this.units.get(unit.serial)?.unit;
      const state = await this.addUnit(unit);
      if (state && before && before.name !== unit.name && unit.name) {
        this.log.info(`Unit ${unit.serial} is now called "${unit.name}" in the Ambientika app. The name in your Matter controller stays as you set it there.`);
      }
    }
    // A unit that was removed from the account is removed from Matter as well.
    for (const [serial, state] of this.units) {
      if (seen.has(serial)) continue;
      this.log.notice(`Unit ${this.label(state)} is no longer in the Ambientika account - it is removed`);
      this.units.delete(serial);
      if (state.wantedTimer) clearTimeout(state.wantedTimer);
      if (state.device) await this.unregisterDevice(state.device);
    }
    await this.context?.set(STORED_UNITS, list);
    if (list.length === 0) this.log.warn('The Ambientika account has no units yet. Add them in the Ambientika app; the plugin finds them on its own.');
  }

  private async showReachable(state: UnitState, reachable: boolean): Promise<void> {
    if (this.stopped) return;
    const changed = state.reachable !== reachable;
    state.reachable = reachable;
    if (!state.device || !this.configured || !changed) return;
    await state.device.setAttribute(BridgedDeviceBasicInformation, 'reachable', reachable, state.device.log);
  }

  /**
   * Writes a status packet into the Matter attributes of the unit.
   *
   * @param {UnitState} state - The unit.
   * @param {UnitStatus} status - The status packet.
   * @returns {Promise<void>} Resolves when the attributes are set.
   */
  private async show(state: UnitState, status: UnitStatus): Promise<void> {
    const device = state.device;
    if (!device || !this.configured || this.stopped) return;
    const { fanMode, percent } = fanOf(status);
    await device.setAttribute(FanControl, 'fanMode', fanMode, device.log);
    // In Auto the unit chooses the speed: no speed is set, the current one is shown.
    await device.setAttribute(FanControl, 'percentSetting', fanMode === FanControl.FanMode.Auto ? null : percent, device.log);
    await device.setAttribute(FanControl, 'percentCurrent', percent, device.log);
    if (this.config.operatingModeSelect !== false) {
      const index = (OPERATING_MODES as readonly string[]).indexOf(status.operatingMode);
      if (index >= 0) await device.setAttribute(ModeSelect, 'currentMode', index, device.log);
    }
    const temperature = typeof status.temperature === 'number' && Number.isFinite(status.temperature) ? Math.round(status.temperature * 100) : null;
    await device.getChildEndpointById('Temperature')?.setAttribute(TemperatureMeasurement, 'measuredValue', temperature, device.log);
    const humidity = typeof status.humidity === 'number' && Number.isFinite(status.humidity) ? Math.round(Math.min(100, Math.max(0, status.humidity)) * 100) : null;
    await device.getChildEndpointById('Humidity')?.setAttribute(RelativeHumidityMeasurement, 'measuredValue', humidity, device.log);
    await device.getChildEndpointById('AirQuality')?.setAttribute(AirQuality, 'airQuality', AIR_QUALITY[status.airQuality ?? ''] ?? AirQuality.AirQualityEnum.Unknown, device.log);
  }

  /**
   * Takes a status packet: remembers it and shows it.
   *
   * @param {UnitState} state - The unit.
   * @param {UnitStatus} status - The status packet.
   * @returns {Promise<void>} Resolves when it is shown.
   */
  private async take(state: UnitState, status: UnitStatus): Promise<void> {
    if (this.stopped) return;
    state.status = status;
    if ((FAN_SPEEDS as readonly string[]).includes(status.fanSpeed ?? '')) state.lastFan = status.fanSpeed;
    // A unit that is switched off reports a default light sensor level, not the one it was set to.
    if (status.operatingMode !== 'Off' && (LIGHT_SENSOR_LEVELS as readonly string[]).includes(status.lightSensorLevel ?? '')) state.lastLight = status.lightSensorLevel;
    await this.show(state, status);
  }

  private async readUnit(state: UnitState): Promise<{ state: UnitState; ok: boolean; reached: boolean; error?: unknown }> {
    if (!this.cloud) return { state, ok: false, reached: false };
    try {
      const status = await this.cloud.status(state.unit.serial);
      // A command sent while this reading was under way: the reading shows the state before.
      if (state.holdUntil <= Date.now()) await this.take(state, status);
      return { state, ok: true, reached: true };
    } catch (e) {
      const reached = e instanceof CloudError && e.status !== null && e.status < 500 && e.kind !== 'auth';
      return { state, ok: false, reached, error: e };
    }
  }

  /**
   * One reading of all units, then the next one is scheduled.
   *
   * @returns {Promise<void>} Resolves when the reading is done.
   */
  private async poll(): Promise<void> {
    if (this.stopped) return;
    const started = Date.now();
    if (started - this.unitsReadAt > TIMING.unitsIntervalS * 1000) {
      try {
        await this.readUnits();
      } catch (e) {
        if (e instanceof CloudError && e.kind === 'auth') {
          await this.lost(e);
          return;
        }
        this.unitsReadAt = Date.now() - (TIMING.unitsIntervalS - 60) * 1000; // again in a minute
        this.log.debug(`List of units not read: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const due = [...this.units.values()].filter((s) => s.holdUntil <= Date.now());
    const results: Array<Awaited<ReturnType<AmbientikaPlatform['readUnit']>>> = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < due.length && !this.stopped) results.push(await this.readUnit(due[next++]));
    };
    await Promise.all(Array.from({ length: Math.min(REQUESTS_AT_ONCE, due.length) }, worker));
    if (this.stopped) return;

    const rejected = results.find((r) => r.error instanceof CloudError && r.error.kind === 'auth');
    if (rejected) {
      await this.lost(rejected.error);
      return;
    }
    await this.judge(results);
    const used = (Date.now() - started) / 1000;
    this.schedule(async () => this.poll(), Math.max(Math.min(1, this.intervalS), this.intervalS - used));
  }

  /**
   * Shows units reachable or not after a reading and says so in the log, once per change.
   *
   * @param {Array} results - One entry per unit read.
   * @returns {Promise<void>} Resolves when everything is shown.
   */
  private async judge(results: Array<{ state: UnitState; ok: boolean; reached: boolean; error?: unknown }>): Promise<void> {
    if (results.length === 0) return;
    const stopped: typeof results = [];
    const resumed: UnitState[] = [];
    for (const r of results) {
      const state = r.state;
      if (r.ok) {
        state.failures = 0;
        if (state.status) {
          if (state.reachable === false) resumed.push(state);
          await this.showReachable(state, true);
        }
        continue;
      }
      state.failures++;
      // Not reachable after a few readings in a row; at once when nothing was ever read.
      if ((state.failures >= OFFLINE_AFTER || !state.status) && state.reachable !== false) {
        stopped.push(r);
        await this.showReachable(state, false);
      }
    }
    const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));
    const total = this.units.size;
    if (total > 1 && stopped.length === total) {
      const reasons = [...new Set(stopped.map((r) => reason(r.error)))].join('; ').slice(0, 300);
      this.log.warn(`No status from any of the ${total} units (${reasons}). They are shown as not reachable until the Ambientika cloud answers again.`);
      this.allSilentLogged = true;
    } else {
      for (const r of stopped) this.log.warn(`No status from the unit ${this.label(r.state)}: ${reason(r.error)}. It is shown as not reachable until it answers again.`);
    }
    if (total > 1 && resumed.length === total && this.allSilentLogged) this.log.info(`All ${total} units answer again`);
    else for (const state of resumed) this.log.info(`The unit ${this.label(state)} answers again`);
    if (resumed.length > 0) this.allSilentLogged = false;
  }

  /**
   * Collects what a controller asks for. One tap often arrives as several
   * writes (fan mode, then percent): they are sent as one command.
   *
   * @param {UnitState} state - The unit.
   * @param {object} wanted - What was asked for.
   */
  private want(state: UnitState, wanted: { operatingMode?: string; fanMode?: FanControl.FanMode }): void {
    if (this.stopped) return;
    state.wanted = { ...state.wanted, ...wanted };
    if (state.wantedTimer) clearTimeout(state.wantedTimer);
    state.wantedTimer = setTimeout(() => {
      state.wantedTimer = undefined;
      const all = state.wanted;
      state.wanted = undefined;
      if (!all || this.stopped) return;
      state.queue = state.queue
        .then(async () => this.command(state, all))
        .catch((e: unknown) => {
          if (this.stopped) return;
          this.log.warn(`${this.label(state)}: ${e instanceof Error ? e.message : String(e)}`);
          // The controller shows what the unit has, not what could not be set.
          if (state.status) void this.show(state, state.status);
        });
    }, TIMING.collectCommandS * 1000);
  }

  private async command(state: UnitState, wanted: { operatingMode?: string; fanMode?: FanControl.FanMode }): Promise<void> {
    if (!this.cloud || !this.signedIn) throw new Error('not signed in to the Ambientika cloud, nothing sent');
    if (!this.units.has(state.unit.serial)) return;
    const serial = state.unit.serial;
    let base = state.status;
    if (!base) {
      base = await this.cloud.status(serial);
      await this.take(state, base);
    }
    const mode: UnitMode = {
      operatingMode: base.operatingMode,
      fanSpeed: base.fanSpeed ?? '',
      humidityLevel: base.humidityLevel ?? '',
      lightSensorLevel: state.lastLight ?? base.lightSensorLevel,
    };
    if (wanted.operatingMode !== undefined) mode.operatingMode = wanted.operatingMode;
    if (wanted.fanMode !== undefined && wanted.operatingMode === undefined) {
      const previous = base.lastOperatingMode;
      const usable = previous !== undefined && previous !== 'Off' && (OPERATING_MODES as readonly string[]).includes(previous);
      if (wanted.fanMode === FanControl.FanMode.Off) {
        mode.operatingMode = 'Off';
      } else if (wanted.fanMode === FanControl.FanMode.Auto) {
        // Auto: the unit chooses the step itself. That is Smart, unless it runs in its mode Auto already.
        if (mode.operatingMode !== 'Auto') mode.operatingMode = 'Smart';
      } else {
        mode.fanSpeed = wanted.fanMode === FanControl.FanMode.Low ? 'Low' : wanted.fanMode === FanControl.FanMode.Medium ? 'Medium' : 'High';
        // A fixed step: out of Smart and Auto into manual heat recovery; a unit that is off runs in its last mode again.
        if (mode.operatingMode === 'Smart' || mode.operatingMode === 'Auto') mode.operatingMode = 'ManualHeatRecovery';
        else if (mode.operatingMode === 'Off') mode.operatingMode = usable && previous !== 'Smart' && previous !== 'Auto' ? previous : 'ManualHeatRecovery';
      }
    }
    if (!(OPERATING_MODES as readonly string[]).includes(mode.operatingMode)) {
      throw new Error(`the unit reports the operating mode ${JSON.stringify(mode.operatingMode)}, which cannot be sent back - please set an operating mode first`);
    }
    // Night and Turbo are steps the unit chooses itself; the cloud does not take them in a command.
    if (!(FAN_SPEEDS as readonly string[]).includes(mode.fanSpeed)) {
      mode.fanSpeed = state.lastFan ?? (mode.fanSpeed === 'Night' ? 'Low' : mode.fanSpeed === 'Turbo' ? 'High' : 'Medium');
    }
    if (!(HUMIDITY_LEVELS as readonly string[]).includes(mode.humidityLevel)) mode.humidityLevel = 'Normal';
    if (!(LIGHT_SENSOR_LEVELS as readonly string[]).includes(mode.lightSensorLevel ?? '')) delete mode.lightSensorLevel; // the unit keeps its own

    state.holdUntil = Date.now() + TIMING.afterCommandS * 1000;
    try {
      await this.cloud.changeMode(serial, mode);
    } catch (e) {
      state.holdUntil = 0;
      throw new Error(`command not accepted (${e instanceof Error ? e.message : String(e)})`, { cause: e });
    }
    this.log.info(`${this.label(state)}: set to ${mode.operatingMode}, fan ${mode.fanSpeed}`);
    const role = base.deviceRole ?? state.unit.role;
    if (SLAVE_ROLES.has(role) && !state.slaveNoted) {
      state.slaveNoted = true;
      this.log.notice(`${this.label(state)} is a Slave and runs with the Master of its zone. Set the mode at the Master; a Slave does not follow a command of its own.`);
    }
    if (this.stopped) return;
    // The next command builds on these values, and the controller shows them until the unit reports.
    const assumed: UnitStatus = { ...base, ...mode };
    if (mode.operatingMode !== base.operatingMode) assumed.lastOperatingMode = base.operatingMode;
    state.holdUntil = Date.now() + TIMING.afterCommandS * 1000;
    await this.take(state, assumed);
    this.later(() => {
      if (this.stopped || !this.units.has(serial) || state.holdUntil > Date.now()) return;
      void this.readUnit(state).then(async (r) => (r.ok ? this.judge([r]) : undefined));
    }, TIMING.afterCommandS + 0.2);
  }
}
