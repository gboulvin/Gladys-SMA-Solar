# SMA Solar

Siga su instalación solar SMA en Gladys: producción, energía del día,
batería, intercambio con la red y estado de cada dispositivo, leídos
**directamente en su red local** mediante Modbus TCP. Sin nube, sin cuenta de
Sunny Portal, sin clave de API: los valores se quedan en casa y siguen
llegando aunque Internet esté caído.

## Dispositivos compatibles

Cualquier dispositivo SMA que hable el **perfil Modbus de SMA** por TCP, en
particular:

- inversores fotovoltaicos: Sunny Boy, Sunny Tripower (incluidas las series X
  y CORE), Sunny Highpower;
- inversores híbridos: Sunny Tripower Smart Energy, Sunny Boy Smart Energy;
- inversores de batería: Sunny Boy Storage, Sunny Island;
- los dispositivos conectados a un SMA Data Manager o Cluster Controller.

El intercambio con la red (potencia tomada e inyectada) aparece cuando un
**SMA Energy Meter** o un **Sunny Home Manager** está conectado al inversor:
es entonces el inversor quien lo transmite por Modbus.

## Requisitos previos

1. **Active Modbus TCP** en cada dispositivo. Según su generación:
   - dispositivos con interfaz web (WebConnect, ennexOS): inicie sesión con
     el usuario **Instalador**, abra **Parámetros del equipo → Comunicación
     externa → Modbus → Servidor TCP** y póngalo en **Activado**;
   - dispositivos gestionados en Sunny Portal: **Configuración →
     Configuración de equipos → Comunicación externa → Modbus → Servidor TCP:
     Activado**;
   - con Sunny Explorer: el mismo parámetro, con sesión de instalador.
2. Asigne a cada dispositivo una **dirección IP fija** (basta con una reserva
   DHCP en su router).
3. Gladys y los dispositivos deben estar en la misma red, o la red debe
   permitir que Gladys alcance el puerto TCP **502** de los dispositivos.

> Modbus TCP no tiene contraseña: manténgalo en su red local y **nunca**
> redirija el puerto 502 en su router de Internet.

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. En **Dispositivos SMA**, introduzca la dirección IP de cada dispositivo,
   separadas por comas: `192.168.1.50, 192.168.1.51`.
   - otro puerto: `192.168.1.50:1502`;
   - otro ID de unidad Modbus (dispositivos tras un Data Manager, que muestra
     el ID de cada dispositivo en sus ajustes Modbus): `192.168.1.30/4`;
   - ambos: `192.168.1.30:502/5`.
3. El **puerto** (502) y el **ID de unidad** (3) se aplican a las direcciones
   que no indican los suyos: manténgalos salvo que los haya cambiado en sus
   dispositivos.
4. **Intervalo de actualización**: frecuencia de lectura de los dispositivos,
   30 segundos por defecto (10 segundos como mínimo).
5. **Umbral de producción**: la potencia (en W, 50 por defecto) a partir de
   la cual un inversor se considera en producción, para los disparadores de
   escena inicio / fin de producción.
6. Guarde y pulse **Probar la conexión**: aparece la lista de los
   dispositivos que respondieron y de los que no, con el motivo.
7. Abra la pestaña **Descubrimiento** y añada sus dispositivos.

## Qué obtiene

Un dispositivo por cada dispositivo SMA, con el nombre de su número de serie
y las funciones que ofrece:

| Función                                                         | Dispositivos             |
| --------------------------------------------------------------- | ------------------------ |
| Producción solar (W), producción de hoy (kWh), total (kWh)      | inversores FV e híbridos |
| Nivel de batería (%), potencia de carga / descarga (W), energía | batería, híbrido         |
| Potencia tomada de / inyectada a la red (W), energía (kWh)      | con un Energy Meter      |
| Tensión CA (V), corriente CA (A), temperatura del inversor (°C) | todos                    |

Las funciones de producción y batería alimentan la vista **Energía** de
Gladys. Cada dispositivo muestra además una insignia **local / inaccesible**.

Muchos inversores apagan su interfaz de red por la noche: la integración los
muestra entonces como inaccesibles con una producción de 0 W, y los recuerda
para que sigan disponibles tras reiniciar Gladys.

## Escenas

La integración añade sus propias tarjetas al editor de escenas (Gladys 5.1 o
posterior), en la categoría **Integraciones**.

Disparadores:

- **Inicio de la producción solar** — un inversor empieza a producir (su
  potencia supera el umbral de producción). Variables: `power`,
  `device_name`.
- **Fin de la producción solar** — deja de producir (por debajo de la mitad
  del umbral, o dormido). Variable `daily_energy`: la energía producida hoy,
  en kWh — para un informe diario.
- **Cambio de estado de un dispositivo SMA** — el estado de un dispositivo
  cambia: OK, advertencia, fallo, apagado o inaccesible. Filtre por el nuevo
  estado para recibir solo las alertas de fallo. Variables: `condition`,
  `previous_condition`, `device_name`.

Lea las variables en las acciones siguientes con
`{{triggerEvent.data.<variable>}}`, por ejemplo «Producción del día:
{{triggerEvent.data.daily_energy}} kWh».

Acciones:

- **Leer un dispositivo SMA** — lee ahora el dispositivo elegido y entrega
  sus valores a las acciones siguientes: `reachable`, `condition`, `power`,
  `daily_energy`, `battery_level`, `grid_import_power`, `grid_export_power`.
- **Leer la instalación solar** — lee todos los dispositivos y entrega los
  totales: `power`, `daily_energy`, `battery_level` (media),
  `grid_import_power`, `grid_export_power`, `reachable_devices`.

Ejemplo: cada día a las 13 h, leer la instalación y, si `power` supera
2000 W, encender el calentador de agua.

## Panel

Hay dos widgets disponibles:

- **Instalación solar** — producción actual, energía del día, intercambio con
  la red, nivel de batería, un gráfico de la producción del día y el estado
  de cada dispositivo, con un botón **Actualizar**.
- **Dispositivo SMA** — elija un dispositivo en los ajustes del widget: sus
  valores en directo, su estado, su dirección, la última lectura, la
  temperatura y la frecuencia de la red.

## Solución de problemas

- **«connect ECONNREFUSED»**: Modbus TCP no está activado en el dispositivo,
  o usa otro puerto.
- **«connect EHOSTUNREACH» / tiempo agotado**: dirección IP incorrecta,
  dispositivo apagado o dormido (normal de noche en muchos inversores), o un
  cortafuegos en medio.
- **«No SMA serial number at this address»**: el dispositivo responde, pero
  no con ese ID de unidad: compruébelo (3 para un inversor consultado
  directamente; si no, vea los ajustes Modbus del Data Manager).
- **Un dispositivo aparece dos veces**: está indicado con dos direcciones;
  conserve una.
- Los registros de la integración están en la interfaz de Gladys (o en
  `docker logs`); inicie la integración con `LOG_LEVEL=debug` para ver todos
  los detalles.
