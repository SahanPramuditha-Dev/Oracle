/**
 * ORACLE Presence & Dormant Mode — Type Definitions
 * Exact port of ORACLE_Dormant_v4.html
 */

export type OracleMode = 'initializing' | 'dormant' | 'ready' | 'listening' | 'thinking' | 'speaking';

export interface OracleState {
  mode: OracleMode;
  energy: number;
  targetEnergy: number;
  sleep: number;
  targetSleep: number;
}

export const MODE_NAMES: Record<OracleMode, string> = {
  initializing: 'INITIALIZING',
  dormant: 'DORMANT',
  ready: 'READY',
  listening: 'LISTENING',
  thinking: 'THINKING',
  speaking: 'SPEAKING'
};

export const HINTS: Record<OracleMode, string> = {
  initializing: 'Calibrating sensory feeds & neural core...',
  dormant: 'Click anywhere or press Space to wake',
  ready: '',
  listening: 'Listening',
  thinking: 'Processing',
  speaking: 'Responding'
};

export const ENERGY_LEVELS: Record<OracleMode, number> = {
  initializing: 0.22,
  dormant: 0,
  ready: 0.08,
  listening: 0.5,
  thinking: 0.72,
  speaking: 0.6
};
