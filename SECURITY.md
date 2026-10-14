# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the SMA devices and services the integration talks to — report those to
SMA.

## Good to know

- The integration only **reads** the SMA devices: it never writes a Modbus
  register, so it cannot change a setting of your installation.
- Modbus TCP has no authentication or encryption: anyone on your local
  network can read (and, if enabled on the device, write) its registers. Keep
  it on your local network and never expose port 502 to the Internet. This is
  a property of the protocol, not a vulnerability of the integration.
- The integration stores nothing secret: `/data/sma-devices.json` holds the
  serial numbers, classes and addresses of the identified devices.
