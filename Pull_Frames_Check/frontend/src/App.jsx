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
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Zap,
  RotateCcw,
  Plus,
  Minus,
  Move,
  Save,
  X,
  Eraser,
  Sparkles,
  Square,
  PenTool,
  Droplet
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const API_BASE = "http://127.0.0.1:8000";

const SurgicalStudio = ({ 
  projectId, 
  frameName, 
  initialUrl, 
  onSave, 
  onCancel,
  showGuides,
  setShowGuides,
  guidePos,
  setGuidePos,
  whiteBg,
  setWhiteBg
}) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [undoStack, setUndoStack] = useState([]);
  const [isPanning, setIsPanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tool, setTool] = useState('eraser'); // 'eraser', 'graft', or 'lasso'
  const [graftSource, setGraftSource] = useState(null); // { canvas, width, height, x, y }
  const [selection, setSelection] = useState(null); // { x, y, w, h }
  const [lassoPoints, setLassoPoints] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [graftRotation, setGraftRotation] = useState(0);
  const [graftZOrder, setGraftZOrder] = useState('front'); // 'front' or 'back'
  const [graftFlipH, setGraftFlipH] = useState(false);
  const [graftFlipV, setGraftFlipV] = useState(false);
  const [smudgeStrength, setSmudgeStrength] = useState(0.5);
  const lastDrawPos = useRef(null);
  
  const lastPos = useRef({ x: 0, y: 0 });
  const [isDraggingGuides, setIsDraggingGuides] = useState(false);

  const handleStudioGuideMove = (e) => {
    if (!isDraggingGuides || !showGuides) return;
    const pos = getMousePos(e);
    setGuidePos(pos);
  };

  const startSelection = (e) => {
    const pos = getMousePos(e);
    if (tool === 'graft' && !graftSource) {
      setSelection({ x: pos.x, y: pos.y, w: 0, h: 0 });
      setIsSelecting(true);
    } else if (tool === 'lasso' && !graftSource) {
      // If clicking near the first point, close the path
      if (lassoPoints.length > 2) {
        const start = lassoPoints[0];
        const dist = Math.sqrt(Math.pow(pos.x - start.x, 2) + Math.pow(pos.y - start.y, 2));
        if (dist < 10 / zoom) {
          endLasso();
          return;
        }
      }
      setLassoPoints(prev => [...prev, pos]);
    }
  };

  const endLasso = () => {
    if (lassoPoints.length < 3) return;
    
    const canvas = canvasRef.current;
    // Find bounding box
    const minX = Math.min(...lassoPoints.map(p => p.x));
    const maxX = Math.max(...lassoPoints.map(p => p.x));
    const minY = Math.min(...lassoPoints.map(p => p.y));
    const maxY = Math.max(...lassoPoints.map(p => p.y));
    const w = maxX - minX;
    const h = maxY - minY;

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = w;
    sourceCanvas.height = h;
    const sCtx = sourceCanvas.getContext('2d');
    
    // Draw mask
    sCtx.beginPath();
    lassoPoints.forEach((p, i) => {
      if (i === 0) sCtx.moveTo(p.x - minX, p.y - minY);
      else sCtx.lineTo(p.x - minX, p.y - minY);
    });
    sCtx.closePath();
    sCtx.clip();
    
    // Draw the actual image content into the masked area
    sCtx.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
    
    setGraftSource({ canvas: sourceCanvas, w, h });
    setLassoPoints([]);
  };

  const updateSelection = (e) => {
    if (!isSelecting) return;
    const pos = getMousePos(e);
    setSelection(prev => ({
      ...prev,
      w: pos.x - prev.x,
      h: pos.y - prev.y
    }));
  };

  const endSelection = () => {
    if (!isSelecting) return;
    setIsSelecting(false);
    
    // Capture the selected area
    const canvas = canvasRef.current;
    const { x, y, w, h } = selection;
    if (Math.abs(w) < 5 || Math.abs(h) < 5) {
      setSelection(null);
      return;
    }

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = Math.abs(w);
    sourceCanvas.height = Math.abs(h);
    const sCtx = sourceCanvas.getContext('2d');
    
    // Handle negative width/height from dragging backwards
    const sourceX = w > 0 ? x : x + w;
    const sourceY = h > 0 ? y : y + h;
    
    sCtx.drawImage(canvas, sourceX, sourceY, Math.abs(w), Math.abs(h), 0, 0, Math.abs(w), Math.abs(h));
    setGraftSource({ canvas: sourceCanvas, w: Math.abs(w), h: Math.abs(h) });
    setSelection(null);
  };

  const handleGraftStamp = (e) => {
    if (tool !== 'graft' || !graftSource) return;
    const pos = getMousePos(e);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Draw the graft centered on click
    ctx.save();
    
    if (graftZOrder === 'back') {
      ctx.globalCompositeOperation = 'destination-over';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.translate(pos.x, pos.y);
    ctx.rotate(graftRotation * Math.PI / 180);
    ctx.scale(graftFlipH ? -1 : 1, graftFlipV ? -1 : 1);
    ctx.drawImage(graftSource.canvas, -graftSource.w/2, -graftSource.h/2);
    
    ctx.restore();
    saveState();
  };

  const handleDehalo = async () => {
    setIsProcessing(true);
    try {
      const dataUrl = canvasRef.current.toDataURL();
      const formData = new FormData();
      formData.append('image_data', dataUrl);
      
      const res = await axios.post(`${API_BASE}/dehalo`, formData);
      const img = new Image();
      img.src = res.data.image_data;
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        saveState();
        setIsProcessing(false);
      };
    } catch (err) {
      console.error("Dehalo failed", err);
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    if (!initialUrl) return;
    
    setIsLoading(true);
    setError(null);
    
    // Add a cache buster to force a fresh load with correct CORS headers
    const busterUrl = `${initialUrl}${initialUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
    
    const img = new Image();
    // We'll use fetch to get the blob first. This gives us better error reporting
    // and bypasses some browser-specific image caching issues with CORS.
    fetch(busterUrl)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob);
        img.onload = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;

          const ctx = canvas.getContext('2d');
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          saveState();
          
          const container = containerRef.current;
          if (container) {
            const hRatio = (container.clientHeight * 0.8) / img.height;
            const wRatio = (container.clientWidth * 0.8) / img.width;
            setZoom(Math.min(hRatio, wRatio, 1));
          }
          setIsLoading(false);
          URL.revokeObjectURL(objectUrl);
        };
        img.src = objectUrl;
      })
      .catch(err => {
        console.error("Studio load error:", err);
        setError(`Failed to load frame: ${err.message}. Ensure backend is running at ${API_BASE}`);
        setIsLoading(false);
      });
  }, [initialUrl]);

  const saveState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setUndoStack(prev => [...prev, canvas.toDataURL()]);
  };

  const undo = () => {
    if (undoStack.length <= 1) return;
    const newStack = [...undoStack];
    newStack.pop(); // Remove current
    const prevState = newStack[newStack.length - 1];
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = prevState;
    img.onload = () => {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      setUndoStack(newStack);
    };
  };

  const getMousePos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    };
  };

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const onMouseDown = (e) => {
    if (isLoading || error) return;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      lastPos.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (tool === 'graft' || tool === 'lasso') {
      if (!graftSource) {
        startSelection(e);
      } else {
        handleGraftStamp(e);
      }
      return;
    }
    setIsDrawing(true);
    const pos = getMousePos(e);
    lastDrawPos.current = pos;
    if (tool === 'eraser') draw(pos.x, pos.y);
  };

  const onDoubleClick = (e) => {
    if (tool === 'lasso' && !graftSource) {
      endLasso();
    }
  };

  const onMouseMove = (e) => {
    const pos = getMousePos(e);
    setMousePos(pos);

    if (isPanning) {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPos.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (isSelecting) {
      updateSelection(e);
      return;
    }
    if (!isDrawing) return;
    if (isDraggingGuides) {
      handleStudioGuideMove(e);
      return;
    }
    if (tool === 'eraser') {
      draw(pos.x, pos.y);
    } else if (tool === 'smudge') {
      smudge(pos.x, pos.y);
    }
    lastDrawPos.current = pos;
  };

  const onMouseUp = () => {
    if (isDrawing) saveState();
    setIsDrawing(false);
    setIsPanning(false);
    setIsDraggingGuides(false);
    if (isSelecting) endSelection();
    lastDrawPos.current = null;
  };

  const draw = (x, y) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    const radius = (brushSize / 2) / zoom;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const smudge = (x, y) => {
    if (!lastDrawPos.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const px = lastDrawPos.current.x;
    const py = lastDrawPos.current.y;
    
    // Brush size in canvas space
    const size = brushSize / zoom;
    
    ctx.save();
    // Clip to circular brush
    ctx.beginPath();
    ctx.arc(x, y, size/2, 0, Math.PI * 2);
    ctx.clip();
    
    // Move pixels from previous position to current
    ctx.globalAlpha = smudgeStrength;
    ctx.drawImage(
      canvas, 
      px - size/2, py - size/2, size, size, 
      x - size/2, y - size/2, size, size
    );
    ctx.restore();
  };

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.min(Math.max(prev * delta, 0.05), 20));
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.key === '[') setBrushSize(prev => Math.max(prev - 2, 1));
      if (e.key === ']') setBrushSize(prev => Math.min(prev + 2, 200));
      if (e.key === 'r') setGraftRotation(prev => (prev + 5) % 360);
      if (e.key === 'R') setGraftRotation(prev => (prev - 5 + 360) % 360);
      if (e.key === 'h') setGraftFlipH(prev => !prev);
      if (e.key === 'v') setGraftFlipV(prev => !prev);
      if (e.key === 'e') setTool('eraser');
      if (e.key === 's') setTool('smudge');
      if (e.key === 'g') setTool('graft');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack]);

  const handleSave = () => {
    const dataUrl = canvasRef.current.toDataURL();
    onSave(dataUrl);
  };

  return (
    <div className="surgical-studio-overlay" onContextMenu={(e) => e.preventDefault()} style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: '#050505', zIndex: 1000, display: 'flex', flexDirection: 'column'
    }}>
      <header style={{ 
        padding: '1rem 2rem', borderBottom: '1px solid var(--border)', 
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'var(--bg-dark)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Eraser size={24} color="var(--primary)" />
          <h3>Surgical Studio <span style={{ opacity: 0.5, fontSize: '0.8rem' }}>{frameName}</span></h3>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '0.8rem', padding: '0.3rem', gap: '0.5rem' }}>
            <button 
              className={`btn btn-icon ${tool === 'eraser' ? 'active' : ''}`} 
              onClick={() => setTool('eraser')}
              title="Eraser (E)"
              style={{ background: tool === 'eraser' ? 'var(--primary)' : 'transparent', border: 'none', color: 'white', padding: '0.4rem', borderRadius: '0.5rem', cursor: 'pointer' }}
            >
              <Eraser size={18} />
            </button>
            <button 
              className={`btn btn-icon ${tool === 'smudge' ? 'active' : ''}`} 
              onClick={() => setTool('smudge')}
              title="Smudge (S)"
              style={{ background: tool === 'smudge' ? 'var(--primary)' : 'transparent', border: 'none', color: 'white', padding: '0.4rem', borderRadius: '0.5rem', cursor: 'pointer' }}
            >
              <Droplet size={18} />
            </button>
            <button 
              className={`btn btn-icon ${tool === 'graft' ? 'active' : ''}`} 
              onClick={() => setTool('graft')}
              title="Rectangle Graft"
              style={{ background: tool === 'graft' ? 'var(--primary)' : 'transparent', border: 'none', color: 'white', padding: '0.4rem', borderRadius: '0.5rem', cursor: 'pointer' }}
            >
              <Square size={18} />
            </button>
            <button 
              className={`btn btn-icon ${tool === 'lasso' ? 'active' : ''}`} 
              onClick={() => setTool('lasso')}
              title="Lasso Graft (Click points, Double-click to close)"
              style={{ background: tool === 'lasso' ? 'var(--primary)' : 'transparent', border: 'none', color: 'white', padding: '0.4rem', borderRadius: '0.5rem', cursor: 'pointer' }}
            >
              <PenTool size={18} />
            </button>
          </div>

          <div style={{ width: 1, height: '2rem', background: 'var(--border)' }}></div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {graftSource && (
              <button 
                className="btn btn-outline" 
                onClick={() => {
                  localStorage.setItem('surgical_clipboard', graftSource.canvas.toDataURL());
                  localStorage.setItem('surgical_clipboard_meta', JSON.stringify({ w: graftSource.w, h: graftSource.h }));
                  alert("Selection saved to Surgical Clipboard!");
                }}
                style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
              >
                <Save size={16} /> Save to Clipboard
              </button>
            )}

            {!graftSource && localStorage.getItem('surgical_clipboard') && (
              <button 
                className="btn btn-outline" 
                onClick={() => {
                  const data = localStorage.getItem('surgical_clipboard');
                  const meta = JSON.parse(localStorage.getItem('surgical_clipboard_meta'));
                  const img = new Image();
                  img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = meta.w;
                    canvas.height = meta.h;
                    canvas.getContext('2d').drawImage(img, 0, 0);
                    setGraftSource({ canvas, w: meta.w, h: meta.h });
                    setTool('graft');
                  };
                  img.src = data;
                }}
                style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
              >
                <Layers size={16} /> Recall Clipboard
              </button>
            )}

            {(graftSource || lassoPoints.length > 0) && (
              <button className="btn btn-icon" onClick={() => { setGraftSource(null); setLassoPoints([]); }} style={{ color: 'var(--accent)' }}>
                <X size={18} />
              </button>
            )}
          </div>

          <button 
            className={`btn btn-outline ${showGuides ? 'active' : ''}`} 
            onClick={() => setShowGuides(!showGuides)} 
            style={{ borderColor: showGuides ? 'var(--primary)' : 'var(--border)', color: showGuides ? 'var(--primary)' : 'var(--text-dim)' }}
            title="Toggle Alignment Guides"
          >
            <Move size={18} />
          </button>

          <button 
            className={`btn btn-outline ${whiteBg ? 'active' : ''}`} 
            onClick={() => setWhiteBg(!whiteBg)} 
            style={{ borderColor: whiteBg ? '#ffffff' : 'var(--border)', color: whiteBg ? '#ffffff' : 'var(--text-dim)', minWidth: 'auto' }}
            title="Toggle White Background"
          >
            <Square size={18} fill={whiteBg ? '#ffffff' : 'none'} />
          </button>

          <button className="btn btn-outline" onClick={handleDehalo} disabled={isLoading || isProcessing} style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
            {isProcessing ? <div className="loading-spinner" style={{ width: 14, height: 14 }}></div> : <Sparkles size={18} />}
            De-Halo (2px)
          </button>
          <button className="btn btn-outline" onClick={undo} disabled={undoStack.length <= 1}>
            <RotateCcw size={18} /> Undo (Ctrl+Z)
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isLoading || !!error}>
            <Save size={18} /> Save & Return
          </button>
          <button className="btn btn-outline" onClick={onCancel} style={{ borderColor: '#ef4444', color: '#ef4444' }}>
            <X size={18} />
          </button>
        </div>
      </header>

      <div 
        ref={containerRef}
        className="studio-workspace" 
        style={{ 
          flex: 1, position: 'relative', overflow: 'hidden', 
          cursor: isPanning ? 'grabbing' : (isLoading ? 'wait' : (tool === 'eraser' ? 'crosshair' : 'copy')),
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
        onMouseDown={onMouseDown} 
        onMouseMove={onMouseMove} 
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        <div className="canvas-wrapper" style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center',
          transition: isPanning ? 'none' : 'transform 0.1s ease-out',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: isLoading ? 'none' : 'all',
          position: 'relative'
        }}>
          <div className="canvas-container" style={{ opacity: isLoading ? 0 : 1, position: 'relative' }}>
            <canvas ref={canvasRef} style={{ 
              background: whiteBg ? '#ffffff' : 'repeating-conic-gradient(#1e293b 0% 25%, #0f172a 0% 50%) 50% / 20px 20px',
              boxShadow: '0 0 100px rgba(0,0,0,0.8)',
              imageRendering: 'pixelated',
              transition: 'background 0.2s ease'
            }} />

            {showGuides && (
              <div 
                className="studio-guides-overlay"
                style={{ position: 'absolute', inset: 0, zIndex: 1200, pointerEvents: 'none' }}
              >
                <div className="guide-line-h" style={{ 
                  position: 'absolute', 
                  top: guidePos.y, 
                  left: 0, 
                  width: '100%', 
                  height: '1px', 
                  background: '#ff4444',
                  boxShadow: '0 0 8px rgba(255, 68, 68, 0.4)',
                }} />
                <div className="guide-line-v" style={{ 
                  position: 'absolute', 
                  left: guidePos.x, 
                  top: 0, 
                  width: '1px', 
                  height: '100%', 
                  background: '#ff4444',
                  boxShadow: '0 0 8px rgba(255, 68, 68, 0.4)',
                }} />
                <div className="guide-handle" style={{
                  position: 'absolute',
                  left: guidePos.x - 10,
                  top: guidePos.y - 10,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: '2px solid #ff4444',
                  background: isDraggingGuides ? '#ff4444' : 'rgba(255, 68, 68, 0.2)',
                  pointerEvents: 'all',
                  cursor: isDraggingGuides ? 'grabbing' : 'crosshair'
                }} onMouseDown={(e) => { e.stopPropagation(); setIsDraggingGuides(true); }} />
              </div>
            )}

            {/* Overlays */}
            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
              {selection && (
                <rect 
                  x={selection.w > 0 ? selection.x : selection.x + selection.w}
                  y={selection.h > 0 ? selection.y : selection.y + selection.h}
                  width={Math.abs(selection.w)}
                  height={Math.abs(selection.h)}
                  fill="rgba(99, 102, 241, 0.2)"
                  stroke="var(--primary)"
                  strokeWidth={2 / zoom}
                  strokeDasharray={`${4/zoom}, ${4/zoom}`}
                />
              )}
              {lassoPoints.length > 0 && (
                <g>
                  <polyline 
                    points={lassoPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="rgba(99, 102, 241, 0.2)"
                    stroke="var(--primary)"
                    strokeWidth={2 / zoom}
                  />
                  {/* Line to mouse */}
                  <line 
                    x1={lassoPoints[lassoPoints.length-1].x}
                    y1={lassoPoints[lassoPoints.length-1].y}
                    x2={mousePos.x}
                    y2={mousePos.y}
                    stroke="var(--primary)"
                    strokeWidth={1 / zoom}
                    strokeDasharray={`${4/zoom}, ${4/zoom}`}
                  />
                </g>
              )}
              {(tool === 'eraser' || tool === 'smudge') && !isPanning && (
                <circle cx={mousePos.x} cy={mousePos.y} r={(brushSize / 2) / zoom} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1 / zoom} />
              )}
            </svg>

            {/* Graft Ghost Preview (Rectangle or Lasso) */}
            {((tool === 'graft' || tool === 'lasso') && graftSource) && (
              <div style={{
                position: 'absolute',
                left: mousePos.x - graftSource.w/2,
                top: mousePos.y - graftSource.h/2,
                width: graftSource.w,
                height: graftSource.h,
                opacity: 0.6,
                pointerEvents: 'none'
              }}>
                <canvas 
                  ref={el => {
                    if (el && graftSource) {
                      el.width = graftSource.w;
                      el.height = graftSource.h;
                      const c = el.getContext('2d');
                      c.clearRect(0, 0, el.width, el.height);
                      c.drawImage(graftSource.canvas, 0, 0);
                    }
                  }}
                  style={{ 
                    width: '100%', 
                    height: '100%', 
                    imageRendering: 'pixelated',
                    transform: `rotate(${graftRotation}deg) scale(${graftFlipH ? -1 : 1}, ${graftFlipV ? -1 : 1})`,
                    opacity: graftZOrder === 'back' ? 0.4 : 0.8
                  }}
                />
              </div>
            )}
          </div>
        </div>

        </div>

        {error && (
          <div style={{ position: 'absolute', zIndex: 10, textAlign: 'center', color: '#ef4444' }}>
            <p>{error}</p>
            <button className="btn btn-outline" onClick={() => window.location.reload()} style={{ marginTop: '1rem' }}>Retry</button>
          </div>
        )}

        <div className="studio-tools" style={{
          position: 'absolute', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(30, 41, 59, 0.9)', backdropFilter: 'blur(12px)',
          padding: '1rem 2rem', borderRadius: '1rem', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: '2rem', zIndex: 1100,
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
        }}>
          <div className="tool-group">
            <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)' }}>Brush Size: {brushSize}px</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Minus size={14} onClick={() => setBrushSize(prev => Math.max(prev-5, 2))} style={{ cursor: 'pointer' }} />
              <input type="range" min="1" max="200" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} />
              <Plus size={14} onClick={() => setBrushSize(prev => Math.min(prev+5, 200))} style={{ cursor: 'pointer' }} />
            </div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border)', height: '30px' }}></div>
          {tool === 'smudge' && (
            <>
              <div className="tool-group">
                <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)' }}>Smudge Strength: {Math.round(smudgeStrength * 100)}%</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="range" min="0.05" max="1" step="0.05" value={smudgeStrength} onChange={(e) => setSmudgeStrength(parseFloat(e.target.value))} />
                </div>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', height: '30px' }}></div>
            </>
          )}
          <div className="tool-group" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem' }}>Zoom: {Math.round(zoom * 100)}%</div>
            <div style={{ fontSize: '0.6rem', opacity: 0.5 }}>
              {tool === 'graft' ? (!graftSource ? 'Drag to select source head' : 'Click to stamp head') : 'Wheel to Zoom | Mid-Click to Pan'}
            </div>
          </div>

          {graftSource && (
            <>
              <div style={{ borderLeft: '1px solid var(--border)', height: '30px' }}></div>
              <div className="tool-group">
                <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)' }}>Graft Rotation: {graftRotation}°</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <RotateCcw size={14} onClick={() => setGraftRotation(0)} style={{ cursor: 'pointer', marginRight: '0.5rem' }} title="Reset Rotation" />
                  <input type="range" min="0" max="360" value={graftRotation} onChange={(e) => setGraftRotation(parseInt(e.target.value))} />
                  <span style={{ fontSize: '0.6rem', opacity: 0.5 }}>'R' to rotate</span>
                </div>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', height: '30px' }}></div>
              <div className="tool-group">
                <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)' }}>Mirroring</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    className={`btn btn-icon ${graftFlipH ? 'active' : ''}`}
                    onClick={() => setGraftFlipH(prev => !prev)}
                    style={{ padding: '0.4rem', background: graftFlipH ? 'var(--primary)' : 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '0.3rem', color: 'white' }}
                    title="Flip Horizontal (H)"
                  >
                    <Move size={14} style={{ transform: 'rotate(90deg)' }} />
                  </button>
                  <button 
                    className={`btn btn-icon ${graftFlipV ? 'active' : ''}`}
                    onClick={() => setGraftFlipV(prev => !prev)}
                    style={{ padding: '0.4rem', background: graftFlipV ? 'var(--primary)' : 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '0.3rem', color: 'white' }}
                    title="Flip Vertical (V)"
                  >
                    <Move size={14} />
                  </button>
                </div>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', height: '30px' }}></div>
              <div className="tool-group">
                <label style={{ fontSize: '0.7rem', display: 'block', marginBottom: '0.5rem', color: 'var(--text-dim)' }}>Z-Order</label>
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '0.5rem', padding: '0.2rem' }}>
                  <button 
                    onClick={() => setGraftZOrder('front')} 
                    style={{ 
                      padding: '0.2rem 0.6rem', fontSize: '0.7rem', border: 'none', borderRadius: '0.3rem', 
                      background: graftZOrder === 'front' ? 'var(--primary)' : 'transparent',
                      color: 'white', cursor: 'pointer'
                    }}
                  >Front</button>
                  <button 
                    onClick={() => setGraftZOrder('back')} 
                    style={{ 
                      padding: '0.2rem 0.6rem', fontSize: '0.7rem', border: 'none', borderRadius: '0.3rem', 
                      background: graftZOrder === 'back' ? 'var(--primary)' : 'transparent',
                      color: 'white', cursor: 'pointer'
                    }}
                  >Behind</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
  );
};

function App() {
  const [projectId, setProjectId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [frames, setFrames] = useState([]);
  const [selectedFrames, setSelectedFrames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(12);
  const [bgRemovedFrames, setBgRemovedFrames] = useState({}); // { frameName: processedUrl }
  const [frameOffsets, setFrameOffsets] = useState({}); // { frameName: { x, y } }
  const [onionSkin, setOnionSkin] = useState(false);
  const [onionSkinDepth, setOnionSkinDepth] = useState(1); // How many frames before/after
  const [onionSkinOpacity, setOnionSkinOpacity] = useState(1); // Multiplier for onion skin opacity
  const [showGuides, setShowGuides] = useState(false);
  const [guidePos, setGuidePos] = useState({ x: 256, y: 256 });
  const [isDraggingGuides, setIsDraggingGuides] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [useProcessed, setUseProcessed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [spritesheetUrl, setSpritesheetUrl] = useState(null);
  const [studioFrame, setStudioFrame] = useState(null); // Frame name for manual editing
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [forceRerun, setForceRerun] = useState(false);
  const [imageSize, setImageSize] = useState({ w: 512, h: 512 }); // Natural size of frames
  const [whiteBg, setWhiteBg] = useState(false); // Toggleable white background for contrast

  const fileInputRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  const bulkRemoveBg = async () => {
    if (!projectId || frames.length === 0) return;
    setIsBulkProcessing(true);
    
    // Filter frames that actually need processing if not forcing
    const framesToProcess = forceRerun ? [...frames] : frames.filter(f => !bgRemovedFrames[f.name]);
    setBulkProgress({ current: 0, total: framesToProcess.length });

    if (framesToProcess.length === 0) {
      alert("No frames need processing. Use 'Force Rerun' if you want to redo them.");
      setIsBulkProcessing(false);
      return;
    }

    // Process in small chunks
    const chunk = 3;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < framesToProcess.length; i += chunk) {
      const batch = framesToProcess.slice(i, i + chunk);
      try {
        await Promise.all(batch.map(async (f) => {
          try {
            await handleRemoveBg(f.name);
            successCount++;
          } catch (err) {
            console.error(`Failed to process ${f.name}`, err);
            failCount++;
          }
        }));
      } catch (err) {
        console.error("Batch error", err);
      }
      setBulkProgress(prev => ({ ...prev, current: Math.min(i + chunk, framesToProcess.length) }));
    }

    setIsBulkProcessing(false);
    setBulkProgress({ current: 0, total: 0 });
    alert(`Processing complete! \nSuccess: ${successCount}\nFailed: ${failCount}`);
  };

  const handleSaveStudio = async (dataUrl) => {
    try {
      const formData = new FormData();
      formData.append('project_id', projectId);
      formData.append('frame_name', studioFrame);
      formData.append('image_data', dataUrl);

      const res = await axios.post(`${API_BASE}/save-manual-edit`, formData);
      
      // Add cache-buster to the URL so the browser reloads the image
      const cacheBusterUrl = `${res.data.url}?t=${Date.now()}`;
      
      setBgRemovedFrames(prev => ({
        ...prev,
        [studioFrame]: cacheBusterUrl
      }));
      setUseProcessed(true);
      setStudioFrame(null);
    } catch (err) {
      console.error("Failed to save manual edit", err);
    }
  };

  // Fetch projects on load
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await axios.get(`${API_BASE}/list-projects`);
        setProjects(res.data.projects);
      } catch (err) {
        console.error("Failed to fetch projects", err);
      }
    };
    if (!projectId) fetchProjects();
  }, [projectId]);

  const loadProject = async (id) => {
    setLoading(true);
    try {
      // We need the frame list for this project
      // For simplicity, we'll re-scan the folder on the backend or just assume frames are there
      // Let's add an endpoint to get frames for an existing project
      const stateRes = await axios.get(`${API_BASE}/load-state/${id}`);
      if (stateRes.data.status === 'success') {
        const s = stateRes.data.state;
        
        // We also need the actual frame file list
        // Let's call a new endpoint or just build it from state if we trust it
        // Actually, we should just ask the backend for the current frame list
        const framesRes = await axios.get(`${API_BASE}/get-project-frames/${id}`);
        
        setProjectId(id);
        setFrames(framesRes.data.frames);
        setSelectedFrames(s.selectedFrames || []);
        setFrameOffsets(s.frameOffsets || {});
        setBgRemovedFrames(s.bgRemovedFrames || {});
        setFps(s.fps || 12);
        setUseProcessed(s.useProcessed || false);
        setOnionSkin(s.onionSkin || false);
        setOnionSkinDepth(s.onionSkinDepth || 1);
        setOnionSkinOpacity(s.onionSkinOpacity || 1);
      }
    } catch (err) {
      console.error("Failed to load project", err);
    }
    setLoading(false);
  };

  // Auto-save logic
  useEffect(() => {
    if (!projectId) return;

    // Clear previous timeout
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    // Debounce save (wait 1 second after last change)
    saveTimeoutRef.current = setTimeout(async () => {
      const state = {
        selectedFrames,
        frameOffsets,
        bgRemovedFrames,
        fps,
        useProcessed,
        onionSkin,
        onionSkinDepth,
        onionSkinOpacity,
        guidePos,
        showGuides
      };
      
      try {
        const formData = new FormData();
        formData.append('project_id', projectId);
        formData.append('state_json', JSON.stringify(state));
        await axios.post(`${API_BASE}/save-state`, formData);
        console.log("Project auto-saved");
      } catch (err) {
        console.error("Auto-save failed", err);
      }
    }, 1000);

    return () => clearTimeout(saveTimeoutRef.current);
  }, [selectedFrames, frameOffsets, bgRemovedFrames, fps, useProcessed, onionSkin, onionSkinDepth, onionSkinOpacity, showGuides, guidePos, projectId]);

  const stepFrame = (dir) => {
    if (selectedFrames.length === 0) return;
    setIsPlaying(false); // Stop playback when manually stepping
    setPreviewIndex(prev => {
      if (dir === 'next') return (prev + 1) % selectedFrames.length;
      if (dir === 'prev') return (prev - 1 + selectedFrames.length) % selectedFrames.length;
      return prev;
    });
  };

  // Handle Video Upload
  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_BASE}/upload-video`, formData);
      const newProjectId = res.data.project_id;
      setProjectId(newProjectId);
      setFrames(res.data.frames);
      
      // Check for existing state
      try {
        const stateRes = await axios.get(`${API_BASE}/load-state/${newProjectId}`);
        if (stateRes.data.status === 'success') {
          const s = stateRes.data.state;
          setSelectedFrames(s.selectedFrames || []);
          setFrameOffsets(s.frameOffsets || {});          setBgRemovedFrames(s.bgRemovedFrames || {});
          setFps(s.fps || 12);
          setUseProcessed(s.useProcessed || false);
          setOnionSkin(s.onionSkin || false);
          setOnionSkinDepth(s.onionSkinDepth || 1);
          setOnionSkinOpacity(s.onionSkinOpacity || 1);
          if (s.guidePos) setGuidePos(s.guidePos);
          if (s.showGuides !== undefined) setShowGuides(s.showGuides);
        } else {
          // Default initialization
          setSelectedFrames(res.data.frames.map(f => f.name));
          const initialOffsets = {};
          res.data.frames.forEach(f => initialOffsets[f.name] = { x: 0, y: 0 });
          setFrameOffsets(initialOffsets);
        }
      } catch (loadErr) {
        console.log("No previous state found");
      }
      
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
      const isRemoving = prev.includes(name);
      let next;
      if (isRemoving) {
        next = prev.filter(f => f !== name);
      } else {
        // Keep selection sorted by original frame index
        const allNames = [...prev, name];
        next = allNames.sort((a, b) => {
          const idxA = frames.find(f => f.name === a)?.index || 0;
          const idxB = frames.find(f => f.name === b)?.index || 0;
          return idxA - idxB;
        });
      }
      
      // Safety check: ensure previewIndex stays valid
      if (previewIndex >= next.length) setPreviewIndex(0);
      return next;
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
      const busterUrl = `${res.data.processed_url}?t=${Date.now()}`;
      setBgRemovedFrames(prev => ({
        ...prev,
        [frameName]: busterUrl
      }));
    } catch (err) {
      console.error("BG Removal failed", err);
    }
  };

  const handleMainGuideMove = (e) => {
    if (!isDraggingGuides || !showGuides) return;
    
    const previewWindow = document.querySelector('.preview-window');
    if (!previewWindow) return;
    
    const rect = previewWindow.getBoundingClientRect();
    const containerCenterX = rect.width / 2;
    const containerCenterY = rect.height / 2;
    
    // Scale in main view
    const mainScale = Math.min(
      (rect.height * 0.9) / imageSize.h,
      (rect.width * 0.9) / imageSize.w,
      1
    );
    
    // Offset from container center (ignoring frame nudges for the guide itself)
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    const imgRelX = (screenX - containerCenterX) / mainScale;
    const imgRelY = (screenY - containerCenterY) / mainScale;
    
    setGuidePos({
      x: imgRelX + imageSize.w / 2,
      y: imgRelY + imageSize.h / 2
    });
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
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          {projectId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div 
                title="When enabled, 'Process All Backgrounds' will re-process every frame in the project, overwriting previous results. Useful if you want to redo the AI pass."
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.4rem 0.8rem', borderRadius: '0.5rem', fontSize: '0.7rem' }}
              >
                <input 
                  type="checkbox" 
                  id="force-rerun" 
                  checked={forceRerun} 
                  onChange={(e) => setForceRerun(e.target.checked)} 
                />
                <label htmlFor="force-rerun" style={{ cursor: 'pointer', color: forceRerun ? 'var(--primary)' : 'var(--text-dim)' }}>Force AI Rerun</label>
              </div>

              <button 
                className="btn btn-outline" 
                onClick={bulkRemoveBg} 
                disabled={isBulkProcessing}
                style={{ borderColor: 'var(--primary)', color: 'var(--primary)', minWidth: '180px' }}
              >
                {isBulkProcessing ? (
                  <>
                    <div className="loading-spinner" style={{ width: 14, height: 14 }}></div>
                    {bulkProgress.current} / {bulkProgress.total}
                  </>
                ) : (
                  <>
                    <Zap size={18} />
                    Process All Backgrounds
                  </>
                )}
              </button>
              
              <button className="btn btn-outline" onClick={() => window.location.reload()}>
                <Trash2 size={18} /> New Project
              </button>
            </div>
          )}
        </div>
      </header>

      <AnimatePresence>
        {studioFrame && (
          <SurgicalStudio 
            projectId={projectId}
            frameName={studioFrame}
            initialUrl={getFrameUrl(studioFrame)}
            onSave={handleSaveStudio}
            onCancel={() => setStudioFrame(null)}
            showGuides={showGuides}
            setShowGuides={setShowGuides}
            guidePos={guidePos}
            setGuidePos={setGuidePos}
            whiteBg={whiteBg}
            setWhiteBg={setWhiteBg}
          />
        )}
      </AnimatePresence>

      {!projectId ? (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="upload-section"
        >
          <div className="glass-card upload-zone" onClick={() => fileInputRef.current.click()}>
            {loading ? (
              <div className="loading-container">
                <div className="loading-spinner"></div>
                <p style={{ marginTop: '1rem' }}>Processing project...</p>
              </div>
            ) : (
              <>
                <Upload size={48} color="var(--primary)" style={{ marginBottom: '1rem' }} />
                <h2>Start New Project</h2>
                <p>Drop your MP4 here to extract frames</p>
              </>
            )}
          </div>

          {projects.length > 0 && (
            <div className="recent-projects" style={{ marginTop: '3rem' }}>
              <h3 style={{ marginBottom: '1.5rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '1px' }}>Recent Workspaces</h3>
              <div className="project-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1.5rem' }}>
                {projects.map(p => (
                  <motion.div 
                    key={p.id}
                    whileHover={{ scale: 1.02, translateY: -5 }}
                    className="glass-card project-card"
                    style={{ cursor: 'pointer', padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}
                    onClick={() => loadProject(p.id)}
                  >
                    <div className="project-thumb" style={{ width: '80px', height: '80px', borderRadius: '0.75rem', overflow: 'hidden', background: '#000', flexShrink: 0 }}>
                      <img src={`${API_BASE}${p.thumbnail}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                    <div className="project-info">
                      <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>Project {p.id}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                        {new Date(p.updated * 1000).toLocaleDateString()}
                      </div>
                    </div>
                    <ChevronRight size={18} style={{ marginLeft: 'auto', opacity: 0.3 }} />
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleUpload} 
            style={{ display: 'none' }} 
            accept="video/mp4,video/quicktime"
          />
        </motion.div>
      ) : (
        <div className="workspace" style={{ gridTemplateColumns: showPreview ? '1fr 350px' : '1fr' }}>
          <div className="main-content">
            {showPreview && (
              <div className="glass-card preview-window" style={{ position: 'relative', marginBottom: '2rem', background: whiteBg ? '#ffffff' : undefined, transition: 'background 0.2s ease' }}>
                {/* Frame HUD Overlay */}
                {currentPreviewFrame && (
                  <div 
                    className="preview-hud" 
                    onClick={() => setStudioFrame(currentPreviewFrame)}
                    style={{ 
                      position: 'absolute', 
                      top: '1rem', 
                      right: '1rem', 
                      background: 'rgba(0,0,0,0.6)', 
                      padding: '0.4rem 0.8rem', 
                      borderRadius: '0.5rem', 
                      fontSize: '0.75rem', 
                      fontWeight: '800', 
                      color: 'var(--primary)',
                      zIndex: 110,
                      border: '1px solid var(--border)',
                      backdropFilter: 'blur(4px)',
                      letterSpacing: '1px',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = 'white'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; e.currentTarget.style.color = 'var(--primary)'; }}
                  >
                    EDIT FRAME #{frames.find(f => f.name === currentPreviewFrame)?.index}
                  </div>
                )}
                
                {onionSkin && selectedFrames.length > 0 && (
                  <div className="onion-skin-container" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    {selectedFrames.map((name, i) => {
                      if (name === currentPreviewFrame) return null;
                      
                      const dist = Math.abs(i - previewIndex);
                      const wrapDist = Math.min(dist, selectedFrames.length - dist);
                      if (onionSkinDepth !== 0 && wrapDist > onionSkinDepth) return null;

                      const offset = frameOffsets[name] || { x: 0, y: 0 };
                      return (
                        <img 
                          key={`onion-${name}`}
                          src={getFrameUrl(name)} 
                          alt="" 
                          style={{ 
                            opacity: Math.min(1, (onionSkinDepth === 0 ? 0.05 : Math.max(0.05, 0.3 - (wrapDist * 0.1))) * onionSkinOpacity),
                            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                            zIndex: 1
                          }} 
                        />
                      );
                    })}
                  </div>
                )}

                {previewImgSrc ? (
                  <div className="current-frame-container" style={{ zIndex: 2, position: 'absolute', inset: 0 }}>
                    <img 
                      src={previewImgSrc} 
                      alt="Preview" 
                      key={previewImgSrc} 
                      onLoad={(e) => {
                        if (e.target.naturalWidth) {
                          setImageSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
                        }
                      }}
                      style={{ 
                        transform: `translate(calc(-50% + ${frameOffsets[currentPreviewFrame]?.x || 0}px), calc(-50% + ${frameOffsets[currentPreviewFrame]?.y || 0}px))`,
                        zIndex: 10
                      }}
                    />
                  </div>
                ) : (
                  <div className="no-selection">
                    <Play size={48} color="var(--text-dim)" />
                    <p>Select frames to preview animation</p>
                  </div>
                )}
                {/* Playback Controls Overlay */}
                <div className="preview-controls-overlay" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <button className="btn btn-outline" onClick={() => stepFrame('prev')} style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0 }}>
                    <ChevronLeft size={20} />
                  </button>

                  <button className="btn btn-primary" onClick={() => setIsPlaying(!isPlaying)} style={{ borderRadius: '50%', width: '50px', height: '50px' }}>
                    {isPlaying ? <Pause /> : <Play />}
                  </button>

                  <button className="btn btn-outline" onClick={() => stepFrame('next')} style={{ borderRadius: '50%', width: '40px', height: '40px', padding: 0 }}>
                    <ChevronRight size={20} />
                  </button>
                </div>

                {showGuides && (
                  <div 
                    className="guides-overlay"
                    onMouseMove={handleMainGuideMove}
                    onMouseUp={() => setIsDraggingGuides(false)}
                    onMouseLeave={() => setIsDraggingGuides(false)}
                    style={{ 
                      position: 'absolute', 
                      inset: 0, 
                      zIndex: 120, 
                      pointerEvents: isDraggingGuides ? 'all' : 'none'
                    }}
                  >
                    {/* Calculate screen position of the image-space guide */}
                    {(() => {
                      const win = document.querySelector('.preview-window');
                      if (!win) return null;
                      const rect = win.getBoundingClientRect();
                      const scale = Math.min((rect.height * 0.9) / imageSize.h, (rect.width * 0.9) / imageSize.w, 1);
                      const screenX = (rect.width / 2) + (guidePos.x - imageSize.w / 2) * scale;
                      const screenY = (rect.height / 2) + (guidePos.y - imageSize.h / 2) * scale;
                      
                      return (
                        <>
                          <div className="guide-line-h" style={{ position: 'absolute', top: screenY, left: 0, width: '100%', height: '1px', background: '#ff4444', boxShadow: '0 0 8px rgba(255, 68, 68, 0.4)', pointerEvents: 'none' }} />
                          <div className="guide-line-v" style={{ position: 'absolute', left: screenX, top: 0, width: '1px', height: '100%', background: '#ff4444', boxShadow: '0 0 8px rgba(255, 68, 68, 0.4)', pointerEvents: 'none' }} />
                          <div 
                            className="guide-handle" 
                            onMouseDown={(e) => { e.stopPropagation(); setIsDraggingGuides(true); }}
                            style={{ 
                              position: 'absolute', 
                              left: screenX - 10, 
                              top: screenY - 10, 
                              width: 20, 
                              height: 20, 
                              borderRadius: '50%', 
                              border: '2px solid #ff4444', 
                              background: isDraggingGuides ? '#ff4444' : 'rgba(255, 68, 68, 0.2)', 
                              pointerEvents: 'all',
                              cursor: 'crosshair'
                            }} 
                          />
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

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
                    <div key={frame.name} className="frame-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div 
                        className="frame-header" 
                        onClick={() => toggleFrame(frame.name)}
                        style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          padding: '0.4rem 0.6rem',
                          background: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                          borderRadius: '0.5rem',
                          cursor: 'pointer',
                          border: isSelected ? '1px solid var(--primary)' : '1px solid transparent'
                        }}
                      >
                        <span style={{ fontSize: '0.7rem', fontWeight: '800', color: isSelected ? 'var(--primary)' : 'var(--text-dim)' }}>#{idx}</span>
                        {isSelected ? <Check size={12} color="var(--primary)" strokeWidth={3} /> : <div style={{ width: 12, height: 12, border: '1px solid var(--border)', borderRadius: '2px' }}></div>}
                      </div>
                      <motion.div 
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className={`frame-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => setStudioFrame(frame.name)}
                        style={{ position: 'relative' }}
                      >
                        <img src={displayUrl} alt={frame.name} loading="lazy" />
                        
                        <div className="studio-prompt" style={{
                          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: 0, transition: 'opacity 0.2s'
                        }}>
                          <Eraser size={24} color="white" />
                        </div>

                        <div className="frame-actions" onClick={(e) => e.stopPropagation()}>
                          <button 
                            className={`bg-toggle ${isBgRemoved ? 'active' : ''}`}
                            onClick={() => handleRemoveBg(frame.name)}
                            title="AI Remove Background"
                            style={{ 
                              color: isBgRemoved ? 'var(--success)' : 'white',
                              borderColor: isBgRemoved ? 'var(--success)' : 'var(--border)'
                            }}
                          >
                            {isBgRemoved ? <Zap size={10} fill="currentColor" /> : <Scissors size={10} />}
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <aside className="controls-panel">
            <div className="glass-card">
              <h3>Interface</h3>
              <div className="control-group" style={{ marginTop: '1.5rem' }}>
                <div className="toggle-container" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <input 
                    type="checkbox" 
                    id="showPreview" 
                    checked={showPreview} 
                    onChange={(e) => setShowPreview(e.target.checked)}
                  />
                  <label htmlFor="showPreview" style={{ textTransform: 'none', cursor: 'pointer' }}>
                    Show Animation Preview
                  </label>
                </div>
                <div className="toggle-container" style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                  <input 
                    type="checkbox" 
                    id="showGuides" 
                    checked={showGuides} 
                    onChange={(e) => setShowGuides(e.target.checked)}
                  />
                  <label htmlFor="showGuides" style={{ textTransform: 'none', cursor: 'pointer' }}>
                    Enable Alignment Guides
                  </label>
                </div>
                {showGuides && (
                  <button 
                    className="btn btn-outline" 
                    onClick={() => setGuidePos({ x: 250, y: 250 })}
                    style={{ fontSize: '0.7rem', padding: '0.4rem', marginTop: '0.5rem', width: '100%' }}
                  >
                    Reset Guide Position
                  </button>
                )}
                <div className="toggle-container" style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                  <input 
                    type="checkbox" 
                    id="whiteBg" 
                    checked={whiteBg} 
                    onChange={(e) => setWhiteBg(e.target.checked)}
                  />
                  <label htmlFor="whiteBg" style={{ textTransform: 'none', cursor: 'pointer' }}>
                    White Background
                  </label>
                </div>
              </div>
            </div>

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

                  {onionSkin && (
                    <div className="control-group" style={{ paddingLeft: '1.5rem', gap: '1rem' }}>
                      <div className="sub-control">
                        <label style={{ fontSize: '0.7rem' }}>Skin Depth: {onionSkinDepth === 0 ? 'All' : onionSkinDepth}</label>
                        <input 
                          type="range" 
                          min="0" 
                          max="5" 
                          step="1"
                          value={onionSkinDepth} 
                          onChange={(e) => setOnionSkinDepth(parseInt(e.target.value))}
                        />
                      </div>
                      <div className="sub-control">
                        <label style={{ fontSize: '0.7rem' }}>Skin Opacity: {Math.round(onionSkinOpacity * 100)}%</label>
                        <input 
                          type="range" 
                          min="1" 
                          max="5" 
                          step="0.1"
                          value={onionSkinOpacity} 
                          onChange={(e) => setOnionSkinOpacity(parseFloat(e.target.value))}
                        />
                      </div>
                    </div>
                  )}

                  <div className="dpad-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Nudge Current Frame</div>
                    <button className="btn nudge-btn" onClick={() => nudgeFrame('up')}><ChevronUp size={20} /></button>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn nudge-btn" onClick={() => nudgeFrame('left')}><ChevronLeft size={20} /></button>
                      <button className="btn nudge-btn" onClick={() => nudgeFrame('down')}><ChevronDown size={20} /></button>
                      <button className="btn nudge-btn" onClick={() => nudgeFrame('right')}><ChevronRight size={20} /></button>
                    </div>
                    <div style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: '0.5rem' }}>X: {frameOffsets[currentPreviewFrame]?.x || 0} Y: {frameOffsets[currentPreviewFrame]?.y || 0}</div>
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
                  <button 
                    className="btn btn-outline"
                    style={{ width: '100%', borderColor: 'var(--success)', color: 'var(--success)' }}
                    onClick={async () => {
                      try {
                        const response = await fetch(spritesheetUrl);
                        const blob = await response.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = `spritesheet_${projectId || 'export'}.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(blobUrl);
                      } catch (err) {
                        console.error('Download failed:', err);
                        // Fallback: open in new tab
                        window.open(spritesheetUrl, '_blank');
                      }
                    }}
                  >
                    <Download size={18} /> Download Result
                  </button>
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
    </div>
  );
}

export default App;
