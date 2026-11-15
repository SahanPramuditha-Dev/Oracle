import { speakWithKokoro } from './voice';
import { fetchWithAuth } from './api';

export type ProtocolActionType =
  | 'speak'
  | 'timer'
  | 'launch_app'
  | 'volume'
  | 'privacy'
  | 'sentry'
  | 'dormant'
  | 'map'
  | 'diagnostic'
  | 'desktop_hud'
  | 'custom_event';

export interface ProtocolAction {
  id: string;
  type: ProtocolActionType;
  payload?: string;
  label?: string;
}

export interface ProtocolDefinition {
  id: string;
  name: string;
  code: string;
  badge: string;
  clearance: string;
  summary: string;
  description: string;
  voicePhrases: string[];
  standardMode: string;
  adminMode: string;
  requiresAdmin: boolean;
  status: 'active' | 'ready' | 'restricted';
  isCustom?: boolean;
  isModified?: boolean;
  actions?: ProtocolAction[];
  spokenResponse?: string;
}

export const ORACLE_PROTOCOLS: ProtocolDefinition[] = [
  {
    id: 'admin',
    name: 'Protocol Admin',
    code: 'PROTO-ADM-01',
    badge: 'BIOMETRIC GATE',
    clearance: 'Administrator Level 5',
    summary: 'Biometric Optical Identification',
    description:
      'Verifies an enrolled administrator by face and a one-time spoken phrase. The gateway grants five minutes of administrator clearance.',
    voicePhrases: [
      'activate protocol admin',
      'select protocol admin',
      'protocol admin',
      'admin protocol',
      'start protocol admin'
    ],
    standardMode: 'Request verification',
    adminMode: 'Manage admin session',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'sentinel',
    name: 'Protocol SENTINEL',
    code: 'PROTO-SEN-02',
    badge: 'SECURITY MONITORING',
    clearance: 'Security Clearance',
    summary: 'Monitors ORACLE permissions, access requests, and sensor activation',
    description:
      'Shows current browser camera and microphone permissions, Oracle sensor activity, and administrator clearance. Recent changes appear in the status menu.',
    voicePhrases: [
      'activate sentinel',
      'activate protocol sentinel',
      'protocol sentinel',
      'sentinel mode'
    ],
    standardMode: 'View basic status',
    adminMode: 'View live activity',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'sentry',
    name: 'Protocol SENTRY',
    code: 'PROTO-STR-12',
    badge: 'CAMERA',
    clearance: 'All Operators',
    summary: 'Opens the live Oracle camera',
    description: 'Opens the existing camera viewfinder with browser permission. Close the viewfinder or say “Stop Sentry” to release the camera.',
    voicePhrases: ['activate sentry', 'activate protocol sentry', 'protocol sentry', 'sentry mode'],
    standardMode: 'Use camera',
    adminMode: 'Use camera',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'ghost',
    name: 'Protocol GHOST',
    code: 'PROTO-GHO-03',
    badge: 'PRIVACY MODE',
    clearance: 'All Operators',
    summary: 'Hides sensitive information, pauses sensing, suppresses previews',
    description:
      'Hides private Oracle panels and notification previews, stops the camera, and pauses voice input. Exit Ghost mode from the on-screen control.',
    voicePhrases: [
      'activate ghost',
      'activate protocol ghost',
      'protocol ghost',
      'privacy mode'
    ],
    standardMode: 'Activate privacy',
    adminMode: 'Configure privacy policies',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'focus',
    name: 'Protocol FOCUS',
    code: 'PROTO-FOC-04',
    badge: 'DEEP WORK MODE',
    clearance: 'All Operators',
    summary: 'Opens dev workspace, starts focus session, silences nonessentials',
    description:
      'Opens development workspace, starts a timed focus session, silences nonessential notifications, and prioritizes coding tasks.',
    voicePhrases: [
      'initiate focus',
      'activate focus',
      'activate protocol focus',
      'protocol focus',
      'deep work mode'
    ],
    standardMode: 'Full access',
    adminMode: 'Full access',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'diagnostic',
    name: 'Protocol DIAGNOSTIC',
    code: 'PROTO-DIA-05',
    badge: 'SYSTEM HEALTH',
    clearance: 'Engineering Clearance',
    summary: 'Checks CPU, RAM, GPU, storage, running services, and models',
    description:
      'Checks CPU, RAM, GPU, storage, running services, AI models, and ORACLE subsystem status. Provides a spoken health summary.',
    voicePhrases: [
      'run full diagnostics',
      'activate diagnostic',
      'activate protocol diagnostic',
      'protocol diagnostic',
      'system diagnostics'
    ],
    standardMode: 'View health',
    adminMode: 'Advanced diagnostics',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'command',
    name: 'Protocol COMMAND',
    code: 'PROTO-CMD-06',
    badge: 'DESKTOP CONTROL',
    clearance: 'Operator / Admin',
    summary: 'Application launches, window management, media control',
    description:
      'Enables approved application launches, window management, media control, and file operations. Requires confirmation for sensitive changes.',
    voicePhrases: [
      'activate command',
      'activate protocol command',
      'protocol command',
      'desktop control'
    ],
    standardMode: 'Basic desktop actions',
    adminMode: 'Privileged actions with approval',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'atlas',
    name: 'Protocol ATLAS',
    code: 'PROTO-ATL-07',
    badge: 'SPATIAL INTELLIGENCE',
    clearance: 'Spatial Operations',
    summary: 'Map tools, route planning, location bookmarks, geospatial layers',
    description:
      'Opens map tools, route planning, location bookmarks, geospatial layers, and location-based event views.',
    voicePhrases: [
      'activate atlas',
      'activate protocol atlas',
      'protocol atlas',
      'open atlas',
      'open the map',
      'open map',
      'show map',
      'show the map',
      'view map',
      'launch map',
      'spatial intelligence'
    ],
    standardMode: 'Basic maps',
    adminMode: 'Protected location data',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'watchtower',
    name: 'Protocol WATCHTOWER',
    code: 'PROTO-WAT-08',
    badge: 'NETWORK AWARENESS',
    clearance: 'Network Admin',
    summary: 'Connectivity, known devices, service availability, latency',
    description:
      'Displays connectivity, known devices, service availability, latency, and network health for systems you own or administer.',
    voicePhrases: [
      'activate watchtower',
      'activate protocol watchtower',
      'protocol watchtower',
      'network awareness'
    ],
    standardMode: 'Connectivity status',
    adminMode: 'Authorized network diagnostics',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'briefing',
    name: 'Protocol BRIEFING',
    code: 'PROTO-BRF-09',
    badge: 'DAILY INTELLIGENCE',
    clearance: 'All Operators',
    summary: 'Presents calendar, upcoming tasks, weather, spoken briefing',
    description:
      'Presents your calendar, upcoming tasks, deadlines, weather, and important reminders on the left and right panels, with a concise spoken briefing.',
    voicePhrases: [
      'initiate morning briefing',
      'initiate briefing',
      'activate protocol briefing',
      'protocol briefing',
      'morning briefing'
    ],
    standardMode: 'Non-sensitive summaries',
    adminMode: 'Private calendar and task details',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'hibernate',
    name: 'Protocol HIBERNATE',
    code: 'PROTO-HIB-10',
    badge: 'LOW ACTIVITY',
    clearance: 'All Operators',
    summary: 'Pauses Oracle activity and reduces rendering',
    description:
      'Stops camera and voice capture, interrupts the current conversation, and pauses background gateway checks. Select Wake Oracle or click the orb to resume.',
    voicePhrases: [
      'initiate hibernate',
      'activate hibernate',
      'activate protocol hibernate',
      'protocol hibernate',
      'hibernate system'
    ],
    standardMode: 'Full access',
    adminMode: 'Full access',
    requiresAdmin: false,
    status: 'ready'
  },
  {
    id: 'lockdown',
    name: 'Protocol LOCKDOWN',
    code: 'PROTO-LCK-11',
    badge: 'EMERGENCY RESTRICTION',
    clearance: 'Emergency Protocol',
    summary: 'Revokes admin, cancels queued actions, locks workstation',
    description:
      'Revokes administrator clearance, cancels queued desktop actions, and requests a Windows lock. Verify with Admin Protocol to resume desktop actions.',
    voicePhrases: [
      'initiate lockdown',
      'activate lockdown',
      'activate protocol lockdown',
      'protocol lockdown',
      'emergency restriction'
    ],
    standardMode: 'Lock own session',
    adminMode: 'Lock protected ORACLE services',
    requiresAdmin: false,
    status: 'ready'
  }
];

