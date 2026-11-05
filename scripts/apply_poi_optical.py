with open('frontend/src/components/InitializationOverlay.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

old_optical_start = code.find('key="optical-card"')
tag_start = code.rfind('<motion.div', 0, old_optical_start)
tag_end = code.find('</motion.div>', old_optical_start) + len('</motion.div>')

new_optical = """<motion.div
      key="optical-card"
      className="oracle-diag-card fts-card"
      style={{ maxWidth: 540, width: '94vw' }}
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
              ? { borderColor: 'rgba(250, 204, 21, 0.4)', color: '#facc15' }
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
                : isLocked
                ? { background: '#facc15' }
                : { background: '#38bdf8' }
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
              : 'Auditing Face Vectors...'
            : 'Searching FOV...'}
        </span>
      </div>

      <div className="card-hero-block" style={{ marginBottom: 4 }}>
        <div className="card-hero-title">Facial Recognition System</div>
        <div className="card-hero-sub">
          Biometric Neural Verification • SFace 128-D Embeddings
        </div>
      </div>

      {/* Clean Full-Width Live Camera Viewport */}
      <div className="frs-single-viewport" style={{ maxHeight: 275 }}>
        <div className="frs-feed-ribbon">
          <div className="feed-tag">
            <span className="cctv-rec-dot" style={{ background: isLocked ? '#facc15' : '#22c55e', boxShadow: isLocked ? '0 0 8px #facc15' : '0 0 8px #22c55e' }} />
            <span>OPTICAL_CAM_01</span>
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

        {/* When subject IS detected: Person of Interest (The Machine) Target Box */}
        {hasSubject && liveBox && (() => {
          const isFaceOnRight = (liveBox[0] + liveBox[2] / 2) > 50;
          const targetColor = !isLocked
            ? '#38bdf8'
            : isAdmin
            ? '#facc15'
            : isMatch
            ? '#f59e0b'
            : '#ef4444';

          return (
            <>
              {/* Target Bounding Box with POI Corner L-Brackets and Edge Ticks */}
              <div
                className="poi-target-container"
                style={{
                  left: `${liveBox[0]}%`,
                  top: `${liveBox[1]}%`,
                  width: `${liveBox[2]}%`,
                  height: `${liveBox[3]}%`
                }}
              >
                <svg
                  className="poi-target-svg"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {/* Dashed Perimeter */}
                  <rect
                    x="2"
                    y="2"
                    width="96"
                    height="96"
                    fill="none"
                    stroke={targetColor}
                    strokeWidth="1.8"
                    strokeDasharray="6 3.5"
                    opacity="0.88"
                  />
                  {/* 4 Corner L-Brackets */}
                  <path
                    d="M 2 16 L 2 2 L 16 2"
                    stroke={targetColor}
                    strokeWidth="3.4"
                    strokeLinecap="square"
                    fill="none"
                  />
                  <path
                    d="M 84 2 L 98 2 L 98 16"
                    stroke={targetColor}
                    strokeWidth="3.4"
                    strokeLinecap="square"
                    fill="none"
                  />
                  <path
                    d="M 2 84 L 2 98 L 16 98"
                    stroke={targetColor}
                    strokeWidth="3.4"
                    strokeLinecap="square"
                    fill="none"
                  />
                  <path
                    d="M 84 98 L 98 98 L 98 84"
                    stroke={targetColor}
                    strokeWidth="3.4"
                    strokeLinecap="square"
                    fill="none"
                  />
                  {/* 4 Inward-pointing Center Ticks */}
                  <line x1="50" y1="2" x2="50" y2="8" stroke={targetColor} strokeWidth="2.5" />
                  <line x1="50" y1="98" x2="50" y2="92" stroke={targetColor} strokeWidth="2.5" />
                  <line x1="2" y1="50" x2="8" y2="50" stroke={targetColor} strokeWidth="2.5" />
                  <line x1="98" y1="50" x2="92" y2="50" stroke={targetColor} strokeWidth="2.5" />
                </svg>
              </div>

              {/* POI Intelligence Dossier Card */}
              <div className={`poi-dossier-card ${isFaceOnRight ? 'dock-left' : 'dock-right'}`}>
                {/* Header Banner */}
                <div
                  className="poi-dossier-banner"
                  style={{
                    background: !isLocked
                      ? 'rgba(56, 189, 248, 0.25)'
                      : isAdmin
                      ? '#facc15'
                      : isMatch
                      ? '#f59e0b'
                      : '#ef4444',
                    color: !isLocked ? '#38bdf8' : '#0c0e11'
                  }}
                >
                  {!isLocked
                    ? 'TARGET ACQUISITION // SCANNING'
                    : isAdmin
                    ? 'PRIMARY ASSET IDENTIFIED'
                    : isMatch
                    ? 'KNOWN OPERATOR IDENTIFIED'
                    : 'UNIDENTIFIED SUBJECT // RESTRICTED'}
                </div>

                {/* Identity / Alias Header */}
                <div className="poi-dossier-alias">
                  <span className="alias-key">IDENTITY:</span>
                  <span className="alias-val">
                    {isLocked
                      ? (displayName ? displayName.toUpperCase() : 'UNKNOWN')
                      : 'AUDITING MESH...'}
                  </span>
                </div>

                {/* Machine Intelligence Specs Grid */}
                <div className="poi-dossier-grid">
                  <div className="poi-row">
                    <span className="poi-k">CLEARANCE:</span>
                    <span
                      className="poi-v"
                      style={{ color: isAdmin ? '#22c55e' : isMatch ? '#f59e0b' : '#ef4444' }}
                    >
                      {isAdmin ? 'ROOT_AUTHORITY // ALPHA-1' : isMatch ? 'STANDARD_USER // LEVEL-2' : 'UNAUTHORIZED'}
                    </span>
                  </div>
                  <div className="poi-row">
                    <span className="poi-k">BIOMETRIC:</span>
                    <span className="poi-v">
                      {isLocked ? `${authResult.confidence}% MATCH` : 'CALCULATING SFACE 128-D...'}
                    </span>
                  </div>
                  <div className="poi-row">
                    <span className="poi-k">REGISTRY:</span>
                    <span className="poi-v">POSTGRESQL // BIOMETRIC VAULT</span>
                  </div>
                  <div className="poi-row">
                    <span className="poi-k">PIPELINE:</span>
                    <span className="poi-v">YUNET + SFACE ONNX</span>
                  </div>
                </div>

                {/* Bottom Callout Note */}
                <div
                  className="poi-dossier-callout"
                  style={{
                    color: !isLocked
                      ? '#38bdf8'
                      : isAdmin
                      ? '#facc15'
                      : isMatch
                      ? '#f59e0b'
                      : '#ef4444'
                  }}
                >
                  {!isLocked
                    ? 'MATCHING FACIAL VECTORS AGAINST VAULT'
                    : isAdmin
                    ? 'PRIMARY SYSTEM OPERATOR // ELEVATED ACCESS GRANTED'
                    : isMatch
                    ? 'STANDARD OPERATOR // ELEVATED ACCESS LOCKED'
                    : 'THREAT PROTOCOL ENGAGED // ACCESS DENIED'}
                </div>
              </div>
            </>
          );
        })()}

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
                ? '#facc15'
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
              ? 'Biometric Lock Engaged (100%)'
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
                ? '#facc15'
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

with open('frontend/src/components/InitializationOverlay.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated OpticalCard with POI Machine UI")
