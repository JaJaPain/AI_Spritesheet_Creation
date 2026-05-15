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
  const fpsRef = useRef(fps);
  const totalFramesRef = useRef(totalFrames);

  // Keep refs in sync
  useEffect(() => { fpsRef.current = fps; }, [fps]);
  useEffect(() => { totalFramesRef.current = totalFrames; }, [totalFrames]);

  // Handle Animation Loop — uses refs so it never needs to restart
  useEffect(() => {
    if (!spriteUrl) return;

    const animate = (time) => {
      const curFps = fpsRef.current;
      const curTotal = totalFramesRef.current;
      if (curTotal > 1 && time - lastUpdateRef.current > 1000 / curFps) {
        setCurrentFrame(prev => (prev + 1) % curTotal);
        lastUpdateRef.current = time;
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [spriteUrl]);

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const fw = img.width / columns;
        
        // Scan first cell column to detect row count from content bands.
        // BG-removed sprites have transparent gaps between rows of characters.
        const scanCanvas = document.createElement('canvas');
        scanCanvas.width = fw;
        scanCanvas.height = img.height;
        const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
        scanCtx.drawImage(img, 0, 0, fw, img.height, 0, 0, fw, img.height);
        const scanData = scanCtx.getImageData(0, 0, fw, img.height);
        
        // Check each pixel row for any non-transparent content
        const rowHasContent = [];
        for (let y = 0; y < img.height; y++) {
          let found = false;
          for (let x = 0; x < fw; x++) {
            const idx = (y * fw + x) * 4;
            if (scanData.data[idx + 3] > 10) {
              found = true;
              break;
            }
          }
          rowHasContent.push(found);
        }
        
        // Find content bands (start/end of consecutive content rows)
        const bands = [];
        let bandStart = -1;
        for (let y = 0; y < img.height; y++) {
          if (rowHasContent[y] && bandStart === -1) {
            bandStart = y;
          } else if (!rowHasContent[y] && bandStart !== -1) {
            bands.push({ start: bandStart, end: y });
            bandStart = -1;
          }
        }
        if (bandStart !== -1) bands.push({ start: bandStart, end: img.height });
        
        // Merge bands with small gaps (handles transparency within a character)
        const MIN_GAP = Math.max(20, img.height * 0.02);
        const merged = [{ ...bands[0] }];
        for (let i = 1; i < bands.length; i++) {
          const prev = merged[merged.length - 1];
          if (bands[i].start - prev.end < MIN_GAP) {
            prev.end = bands[i].end;
          } else {
            merged.push({ ...bands[i] });
          }
        }
        
        // Each merged band = one row of characters
        let detectedRows = merged.length;
        let fh;
        
        // Verify against image height divisibility
        if (detectedRows > 0 && img.height % detectedRows === 0) {
          fh = img.height / detectedRows;
        } else if (detectedRows > 1) {
          // Use average band-start distance as cell height
          const diffs = [];
          for (let i = 1; i < merged.length; i++) {
            diffs.push(merged[i].start - merged[i - 1].start);
          }
          const avgH = diffs.reduce((a, b) => a + b, 0) / diffs.length;
          detectedRows = Math.round(img.height / avgH);
          fh = img.height / detectedRows;
        } else {
          fh = img.height;
          detectedRows = 1;
        }
        
        setFrameWidth(fw);
        setFrameHeight(fh);
        setRows(detectedRows);
        setTotalFrames(columns * detectedRows);
        setSpriteUrl(event.target.result);
        setCurrentFrame(0);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const row = Math.floor(currentFrame / columns);
  const col = currentFrame % columns;

  const renderPreview = (scale, label, Icon) => {
    const displayWidth = frameWidth * scale;
    const displayHeight = frameHeight * scale;
    
    return (
      <div className="preview-card" key={label}>
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
            {renderPreview(0.25, 'UI / Icon (0.25x)', Smartphone)}
            {renderPreview(0.5, 'Mobile / SD (0.5x)', Smartphone)}
            {renderPreview(1, 'Desktop / HD (1x)', Monitor)}
            {renderPreview(2, 'Hero / Boss (2x)', Maximize)}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
