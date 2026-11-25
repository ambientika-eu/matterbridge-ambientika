# matterbridge-ambientika

[![npm version](https://img.shields.io/npm/v/matterbridge-ambientika.svg)](https://www.npmjs.com/package/matterbridge-ambientika)
![Node.js CI](https://github.com/ambientika-eu/matterbridge-ambientika/actions/workflows/build.yml/badge.svg)

[Matterbridge](https://github.com/Luligu/matterbridge) plugin for **Ambientika** decentralised ventilation units with
heat recovery. Developed and maintained by **Südwind GmbH** (SUEDWIND S.R.L.), Eppan/Appiano, South Tyrol, the
manufacturer of Ambientika.

Matterbridge brings devices into Matter. With this plugin every Ambientika unit of your account appears in the Matter
controller you pair Matterbridge with, for example Apple Home, Google Home, Amazon Alexa, SmartThings, Home Assistant
or ioBroker.

## Supported devices

All Ambientika units that are set up in the **Ambientika app** (for example SMART and OFFICE). The plugin uses the
same Ambientika cloud account as the app, so the units need their Wi-Fi connection and Matterbridge needs internet
access.

## What appears in Matter

Every unit is a bridged device named as in the app, with its serial number:

| Part               | What it shows and does                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fan                | Off, Low, Medium, High and Auto, and the current speed                                                                                                                            |
| Temperature sensor | Temperature measured by the unit                                                                                                                                                  |
| Humidity sensor    | Relative humidity measured by the unit                                                                                                                                            |
| Air quality sensor | Air quality level of the unit                                                                                                                                                     |
| Mode selection     | The operating mode of the unit: Smart, Auto, Manual heat recovery, Night, Away, Surveillance, Timed expulsion, Expulsion, Intake, Flow master to slave, Flow slave to master, Off |

How the fan maps to the unit:

- **Off** is the operating mode Off.
- **Auto** stands for the modes in which the unit chooses its fan step itself (Smart and Auto). Choosing Auto sets
  Smart.
- **Low, Medium, High** set the fan step. Out of a mode in which the unit chooses its step itself (Smart, Auto, Night,
  Away, Surveillance) the unit changes to manual heat recovery, because only in a manual mode a fixed step holds. A
  unit that was off runs in the manual mode it had before. In the other modes (Expulsion, Intake, ...) the mode stays
  and the step changes.
- The steps Night and Turbo, which a unit chooses itself, are shown as Low and High.

Not every controller shows every part: a mode selection, for example, is not shown in Apple Home. The option
_Operating mode as a selection_ removes it for all controllers.

For coupled units set the mode at the Master of the zone; a Slave runs with its Master and is shown with the mode of
its Master.

The plugin follows the same rules as the [Ambientika MQTT Bridge](https://github.com/ambientika-eu/ambientika-mqtt-bridge)
and the integration for Home Assistant: a single impossible temperature or humidity reading is held back, a saturated
humidity sensor reads 100 %, and a command stays shown until the unit reports it (up to two minutes) - the cloud
confirms that it took the command, the unit reports it a little later.

A unit the cloud has no current status of is shown as not reachable after three readings.

## Installation

1. Install [Matterbridge](https://matterbridge.io) (also available as a Home Assistant add-on) and open its frontend.
2. Under **Install plugins** enter `matterbridge-ambientika` and choose **Install**.
3. Open the settings of the plugin, enter the **e-mail address** and the **password** of your Ambientika app, save
   and restart Matterbridge.
4. Pair Matterbridge with your controller using the QR code of the frontend, if you have not done so before. The
   units appear there after the restart.

## Settings

| Setting                       | Default   | Description                                                                                          |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| E-mail address, Password      | _(empty)_ | The same as in the Ambientika app. Matterbridge stores them in the configuration file of the plugin. |
| Reading interval              | `30`      | Seconds between two readings of all units (10 to 3600)                                               |
| Operating mode as a selection | on        | Adds the mode selection described above                                                              |
| White list / Black list       | _(empty)_ | Expose only some units, or leave some out; by name or serial number                                  |

## Troubleshooting

- **"did not accept e-mail address and password"** in the log: the data differ from those of the Ambientika app.
  Correct them in the settings and restart. The plugin does not keep trying with a wrong password; it tries again
  after 30 minutes.
- **No units, or all units not reachable:** the Ambientika cloud cannot be reached. The log names the reason once;
  the plugin tries again on its own, first after 15 seconds, then at longer intervals up to five minutes. The units
  of the last run stay in your controller meanwhile.
- **A unit is missing:** it has to be set up in the Ambientika app under the same account. New units appear within
  ten minutes, or at once after a restart.
- **A Slave does not change its mode:** coupled units are set at the Master of their zone.

Support: info@ambientika.eu, or an [issue](https://github.com/ambientika-eu/matterbridge-ambientika/issues).

## Related

- [ioBroker adapter](https://github.com/ambientika-eu/ioBroker.ambientika)
- [Home Assistant integration](https://github.com/ambientika-eu/HomeAssistant-integration-for-Ambientika)
- [Ambientika MQTT Bridge](https://github.com/ambientika-eu/ambientika-mqtt-bridge)

## License

MIT License, © Südwind GmbH (SUEDWIND S.R.L.)

Matter is a trademark of the Connectivity Standards Alliance. This plugin is not certified by the alliance; it runs
on Matterbridge, an open-source project.
