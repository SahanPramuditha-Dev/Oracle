// Re-export SelfDiagnosticOverlay as InitializationOverlay for backwards-compatibility
// Diagnostic checks have been separated into a dedicated Self-Diagnostic feature.

export {
  SelfDiagnosticOverlay as InitializationOverlay,
  type SelfDiagnosticOverlayProps as InitializationOverlayProps,
  type BiometricAuthResult
} from './SelfDiagnosticOverlay';
