// Picks the co-op transport for this page. main.js imports this; the rest of
// src/net/ is pure and node-tested.
//
//   ?net=local   two tabs of this browser (local.js), no server: for development
//   otherwise    the Realtime Database in config.js, or co-op off when it's empty

import { NET } from './config.js';
import { createTabTransport } from './local.js';
import { createRtdbTransport } from './rtdb.js';

/**
 * @param {URLSearchParams} params
 * @returns {{enabled: boolean, kind: 'local'|'rtdb'|'off', transport: Object|null}}
 */
export function pickTransport(params, config = NET) {
  if (params.get('net') === 'local' && typeof BroadcastChannel === 'function') {
    return { enabled: true, kind: 'local', transport: createTabTransport() };
  }
  const url = typeof config?.databaseURL === 'string' ? config.databaseURL.trim() : '';
  if (url && typeof EventSource === 'function') {
    return { enabled: true, kind: 'rtdb', transport: createRtdbTransport({ databaseURL: url }) };
  }
  return { enabled: false, kind: 'off', transport: null };
}

export { hostRoom, joinRoom } from './session.js';
export { cleanCode, inviteLink, NET_MESSAGES } from './room.js';
export { FORWARDED, replayPayload, shouldForward } from './protocol.js';
