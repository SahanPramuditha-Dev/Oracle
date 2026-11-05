with open('frontend/src/components/InitializationOverlay.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Add isMirrored state in OpticalCard if not present
if 'const [isMirrored, setIsMirrored] = useState(false);' not in code:
    code = code.replace(
        'const [isLocked, setIsLocked] = useState(false);',
        'const [isLocked, setIsLocked] = useState(false);\n  const [isMirrored, setIsMirrored] = useState(false);'
    )

# Fix NeuralCard JSX to use model & detail
old_neural_block = '''      <div className="card-hero-block">
        <div className="card-hero-title">Neural Inference Engine</div>
        <div className="card-hero-sub">Local Cluster • Qwen 2.5 1.5B</div>
      </div>'''

new_neural_block = '''      <div className="card-hero-block">
        <div className="card-hero-title">{model}</div>
        <div className="card-hero-sub">{detail}</div>
      </div>'''

code = code.replace(old_neural_block, new_neural_block)

# Fix DatabaseCard JSX to use dbStorage & migrationVersion
old_db_block = '''      <div className="card-hero-block">
        <div className="card-hero-title">PostgreSQL Biometric Vault</div>
        <div className="card-hero-sub">Relational Engine • Vector Database</div>
      </div>'''

new_db_block = '''      <div className="card-hero-block">
        <div className="card-hero-title">{dbStorage} Biometric Vault</div>
        <div className="card-hero-sub">
          {queryLatency !== null ? `Query Latency: ${queryLatency}ms` : 'Testing Relational & Vector Integrity...'}
        </div>
      </div>'''

code = code.replace(old_db_block, new_db_block)

old_db_spec = '''        <div className="spec-cell">
          <span className="spec-key">Encryption</span>
          <span className="spec-val">AES-256</span>
        </div>'''

new_db_spec = '''        <div className="spec-cell">
          <span className="spec-key">Migration</span>
          <span className="spec-val" title={migrationVersion}>{migrationVersion || 'v1.0.0'}</span>
        </div>'''

code = code.replace(old_db_spec, new_db_spec)

# Fix AcousticCard to use frequencyRange
old_acoustic_spec = '''        <div className="spec-cell">
          <span className="spec-key">Noise Floor</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : 'inherit' }}>
            {noiseFloor}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Sample Rate</span>
          <span className="spec-val">{sampleRate}</span>
        </div>'''

new_acoustic_spec = '''        <div className="spec-cell">
          <span className="spec-key">Noise Floor</span>
          <span className="spec-val" style={{ color: isLocked ? '#22c55e' : 'inherit' }}>
            {noiseFloor}
          </span>
        </div>
        <div className="spec-cell">
          <span className="spec-key">Range</span>
          <span className="spec-val">{frequencyRange}</span>
        </div>'''

code = code.replace(old_acoustic_spec, new_acoustic_spec)

with open('frontend/src/components/InitializationOverlay.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Applied fixes")
