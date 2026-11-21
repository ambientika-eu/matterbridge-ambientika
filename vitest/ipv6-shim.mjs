// @ts-nocheck
// For machines without IPv6 (this build sandbox): matter.js opens IPv6 UDP sockets for mDNS and
// refuses to start without them. Here an IPv6 socket is replaced by an IPv4 one, so that a Matter
// node can run for tests. Not part of the plugin; not needed where IPv6 exists.
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';

const real = dgram.createSocket;
let needed = false;
try {
  const probe = real.call(dgram, { type: 'udp6' });
  await new Promise((resolve) => {
    probe.once('error', (e) => {
      needed = e.code === 'EAFNOSUPPORT';
      resolve();
    });
    probe.bind(0, '::1', () => resolve());
  });
  probe.close();
} catch {
  needed = true;
}
if (needed) {
  const v4 = (a) => (a === undefined || a === '::' ? '0.0.0.0' : a === '::1' ? '127.0.0.1' : typeof a === 'string' && a.includes(':') ? '127.0.0.1' : a);
  dgram.createSocket = function (options, listener) {
    const opts = typeof options === 'string' ? { type: options } : { ...options };
    const was6 = opts.type === 'udp6';
    if (was6) {
      opts.type = 'udp4';
      delete opts.ipv6Only;
    }
    const socket = real.call(dgram, opts, listener);
    if (!was6) return socket;
    const bind = socket.bind.bind(socket);
    socket.bind = (...args) => {
      if (args[0] !== null && typeof args[0] === 'object') args[0] = { ...args[0], address: v4(args[0].address) };
      else if (typeof args[1] === 'string') args[1] = v4(args[1]);
      return bind(...args);
    };
    const send = socket.send.bind(socket);
    socket.send = (msg, ...rest) => {
      // (msg, [offset, length,] port, address, cb): only unicast to this machine is passed on
      const i = rest.findIndex((x) => typeof x === 'string');
      if (i >= 0) {
        if (/^ff/i.test(rest[i])) {
          const cb = rest.find((x) => typeof x === 'function');
          if (cb) queueMicrotask(() => cb(null));
          return;
        }
        rest[i] = v4(rest[i]);
      }
      return send(msg, ...rest);
    };
    for (const name of ['addMembership', 'dropMembership', 'setMulticastInterface', 'addSourceSpecificMembership', 'dropSourceSpecificMembership']) socket[name] = () => {};
    return socket;
  };
  syncBuiltinESMExports();
  console.error('[ipv6-shim] no IPv6 on this machine: IPv6 UDP sockets are replaced by IPv4 ones');
}
