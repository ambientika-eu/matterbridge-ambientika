/**
 * @file vitest/module.test.ts
 * @description The plugin on a real matter.js server node (created, not started) against a local stand-in for the Ambientika cloud.
 *
 * The tests run one after the other: they share the Matter node.
 */

// oxlint-disable-next-line import/no-unassigned-import
import './ipv6-shim.mjs';

const NAME = 'Ambientika';
const MATTER_PORT = 8011;

import { invokeSubscribeHandler, type MatterbridgeEndpoint, type PlatformMatterbridge } from 'matterbridge';
import { LogLevel } from 'matterbridge/logger';
import { AirQuality, BridgedDeviceBasicInformation, FanControl, ModeSelect, RelativeHumidityMeasurement, TemperatureMeasurement } from 'matterbridge/matter/clusters';
import {
  addMatterbridge,
  createServerNode,
  createTestEnvironment,
  destroyTestEnvironment,
  flushServerNode,
  getMatterbridge,
  log,
  loggerLogSpy,
  setupTest,
} from 'matterbridge/test-utils/vitest';

import { AmbientikaCloud, cleanHost, CloudError } from '../src/cloud.js';
import initializePlugin, { AmbientikaPlatform, type AmbientikaPlatformConfig, fanOf, TIMING } from '../src/module.js';
import fakeCloud from './fake-cloud.cjs';

// Short times, so that outages and retries can be watched in seconds.
Object.assign(TIMING, { pollMinS: 0.15, unitsIntervalS: 0.6, retryFirstS: 0.3, retryMaxS: 0.6, retryRejectedS: 0.8, afterCommandS: 0.3, collectCommandS: 0.05, requestS: 0.5 });

const FLUR = 'A0B1C2D3E402'; // Master zone 0
const WOHN = 'A0B1C2D3E401'; // Slave zone 0
const ELTERN = 'A0B1C2D3E404'; // Master zone 1

await setupTest(NAME, false);

