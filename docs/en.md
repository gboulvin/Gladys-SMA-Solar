# SMA Solar

Follow your SMA solar installation in Gladys: production, energy of the day,
battery, grid exchange and the condition of every device, read **directly on
your local network** through Modbus TCP. No cloud, no Sunny Portal account,
no API key: the values stay at home and keep coming when the Internet is down.

## Compatible devices

Every SMA device that speaks the **SMA Modbus profile** over TCP, in
particular:

- PV inverters: Sunny Boy, Sunny Tripower (including the X and CORE
  series), Sunny Highpower;
- hybrid inverters: Sunny Tripower Smart Energy, Sunny Boy Smart Energy;
- battery inverters: Sunny Boy Storage, Sunny Island;
- the devices behind an SMA Data Manager or Cluster Controller.

The grid exchange (power drawn from and fed into the grid) appears when an
**SMA Energy Meter** or a **Sunny Home Manager** is connected to the
inverter: the inverter then reports it over Modbus.

## Prerequisites

1. **Enable Modbus TCP** on each device. Depending on its generation:
   - devices with a web interface (WebConnect, ennexOS): log in with the
     **Installer** user, open **Device parameters → External communication →
     Modbus → TCP server** and switch it **On**;
   - devices managed in Sunny Portal: **Configuration → Device configuration →
     External communication → Modbus → TCP server: On**;
   - with Sunny Explorer: same parameter, logged in as installer.
2. Give each device a **fixed IP address** (a DHCP reservation in your router
   is enough).
3. Gladys and the devices must be on the same network, or the network must
   let Gladys reach TCP port **502** of the devices.

> Modbus TCP has no password: keep it on your local network and **never**
> forward port 502 on your Internet box.

## Configuration

1. Open the **Configuration** tab of the integration.
2. In **SMA devices**, enter the IP address of each device, separated by
   commas: `192.168.1.50, 192.168.1.51`.
   - another port: `192.168.1.50:1502`;
   - another Modbus unit ID (devices behind a Data Manager, which shows the
     unit ID of each device in its Modbus settings): `192.168.1.30/4`;
   - both: `192.168.1.30:502/5`.
3. The **port** (502) and **unit ID** (3) apply to the addresses that do not
   set their own: keep them unless you changed them on your devices.
4. **Refresh interval**: how often the devices are read, 30 seconds by
   default (10 seconds minimum).
5. **Production threshold**: the power (in W, 50 by default) above which an
   inverter is considered as producing, for the start / end of production
   scene triggers.
6. Save, then click **Test the connection**: it lists the devices that
   answered and those that did not, with the reason.
7. Open the **Discovery** tab and add your devices.

## What you get

One device per SMA device, named after its serial number, with the features
it carries:

| Feature                                                       | Devices                 |
| ------------------------------------------------------------- | ----------------------- |
| Solar production (W), production today (kWh), total (kWh)     | PV and hybrid inverters |
| Battery level (%), charge / discharge power (W), energy (kWh) | battery, hybrid         |
| Power drawn from / fed into the grid (W), energy (kWh)        | with an Energy Meter    |
| AC voltage (V), AC current (A), inverter temperature (°C)     | all                     |

The production and battery features feed the **Energy** view of Gladys. Each
device also shows a **local / unreachable** badge.

Many inverters switch their network interface off at night: the integration
then shows them as unreachable and their production at 0 W, and remembers
them so they stay available after a restart of Gladys.

## Scenes

The integration adds its own cards to the scene editor (Gladys 5.1 or
later), under the **Integrations** category.

Triggers:

- **Solar production started** — an inverter starts producing (its power
  goes above the production threshold). Variables: `power`, `device_name`.
- **Solar production stopped** — it stops (below half the threshold, or
  asleep). Variable `daily_energy`: the energy produced today, in kWh — for
  a daily production report.
- **SMA device condition changed** — the condition of a device changes: OK,
  warning, fault, off or unreachable. Filter on the new condition to be
  alerted of a fault only. Variables: `condition`, `previous_condition`,
  `device_name`.

Read the variables in the following actions with
`{{triggerEvent.data.<variable>}}`, e.g. "Production of the day:
{{triggerEvent.data.daily_energy}} kWh".

Actions:

- **Read an SMA device** — reads the chosen device now and gives the next
  actions its values: `reachable`, `condition`, `power`, `daily_energy`,
  `battery_level`, `grid_import_power`, `grid_export_power`.
- **Read the solar installation** — reads every device and gives the
  totals: `power`, `daily_energy`, `battery_level` (average),
  `grid_import_power`, `grid_export_power`, `reachable_devices`.

Example: every day at 1 pm, read the installation, and if `power` is above
2000 W, start the water heater.

## Dashboard

Two widgets are available:

- **Solar installation** — current production, energy of the day, grid
  exchange, battery level, a chart of the day's production and the condition
  of each device, with a **Refresh** button.
- **SMA device** — pick one device in the widget settings: its live values,
  its condition, address, last reading, temperature and grid frequency.

## Troubleshooting

- **"connect ECONNREFUSED"**: Modbus TCP is not enabled on the device, or
  uses another port.
- **"connect EHOSTUNREACH" / timed out**: wrong IP address, device off or
  asleep (normal at night for many inverters), or a firewall in between.
- **"No SMA serial number at this address"**: the device answers but not
  with this unit ID: check the unit ID (3 for an inverter reached directly,
  see the Modbus settings of the Data Manager otherwise).
- **A device appears twice**: it is listed under two addresses; keep one.
- The integration logs are in the Gladys UI (or `docker logs`); start the
  integration with `LOG_LEVEL=debug` for the full detail.
