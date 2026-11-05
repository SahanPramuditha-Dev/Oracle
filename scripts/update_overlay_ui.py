import re

with open('frontend/src/components/InitializationOverlay.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update lucide-react import
code = code.replace(
    "import { Database, ShieldCheck, Camera } from 'lucide-react';",
    "import { Database, ShieldCheck, Camera, Cpu, Mic } from 'lucide-react';"
)

# 2. Update NeuralCard JSX
old_neural_start = code.find('key="neural-card"')
if old_neural_start != -1:
    tag_start = code.rfind('<motion.div', 0, old_neural_start)
    tag_end = code.find('</motion.div>', old_neural_start) + len('</motion.div>')
    new_neural = """<motion.div
      key="neural-card"
      className="oracle-diag-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <Cpu size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--accent)' }} />
          Neural Gateway
        </span>
        <span className={`card-status-badge ${isLocked ? 'locked' : 'scanning'}`}>
          <span className="card-status-dot" />
          {errorText || (isLocked ? '100% Nominal' : 'Probing Ollama Engine...')}
        </span>
      </div>

      <div className="card-hero-block">
        <div className="card-hero-title">Neural Inference Engine</div>
        <div className="card-hero-sub">Local Cluster • Qwen 2.5 1.5B</div>
      </div>

      <div className="card-meter-rack">
        <span className="meter-label">Verification Progress</span>
        <div className="meter-segments">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`meter-bar ${i < activeBars ? 'active' : ''}`}
            />
          ))}
        </div>
        <span className="meter-pct">{progress}%</span>
      </div>

      <div className="card-spec-grid">
        <div className="spec-cell">
          <span className="spec-key">Engine</span>
          <span className="spec-val">Ollama Link</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Model</span>
          <span className="spec-val">Qwen 2.5</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Latency</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : 'inherit' }}>
            {latency !== null ? `${latency}ms` : 'Testing...'}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Clearance</span>
          <span className="spec-val" style={{ color: '#22c55e' }}>Alpha-1</span>
        </div>
      </div>
    </motion.div>"""
    code = code[:tag_start] + new_neural + code[tag_end:]
    print("Updated NeuralCard")

# 3. Update DatabaseCard JSX
old_db_start = code.find('key="database-card"')
if old_db_start != -1:
    tag_start = code.rfind('<motion.div', 0, old_db_start)
    tag_end = code.find('</motion.div>', old_db_start) + len('</motion.div>')
    new_db = """<motion.div
      key="database-card"
      className="oracle-diag-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <Database size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--accent)' }} />
          Storage Vault
        </span>
        <span className={`card-status-badge ${isLocked ? 'locked' : 'scanning'}`}>
          <span className="card-status-dot" />
          {isLocked ? '100% Integrity' : 'Executing SQL Audit...'}
        </span>
      </div>

      <div className="card-hero-block">
        <div className="card-hero-title">PostgreSQL Biometric Vault</div>
        <div className="card-hero-sub">Relational Engine • Vector Database</div>
      </div>

      <div className="card-meter-rack">
        <span className="meter-label">Database Integrity</span>
        <div className="meter-segments">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`meter-bar ${i < activeBars ? 'active-green' : ''}`}
            />
          ))}
        </div>
        <span className="meter-pct">{progress}%</span>
      </div>

      <div className="card-spec-grid">
        <div className="spec-cell">
          <span className="spec-key">Database</span>
          <span className="spec-val">PostgreSQL</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Encryption</span>
          <span className="spec-val">AES-256</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Latency</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : 'inherit' }}>
            {queryLatency !== null ? `${queryLatency}ms` : 'Testing...'}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Records</span>
          <span className="spec-val" style={{ color: '#22c55e' }}>
            {recordsCount !== null ? `${recordsCount} Assets` : 'Auditing...'}
          </span>
        </div>
      </div>
    </motion.div>"""
    code = code[:tag_start] + new_db + code[tag_end:]
    print("Updated DatabaseCard")

# 4. Update AcousticCard JSX
old_acoustic_start = code.find('key="acoustic-card"')
if old_acoustic_start != -1:
    tag_start = code.rfind('<motion.div', 0, old_acoustic_start)
    tag_end = code.find('</motion.div>', old_acoustic_start) + len('</motion.div>')
    new_acoustic = """<motion.div
      key="acoustic-card"
      className="oracle-waveform-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <Mic size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--accent)' }} />
          Acoustic Sensors
        </span>
        <span className={`card-status-badge ${isLocked ? 'locked' : 'scanning'}`}>
          <span className="card-status-dot" />
          {isLocked ? '100% Calibrated' : 'Sampling Audio Stream...'}
        </span>
      </div>

      <div className="card-hero-block" style={{ marginBottom: 10 }}>
        <div className="card-hero-title">Acoustic Environment</div>
        <div className="card-hero-sub">Audio Pipeline • Kokoro Neural TTS</div>
      </div>

      <FluidVoiceWaveform
        analyser={analyser}
        width={422}
        height={96}
        isCalibrated={isLocked}
      />

      <div className="card-meter-rack" style={{ marginTop: 10, marginBottom: 0 }}>
        <span className="meter-label">Frequency Calibration</span>
        <div className="meter-segments">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className={`meter-bar ${i < activeBars ? 'active' : ''}`}
            />
          ))}
        </div>
        <span className="meter-pct">{progress}%</span>
      </div>

      <div className="card-spec-grid" style={{ marginTop: 12 }}>
        <div className="spec-cell">
          <span className="spec-key">Hardware</span>
          <span className="spec-val" title={deviceLabel}>Default Mic</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Noise Floor</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : 'inherit' }}>
            {noiseFloor}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Sample Rate</span>
          <span className="spec-val">{sampleRate}</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Status</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : '#38bdf8' }}>
            {isLocked ? 'Calibrated' : 'Sampling'}
          </span>
        </div>
      </div>
    </motion.div>"""
    code = code[:tag_start] + new_acoustic + code[tag_end:]
    print("Updated AcousticCard")

# 5. Update OpticalCard JSX
old_optical_start = code.find('key="optical-card"')
if old_optical_start != -1:
    tag_start = code.rfind('<motion.div', 0, old_optical_start)
    tag_end = code.find('</motion.div>', old_optical_start) + len('</motion.div>')
    new_optical = """<motion.div
      key="optical-card"
      className="oracle-diag-card fts-card"
      style={{ maxWidth: 470, width: '92vw' }}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <Camera size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--accent)' }} />
          Optical Presence
        </span>
        <span
          className={`card-status-badge ${isAdmin && isLocked ? 'locked' : 'scanning'}`}
          style={
            !hasSubject
              ? { borderColor: 'rgba(232, 235, 239, 0.08)', color: 'var(--muted)' }
              : !isMatch
              ? { borderColor: 'rgba(239, 68, 68, 0.35)', color: '#ef4444' }
              : !isAdmin
              ? { borderColor: 'rgba(245, 158, 11, 0.35)', color: '#f59e0b' }
              : isLocked
              ? { borderColor: 'rgba(34, 197, 94, 0.35)', color: '#22c55e' }
              : undefined
          }
        >
          <span
            className="card-status-dot"
            style={
              !hasSubject
                ? { background: 'var(--muted)' }
                : !isMatch
                ? { background: '#ef4444' }
                : !isAdmin
                ? { background: '#f59e0b' }
                : { background: '#22c55e' }
            }
          />
          {isLocked
            ? isAdmin
              ? `Asset Identified (${authResult.confidence}%)`
              : isMatch
              ? `Operator: ${displayName}`
              : hasSubject
              ? 'Unregistered Subject'
              : 'No Operator Detected'
            : hasSubject
            ? isMatch
              ? `Auditing: ${displayName}`
              : 'Analyzing Subject...'
            : 'Searching Field...'}
        </span>
      </div>

      <div className="card-hero-block" style={{ marginBottom: 4 }}>
        <div className="card-hero-title">Facial Recognition</div>
        <div className="card-hero-sub">
          Biometric Neural Verification • SFace 128-D
        </div>
      </div>

      {/* Clean Full-Width Live Camera Viewport */}
      <div className="frs-single-viewport">
        <div className="frs-feed-ribbon">
          <div className="feed-tag">
            <span className="cctv-rec-dot" />
            <span>Optical Feed</span>
          </div>
          <div className="feed-pill-right">
            <button
              type="button"
              className="frs-mirror-btn"
              onClick={() => setIsMirrored((prev) => !prev)}
              title="Flip camera mirror"
            >
              MIRROR: {isMirrored ? 'ON' : 'OFF'}
            </button>
            <span style={{ opacity: 0.35 }}>|</span>
            <span ref={timecodeRef}>LIVE 00:00:00</span>
          </div>
        </div>

        <video
          ref={(el) => {
            videoRef.current = el;
            if (el && stream && el.srcObject !== stream) {
              el.srcObject = stream;
              el.play().catch(() => {});
            }
          }}
          autoPlay
          playsInline
          muted
          style={{ transform: isMirrored ? 'scaleX(-1)' : 'none' }}
          className="frs-full-stream"
        />

        {/* When NO subject is in frame: Tasteful centered indicator */}
        {!hasSubject && (
          <div className="frs-empty-viewport">
            <div className="frs-empty-pill">
              <span className="card-status-dot" style={{ background: 'var(--muted)', animation: 'none' }} />
              <span>Awaiting operator in frame</span>
            </div>
          </div>
        )}

        {/* When subject IS detected: Precision Modern Rounded Box */}
        {hasSubject && liveBox && (
          <div
            className={`frs-bounding-box ${
              !isMatch
                ? 'unidentified'
                : !isAdmin
                ? 'guest'
                : isLocked
                ? 'locked'
                : 'scanning'
            }`}
            style={{
              left: `${liveBox[0]}%`,
              top: `${liveBox[1]}%`,
              width: `${liveBox[2]}%`,
              height: `${liveBox[3]}%`
            }}
          >
            <div
              className="frs-face-tag"
              style={{
                top: liveBox[1] < 16 ? 'auto' : '-28px',
                bottom: liveBox[1] < 16 ? '-28px' : 'auto'
              }}
            >
              <span
                className="card-status-dot"
                style={{
                  background: !isMatch ? '#ef4444' : !isAdmin ? '#f59e0b' : '#22c55e',
                  animation: 'none'
                }}
              />
              <span className="frs-face-tag-name">
                {isAdmin ? displayName : isMatch ? displayName : 'Unregistered'}
              </span>
              <span className="frs-face-tag-sub">
                {isAdmin ? 'Primary Authority' : isMatch ? 'Standard User' : 'Restricted'}
              </span>
            </div>
          </div>
        )}

        {/* Viewport Bottom Status Bar */}
        <div className="frs-viewport-bottom-bar">
          <span className="engine-tag">YuNet + SFace ONNX</span>
          <span
            className="lock-tag"
            style={{
              color: !hasSubject
                ? 'var(--muted)'
                : !isMatch
                ? '#ef4444'
                : !isAdmin
                ? '#f59e0b'
                : isLocked
                ? '#22c55e'
                : 'var(--accent)'
            }}
          >
            {!hasSubject
              ? 'Awaiting Operator'
              : !isMatch
              ? 'Unregistered Subject'
              : !isAdmin
              ? `Standard User (${displayName})`
              : isLocked
              ? '100% Verified'
              : 'Verifying Vectors...'}
          </span>
        </div>
      </div>

      <div className="card-spec-grid">
        <div className="spec-cell">
          <span className="spec-key">Sensor</span>
          <span className="spec-val">HD Optical</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Pipeline</span>
          <span className="spec-val">YuNet + SFace</span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Identity</span>
          <span
            className="spec-val"
            style={{
              color: isAdmin
                ? '#22c55e'
                : isMatch
                ? '#f59e0b'
                : hasSubject
                ? '#ef4444'
                : 'var(--muted)'
            }}
          >
            {isAdmin
              ? `${displayName}`
              : isMatch
              ? `${displayName}`
              : hasSubject
              ? 'Unregistered'
              : 'None'}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Clearance</span>
          <span
            className="spec-val"
            style={{
              color: isLocked
                ? isAdmin
                  ? '#22c55e'
                  : isMatch
                  ? '#f59e0b'
                  : hasSubject
                  ? '#ef4444'
                  : 'var(--muted)'
                : 'var(--muted)'
            }}
          >
            {isLocked
              ? isAdmin
                ? 'Root Authority'
                : isMatch
                ? 'Restricted'
                : hasSubject
                ? 'Unauthorized'
                : 'Standby'
              : 'Analyzing...'}
          </span>
        </div>
      </div>
    </motion.div>"""
    code = code[:tag_start] + new_optical + code[tag_end:]
    print("Updated OpticalCard")

# 6. Update AdminPrivilegesCard JSX
old_admin_start = code.find('key="admin-card"')
if old_admin_start != -1:
    tag_start = code.rfind('<motion.div', 0, old_admin_start)
    tag_end = code.find('</motion.div>', old_admin_start) + len('</motion.div>')
    new_admin = """<motion.div
      key="admin-card"
      className="oracle-diag-card"
      style={{ maxWidth: 470 }}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="card-header-strip">
        <span className="card-section-tag">
          <ShieldCheck size={13} strokeWidth={1.8} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--accent)' }} />
          Administrative Clearance
        </span>
        <span
          className={`card-status-badge ${isAdmin ? 'locked' : 'scanning'}`}
          style={
            !isAdmin
              ? { borderColor: biometricAuth.isMatched ? 'rgba(245, 158, 11, 0.35)' : 'rgba(239, 68, 68, 0.35)', color: biometricAuth.isMatched ? '#f59e0b' : '#ef4444' }
              : undefined
          }
        >
          <span
            className="card-status-dot"
            style={
              !isAdmin
                ? { background: biometricAuth.isMatched ? '#f59e0b' : '#ef4444' }
                : undefined
            }
          />
          {isAdmin ? '100% Authorized' : biometricAuth.isMatched ? 'Standard Access' : 'Access Restricted'}
        </span>
      </div>

      <div className="card-hero-block" style={{ marginTop: 10, marginBottom: 16 }}>
        <div className="card-hero-title">
          {isAdmin
            ? 'Administrative Access Granted'
            : biometricAuth.isMatched
            ? `Restricted Session: ${biometricAuth.identifiedName}`
            : biometricAuth.facesDetected > 0
            ? 'Administrative Access Denied'
            : 'Terminal Vacant // Standby'}
        </div>
        <div className="card-hero-sub">
          {isAdmin
            ? `Root Clearance Alpha-1 • Operator ${biometricAuth.identifiedName} Confirmed`
            : biometricAuth.isMatched
            ? 'Non-Administrative Operator • Elevated Privileges Locked'
            : biometricAuth.facesDetected > 0
            ? 'Unverified Biometrics • Operator Not In Registry'
            : 'No Subject Detected By Optical Surveillance Sensor'}
        </div>
      </div>

      <div className="card-spec-grid">
        <div className="spec-cell">
          <span className="spec-key">Clearance</span>
          <span
            className="spec-val"
            style={{ color: isAdmin ? '#22c55e' : biometricAuth.isMatched ? '#38bdf8' : '#ef4444' }}
          >
            {isAdmin ? 'Root Authority' : biometricAuth.isMatched ? 'Standard User' : 'Unauthorized'}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Biometric Asset</span>
          <span
            className="spec-val"
            style={{ color: biometricAuth.isMatched ? '#22c55e' : '#ef4444' }}
          >
            {biometricAuth.identifiedName
              ? `${biometricAuth.identifiedName}`
              : biometricAuth.facesDetected > 0
              ? 'Unregistered'
              : 'None'}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">System Integrity</span>
          <span className="spec-val" style={{ color: allSubsystemsOk ? '#22c55e' : '#f59e0b' }}>
            {allSubsystemsOk ? '100% Operational' : `${failures.length} Warning`}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Oracle Interface</span>
          <span className="spec-val" style={{ color: '#38bdf8' }}>
            {isAdmin ? 'Standing By' : 'Restricted'}
          </span>
        </div>
      </div>
    </motion.div>"""
    code = code[:tag_start] + new_admin + code[tag_end:]
    print("Updated AdminPrivilegesCard")

with open('frontend/src/components/InitializationOverlay.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Finished updating InitializationOverlay.tsx")