describe('matterbridge-ambientika', () => {
  let matterbridge: PlatformMatterbridge;
  let platform: AmbientikaPlatform;
  let cloud: any;

  const config = (more: Partial<AmbientikaPlatformConfig> = {}): AmbientikaPlatformConfig => ({
    name: 'matterbridge-ambientika',
    type: 'DynamicPlatform',
    version: '1.0.0',
    username: cloud.USER,
    password: cloud.PASSWORD,
    pollInterval: 0.15,
    host: cloud.url,
    whiteList: [],
    blackList: [],
    debug: false,
    unregisterOnShutdown: true,
    ...more,
  });
  const start = async (more: Partial<AmbientikaPlatformConfig> = {}, keepStorage = false): Promise<void> => {
    platform = initializePlugin(matterbridge, log, config(more));
    addMatterbridge(platform);
    await platform.ready;
    if (!keepStorage) await platform.context?.clear();
    await platform.onStart('test');
    await platform.onConfigure();
  };
  const stop = async (): Promise<void> => {
    await platform.onShutdown('test');
  };
  const dev = (serial: string): MatterbridgeEndpoint => {
    const d = platform.units.get(serial)?.device;
    if (!d) throw new Error(`no device for ${serial}`);
    return d;
  };
  const fanMode = (serial: string): unknown => dev(serial).getAttribute(FanControl, 'fanMode');
  const reachable = (serial: string): unknown => dev(serial).getAttribute(BridgedDeviceBasicInformation, 'reachable');
  const allReachable = (): boolean => cloud.serials.every((s: string) => platform.units.get(s)?.reachable === true && reachable(s) === true);
  const changes = (): any[] => cloud.log.filter((l: any) => l.kind === 'change-mode');
  const logged = (level: LogLevel, re: RegExp): number => loggerLogSpy.mock.calls.filter((c) => c[0] === level && re.test(c[1])).length;
  const controllerSetsFan = async (serial: string, mode: FanControl.FanMode): Promise<void> => {
    await invokeSubscribeHandler(dev(serial), 'fanControl', 'fanMode', mode, fanMode(serial));
  };
  const wait = async (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  beforeAll(async () => {
    try {
      cloud = await fakeCloud.startFakeCloud();
      await createTestEnvironment();
      await createServerNode(MATTER_PORT);
      matterbridge = getMatterbridge('bridge');
    } catch (e) {
      // An error of matter.js carries the whole node; only its text is passed on.
      // oxlint-disable-next-line preserve-caught-error
      throw new Error(`setup failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  });

  beforeEach(() => {
    cloud.reset();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await flushServerNode();
    await destroyTestEnvironment();
    await cloud.stop();
    vi.restoreAllMocks();
  });

  it('refuses a Matterbridge that is too old', () => {
    expect(() => initializePlugin({ ...matterbridge, matterbridgeVersion: '1.5.0' }, log, config())).toThrow('This plugin requires Matterbridge version >= "3.11.0"');
  });

  it('asks for the sign-in data when none are entered and sends nothing', async () => {
    await start({ username: '', password: '' });
    expect(logged(LogLevel.WARN, /Please enter the e-mail address and the password of the Ambientika app/)).toBe(1);
    await wait(200);
    expect(cloud.counts).toEqual({});
    expect(platform.units.size).toBe(0);
    await stop();
  });

  it('exposes every unit as a fan with temperature, humidity, air quality and operating mode', async () => {
    await start();
    await expect.poll(allReachable).toBe(true);
    expect(platform.units.size).toBe(5);
    const flur = dev(FLUR);
    expect(flur.deviceName).toBe('Flur');
    expect(flur.serialNumber).toBe(FLUR);
    expect(flur.getAttribute(BridgedDeviceBasicInformation, 'vendorName')).toBe('Südwind');
    expect(flur.getAttribute(BridgedDeviceBasicInformation, 'productName')).toBe('Ambientika Smart');
    expect(dev('A0B1C2D3E405').deviceName).toBe('Gäste-Bad');
    // Smart: the unit chooses the step itself
    expect(fanMode(FLUR)).toBe(FanControl.FanMode.Auto);
    expect(flur.getAttribute(FanControl, 'percentCurrent')).toBe(66);
    expect(flur.getAttribute(FanControl, 'percentSetting')).toBeNull();
    expect(flur.getAttribute(FanControl, 'fanModeSequence')).toBe(FanControl.FanModeSequence.OffLowMedHighAuto);
    expect(flur.getAttribute(ModeSelect, 'currentMode')).toBe(0);
    expect((flur.getAttribute(ModeSelect, 'supportedModes') as unknown[]).length).toBe(12);
    expect(flur.getChildEndpointById('Temperature')?.getAttribute(TemperatureMeasurement, 'measuredValue')).toBe(2100);
    expect(flur.getChildEndpointById('Humidity')?.getAttribute(RelativeHumidityMeasurement, 'measuredValue')).toBe(5500);
    expect(flur.getChildEndpointById('AirQuality')?.getAttribute(AirQuality, 'airQuality')).toBe(AirQuality.AirQualityEnum.Fair);
    expect(cloud.counts.auth).toBe(1);
    expect(cloud.log.filter((l: any) => l.kind === 'UNEXPECTED' || l.kind === 'unauthorized')).toEqual([]);
    expect(logged(LogLevel.WARN, /./) + logged(LogLevel.ERROR, /./)).toBe(0);
  });

  it('follows the units: off, fixed steps, steps the unit chooses itself, values out of range', async () => {
    cloud.set(FLUR, { operatingMode: 'Off' });
    await expect.poll(() => dev(FLUR).getAttribute(ModeSelect, 'currentMode')).toBe(11);
    expect(fanMode(FLUR)).toBe(FanControl.FanMode.Off);
    expect(dev(FLUR).getAttribute(FanControl, 'percentCurrent')).toBe(0);
    expect(dev(FLUR).getAttribute(FanControl, 'percentSetting')).toBe(0);

    cloud.set(FLUR, { operatingMode: 'ManualHeatRecovery', fanSpeed: 'High', temperature: -3, humidity: 104, airQuality: 'Bad' });
    await expect.poll(() => dev(FLUR).getChildEndpointById('AirQuality')?.getAttribute(AirQuality, 'airQuality')).toBe(AirQuality.AirQualityEnum.VeryPoor);
    expect(fanMode(FLUR)).toBe(FanControl.FanMode.High);
    expect(dev(FLUR).getAttribute(FanControl, 'percentCurrent')).toBe(100);
    expect(dev(FLUR).getAttribute(FanControl, 'percentSetting')).toBe(100);
    expect(dev(FLUR).getChildEndpointById('Temperature')?.getAttribute(TemperatureMeasurement, 'measuredValue')).toBe(-300);
    expect(dev(FLUR).getChildEndpointById('Humidity')?.getAttribute(RelativeHumidityMeasurement, 'measuredValue')).toBe(10000);
    expect(dev(FLUR).getChildEndpointById('AirQuality')?.getAttribute(AirQuality, 'airQuality')).toBe(AirQuality.AirQualityEnum.VeryPoor);

    cloud.set(FLUR, { operatingMode: 'Night', fanSpeed: 'Night', airQuality: 'Purple' });
    await expect.poll(() => dev(FLUR).getChildEndpointById('AirQuality')?.getAttribute(AirQuality, 'airQuality')).toBe(AirQuality.AirQualityEnum.Unknown);
    expect(fanMode(FLUR)).toBe(FanControl.FanMode.Low);
    expect(dev(FLUR).getAttribute(FanControl, 'percentSetting')).toBe(33);
    expect(dev(FLUR).getAttribute(ModeSelect, 'currentMode')).toBe(3);

    cloud.set(FLUR, { operatingMode: 'Smart', fanSpeed: 'Turbo' });
    await expect.poll(() => dev(FLUR).getAttribute(FanControl, 'percentCurrent')).toBe(100);
    expect(fanMode(FLUR)).toBe(FanControl.FanMode.Auto);
    expect(dev(FLUR).getAttribute(FanControl, 'percentSetting')).toBeNull();
    expect(logged(LogLevel.WARN, /./) + logged(LogLevel.ERROR, /./)).toBe(0);
  });

  it('sends what a controller sets: a fixed step leaves Smart for manual heat recovery', async () => {
    cloud.set(FLUR, { operatingMode: 'Smart', fanSpeed: 'Medium', humidityLevel: 'Moist' });
    await expect.poll(() => dev(FLUR).getAttribute(FanControl, 'percentCurrent')).toBe(66);
    cloud.clear();
    await controllerSetsFan(FLUR, FanControl.FanMode.Low);
    await expect.poll(() => changes().length).toBe(1);
    expect(changes()[0].body).toEqual({ deviceSerialNumber: FLUR, operatingMode: '2', fanSpeed: 0, humidityLevel: 2, lightSensorLevel: 2 });
    expect(changes()[0].ok).toBe(true);
    await expect.poll(() => fanMode(FLUR)).toBe(FanControl.FanMode.Low);
    expect(dev(FLUR).getAttribute(ModeSelect, 'currentMode')).toBe(2);
    await wait(500); // read again after the command: the cloud agrees
    expect(fanMode(FLUR)).toBe(FanControl.FanMode.Low);
    expect(cloud.unit(ELTERN).status.operatingMode).toBe('Smart');
  });

  it('switches off, and on again in the mode the unit had', async () => {
    cloud.set(FLUR, { operatingMode: 'Night', fanSpeed: 'Low' });
    await expect.poll(() => dev(FLUR).getAttribute(ModeSelect, 'currentMode')).toBe(3);
    cloud.clear();
    await controllerSetsFan(FLUR, FanControl.FanMode.Off);
    await expect.poll(() => changes().length).toBe(1);
    expect(changes()[0].body.operatingMode).toBe('11');
    await expect.poll(() => fanMode(FLUR)).toBe(FanControl.FanMode.Off);
    await wait(500);
    await controllerSetsFan(FLUR, FanControl.FanMode.High);
    await expect.poll(() => changes().length).toBe(2);
    expect(changes()[1].body).toMatchObject({ operatingMode: '3', fanSpeed: 2 });
    // off, and before that the unit ran in Smart: a fixed step means manual heat recovery
    cloud.set(ELTERN, { operatingMode: 'Off', lastOperatingMode: 'Smart' });
    await expect.poll(() => fanMode(ELTERN)).toBe(FanControl.FanMode.Off);
    cloud.clear();
    await controllerSetsFan(ELTERN, FanControl.FanMode.Medium);
    await expect.poll(() => changes().length).toBe(1);
    expect(changes()[0].body).toMatchObject({ operatingMode: '2', fanSpeed: 1 });
  });

  it('sets Smart for Auto, and leaves the mode Auto of the unit alone', async () => {
    cloud.set(FLUR, { operatingMode: 'ManualHeatRecovery', fanSpeed: 'High' });
    await expect.poll(() => fanMode(FLUR)).toBe(FanControl.FanMode.High);
    cloud.clear();
    await controllerSetsFan(FLUR, FanControl.FanMode.Auto);
    await expect.poll(() => changes().length).toBe(1);
    expect(changes()[0].body).toMatchObject({ operatingMode: '0', fanSpeed: 2 });
    cloud.set(ELTERN, { operatingMode: 'Auto' });
    await expect.poll(() => dev(ELTERN).getAttribute(ModeSelect, 'currentMode')).toBe(1);
    cloud.clear();
    await controllerSetsFan(ELTERN, FanControl.FanMode.Auto);
    await expect.poll(() => changes().length).toBe(1);
    expect(changes()[0].body.operatingMode).toBe('1');
  });

  it('sets an operating mode from the mode selection, and sends several writes of one tap as one command', async () => {
    await wait(500);
    cloud.clear();
    await dev(FLUR).invokeBehaviorCommand(ModeSelect, 'changeToMode', { newMode: 4 });
    await expect.poll(() => changes().length).toBe(1);
    expect(changes()[0].body.operatingMode).toBe('4');
    await expect.poll(() => dev(FLUR).getAttribute(ModeSelect, 'currentMode')).toBe(4);
    await wait(500);
    cloud.clear();
    await controllerSetsFan(FLUR, FanControl.FanMode.Low);
    await controllerSetsFan(FLUR, FanControl.FanMode.High);
    await dev(FLUR).invokeBehaviorCommand(ModeSelect, 'changeToMode', { newMode: 5 });
    await wait(400);
    expect(changes().length).toBe(1);
    expect(changes()[0].body).toMatchObject({ operatingMode: '5' });
  });

  it('never sends Night or Turbo back, and keeps the light sensor level of a unit that was off', async () => {
    cloud.set(FLUR, { operatingMode: 'ManualHeatRecovery', fanSpeed: 'High', lightSensorLevel: 'Medium' });
    await expect.poll(() => fanMode(FLUR)).toBe(FanControl.FanMode.High);
    cloud.set(FLUR, { operatingMode: 'Off', fanSpeed: 'Night', lightSensorLevel: 'Off' });
    await expect.poll(() => fanMode(FLUR)).toBe(FanControl.FanMode.Off);
    cloud.clear();
    await dev(FLUR).invokeBehaviorCommand(ModeSelect, 'changeToMode', { newMode: 0 });
    await expect.poll(() => changes().length).toBe(1);
    expect(changes()[0].body).toEqual({ deviceSerialNumber: FLUR, operatingMode: '0', fanSpeed: 2, humidityLevel: 1, lightSensorLevel: 3 });
    expect(changes()[0].ok).toBe(true);
  });

  it('says once that a Slave does not follow a mode of its own', async () => {
    await dev(WOHN).invokeBehaviorCommand(ModeSelect, 'changeToMode', { newMode: 3 });
    await expect.poll(() => logged(LogLevel.NOTICE, /is a Slave and runs with the Master/)).toBe(1);
    await wait(400);
    await dev(WOHN).invokeBehaviorCommand(ModeSelect, 'changeToMode', { newMode: 1 });
    await wait(400);
    expect(logged(LogLevel.NOTICE, /is a Slave and runs with the Master/)).toBe(1);
  });

  it('shows what the unit has when a command is not accepted', async () => {
    cloud.set(FLUR, { operatingMode: 'ManualHeatRecovery', fanSpeed: 'Medium' });
    await expect.poll(() => fanMode(FLUR)).toBe(FanControl.FanMode.Medium);
    cloud.outage('500');
    // what the controller wrote stands in the attribute until the plugin puts it right
    await dev(FLUR).setAttribute(FanControl, 'fanMode', FanControl.FanMode.High);
    await controllerSetsFan(FLUR, FanControl.FanMode.High);
    await expect.poll(() => logged(LogLevel.WARN, /Flur \(A0B1C2D3E402\): command not accepted \(HTTP status 500/)).toBe(1);
    cloud.outage('ok');
    await expect.poll(() => fanMode(FLUR)).toBe(FanControl.FanMode.Medium);
    await expect.poll(allReachable).toBe(true);
  });

  it('signs in again when the sign-in has expired, without showing anything as not reachable', async () => {
    const before = cloud.counts.auth ?? 0;
    cloud.expire();
    cloud.set(FLUR, { temperature: 25 });
    await expect.poll(() => dev(FLUR).getChildEndpointById('Temperature')?.getAttribute(TemperatureMeasurement, 'measuredValue')).toBe(2500);
    expect(cloud.counts.auth).toBe(before + 1);
    expect(allReachable()).toBe(true);
    expect(logged(LogLevel.WARN, /./)).toBe(0);
  });

  for (const fault of ['404', 'hang', 'garbage', 'html']) {
    it(`shows a unit as not reachable after three readings with "${fault}", keeps reading the others`, async () => {
      cloud.fault(WOHN, fault);
      cloud.set(FLUR, { temperature: 17 });
      await expect.poll(() => dev(FLUR).getChildEndpointById('Temperature')?.getAttribute(TemperatureMeasurement, 'measuredValue')).toBe(1700);
      await expect.poll(() => reachable(WOHN), { timeout: 10000 }).toBe(false);
      expect(reachable(FLUR)).toBe(true);
      expect(logged(LogLevel.WARN, /No status from the unit Wohnzimmer \(A0B1C2D3E401\)/)).toBe(1);
      expect(loggerLogSpy.mock.calls.some((c) => /<html|fanSp/.test(c[1]))).toBe(false);
      cloud.fault(WOHN, null);
      await expect.poll(() => reachable(WOHN)).toBe(true);
      expect(logged(LogLevel.INFO, /The unit Wohnzimmer \(A0B1C2D3E401\) answers again/)).toBe(1);
    });
  }

  it('reports an outage of the cloud in one line and comes back on its own', async () => {
    cloud.outage('500');
    await expect.poll(() => cloud.serials.every((s: string) => reachable(s) === false), { timeout: 10000 }).toBe(true);
    expect(logged(LogLevel.WARN, /No status from any of the 5 units \(HTTP status 500: Internal Server Error\)/)).toBe(1);
    expect(logged(LogLevel.WARN, /No status from the unit/)).toBe(0);
    cloud.outage('ok');
    await expect.poll(allReachable).toBe(true);
    expect(logged(LogLevel.INFO, /All 5 units answer again/)).toBe(1);
  });

  it('handles a password that stops being accepted while running', async () => {
    cloud.outage('refuse-auth');
    cloud.expire();
    await expect.poll(() => logged(LogLevel.ERROR, /did not accept e-mail address and password\. Please check them in the settings of the plugin/)).toBe(1);
    expect(cloud.serials.every((s: string) => reachable(s) === false)).toBe(true);
    await controllerSetsFan(FLUR, FanControl.FanMode.High);
    await expect.poll(() => logged(LogLevel.WARN, /not signed in to the Ambientika cloud, nothing sent/)).toBe(1);
    cloud.outage('ok');
    await expect.poll(allReachable, { timeout: 10000 }).toBe(true);
  });

  it('takes over new units and removes units that left the account', async () => {
    cloud.addUnit('A0B1C2D3E499', 'Büro', 'Master', 2);
    cloud.removeUnit(WOHN);
    await expect.poll(() => platform.units.has('A0B1C2D3E499') && !platform.units.has(WOHN)).toBe(true);
    await expect.poll(() => platform.units.get('A0B1C2D3E499')?.reachable).toBe(true);
    expect(dev('A0B1C2D3E499').deviceName).toBe('Büro');
    expect(platform.getDeviceBySerialNumber(WOHN)).toBeUndefined();
    expect(logged(LogLevel.NOTICE, /Unit Wohnzimmer \(A0B1C2D3E401\) is no longer in the Ambientika account/)).toBe(1);
    await wait(300);
    cloud.clear();
    await wait(400);
    expect(cloud.counts[`status:${WOHN}`] ?? 0).toBe(0);
  });

  it('stops at once and sends nothing afterwards', async () => {
    cloud.outage('hang');
    await wait(200);
    const t0 = Date.now();
    await stop();
    expect(Date.now() - t0).toBeLessThan(1000);
    cloud.outage('ok');
    const calls = JSON.stringify(cloud.counts);
    await wait(600);
    expect(JSON.stringify(cloud.counts)).toBe(calls);
  });

  it('has the units of the last run at once after a restart, also while the cloud is away', async () => {
    await start();
    await expect.poll(allReachable).toBe(true);
    await stop();
    cloud.outage('500');
    await start({}, true);
    expect(platform.units.size).toBe(5);
    expect(dev(FLUR).deviceName).toBe('Flur');
    expect(platform.units.get(FLUR)?.reachable).toBe(false);
    expect(logged(LogLevel.WARN, /Ambientika cloud: HTTP status 500/)).toBe(1);
    cloud.outage('ok');
    await expect.poll(allReachable, { timeout: 10000 }).toBe(true);
    await stop();
  });

  it('says so when e-mail address or password are not accepted, and does not keep trying', async () => {
    await start({ password: 'wrong' });
    expect(logged(LogLevel.ERROR, /did not accept e-mail address and password/)).toBe(1);
    expect(cloud.counts.auth).toBe(1);
    await wait(400);
    expect(cloud.counts.auth).toBe(1);
    expect(loggerLogSpy.mock.calls.some((c) => c[1].includes('wrong'))).toBe(false);
    expect(platform.units.size).toBe(0);
    await stop();
  });

  it('exposes only the units of the white list, without the mode selection when it is switched off', async () => {
    await start({ whiteList: ['Flur', ELTERN], operatingModeSelect: false });
    await expect.poll(() => platform.units.get(FLUR)?.reachable === true && platform.units.get(ELTERN)?.reachable === true).toBe(true);
    expect([...platform.units.keys()].toSorted()).toEqual([FLUR, ELTERN].toSorted());
    expect(dev(FLUR).hasClusterServer(ModeSelect)).toBe(false);
    expect(fanMode(FLUR)).toBe(FanControl.FanMode.Auto);
    await wait(300);
    expect(cloud.counts[`status:${WOHN}`] ?? 0).toBe(0);
    await stop();
  });

  it('uses 30 seconds when the interval is missing or nonsense, and stays within 10 to 3600', () => {
    const saved = TIMING.pollMinS;
    TIMING.pollMinS = 10;
    try {
      for (const [typed, used] of [
        [undefined, 30],
        ['abc', 30],
        [0, 30],
        [-5, 30],
        [3, 10],
        [45.4, 45],
        [99999, 3600],
      ] as const) {
        const p = new AmbientikaPlatform(matterbridge, log, config({ pollInterval: typed as number }));
        expect((p as unknown as { intervalS: number }).intervalS).toBe(used);
      }
    } finally {
      TIMING.pollMinS = saved;
    }
  });
});

describe('cloud client and mapping', () => {
  it('reads the address as typed', () => {
    expect(cleanHost('')).toBe('https://app.ambientika.eu:4521');
    expect(cleanHost(null)).toBe('https://app.ambientika.eu:4521');
    expect(cleanHost(' app.example.com:4521/ ')).toBe('https://app.example.com:4521');
    expect(cleanHost('http://127.0.0.1:8080//')).toBe('http://127.0.0.1:8080');
  });

  it('shares one sign-in between requests that start together', async () => {
    const cloud: any = await fakeCloud.startFakeCloud();
    try {
      const c = new AmbientikaCloud({ username: cloud.USER, password: cloud.PASSWORD, host: cloud.url });
      expect((await Promise.all(cloud.serials.map(async (s: string) => c.status(s)))).length).toBe(5);
      expect(cloud.counts.auth).toBe(1);
      cloud.expire();
      await Promise.all(cloud.serials.map(async (s: string) => c.status(s)));
      expect(cloud.counts.auth).toBe(2);
      await expect(c.status('NOPE')).rejects.toBeInstanceOf(CloudError);
      await expect(c.changeMode(cloud.serials[0], { operatingMode: 'Smart', fanSpeed: 'Night', humidityLevel: 'Normal' })).rejects.toThrow('cannot be sent');
      c.close();
      await expect(c.status(cloud.serials[0])).rejects.toThrow('stopping');
    } finally {
      await cloud.stop();
    }
  });

  it('maps the unit to a Matter fan', () => {
    expect(fanOf({ operatingMode: 'Off', fanSpeed: 'High' })).toEqual({ fanMode: FanControl.FanMode.Off, percent: 0 });
    expect(fanOf({ operatingMode: 'Smart', fanSpeed: 'Low' })).toEqual({ fanMode: FanControl.FanMode.Auto, percent: 33 });
    expect(fanOf({ operatingMode: 'Auto', fanSpeed: 'Turbo' })).toEqual({ fanMode: FanControl.FanMode.Auto, percent: 100 });
    expect(fanOf({ operatingMode: 'Expulsion', fanSpeed: 'Medium' })).toEqual({ fanMode: FanControl.FanMode.Medium, percent: 66 });
    expect(fanOf({ operatingMode: 'AwayHome', fanSpeed: 'Night' })).toEqual({ fanMode: FanControl.FanMode.Low, percent: 33 });
    expect(fanOf({ operatingMode: 'SomethingNew' })).toEqual({ fanMode: FanControl.FanMode.Medium, percent: 66 });
  });
});
