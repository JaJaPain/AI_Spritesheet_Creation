import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  Upload, 
  Play, 
  Pause, 
  Check, 
  Download, 
  Scissors, 
  Trash2, 
  Layers,
  Settings2,
  ChevronRight,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const API_BASE = "http://localhost:8000";

function App() {
  const [projectId, setProjectId] = useState(null);
  const [frames, setFrames] = useState([]);
  const [selectedFrames, setSelectedFrames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(12);
  const [bgRemovedFrames, setBgRemovedFrames] = useState({}); // { frameName: processedUrl }
  const [frameOffsets, setFrameOffsets] = useState({}); // { frameName: { x, y } }
  const [onionSkin, setOnionSkin] = useState(false);
  const [useProcessed, setUseProcessed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [spritesheetUrl, setSpritesheetUrl] = useState(null);

  const fileInputRef = useRef(null);

  // Handle Video Upload
  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_BASE}/upload-video`, formData);
      setProjectId(res.data.project_id);
      setFrames(res.data.frames);
      setSelectedFrames(res.data.frames.map(f => f.name));
      
      // Initialize offsets
      const initialOffsets = {};
      res.data.frames.forEach(f => initialOffsets[f.name] = { x: 0, y: 0 });
      setFrameOffsets(initialOffsets);
      
      setLoading(false);
    } catch (err) {
      console.error("Upload failed", err);
      setLoading(false);
      alert("Failed to extract frames. Make sure the backend is running.");
    }
  };

  const nudgeFrame = (dir, amount = 1) => {
    const currentFrame = selectedFrames[previewIndex];
    if (!currentFrame) return;

    setFrameOffsets(prev => {
      const current = prev[currentFrame] || { x: 0, y: 0 };
      const next = { ...current };
      if (dir === 'up') next.y -= amount;
      if (dir === 'down') next.y += amount;
      if (dir === 'left') next.x -= amount;
      if (dir === 'right') next.x += amount;
      return { ...prev, [currentFrame]: next };
    });
  };

  // Toggle Frame Selection
  const toggleFrame = (name) => {
    setSelectedFrames(prev => {
      const newSelection = prev.includes(name) ? prev.filter(f => f !== name) : [...prev, name];
      // Reset preview index if needed
      if (previewIndex >= newSelection.length) setPreviewIndex(0);
      return newSelection;
    });
  };

  // Background Removal Logic
  const handleRemoveBg = async (frameName) => {
    if (bgRemovedFrames[frameName]) return;

    try {
      const formData = new FormData();
      formData.append('project_id', projectId);
      formData.append('frame_name', frameName);
      
      const res = await axios.post(`${API_BASE}/remove-bg`, formData);
      setBgRemovedFrames(prev => ({
        ...prev,
        [frameName]: res.data.processed_url
      }));
    } catch (err) {
      console.error("BG Removal failed", err);
    }
  };

  // Animation Playback Logic
  useEffect(() => {
    let interval;
    if (isPlaying && selectedFrames.length > 0) {
      interval = setInterval(() => {
        setPreviewIndex(prev => (prev + 1) % selectedFrames.length);
      }, 1000 / fps);
    }
    return () => clearInterval(interval);
  }, [isPlaying, selectedFrames, fps]);

  // Export Spritesheet
  const handleExport = async () => {
    if (selectedFrames.length === 0) return;
    
    setExporting(true);
    try {
      const formData = new FormData();
      formData.append('project_id', projectId);
      formData.append('frame_names', JSON.stringify(selectedFrames));
      formData.append('use_processed', useProcessed);
      formData.append('offsets', JSON.stringify(frameOffsets));

      const res = await axios.post(`${API_BASE}/export-spritesheet`, formData);
      setSpritesheetUrl(`${API_BASE}${res.data.url}`);
    } catch (err) {
      console.error("Export failed", err);
    }
    setExporting(false);
  };

  const currentPreviewFrame = selectedFrames[previewIndex];
  const previewImgSrc = useProcessed && bgRemovedFrames[currentPreviewFrame] 
    ? `${API_BASE}${bgRemovedFrames[currentPreviewFrame]}`
    : frames.find(f => f.name === currentPreviewFrame)?.path 
      ? `${API_BASE}${frames.find(f => f.name === currentPreviewFrame).path}`
      : null;

  const getFrameUrl = (name) => {
    const isBgRemoved = !!bgRemovedFrames[name];
    const frame = frames.find(f => f.name === name);
    if (!frame) return null;
    return (useProcessed && isBgRemoved) 
      ? `${API_BASE}${bgRemovedFrames[name]}` 
      : `${API_BASE}${frame.path}`;
  };

  return (
    <div className="app-container">
      <header>
        <div className="logo-area">
          <h1>SpriteForge</h1>
          <p>AI Frame Extraction & Stabilization Studio</p>
        </div>
        <div className="header-actions">
          {projectId && (
            <button className="btn btn-outline" onClick={() => window.location.reload()}>
              <Trash2 size={18} /> New Project
            </button>
          )}
        </div>
      </header>

      {!projectId ? (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card upload-section"
        >
          <div className="upload-zone" onClick={() => fileInputRef.current.click()}>
            {loading ? (
              <div className="loading-container">
                <div className="loading-spinner"></div>
                <p style={{ marginTop: '1rem' }}>Extracting frames... this might take a minute.</p>
              </div>
            ) : (
              <>
                <Upload size={48} color="var(--primary)" style={{ marginBottom: '1rem' }} />
                <h2>Drop your MP4 here</h2>
                <p>Drag and drop or click to browse</p>
              </>
            )}
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleUpload} 
            style={{ display: 'none' }} 
            accept="video/mp4,video/quicktime"
          />
        </motion.div>
      ) : (
        <div className="workspace">
          <div className="main-content">
            <div className="glass-card preview-window" style={{ position: 'relative' }}>
              {/* Onion Skin Layers */}
              {onionSkin && selectedFrames.length > 0 && (
                <div className="onion-skin-container" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {selectedFrames.map((name, i) => {
                    if (name === currentPreviewFrame) return null;
                    const offset = frameOffsets[name] || { x: 0, y: 0 };
                    return (
                      <img 
                        key={`onion-${name}`}
                        src={getFrameUrl(name)} 
                        alt="" 
                        style={{ 
                          position: 'absolute', 
                          opacity: 0.15,
                          transform: `translate(${offset.x}px, ${offset.y}px)`,
                          width: 'auto',
                          height: 'auto',
                          maxWidth: '100%',
                          maxHeight: '100%',
                          left: '50%',
                          top: '50%',
                          marginTop: '-25%', // rough centering, improve with layout
                          marginLeft: '-25%'
                        }} 
                      />
                    );
                  })}
                </div>
              )}

              {previewImgSrc ? (
                <div className="current-frame-container" style={{ zIndex: 2, position: 'relative' }}>
                  <img 
                    src={previewImgSrc} 
                    alt="Preview" 
                    key={previewImgSrc} 
                    style={{ 
                      transform: `translate(${frameOffsets[currentPreviewFrame]?.x || 0}px, ${frameOffsets[currentPreviewFrame]?.y || 0}px)`
                    }}
                  />
                </div>
              ) : (
                <div className="no-selection">
                  <Play size={48} color="var(--text-dim)" />
                  <p>Select frames to preview animation</p>
                </div>
              )}
              
              <div className="preview-controls-overlay">
                <button 
                  className="btn btn-primary" 
                  onClick={() => setIsPlaying(!isPlaying)}
                  style={{ borderRadius: '50%', width: '50px', height: '50px' }}
                >
                  {isPlaying ? <Pause /> : <Play />}
                </button>
              </div>
            </div>

            <div className="frame-grid-container">
              <div className="grid-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>Extracted Frames ({frames.length})</h3>
                <div className="selection-stats">
                  <span>{selectedFrames.length} selected</span>
                </div>
              </div>
              
              <div className="frame-grid">
                {frames.map((frame, idx) => {
                  const isSelected = selectedFrames.includes(frame.name);
                  const isBgRemoved = !!bgRemovedFrames[frame.name];
                  const displayUrl = (useProcessed && isBgRemoved) 
                    ? `${API_BASE}${bgRemovedFrames[frame.name]}` 
                    : `${API_BASE}${frame.path}`;

                  return (
                    <motion.div 
                      key={frame.name}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={`frame-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleFrame(frame.name)}
                    >
                      <img src={displayUrl} alt={frame.name} loading="lazy" />
                      <div className="frame-overlay">
                        <Check size={14} strokeWidth={3} />
                      </div>
                      
                      <div className="frame-actions" onClick={(e) => e.stopPropagation()}>
                        <button 
                          className={`bg-toggle ${isBgRemoved ? 'active' : ''}`}
                          onClick={() => handleRemoveBg(frame.name)}
                          title="Remove Background"
                          style={{ 
                            color: isBgRemoved ? 'var(--success)' : 'white',
                            borderColor: isBgRemoved ? 'var(--success)' : 'var(--border)'
                          }}
                        >
                          {isBgRemoved ? <Zap size={10} fill="currentColor" /> : <Scissors size={10} />}
                        </button>
                      </div>
                      
                      <div className="frame-index">{idx}</div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>

          <aside className="controls-panel">
            <div className="glass-card">
              <h3>Controls</h3>
              
              <div className="control-group" style={{ marginTop: '1.5rem' }}>
                <label>Stabilization</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="toggle-container" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <input 
                      type="checkbox" 
                      id="onionSkin" 
                      checked={onionSkin} 
                      onChange={(e) => setOnionSkin(e.target.checked)}
                    />
                    <label htmlFor="onionSkin" style={{ textTransform: 'none', cursor: 'pointer' }}>
                      Onion Skinning
                    </label>
                  </div>

                  <div className="dpad-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Nudge Current Frame</div>
                    <button className="btn btn-outline nudge-btn" onClick={() => nudgeFrame('up')}><ChevronRight style={{ transform: 'rotate(-90deg)' }} size={16} /></button>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn-outline nudge-btn" onClick={() => nudgeFrame('left')}><ChevronRight style={{ transform: 'rotate(180deg)' }} size={16} /></button>
                      <button className="btn btn-outline nudge-btn" onClick={() => nudgeFrame('down')}><ChevronRight style={{ transform: 'rotate(90deg)' }} size={16} /></button>
                      <button className="btn btn-outline nudge-btn" onClick={() => nudgeFrame('right')}><ChevronRight size={16} /></button>
                    </div>
                    <div style={{ fontSize: '0.6rem', opacity: 0.5 }}>X: {frameOffsets[currentPreviewFrame]?.x || 0} Y: {frameOffsets[currentPreviewFrame]?.y || 0}</div>
                  </div>
                </div>
              </div>

              <div className="control-group" style={{ marginTop: '1.5rem' }}>
                <label>Animation Speed</label>
                <div className="slider-container">
                  <input 
                    type="range" 
                    min="1" 
                    max="60" 
                    value={fps} 
                    onChange={(e) => setFps(parseInt(e.target.value))}
                  />
                  <span className="value-badge">{fps} FPS</span>
                </div>
              </div>

              <div className="control-group" style={{ marginTop: '1.5rem' }}>
                <label>Processing</label>
                <div className="toggle-container" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <input 
                    type="checkbox" 
                    id="useProcessed" 
                    checked={useProcessed} 
                    onChange={(e) => setUseProcessed(e.target.checked)}
                  />
                  <label htmlFor="useProcessed" style={{ textTransform: 'none', cursor: 'pointer' }}>
                    Use BG Removed Frames
                  </label>
                </div>
              </div>

              <div className="control-group" style={{ marginTop: '2rem' }}>
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%' }}
                  onClick={handleExport}
                  disabled={exporting || selectedFrames.length === 0}
                >
                  {exporting ? (
                    <div className="loading-spinner" style={{ width: '18px', height: '18px' }}></div>
                  ) : (
                    <>
                      <Layers size={18} />
                      Send to Sprite Sheet
                    </>
                  )}
                </button>
              </div>

              {spritesheetUrl && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="export-result"
                  style={{ marginTop: '1.5rem', textAlign: 'center' }}
                >
                  <p style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>Ready to Download!</p>
                  <a 
                    href={spritesheetUrl} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="btn btn-outline"
                    style={{ width: '100%', borderColor: 'var(--success)', color: 'var(--success)' }}
                    download
                  >
                    <Download size={18} /> Download Result
                  </a>
                </motion.div>
              )}
            </div>

            <div className="glass-card help-card" style={{ padding: '1.5rem' }}>
              <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Pro Tips</h4>
              <ul style={{ fontSize: '0.8rem', color: 'var(--text-dim)', paddingLeft: '1.2rem' }}>
                <li>Click frames to toggle selection for animation.</li>
                <li>Use the <Scissors size={10} /> icon for AI BG removal.</li>
                <li>Adjust speed dial for the perfect loop.</li>
              </ul>
            </div>
          </aside>
        </div>
      )}

      <style jsx>{`
        .preview-controls-overlay {
          position: absolute;
          bottom: 2rem;
          left: 50%;
          transform: translateX(-50%);
        }
        .frame-index {
          position: absolute;
          bottom: 0.5rem;
          right: 0.5rem;
          font-size: 0.6rem;
          opacity: 0.5;
        }
        .value-badge {
          background: var(--primary);
          padding: 0.2rem 0.5rem;
          border-radius: 0.4rem;
          font-size: 0.75rem;
          min-width: 50px;
          text-align: center;
        }
        .toggle-container input {
          width: 20px;
          height: 20px;
        }
        .bg-toggle {
          cursor: pointer;
          transition: all 0.2s;
        }
        .bg-toggle:hover {
          transform: scale(1.1);
          background: rgba(255,255,255,0.1);
        }
        .bg-toggle.active {
          background: rgba(16, 185, 129, 0.1);
        }
      `}</style>
    </div>
  );
}

export default App;
