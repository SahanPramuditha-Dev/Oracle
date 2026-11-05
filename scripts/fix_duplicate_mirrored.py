with open('frontend/src/components/InitializationOverlay.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Clean up duplicate isMirrored in NeuralCard, DatabaseCard, AcousticCard
cleaned_lines = []
in_optical = False
for line in lines:
    if 'const OpticalCard: React.FC' in line:
        in_optical = True
    if not in_optical and 'const [isMirrored, setIsMirrored] = useState(false);' in line:
        continue
    cleaned_lines.append(line)

code = ''.join(cleaned_lines)

# In AcousticCard, restore sampleRate in spec-val
old_acoustic_cell = '''        <div className="spec-cell">
          <span className="spec-key">Range</span>
          <span className="spec-val">{frequencyRange}</span>
        </div>'''

new_acoustic_cell = '''        <div className="spec-cell">
          <span className="spec-key">Sample Rate</span>
          <span className="spec-val">{sampleRate} ({frequencyRange})</span>
        </div>'''

code = code.replace(old_acoustic_cell, new_acoustic_cell)

with open('frontend/src/components/InitializationOverlay.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Fixed duplicate isMirrored and restored sampleRate")