const STORAGE_KEY = 'oracle_custom_protocols_v1';

export function getStoredProtocols(): ProtocolDefinition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return ORACLE_PROTOCOLS;
    const stored: ProtocolDefinition[] = JSON.parse(raw);
    
    // Map existing built-in protocols with any customized fields
    const merged = ORACLE_PROTOCOLS.map(builtin => {
      const customMatch = stored.find(s => s.id === builtin.id);
      return customMatch ? { ...builtin, ...customMatch, isModified: true } : builtin;
    });

    // Append newly created custom protocols
    const userCreated = stored.filter(s => !ORACLE_PROTOCOLS.some(b => b.id === s.id));
    return [...merged, ...userCreated];
  } catch (err) {
    console.warn('Failed to parse custom protocols from storage:', err);
    return ORACLE_PROTOCOLS;
  }
}

export function saveProtocol(protocol: ProtocolDefinition): void {
  try {
    const current = getStoredProtocols();
    const existingIdx = current.findIndex(p => p.id === protocol.id);
    let next: ProtocolDefinition[];
    if (existingIdx >= 0) {
      next = [...current];
      next[existingIdx] = { ...protocol, isModified: !protocol.isCustom };
    } else {
      next = [...current, { ...protocol, isCustom: true }];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('oracle_protocols_changed'));
  } catch (err) {
    console.error('Failed to save protocol:', err);
  }
}

