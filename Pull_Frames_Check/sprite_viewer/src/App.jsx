import React, { useState, useEffect, useRef } from 'react';
import { Upload, Play, Gauge, Box, Maximize, Smartphone, Monitor, LayoutGrid } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function App() {
  const [spriteUrl, setSpriteUrl] = useState(null);
  const [fps, setFps] = useState(12);
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);
  const [totalFrames, setTotalFrames] = useState(1);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [columns, setColumns] = useState(8);
  const [rows, setRows] = useState(1);
  
  const fileInputRef = useRef(null);
  const animationRef = useRef(null);
  const lastUpdateRef = useRef(0);

  // Handle Animation Loop
  useEffect(() => {
    if (!spriteUrl || totalFrames <= 1) return;

    const animate = (time) => {
      if (time - lastUpdateRef.current > 1000 / fps) {
        setCurrentFrame(prev => (prev + 1) % totalFrames);
        lastUpdateRef.current = time;
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [spriteUrl, fps, totalFrames]);

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const fw = img.width / columns;
        const fr = Math.floor(img.height / fw); // Assuming square or based on width
        setFrameWidth(fw);
        setFrameHeight(fw); // Default to width, but calculate rows properly
        const calculatedRows = Math.floor(img.height / fw);
        setRows(calculatedRows);
        setTotalFrames(columns * calculatedRows);
        setSpriteUrl(event.target.result);
        setCurrentFrame(0);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const row = Math.floor(currentFrame / columns);
  const col = currentFrame % columns;

  const SpritePreview = ({ scale, label, icon: Icon }) => {
    const displayWidth = frameWidth * scale;
    const displayHeight = frameHeight * scale;
    
    return (
      <div className="preview-card">
        <div className="preview-label">
          <Icon size={12} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
          {label}
        </div>
        <div 
          className="sprite-display"
          style={{
            width: `${displayWidth}px`,
            height: `${displayHeight}px`,
            backgroundImage: `url(${spriteUrl})`,
            backgroundSize: `${frameWidth * columns * scale}px ${frameHeight * rows * scale}px`,
            backgroundPosition: `-${col * displayWidth}px -${row * displayHeight}px`,
          }}
        />
        <div style={{ marginTop: 'auto', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
          Rendered at {Math.round(displayHeight)}px
        </div>
      </div>
    );
  };

  return (
    <div className="app-container">
      <aside>
        <div className="logo-area">
          <h1>SpriteForge</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>Animation Laboratory</p>
        </div>

        <div className="control-group">
          <button className="upload-btn" onClick={() => fileInputRef.current.click()}>
            <Upload size={20} />
            Upload Spritesheet
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleUpload} 
            style={{ display: 'none' }} 
            accept="image/png" 
          />
        </div>

        <div className="control-group">
          <label><Gauge size={16} /> Playback Speed <span className="value-badge">{fps} FPS</span></label>
          <input 
            type="range" 
            min="1" 
            max="60" 
            value={fps} 
            onChange={(e) => setFps(parseInt(e.target.value))} 
          />
        </div>

        <div className="control-group">
          <label><LayoutGrid size={16} /> Grid Columns <span className="value-badge">{columns}</span></label>
          <input 
            type="range" 
            min="1" 
            max="16" 
            value={columns} 
            onChange={(e) => setColumns(parseInt(e.target.value))} 
          />
        </div>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
            {spriteUrl ? (
              <>
                Detected {totalFrames} frames<br/>
                {columns} columns x {rows} rows
              </>
            ) : 'Ready to analyze assets...'}
          </div>
        </div>
      </aside>

      <main>
        {!spriteUrl ? (
          <div className="empty-state">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Box size={64} style={{ marginBottom: '1.5rem', opacity: 0.2 }} />
              <h2>Awaiting Animation Input</h2>
              <p style={{ marginTop: '1rem' }}>Upload an 8-column PNG to begin simulation.</p>
            </motion.div>
          </div>
        ) : (
          <div className="preview-grid">
            <SpritePreview scale={0.25} label="UI / Icon (0.25x)" icon={Smartphone} />
            <SpritePreview scale={0.5} label="Mobile / SD (0.5x)" icon={Smartphone} />
            <SpritePreview scale={1} label="Desktop / HD (1x)" icon={Monitor} />
            <SpritePreview scale={2} label="Hero / Boss (2x)" icon={Maximize} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
