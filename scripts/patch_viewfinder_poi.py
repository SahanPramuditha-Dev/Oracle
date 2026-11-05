path = 'frontend/src/components/SurveillanceViewfinder.tsx'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

old_block = """        {/* Reticles & Bounding Boxes */}
        {subjects.filter((subject) => showAllObjects || !primarySubject || subject.key === effectivePrimaryKey).map((subject) => {
          const outlineBox = subject.body && showYolo ? subject.body.box : subject.face && showFaceReticles ? subject.face.box : null;
          if (!outlineBox) return null;
          const [x, y, w, h] = outlineBox;
          const left = isMirrored ? vw - x - w : x;
          return (
            <div
              key={subject.key}
              data-subject={subject.key}
              aria-hidden="true"
              className={`camera-subject-outline ${subject.key === effectivePrimaryKey ? 'is-primary' : ''} ${subject.face?.matched ? 'is-recognized' : ''}`}
              style={{ left: `${left / vw * 100}%`, top: `${y / vh * 100}%`, width: `${w / vw * 100}%`, height: `${h / vh * 100}%` }}
            >
              {subject.face?.matched && (
                <span className="face-reticle-label">{subject.face.name}</span>
              )}
            </div>
          );
        })}"""

new_block = """        {/* Reticles & Bounding Boxes (Person of Interest Machine HUD) */}
        {subjects.filter((subject) => showAllObjects || !primarySubject || subject.key === effectivePrimaryKey).map((subject) => {
          const outlineBox = subject.body && showYolo ? subject.body.box : subject.face && showFaceReticles ? subject.face.box : null;
          if (!outlineBox) return null;
          const [x, y, w, h] = outlineBox;
          const left = isMirrored ? vw - x - w : x;
          const isMatched = !!subject.face?.matched;
          const reticleColor = isMatched ? '#facc15' : subject.key === effectivePrimaryKey ? '#38bdf8' : 'rgba(157, 180, 211, 0.65)';
          const nameLabel = subject.face?.name || (subject.face ? 'ANALYZING...' : 'TRACKING');

          return (
            <div
              key={subject.key}
              data-subject={subject.key}
              aria-hidden="true"
              className="poi-target-container"
              style={{
                left: `${(left / vw) * 100}%`,
                top: `${(y / vh) * 100}%`,
                width: `${(w / vw) * 100}%`,
                height: `${(h / vh) * 100}%`
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
                  stroke={reticleColor}
                  strokeWidth="1.6"
                  strokeDasharray="4 3"
                  opacity="0.85"
                />
                {/* 4 Corner L-Brackets */}
                <path d="M 2 18 L 2 2 L 18 2" stroke={reticleColor} strokeWidth="3" strokeLinecap="square" fill="none" />
                <path d="M 82 2 L 98 2 L 98 18" stroke={reticleColor} strokeWidth="3" strokeLinecap="square" fill="none" />
                <path d="M 2 82 L 2 98 L 18 98" stroke={reticleColor} strokeWidth="3" strokeLinecap="square" fill="none" />
                <path d="M 82 98 L 98 98 L 98 82" stroke={reticleColor} strokeWidth="3" strokeLinecap="square" fill="none" />
                {/* Inward Center Ticks */}
                <line x1="50" y1="2" x2="50" y2="7" stroke={reticleColor} strokeWidth="2" />
                <line x1="50" y1="98" x2="50" y2="93" stroke={reticleColor} strokeWidth="2" />
                <line x1="2" y1="50" x2="7" y2="50" stroke={reticleColor} strokeWidth="2" />
                <line x1="98" y1="50" x2="93" y2="50" stroke={reticleColor} strokeWidth="2" />
              </svg>

              {/* Sub-reticle scanning sweep */}
              <div
                className="poi-face-scanline"
                style={{ background: `linear-gradient(180deg, transparent 0%, ${reticleColor}33 50%, transparent 100%)` }}
              />

              {/* Minimalist Name Badge */}
              <div
                className="live-detection-name-badge"
                style={{
                  borderColor: reticleColor,
                  color: reticleColor,
                  boxShadow: `0 0 14px ${reticleColor}33`
                }}
              >
                <span className="live-name-dot" style={{ background: reticleColor }} />
                <span className="live-name-text">{nameLabel.toUpperCase()}</span>
              </div>
            </div>
          );
        })}"""

assert old_block in c, 'old_block not found in SurveillanceViewfinder.tsx'
c = c.replace(old_block, new_block, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print('Successfully patched SurveillanceViewfinder.tsx with POI reticle')