export function deleteProtocol(protocolId: string): void {
  try {
    const current = getStoredProtocols();
    // If it's custom, remove completely. If it was modified built-in, reset to default.
    const isBuiltin = ORACLE_PROTOCOLS.some(b => b.id === protocolId);
    let next: ProtocolDefinition[];
    if (isBuiltin) {
      const defaultDef = ORACLE_PROTOCOLS.find(b => b.id === protocolId)!;
      next = current.map(p => (p.id === protocolId ? defaultDef : p));
    } else {
      next = current.filter(p => p.id !== protocolId);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('oracle_protocols_changed'));
  } catch (err) {
    console.error('Failed to delete protocol:', err);
  }
}

export function resetAllProtocols(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('oracle_protocols_changed'));
  } catch (err) {
    console.error('Failed to reset protocols:', err);
  }
}

export function executeProtocol(protocolId: string, isAdmin: boolean = false): boolean {
  if (protocolId === 'ghost') {
    window.dispatchEvent(new Event('oracle_activate_ghost_protocol'));
    return true;
  }
  if (protocolId === 'admin') {
    window.dispatchEvent(new CustomEvent('oracle_open_admin_protocol'));
    return true;
  }
  if (protocolId === 'lockdown') {
    window.dispatchEvent(new CustomEvent('oracle_activate_lockdown_protocol'));
    return true;
  }
  const protocols = getStoredProtocols();
  const proto = protocols.find(p => p.id === protocolId);

  // Clearance Gate Check
  if (proto && proto.requiresAdmin && !isAdmin) {
    speakWithKokoro('Access restricted. Protocol requires Administrator Level 5 clearance.', { allowBargeIn: true });
    window.dispatchEvent(new CustomEvent('oracle_protocol_denied', { detail: proto }));
    return false;
  }

  // Spoken custom announcement
  if (proto?.spokenResponse) {
    speakWithKokoro(proto.spokenResponse, { allowBargeIn: true });
  }

  // Execute custom action sequence if configured
  if (proto?.actions && proto.actions.length > 0) {
    for (const action of proto.actions) {
      switch (action.type) {
        case 'speak':
          if (action.payload) speakWithKokoro(action.payload, { allowBargeIn: true });
          break;
        case 'timer':
          if (action.payload) {
            const minutes = parseInt(action.payload, 10) || 25;
            window.dispatchEvent(new CustomEvent('oracle_set_timer', { detail: { duration: minutes * 60, label: `${minutes}m Focus` } }));
          }
          break;
        case 'privacy':
          executeProtocol('ghost');
          break;
        case 'sentry':
          executeProtocol('sentry');
          break;
        case 'volume':
          if (action.payload) {
            const vol = parseInt(action.payload, 10) || 50;
            void fetchWithAuth(`/api/v1/desktop/volume?level=${vol}`, { method: 'POST' }).catch(() => {});
          }
          break;
        case 'launch_app':
          if (action.payload) {
            void fetchWithAuth('/api/v1/actions/propose', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ app_id: action.payload })
            }).catch(() => {});
          }
          break;
        case 'custom_event':
          if (action.payload) {
            window.dispatchEvent(new CustomEvent(action.payload));
          }
          break;
        default:
          break;
      }
    }
  }

  // Dispatch standard events for built-in protocol logic
  switch (protocolId) {
    case 'sentinel':
      window.dispatchEvent(new CustomEvent('oracle_activate_sentinel_protocol'));
      break;
    case 'focus':
      window.dispatchEvent(new CustomEvent('oracle_activate_focus_protocol'));
      break;
    case 'diagnostic':
      window.dispatchEvent(new CustomEvent('oracle_open_self_diagnostic'));
      break;
    case 'command':
      window.dispatchEvent(new CustomEvent('oracle_open_desktop_hud'));
      break;
    case 'atlas':
      window.dispatchEvent(new CustomEvent('oracle_activate_atlas_protocol'));
      break;
    case 'watchtower':
      window.dispatchEvent(new CustomEvent('oracle_activate_watchtower_protocol'));
      break;
    case 'briefing':
      window.dispatchEvent(new CustomEvent('oracle_activate_briefing_protocol'));
      break;
    case 'hibernate':
      window.dispatchEvent(new CustomEvent('oracle_activate_hibernate_protocol'));
      break;
    case 'sentry':
      window.dispatchEvent(new CustomEvent('oracle_activate_sentry_protocol'));
      break;
    default:
      // Custom protocol activated
      window.dispatchEvent(new CustomEvent('oracle_custom_protocol_executed', { detail: proto }));
      break;
  }

  return true;
}
