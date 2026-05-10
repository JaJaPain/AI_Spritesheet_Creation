import React, { useState, useEffect, useRef } from 'react'
import { Sparkles, Wand2, Play, Download, Settings, Image as ImageIcon, Loader2, ArrowLeft, RefreshCw, Save, Upload, X, Check, FolderOpen, HelpCircle, Trash2, ChevronLeft, ChevronRight, Video, Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'


function LimbMasker({ imageUrl, onSave, onCancel, title, initialMask }) {
  const canvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [isErasing, setIsErasing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState([]);
  const [lastPos, setLastPos] = useState(null);

  const [baseImage, setBaseImage] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheelEvent = (e) => {
      e.preventDefault();
      handleWheel(e);
    };
    container.addEventListener('wheel', handleWheelEvent, { passive: false });
    return () => container.removeEventListener('wheel', handleWheelEvent);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      maskCanvas.width = img.width;
      maskCanvas.height = img.height;
      
      ctx.drawImage(img, 0, 0);
      setBaseImage(img);
      
      mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      
      if (initialMask) {
        const maskImg = new Image();
        maskImg.src = initialMask;
        maskImg.onload = () => {
          mctx.drawImage(maskImg, 0, 0);
          // Directly call updateDisplay with the new img context
          const tintCanvas = document.createElement('canvas');
          tintCanvas.width = img.width;
          tintCanvas.height = img.height;
          const tctx = tintCanvas.getContext('2d');
          tctx.drawImage(maskCanvas, 0, 0);
          tctx.globalCompositeOperation = 'source-in';
          tctx.fillStyle = '#ff0000';
          tctx.fillRect(0, 0, tintCanvas.width, tintCanvas.height);
          
          ctx.clearRect(0, 0, img.width, img.height);
          ctx.drawImage(img, 0, 0);
          ctx.globalAlpha = 0.5;
          ctx.drawImage(tintCanvas, 0, 0);
          ctx.globalAlpha = 1.0;
          
          saveHistory();
        };
      } else {
        saveHistory();
      }
    };
  }, [imageUrl]);

  const saveHistory = () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const data = maskCanvas.toDataURL();
    setHistory(prev => [...prev.slice(-19), data]); // Keep last 20 steps
  };

  const handleUndo = () => {
    if (history.length <= 1) return;
    const newHistory = history.slice(0, -1);
    const lastState = newHistory[newHistory.length - 1];
    
    const img = new Image();
    img.src = lastState;
    img.onload = () => {
      const mctx = maskCanvasRef.current.getContext('2d');
      mctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      mctx.drawImage(img, 0, 0);
      setHistory(newHistory);
      updateDisplay();
    };
  };

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleMouseDown = (e) => {
    if (e.button === 2 || e.altKey || e.ctrlKey) {
      setIsPanning(true);
      setLastPos({ x: e.clientX, y: e.clientY });
      return;
    }
    setIsDrawing(true);
    draw(e);
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      const dx = e.clientX - lastPos.x;
      const dy = e.clientY - lastPos.y;
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (isDrawing) draw(e);
  };

  const handleMouseUp = () => {
    if (isDrawing) saveHistory();
    setIsDrawing(false);
    setIsPanning(false);
    setLastPos(null);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.min(Math.max(prev * delta, 0.5), 8));
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const mctx = maskCanvasRef.current.getContext('2d');
    const { x, y } = getCoordinates(e);

    mctx.globalCompositeOperation = isErasing ? 'destination-out' : 'source-over';
    mctx.fillStyle = 'white';
    mctx.beginPath();
    mctx.arc(x, y, brushSize / zoom, 0, Math.PI * 2);
    mctx.fill();
    updateDisplay();
  };

  const updateDisplay = () => {
    if (!baseImage) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const maskCanvas = maskCanvasRef.current;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);
    
    const tintCanvas = document.createElement('canvas');
    tintCanvas.width = canvas.width;
    tintCanvas.height = canvas.height;
    const tctx = tintCanvas.getContext('2d');
    
    tctx.drawImage(maskCanvas, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = '#ff0000';
    tctx.fillRect(0, 0, tintCanvas.width, tintCanvas.height);
    
    ctx.globalAlpha = 0.5;
    ctx.drawImage(tintCanvas, 0, 0);
    ctx.globalAlpha = 1.0;
  };

  const handleSave = () => {
    // Pass the raw transparent mask for persistence and surgical processing
    onSave(maskCanvasRef.current.toDataURL('image/png'));
  };

  return (
    <div 
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.98)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Toolbar */}
      <div className="glass-card" style={{ 
        margin: '1.5rem', 
        padding: '0.8rem 1.5rem', 
        display: 'flex', 
        gap: '1.5rem', 
        alignItems: 'center', 
        border: '1px solid var(--accent-primary)',
        zIndex: 10,
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
      }}>
        <div style={{ textAlign: 'left', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: '1.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Surgical <span className="gradient-text">Studio</span></h3>
          <p style={{ margin: 0, fontSize: '0.7rem', color: '#666' }}>L-Click: Paint | R-Click/Ctrl: Pan | Wheel: Zoom</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
           <button 
             className="btn-secondary" 
             style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', background: 'rgba(139, 92, 246, 0.1)', color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}
             onClick={() => alert("SURGERY GUIDE:\n\n1. MASK THE TARGET: Paint over the specific limb you want to re-generate.\n2. ISOLATION: To separate a torso, mask the area where the neck and shoulders used to be.\n3. CLEAN EDGES: Use the Eraser to keep the mask tight to the body.\n4. AI LOGIC: Everything in RED will be re-drawn by the AI. Everything else is kept exactly as is.")}
           >
             <HelpCircle size={14} style={{marginRight: '0.3rem'}} /> How to Mask
           </button>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <button 
            className={!isErasing ? "btn-primary" : "btn-secondary"} 
            onClick={() => setIsErasing(false)}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
          >
            <Sparkles size={14} style={{marginRight: '0.3rem'}} /> Brush
          </button>
          <button 
            className={isErasing ? "btn-primary" : "btn-secondary"} 
            onClick={() => setIsErasing(true)}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
          >
            <X size={14} style={{marginRight: '0.3rem'}} /> Eraser
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(255,255,255,0.05)', padding: '0.4rem 1rem', borderRadius: '8px' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 'bold' }}>Size:</label>
          <input 
            type="range" min="5" max="150" 
            value={brushSize} 
            onChange={(e) => setBrushSize(parseInt(e.target.value))} 
            style={{ width: '100px' }}
          />
          <span style={{ minWidth: '25px', fontSize: '0.8rem' }}>{brushSize}px</span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '1.5rem' }}>
          <button className="btn-secondary" onClick={handleUndo} disabled={history.length <= 1} style={{ padding: '0.4rem' }} title="Undo (Ctrl+Z)">
            <RefreshCw size={16} style={{transform: 'scaleX(-1)'}} />
          </button>
          <button className="btn-secondary" onClick={() => { setZoom(1); setOffset({x:0, y:0}); }} style={{ padding: '0.4rem' }} title="Reset View">
            <RefreshCw size={16} />
          </button>
          <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 0.5rem' }} />
          <button className="btn-secondary" onClick={onCancel} style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} style={{ padding: '0.4rem 1.2rem', fontSize: '0.8rem', background: 'linear-gradient(to right, #8b5cf6, #d946ef)', border: 'none' }}>
            <Check size={16} style={{ marginRight: '0.3rem' }} /> Apply Surgery
          </button>
        </div>
      </div>

      <div 
        ref={containerRef}
        style={{ 
          flex: 1,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isPanning ? 'grabbing' : isErasing ? 'crosshair' : 'crosshair',
          overflow: 'hidden',
          position: 'relative'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div style={{ 
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: 'center',
          transition: isPanning ? 'none' : 'transform 0.1s ease-out',
          position: 'relative'
        }}>
          <canvas 
            ref={canvasRef} 
            style={{ 
              display: 'block', 
              boxShadow: '0 0 50px rgba(0,0,0,0.8)',
              background: '#111',
              imageRendering: 'pixelated'
            }} 
          />
          <canvas ref={maskCanvasRef} style={{ display: 'none' }} />
        </div>
      </div>
      
      <div style={{ padding: '1rem', color: '#444', fontSize: '0.7rem', display: 'flex', gap: '2rem' }}>
        <span>Zoom: {Math.round(zoom * 100)}%</span>
        <span>History: {history.length} steps</span>
        <span>Tip: Hold Right-Click or Ctrl to Pan the view</span>
      </div>
    </div>
  );
}

function App() {
  // Global API Discovery State
  const [apiBase, setApiBase] = useState(null)
  const [stage, setStage] = useState('prompt') // prompt, selecting-anchor, animating, editing, preview
  const [apiReady, setApiReady] = useState(false)
  const [videoApiBase, setVideoApiBase] = useState(null)
  const [rapidApiBase, setRapidApiBase] = useState(null)
  const [rapidEngineReady, setRapidEngineReady] = useState(false)

  useEffect(() => {
    let timeout = null;
    const discover = async () => {
      let mainFound = false;
      let videoFound = false;

      // Always scan ports to discover services
      // (We can't rely on state variables in this closure since deps=[])
      for (let p = 8000; p <= 8020; p++) {
        const url = `http://localhost:${p}`;

        try {
          const res = await fetch(`${url}/status`, { method: 'GET' });
          if (res.ok) {
            const data = await res.json();
            if (data.identity === 'video-forge' && !videoFound) {
              console.log(`Video Forge (Classic) discovered on port ${p}`);
              setVideoApiBase(url);
              setVideoEngineReady(true);
              videoFound = true;
            } else if (data.identity === 'video-forge-rapid' && !videoFound) {
              console.log(`Video Forge (Rapid) discovered on port ${p}`);
              setRapidApiBase(url);
              setRapidEngineReady(true);
              videoFound = true;
            } else if (data.identity === 'main-backend' && !mainFound) {
              setApiBase(url);
              setApiReady(true);
              mainFound = true;
            }
          }
        } catch (e) { /* silent - port not in use */ }
        if (mainFound && videoFound) break;
      }
      
      setApiReady(mainFound);
      setVideoEngineReady(videoFound);
      timeout = setTimeout(discover, (mainFound && videoFound) ? 10000 : 3000);
    }
    
    discover();
    return () => clearTimeout(timeout);
  }, []); // Run once on mount, recursion handled by setTimeout
  const [prompt, setPrompt] = useState('')
  const [variants, setVariants] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedAnchor, setSelectedAnchor] = useState(null)
  const [spritesheetUrl, setSpritesheetUrl] = useState(null)

  // Frame editor state
  const [sessionId, setSessionId] = useState(null)
  const [frameUrls, setFrameUrls] = useState([])
  const [skeletonUrls, setSkeletonUrls] = useState([])
  const [anchorUrl, setAnchorUrl] = useState(null)
  const [redoingFrame, setRedoingFrame] = useState(null)
  const [animFrame, setAnimFrame] = useState(0)
  const [hasSavedAnchor, setHasSavedAnchor] = useState(false)
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false)
  const [savesList, setSavesList] = useState([])
  const [saveStatus, setSaveStatus] = useState({}) // { [url]: 'saving' | 'saved' }
  const [excludedFrames, setExcludedFrames] = useState(new Set())
  const [autoPrompt, setAutoPrompt] = useState('')
  const [describing, setDescribing] = useState(false)

  const [turnaroundUrl, setTurnaroundUrl] = useState(null)
  const [originalTurnaroundUrl, setOriginalTurnaroundUrl] = useState(null)
  const [generatingTurnaround, setGeneratingTurnaround] = useState(false)
  const [isTurnaroundModalOpen, setIsTurnaroundModalOpen] = useState(false)
  const [isWandActive, setIsWandActive] = useState(false)
  const [wandHistory, setWandHistory] = useState([])
  const [activeProjectId, setActiveProjectId] = useState(null)
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)
  const [removerType, setRemoverType] = useState('ai')
  const [alphaMatting, setAlphaMatting] = useState(false)
  const [removalSensitivity, setRemovalSensitivity] = useState(240)
  const [forceReslice, setForceReslice] = useState(false)
  const [enforceWhite, setEnforceWhite] = useState(true)
  const [saveClickCount, setSaveClickCount] = useState(0)
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false)
  const [savedProjects, setSavedProjects] = useState([])
  const [isDeleteMode, setIsDeleteMode] = useState(false)
  const [isResetMode, setIsResetMode] = useState(false)

  const [projectToDelete, setProjectToDelete] = useState(null)
  const [numGenerations, setNumGenerations] = useState(1)
  const [zoomLevel, setZoomLevel] = useState(1)
  const turnaroundCanvasRef = useRef(null)

  
  // Slicing State
  const [slicedUrls, setSlicedUrls] = useState([])
  const [allSliceVersions, setAllSliceVersions] = useState([[], [], [], [], []])
  const [selectedVersionIndices, setSelectedVersionIndices] = useState([0, 0, 0, 0, 0])
  const [slicing, setSlicing] = useState(false)
  

  
  // Surgery & Correction State
  const [isMasking, setIsMasking] = useState(false)
  const [activeManualLimb, setActiveManualLimb] = useState(null)
  const [sliceDirections, setSliceDirections] = useState(['side', 'side', 'front-quarter', 'back-quarter', 'back']);
  
  const handleSetSliceDirection = (idx, val) => {
    const newDirs = [...sliceDirections];
    newDirs[idx] = val;
    setSliceDirections(newDirs);
  }
  const [targetRotation, setTargetRotation] = useState('front-quarter')


  // Video Forge State
  const [videoStage, setVideoStage] = useState('idle') // idle, generating, done
  const [videoUrl, setVideoUrl] = useState(null)
  const [videoPrompt, setVideoPrompt] = useState('')
  const [selectedVideoSlice, setSelectedVideoSlice] = useState(null)
  const [videoHeartbeat, setVideoHeartbeat] = useState({ status: 'Offline', progress: 0 })
  const [videoEngineReady, setVideoEngineReady] = useState(false)
  const [isWarmingUp, setIsWarmingUp] = useState(false)
  const [activeSurgicalIndex, setActiveSurgicalIndex] = useState(null)

  // Batch Animation State
  const [batchMode, setBatchMode] = useState(false)
  const [presetList, setPresetList] = useState([])
  const [selectedPresetId, setSelectedPresetId] = useState('side_view')
  const [currentPreset, setCurrentPreset] = useState(null)
  const [batchChecked, setBatchChecked] = useState({})
  const [batchStatus, setBatchStatus] = useState({ running: false, total: 0, completed: 0, current_name: '', results: [] })
  const [editingAnim, setEditingAnim] = useState(null)
  const [animDuration, setAnimDuration] = useState(25) // 25=1.5s, 49=3s, 97=6s
  const durationOptions = [{ frames: 25, label: '1.5s' }, { frames: 49, label: '3s' }, { frames: 97, label: '6s' }]
  const [animQuality, setAnimQuality] = useState(10)
  const qualityOptions = [{ steps: 10, label: 'Draft' }, { steps: 20, label: 'Standard' }, { steps: 30, label: 'High' }]

  // Load preset list
  const loadPresetList = async () => {
    try {
      const r = await fetch(`${apiBase}/api/presets`);
      const data = await r.json();
      setPresetList(data.presets || []);
    } catch(e) { console.error('Failed to load presets:', e); }
  };

  // Load a specific preset
  const loadPreset = async (viewId) => {
    try {
      const r = await fetch(`${apiBase}/api/presets/${viewId}`);
      const data = await r.json();
      setCurrentPreset(data);
      const checks = {};
      (data.animations || []).forEach(a => { checks[a.id] = true; });
      setBatchChecked(checks);
    } catch(e) { console.error('Failed to load preset:', e); }
  };

  // Save current preset
  const savePreset = async () => {
    if (!currentPreset) return;
    try {
      await fetch(`${apiBase}/api/presets/${selectedPresetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentPreset)
      });
      loadPresetList();
    } catch(e) { console.error('Failed to save preset:', e); }
  };

  // Start batch
  const handleStartBatch = async () => {
    if (!currentPreset || !selectedVideoSlice) return;
    const selected = (currentPreset.animations || []).filter(a => batchChecked[a.id]);
    if (selected.length === 0) return alert('Select at least one animation');
    
    const activeApi = rapidEngineReady ? rapidApiBase : videoApiBase;
    const formData = new FormData();
    
    try {
      const imgSrc = selectedVideoSlice.startsWith('http') ? selectedVideoSlice : `${apiBase}${selectedVideoSlice}`;
      const imgResp = await fetch(imgSrc);
      const imgBlob = await imgResp.blob();
      formData.append('image', imgBlob, 'sprite_slice.png');
    } catch(e) {
      formData.append('image_url', selectedVideoSlice);
    }
    
    const withDuration = selected.map(a => ({ ...a, num_frames: animDuration, steps: animQuality }));
    formData.append('animations_json', JSON.stringify(withDuration));
    formData.append('character_id', activeProjectId || 'unknown');
    formData.append('view_id', selectedPresetId);
    
    const r = await fetch(`${activeApi}/batch`, { method: 'POST', body: formData });
    if (r.ok) {
      setBatchStatus({ running: true, total: selected.length, completed: 0, current_name: '', results: [] });
    } else {
      const err = await r.json();
      alert(`Batch failed: ${err.detail}`);
    }
  };

  // Poll batch status
  useEffect(() => {
    if (!batchStatus.running) return;
    const activeApi = rapidEngineReady ? rapidApiBase : videoApiBase;
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`${activeApi}/batch/status`);
        const data = await r.json();
        setBatchStatus(data);
        if (!data.running) clearInterval(interval);
      } catch(e) {}
    }, 3000);
    return () => clearInterval(interval);
  }, [batchStatus.running, rapidApiBase, videoApiBase, rapidEngineReady]);

  // Load presets when entering batch mode
  useEffect(() => {
    if (batchMode) {
      loadPresetList();
      loadPreset(selectedPresetId);
    }
  }, [batchMode]);

  // Video Engine Heartbeat Poller
  useEffect(() => {
    let timeout = null;
    const pollHeartbeat = async () => {
      const activeBase = rapidEngineReady ? rapidApiBase : videoApiBase;
      const isReady = rapidEngineReady || videoEngineReady;
      
      if (!activeBase || !isReady) {
        timeout = setTimeout(pollHeartbeat, 5000);
        return;
      }
      
      try {
        const res = await fetch(`${activeBase}/status`);
        if (res.ok) {
           const data = await res.json();
           setVideoHeartbeat(data);
           setIsWarmingUp(false);
        } else {
           // Engine might be transiently down
        }
      } catch (e) {
        setVideoHeartbeat({ status: 'Offline', progress: 0 });
      }
      timeout = setTimeout(pollHeartbeat, 3000);
    };
    pollHeartbeat();
    return () => clearTimeout(timeout);
  }, [videoApiBase, videoEngineReady, rapidApiBase, rapidEngineReady]);

  const handleForgeVideo = async () => {
    if (!selectedVideoSlice || !videoPrompt) return;
    setVideoStage('generating');
    setVideoUrl(null);
    
    try {
      const formData = new FormData();
      // Ensure we strip cache busters if present
      const cleanUrl = selectedVideoSlice.split('?')[0];
      
      // Select the active engine
      const activeApi = rapidEngineReady ? rapidApiBase : videoApiBase;
      const endpoint = rapidEngineReady ? '/forge' : '/generate';
      
      // For both engines, fetch the actual image blob and send as file upload
      // This is more reliable than URL resolution across servers
      const imgSrc = cleanUrl.startsWith('http') ? cleanUrl : `${apiBase}${cleanUrl}`;
      try {
        const imgResp = await fetch(imgSrc);
        const imgBlob = await imgResp.blob();
        formData.append('image', imgBlob, 'sprite_slice.png');
      } catch (fetchErr) {
        console.warn("Failed to fetch image blob, falling back to URL:", fetchErr);
        formData.append('image_url', cleanUrl);
      }
      
      formData.append('prompt', videoPrompt);
      formData.append('num_frames', animDuration);
      formData.append('steps', animQuality);
      
      const response = await fetch(`${activeApi}${endpoint}`, {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        // The rapid forge returns a JSON with a video_url, classic returns a blob
        if (rapidEngineReady) {
          const data = await response.json();
          // We need to fetch the blob from the rapid server's output
          const videoRes = await fetch(`${activeApi}${data.video_url}`);
          const blob = await videoRes.blob();
          setVideoUrl(URL.createObjectURL(blob));
        } else {
          const blob = await response.blob();
          setVideoUrl(URL.createObjectURL(blob));
        }
        setVideoStage('done');
      } else {
        try {
          const err = await response.json();
          alert(`Forge failed: ${err.detail}`);
        } catch(e) {
          alert("Forge failed. The engine might be out of memory.");
        }
        setVideoStage('idle');
      }
    } catch (e) {
      console.error(e);
      alert("Lost connection to Video Forge engine. Is run_everything.bat running?");
      setVideoStage('idle');
    }
  };

  // Check for saved anchors ONLY after discovery completes
  useEffect(() => {
    if (!apiReady || !apiBase) return;
    const check = async () => {
      try {
        const res = await fetch(`${apiBase}/list-saves`);
        const data = await res.json();
        if (data.status === 'success' && data.saves.length > 0) {
          setHasSavedAnchor(true);
        } else {
          setHasSavedAnchor(false);
        }
      } catch (e) { setHasSavedAnchor(false); }
    }
    check();
  }, [apiReady, apiBase])

  // Animation preview timer
  const animRef = useRef(null)
  useEffect(() => {
    if (stage === 'editing' && frameUrls.length > 0) {
      const includedIndices = frameUrls.map((_, i) => i).filter(i => !excludedFrames.has(i))
      if (includedIndices.length === 0) return
      let pos = 0
      animRef.current = setInterval(() => {
        pos = (pos + 1) % includedIndices.length
        setAnimFrame(includedIndices[pos])
      }, 150)
      return () => clearInterval(animRef.current)
    }
  }, [stage, frameUrls.length, excludedFrames])


  const handleForgeAnchor = async () => {
    setLoading(true)
    setStage('selecting-anchor')
    setVariants([])
    
    try {
      const response = await fetch(`${apiBase}/generate-anchor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, template_id: 'default', num_variants: 4 })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setVariants(data.urls.map(url => `${apiBase}${url}`));
      }
    } catch (error) {
      console.error("Error forging anchor:", error);
    } finally {
      setLoading(false)
    }
  }

  const handleOpenSavesModal = async () => {
    try {
      const res = await fetch(`${apiBase}/list-saves`);
      const data = await res.json();
      if (data.status === 'success') {
        setSavesList(data.saves)
        setIsSaveModalOpen(true)
      }
    } catch (error) {
      console.error("Error loading saves:", error);
    }
  }

  const handleLoadSave = async (saveData) => {
    setIsSaveModalOpen(false)
    setPrompt(saveData.prompt)
    setSelectedAnchor(`${apiBase}${saveData.image_url}`)
    setStage('animating')
    
    // Auto-describe the loaded anchor with BLIP
    setDescribing(true)
    setAutoPrompt('')
    try {
      const descRes = await fetch(`${apiBase}/describe-anchor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: saveData.image_url })
      });
      const descData = await descRes.json();
      if (descData.status === 'success') {
        setAutoPrompt(descData.description)
      } else {
        setAutoPrompt(saveData.prompt)
      }
    } catch (err) {
      console.error('Error describing anchor:', err)
      setAutoPrompt(saveData.prompt)
    } finally {
      setDescribing(false)
    }
  }

  const handleSaveAnchor = async (anchorFullUrl) => {
    setSaveStatus(prev => ({ ...prev, [anchorFullUrl]: 'saving' }))
    try {
      await fetch(`${apiBase}/save-anchor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: anchorFullUrl, prompt })
      });
      setHasSavedAnchor(true)
      setSaveStatus(prev => ({ ...prev, [anchorFullUrl]: 'saved' }))
    } catch (error) {
      console.error("Error saving anchor:", error);
      setSaveStatus(prev => ({ ...prev, [anchorFullUrl]: null }))
    }
  }

  const handleAnimate = async () => {
    setLoading(true)
    
    try {
      const response = await fetch(`${apiBase}/animate-openpose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          image_url: selectedAnchor,
          prompt: autoPrompt || prompt,
          num_frames: 12
        })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setSessionId(data.session_id)
        setFrameUrls(data.frame_urls.map(u => `${apiBase}${u}`))
        setSkeletonUrls(data.skeleton_urls)
        setAnchorUrl(data.anchor_url)
        setAnimFrame(0)
        setStage('editing')
      }
    } catch (error) {
      console.error("Error animating:", error);
    } finally {
      setLoading(false)
    }
  }

  const handleRedoFrame = async (index) => {
    setRedoingFrame(index)
    try {
      const response = await fetch(`${apiBase}/regenerate-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frame_index: index,
          skeleton_url: skeletonUrls[index],
          anchor_url: anchorUrl,
          prompt: autoPrompt || prompt,
          session_id: sessionId
        })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setFrameUrls(prev => {
          const updated = [...prev]
          updated[index] = `${apiBase}${data.url}?t=${Date.now()}`
          return updated
        })
      }
    } catch (error) {
      console.error("Error redoing frame:", error);
    } finally {
      setRedoingFrame(null)
    }
  }

  const handleGenerateTurnaround = async () => {
    if (numGenerations > 1) {
      const confirmMsg = `You are about to generate ${numGenerations} unique character designs. 
      
Only the LAST image will be displayed here, but all ${numGenerations} will be saved in your Project Library as separate folders.

Continue?`;
      if (!window.confirm(confirmMsg)) return;
    }

    setGeneratingTurnaround(true)
    setIsTurnaroundModalOpen(true)
    try {
      const response = await fetch(`${apiBase}/generate-turnaround`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          session_id: Date.now().toString(),
          prompt: prompt,
          enforce_white: enforceWhite,
          num_variants: numGenerations
        })
      });
      const data = await response.json();
      if (data.status === 'success') {
        const imageUrl = data.url || data.image_url;
        setTurnaroundUrl(`${apiBase}${imageUrl}?t=${Date.now()}`)
        if (data.project_id) {
          setActiveProjectId(data.project_id);
        }
      } else {
        alert(`Generation failed: ${data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error("Error generating turnaround:", error);
      alert("Lost connection to SpriteForge backend. It may have crashed due to high VRAM usage. Check backend.log.");
    } finally {
      setGeneratingTurnaround(false)
    }
  }

  const handleSaveProject = async (silent = false, overrideVersions = null, overrideIndices = null) => {
    // Increment click count for force override
    let forceOverwrite = false;
    if (!silent) {
      const newCount = saveClickCount + 1;
      setSaveClickCount(newCount);
      forceOverwrite = newCount >= 3;
      
      if (forceOverwrite) {
        console.log(">>> [FORCE] Overwriting project file...");
        setSaveClickCount(0);
      }
    }

    try {
      const res = await fetch(`${apiBase}/save-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt,
          image_url: turnaroundUrl,
          project_id: activeProjectId,
          force_overwrite: forceOverwrite,
          all_slice_versions: overrideVersions || allSliceVersions,
          selected_indices: overrideIndices || selectedVersionIndices
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setActiveProjectId(data.project_id);
        // Ensure no double slashes and add cache buster
        const cleanPath = data.image_url.startsWith('/') ? data.image_url : `/${data.image_url}`;
        setTurnaroundUrl(`${apiBase}${cleanPath}?t=${Date.now()}`);
        setWandHistory([]);
        if (!silent) alert(`Project saved as ${data.project_id}`);
      }
    } catch (err) {
      console.error("Failed to save project:", err);
    }
  }

  const handleSlice = async () => {
    if (!turnaroundUrl) {
      alert("No turnaround image to slice!");
      return;
    }
    
    setSlicing(true)
    try {
      // Send the full URL, the backend is now robust enough to strip the base itself
      const res = await fetch(`${apiBase}/slice-turnaround`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: turnaroundUrl,
          project_id: activeProjectId,
          remover_type: removerType,
          alpha_matting: alphaMatting,
          force_reslice: forceReslice,
          foreground_threshold: removalSensitivity,
          background_threshold: Math.max(0, removalSensitivity - 230)
        }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        if (data.project_id) {
          setActiveProjectId(data.project_id);
          console.log("Project initialized:", data.project_id);
        }
        
        // Use the turnaround sheet for this project as our "Golden Base"
        const sheetUrl = `${apiBase}/output_saves/${data.project_id}/${data.project_id}_turnaround.png`;
        setOriginalTurnaroundUrl(sheetUrl);
        setTurnaroundUrl(`${sheetUrl}?t=${Date.now()}`);
        
        // Add a cache-busting timestamp so the browser actually reloads the fresh files
        const timestamp = Date.now();
        const freshUrls = data.urls.map(u => `${apiBase}${u}?t=${timestamp}`);
        setSlicedUrls(freshUrls);
        
        // Initialize versioning from backend metadata
        if (data.all_slice_versions) {
          const absoluteVersions = data.all_slice_versions.map(group => 
            group.map(url => url.startsWith('http') ? url : `${apiBase}${url}`)
          );
          setAllSliceVersions(absoluteVersions);
          setSelectedVersionIndices(absoluteVersions.map(group => Math.max(0, group.length - 1)));
        } else {
          setAllSliceVersions(freshUrls.map(url => [url]));
          setSelectedVersionIndices([0, 0, 0, 0, 0]);
        }

        setIsTurnaroundModalOpen(false)
        setStage('slicing')
      } else if (data.status === 'error') {
        alert(`Slicing failed: ${data.message}`);
      }
    } catch (err) {
      console.error("Slicing failed:", err)
    } finally {
      setSlicing(false)
    }
  }

  const fetchSavedProjects = async (mode = 'load') => {
    try {
      console.log("Fetching project list...");
      const res = await fetch(`${apiBase}/list-projects`);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.status === 'success') {
        setSavedProjects(data.saves);
        setIsDeleteMode(mode === 'delete');
        setIsResetMode(mode === 'reset');
        setIsLoadModalOpen(true);

      } else {
        alert("Server failed to list projects: " + (data.message || "Unknown error"));
      }
    } catch (err) {
      console.error("Failed to list saves:", err);
      alert(`Critical Error: Could not reach the server. ${err.message}\n\nMake sure the backend is running on port 8000-8010.`);
    }
  }

  const handleResetProject = async (project) => {
    const msg = `This will reset this folder back to the original turnaround and will delete all other images in this folder.\n\nThis cannot be undone. Continue?`;
    if (!window.confirm(msg)) return;

    
    try {
      const res = await fetch(`${apiBase}/reset-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id })
      });
      const data = await res.json();
      if (data.status === 'success') {
        fetchSavedProjects();
      }
    } catch (err) {
      console.error("Reset failed:", err);
    }
  }

  const handleDeleteProject = async (project) => {
    try {
      const res = await fetch(`${apiBase}/project/${project.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.status === 'success') {
        // Refresh the list
        const updatedRes = await fetch(`${apiBase}/list-projects`);
        const updatedData = await updatedRes.json();
        if (updatedData.status === 'success') {
          setSavedProjects(updatedData.saves);
        }
        setProjectToDelete(null);
      } else {
        alert("Failed to delete project: " + (data.message || "Unknown error"));
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
      alert(`Failed to delete project: ${err.message}`);
    }
  }

  const handleLoadProject = (project) => {
    if (!project) return;
    setActiveProjectId(project.id);
    setPrompt(project.prompt || '');
    
    // Add cache buster to ensure the image refreshes
    const sheetUrl = project.image_url ? `${apiBase}${project.image_url}` : null;
    setOriginalTurnaroundUrl(sheetUrl);
    setTurnaroundUrl(sheetUrl ? `${sheetUrl}?t=${Date.now()}` : null);
    
    // Restore versioning history if present
    if (project.all_slice_versions && project.all_slice_versions.length > 0) {
      // Ensure we have absolute URLs for the UI
      const restored = project.all_slice_versions.map(group => 
        group.map(url => url.startsWith('http') ? url : `${apiBase}${url}`)
      );
      setAllSliceVersions(restored);
      setSelectedVersionIndices(project.selected_indices || [0,0,0,0,0]);
      
      // Update the current display URLs to match the selected versions
      const currentUrls = restored.map((group, idx) => {
        const vIdx = (project.selected_indices || [0,0,0,0,0])[idx];
        return group[vIdx] || group[0];
      });
      setSlicedUrls(currentUrls);
      setStage('slicing');
    }

    setIsLoadModalOpen(false);
    setIsTurnaroundModalOpen(true);
    setWandHistory([]);
  }



  const handleWandClick = (e) => {
    if (!isWandActive || !turnaroundUrl) return;
    
    const img = e.target;
    const rect = img.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * img.naturalWidth);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * img.naturalHeight);
    
    // Use a canvas to process the image
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const targetIdx = (y * canvas.width + x) * 4;
    const targetR = data[targetIdx];
    const targetG = data[targetIdx + 1];
    const targetB = data[targetIdx + 2];
    
    // Tolerance for matching (higher = more aggressive)
    const tolerance = 45;
    
    // Queue for flood fill
    const queue = [[x, y]];
    const visited = new Set();
    
    while (queue.length > 0) {
      const [cx, cy] = queue.shift();
      if (cx < 0 || cx >= canvas.width || cy < 0 || cy >= canvas.height) continue;
      
      const key = `${cx},${cy}`;
      if (visited.has(key)) continue;
      visited.add(key);
      
      const idx = (cy * canvas.width + cx) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      // Match if color is within tolerance of the clicked pixel
      const dist = Math.sqrt(
        Math.pow(r - targetR, 2) + 
        Math.pow(g - targetG, 2) + 
        Math.pow(b - targetB, 2)
      );
      
      if (dist < tolerance) {
        data[idx + 3] = 0; // Make transparent
        queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
    setWandHistory(prev => [...prev, turnaroundUrl]);
    setTurnaroundUrl(canvas.toDataURL());
  }

  const handleUndo = () => {
    if (wandHistory.length === 0) return;
    const previous = wandHistory[wandHistory.length - 1];
    setWandHistory(prev => prev.slice(0, -1));
    setTurnaroundUrl(previous);
  }

  const openOutputFolder = async () => {
    try {
      await fetch(`${apiBase}/open-output-folder`);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }



  const toggleExcludeFrame = (index) => {
    setExcludedFrames(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleStitchFrames = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${apiBase}/stitch-frames`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          frame_urls: frameUrls.filter((_, i) => !excludedFrames.has(i)),
          project_id: activeProjectId
        })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setSpritesheetUrl(`${apiBase}${data.url}`)
        setStage('preview')
      }
    } catch (error) {
      console.error("Error stitching:", error);
    } finally {
      setLoading(false)
    }
  }








  const handleQuickFix = async (index, specificDirection = null) => {
    setLoading(true);
    const dir = specificDirection || sliceDirections[index] || targetRotation;
    try {
      const res = await fetch(`${apiBase}/correct-pose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: activeProjectId,
          sheet_url: originalTurnaroundUrl || turnaroundUrl,
          slice_index: index,
          target_rotation: dir
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        const newUrl = `${apiBase}${data.url}`;
        setTurnaroundUrl(`${newUrl}?t=${Date.now()}`);
        
        // Re-slice automatically to update individual pose files
        const sliceRes = await fetch(`${apiBase}/slice-turnaround`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            image_url: data.url, 
            project_id: activeProjectId, 
            force_reslice: true,
            target_slice_index: index
          })
        });
        const sliceData = await sliceRes.json();
        if (sliceData.status === 'success') {
          // Use the version history directly from the backend metadata
          const freshUrls = sliceData.urls.map(u => `${apiBase}${u}?t=${Date.now()}`);
          
          if (sliceData.all_slice_versions) {
            const absoluteVersions = sliceData.all_slice_versions.map(group => 
              group.map(url => url.startsWith('http') ? url : `${apiBase}${url}`)
            );
            setAllSliceVersions(absoluteVersions);
            
            // SURGICAL UPDATE: Only auto-select the latest for the slice we just fixed
            let newIndices = [0, 0, 0, 0, 0];
            setSelectedVersionIndices(prev => {
              newIndices = [...prev];
              newIndices[index] = Math.max(0, absoluteVersions[index].length - 1);
              return newIndices;
            });

            // Persist immediately so it's there if the user navigates away
            handleSaveProject(true, absoluteVersions, newIndices);
          }

          setSlicedUrls(freshUrls);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const handleFixPose = async (maskBase64) => {
    setIsMasking(false);
    


    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/correct-pose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: activeProjectId,
          sheet_url: originalTurnaroundUrl || turnaroundUrl,
          mask_image: maskBase64,
          target_rotation: targetRotation
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        const newUrl = `${apiBase}${data.url}`;
        setTurnaroundUrl(`${newUrl}?t=${Date.now()}`);
        
        // Re-slice automatically to update individual pose files
        alert("Pose corrected! Re-slicing character sheet to update poses...");
        
        // We call handleSlice with the new URL
        const sliceRes = await fetch(`${apiBase}/slice-turnaround`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: data.url,
            project_id: activeProjectId,
            remover_type: removerType,
            alpha_matting: alphaMatting,
            force_reslice: true, // MUST force to update files
            foreground_threshold: removalSensitivity,
            background_threshold: Math.max(0, removalSensitivity - 230),
            target_slice_index: activeSurgicalIndex
          }),
        });

        const sliceData = await sliceRes.json();
        if (sliceData.status === 'success') {
            const freshUrls = sliceData.urls.map(u => `${apiBase}${u}?t=${Date.now()}`);
            
            let absoluteVersions = [];
            if (sliceData.all_slice_versions) {
              absoluteVersions = sliceData.all_slice_versions.map(group => 
                group.map(url => url.startsWith('http') ? url : `${apiBase}${url}`)
              );
              setAllSliceVersions(absoluteVersions);
            } else {
              // Fallback if not provided (shouldn't happen with new backend)
              absoluteVersions = allSliceVersions;
            }

            // Auto-select newest versions that were added
            let newIndices = [0,0,0,0,0];
            setSelectedVersionIndices(prev => {
              newIndices = prev.map((vIdx, idx) => {
                // If we added a new version, select it
                return absoluteVersions[idx] ? absoluteVersions[idx].length - 1 : vIdx; 
              });
              return newIndices;
            });

            setSlicedUrls(freshUrls);
            
            // Persist immediately
            handleSaveProject(true, absoluteVersions, newIndices);

        }
      }
    } catch (err) {
      console.error("Pose correction failed:", err);
    } finally {
      setLoading(false);
    }
  }



  const selectAnchor = async (variant) => {
    setSelectedAnchor(variant)
    setStage('animating')
    setDescribing(true)
    setAutoPrompt('')
    try {
      const url = new URL(variant)
      const response = await fetch(`${apiBase}/describe-anchor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: url.pathname })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setAutoPrompt(data.description)
      } else {
        setAutoPrompt(prompt) // Fallback to original prompt
      }
    } catch (error) {
      console.error('Error describing anchor:', error)
      setAutoPrompt(prompt) // Fallback to original prompt
    } finally {
      setDescribing(false)
    }
  }

  const reset = () => {
    setStage('prompt')
    setPrompt('')
    setVariants([])
    setSelectedAnchor(null)
    setSpritesheetUrl(null)
    setFrameUrls([])
    setSkeletonUrls([])
    setSessionId(null)
    setAnchorUrl(null)
    setExcludedFrames(new Set())
    setAutoPrompt('')
    setDescribing(false)
    
    // PROJECT STATE RESET
    setActiveProjectId(null)
    setTurnaroundUrl(null)
    setOriginalTurnaroundUrl(null)
    setSlicedUrls([])
    setAllSliceVersions([[], [], [], [], []])
    setSelectedVersionIndices([0, 0, 0, 0, 0])
  }

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Z for Undo
      if (e.ctrlKey && e.key === 'z') {
        if (stage === 'prompt' && isTurnaroundModalOpen) {
          handleUndo();
        }
      }
      // Ctrl+S for Save
      if (e.ctrlKey && e.key === 's') {
        if (stage === 'prompt' && isTurnaroundModalOpen) {
          e.preventDefault();
          handleSaveProject();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stage, isTurnaroundModalOpen, wandHistory, activeProjectId, turnaroundUrl, prompt]);

  return (
    <div className="app-container">
      <header className="fade-in" style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 style={{ fontSize: '3.5rem', fontWeight: 800, marginBottom: '1rem', cursor: 'pointer' }} onClick={reset}>
          Sprite<span className="gradient-text">Forge</span>
        </h1>
        <p style={{ color: 'var(--text-dim)', fontSize: '1.2rem', maxWidth: '600px', margin: '0 auto' }}>
          Turn your ideas into fully animated, game-ready sprite sheets using advanced AI.
        </p>
      </header>

      <main>
        <AnimatePresence mode="wait">
          {stage === 'prompt' && (
            <motion.div 
              key="prompt"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-card"
              style={{ maxWidth: '800px', margin: '0 auto', position: 'relative' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                <Sparkles size={20} color="var(--accent-primary)" />
                <h2 style={{ fontSize: '1.5rem' }}>Imagine your Character</h2>
              </div>
              
              <textarea 
                placeholder="Describe your character (e.g., 'A cyberpunk ronin with a neon katana, pixel art style, south facing, neutral pose')"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                style={{ height: '120px', resize: 'none', marginBottom: '2rem' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px' }}>
                <div style={{ display: 'flex', gap: '0.8rem' }}>
                  <button 
                    className="btn-secondary" 
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.6rem', minWidth: '40px' }} 
                    onClick={() => setIsOptionsOpen(true)}
                    disabled={!apiReady}
                    title="Pipeline Options"
                  >
                    <Settings size={16} />
                  </button>

                  <button 
                    className="btn-secondary" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1rem', fontSize: '0.85rem' }}
                    onClick={() => fetchSavedProjects('load')}
                    disabled={!apiReady}
                  >
                    <FolderOpen size={16} />
                    Load Saved Sprite
                  </button>
                  <button 
                    className="btn-secondary" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1rem', fontSize: '0.85rem', borderColor: '#ef444466' }}
                    onClick={() => fetchSavedProjects('delete')}

                    disabled={!apiReady}
                  >
                    <Trash2 size={16} color="#ef4444" />
                    Delete Sprite
                  </button>
                  <button 
                    className="btn-secondary" 
                    style={{ 
                      display: 'flex', alignItems: 'center', justifyContent: 'center', 
                      padding: '0.6rem', minWidth: '40px', fontSize: '0.75rem', fontWeight: 'bold',
                      borderColor: 'rgba(139, 92, 246, 0.3)', color: 'var(--accent-primary)'
                    }} 
                    onClick={() => fetchSavedProjects('reset')}
                    disabled={!apiReady}
                    title="Surgical Reset (SR)"
                  >
                    SR
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <select 
                      value={numGenerations}
                      onChange={(e) => setNumGenerations(parseInt(e.target.value))}
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--glass-border)',
                        color: 'white',
                        padding: '0.6rem 2rem 0.6rem 0.8rem',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        appearance: 'none',
                        textAlign: 'center',
                        minWidth: '60px'
                      }}
                      title="Number of variants to generate"
                    >
                      {[1,2,3,4,5,6,7,8,9].map(n => (
                        <option key={n} value={n} style={{ background: '#111' }}>{n}</option>
                      ))}
                    </select>
                    <div style={{ position: 'absolute', right: '0.8rem', pointerEvents: 'none', fontSize: '0.7rem', opacity: 0.5 }}>▼</div>
                  </div>

                  <button 
                    className="btn-primary" 
                    style={{ 
                      display: 'flex', alignItems: 'center', gap: '0.4rem', 
                      padding: '0.6rem 1.2rem', fontSize: '0.85rem',
                      background: 'linear-gradient(to right, #8b5cf6, #d946ef)' 
                    }}
                    onClick={handleGenerateTurnaround}
                    disabled={!prompt.trim() || generatingTurnaround || !apiReady}
                  >
                    {generatingTurnaround ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    FLUX Turnaround (Exp)
                  </button>
                </div>
              </div>

              <button 
                style={{ 
                  position: 'absolute', bottom: '6px', right: '6px', 
                  background: 'none', border: 'none', color: '#333', 
                  cursor: 'pointer', padding: '4px', borderRadius: '4px'
                }}
                onClick={openOutputFolder}
                title="Open project folder"
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#444'}
              >
                <FolderOpen size={16} />
              </button>
            </motion.div>
          )}

          {stage === 'selecting-anchor' && (
            <motion.div
              key="selecting-anchor"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              style={{ textAlign: 'center' }}
            >
              <h2 style={{ marginBottom: '2rem' }}>Select your <span className="gradient-text">Base Sprite</span></h2>
              
              {loading && variants.length === 0 ? (
                <div style={{ padding: '4rem' }}>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                    style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}
                  >
                    <Loader2 size={48} color="var(--accent-primary)" />
                  </motion.div>
                  <p>Forging variants from your prompt...</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>This uses deep learning to generate 4 unique versions</p>
                </div>
              ) : (
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
                  gap: '1.5rem',
                  marginBottom: '3rem',
                  maxWidth: '1200px',
                  margin: '0 auto 3rem'
                }}>
                  {variants.map((v, i) => (
                    <motion.div 
                      key={i} 
                      className="glass-card" 
                      style={{ padding: '0', overflow: 'hidden', cursor: 'pointer', height: '380px', display: 'flex', flexDirection: 'column' }}
                      whileHover={{ scale: 1.02 }}
                      onClick={() => selectAnchor(v)}
                    >
                      <div style={{ flex: 1, background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '1rem' }}>
                        <img src={v} alt={`Variant ${i}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} />
                      </div>
                      <div style={{ padding: '0.75rem', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: '0.5rem' }}>
                        <button className="btn-secondary" style={{ flex: 1 }}>Select</button>
                        <button 
                          className="btn-secondary" 
                          style={{ 
                            display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.5rem 0.75rem',
                            borderColor: saveStatus[v] === 'saved' ? '#4ade80' : undefined,
                            color: saveStatus[v] === 'saved' ? '#4ade80' : undefined,
                            background: saveStatus[v] === 'saved' ? 'rgba(74, 222, 128, 0.1)' : undefined
                          }}
                          onClick={(e) => { e.stopPropagation(); handleSaveAnchor(v); }}
                          title="Save this anchor permanently"
                          disabled={saveStatus[v] === 'saving' || saveStatus[v] === 'saved'}
                        >
                          {saveStatus[v] === 'saving' ? <Loader2 size={14} className="animate-spin" /> : 
                           saveStatus[v] === 'saved' ? <Check size={14} /> : 
                           <Save size={14} />}
                          {saveStatus[v] === 'saved' && <span style={{fontSize: '0.7rem'}}>Saved!</span>}
                        </button>
                      </div>
                    </motion.div>
                  ))}
                  {loading && (
                     <div className="glass-card" style={{ height: '380px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem' }}>
                        <Loader2 size={32} className="animate-spin" color="var(--accent-primary)" />
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>Forging next variant...</p>
                     </div>
                  )}
                </div>
              )}
              {!loading && <button className="btn-secondary" onClick={() => setStage('prompt')}>Back to Prompt</button>}
            </motion.div>
          )}

          {stage === 'animating' && (
            <motion.div
              key="animating"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="glass-card"
              style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}
            >
              <h2 style={{ marginBottom: '1.5rem' }}>Next: <span className="gradient-text">Add Motion</span></h2>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
                <img src={selectedAnchor} alt="Selected" style={{ width: '128px', height: '128px', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '1rem', background: '#111', imageRendering: 'pixelated' }} />
              </div>
              
              {loading ? (
                <div style={{ padding: '2rem' }}>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                    style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}
                  >
                    <Loader2 size={48} color="var(--accent-secondary)" />
                  </motion.div>
                  <p>Forging 12-frame walk cycle...</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>Full frame-by-frame walk cycle generation.</p>
                </div>
              ) : (
                <>
                  {describing ? (
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: 'var(--accent-primary)' }}>
                        <Loader2 size={16} className="animate-spin" />
                        <span style={{ fontSize: '0.9rem' }}>PaliGemma is analyzing your character...</span>
                      </div>
                    </div>
                  ) : autoPrompt ? (
                    <div style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem', display: 'block' }}>
                        AI-Generated Prompt (edit as needed)
                      </label>
                      <textarea
                        value={autoPrompt}
                        onChange={(e) => setAutoPrompt(e.target.value)}
                        style={{ height: '80px', resize: 'vertical', fontSize: '0.85rem', lineHeight: '1.4' }}
                      />
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.4rem' }}>
                        This describes what BLIP sees in your anchor. Edit to remove unwanted details (e.g., hats) before generating.
                      </p>
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-dim)', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                      We'll generate a 12-frame walk cycle using clean skeleton references. You can redo any frame afterwards.
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <button className="btn-secondary" onClick={() => setStage('selecting-anchor')}>
                      <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Back
                    </button>
                    <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={handleAnimate} disabled={describing || generatingTurnaround}>
                      <Play size={18} />
                      Forge Walk Cycle
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {stage === 'editing' && (
            <motion.div
              key="editing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ maxWidth: '1200px', margin: '0 auto' }}
            >
              <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>
                Refine your <span className="gradient-text">Walk Cycle</span>
              </h2>

              {/* Main layout: frame grid on left, preview on right */}
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                {/* Frame grid: 6 columns x 2 rows = 12 frames */}
                <div style={{ 
                  flex: 1,
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(6, 1fr)', 
                  gap: '0.75rem'
                }}>
                  {frameUrls.map((url, i) => (
                    <motion.div
                      key={i}
                      className="glass-card"
                      style={{ padding: '0', overflow: 'hidden', textAlign: 'center', opacity: excludedFrames.has(i) ? 0.35 : 1 }}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <div style={{ 
                        background: animFrame === i ? '#1a1a2e' : '#0a0a0a',
                        border: animFrame === i ? '2px solid var(--accent-secondary)' : '2px solid transparent',
                        padding: '0.5rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        height: '120px',
                        position: 'relative',
                        transition: 'border-color 0.15s'
                      }}>
                        <img 
                          src={url} 
                          alt={`Frame ${i + 1}`} 
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
                        />
                        <span style={{
                          position: 'absolute', top: '4px', left: '6px',
                          fontSize: '0.6rem', color: 'var(--text-dim)',
                          background: 'rgba(0,0,0,0.7)', padding: '1px 5px', borderRadius: '3px'
                        }}>F{i + 1}</span>
                      </div>
                      <div style={{ padding: '0.35rem', display: 'flex', gap: '0.25rem' }}>
                        <button 
                          className="btn-secondary" 
                          style={{ 
                            flex: 1, 
                            fontSize: '0.7rem', 
                            padding: '0.3rem 0.4rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.25rem',
                            opacity: redoingFrame !== null ? 0.5 : 1
                          }}
                          onClick={() => handleRedoFrame(i)}
                          disabled={redoingFrame !== null}
                        >
                          {redoingFrame === i ? (
                            <><Loader2 size={10} className="animate-spin" /> Redoing...</>
                          ) : (
                            <><RefreshCw size={10} /> Redo</>
                          )}
                        </button>
                        <label
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.2rem',
                            fontSize: '0.6rem', color: excludedFrames.has(i) ? '#f44' : 'var(--text-dim)',
                            cursor: 'pointer', padding: '0 0.3rem',
                            userSelect: 'none'
                          }}
                          title={excludedFrames.has(i) ? 'Excluded from sprite sheet' : 'Click to exclude'}
                        >
                          <input
                            type="checkbox"
                            checked={excludedFrames.has(i)}
                            onChange={() => toggleExcludeFrame(i)}
                            style={{ width: '12px', height: '12px', cursor: 'pointer', accentColor: '#f44' }}
                          />
                          ✕
                        </label>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Animation Preview panel */}
                <motion.div
                  className="glass-card"
                  style={{ 
                    padding: '0', 
                    overflow: 'hidden', 
                    width: '220px',
                    minWidth: '220px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                  }}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <span style={{ 
                    fontSize: '0.75rem', 
                    color: 'var(--accent-secondary)', 
                    fontWeight: 600, 
                    marginTop: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em'
                  }}>Preview</span>
                  <div style={{ 
                    background: '#0a0a0a', 
                    width: '100%', 
                    height: '250px',
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    padding: '1rem'
                  }}>
                    {frameUrls.length > 0 && (
                      <img 
                        src={frameUrls[animFrame]} 
                        alt="Animation preview" 
                        style={{ 
                          maxHeight: '220px', 
                          maxWidth: '100%', 
                          objectFit: 'contain', 
                          imageRendering: 'pixelated' 
                        }}
                      />
                    )}
                  </div>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', padding: '0.5rem' }}>
                    Frame {animFrame + 1}/{frameUrls.length} ({frameUrls.length - excludedFrames.size} included)
                  </span>
                </motion.div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                <button className="btn-secondary" onClick={() => { setStage('animating'); setFrameUrls([]); }}>
                  <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Re-forge All
                </button>
                <button 
                  className="btn-primary" 
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 2rem' }}
                  onClick={handleStitchFrames}
                  disabled={loading || redoingFrame !== null}
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  {loading ? 'Stitching...' : 'Finalize Sprite Sheet'}
                </button>
              </div>
            </motion.div>
          )}

          {stage === 'preview' && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
              style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}
            >
              <h2 style={{ marginBottom: '1.5rem' }}>Final <span className="gradient-text">Sprite Sheet</span></h2>
              <div style={{ background: '#000', borderRadius: '12px', padding: '1rem', marginBottom: '2rem', overflow: 'hidden', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {spritesheetUrl && (
                  <div style={{ overflowX: 'auto', width: '100%' }}>
                    <img src={spritesheetUrl} alt="Spritesheet" style={{ height: '200px', imageRendering: 'pixelated', maxWidth: 'none' }} />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => setStage('editing')}>
                  <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Back to Editor
                </button>
                {spritesheetUrl && (
                  <a href={spritesheetUrl} download="spritesheet.png" className="btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 2rem' }}>
                    <Download size={18} />
                    Download Sprite Sheet
                  </a>
                )}
              </div>
            </motion.div>
          )}

          {stage === 'slicing' && (
            <motion.div
              key="slicing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
              style={{ maxWidth: '1200px', margin: '0 auto', textAlign: 'center' }}
            >
              <h2 style={{ marginBottom: '1.5rem' }}>Segmented <span className="gradient-text">Character Poses</span></h2>
              <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>
                OpenCV has automatically detected, isolated, and removed the background from each pose.
              </p>
              
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(5, 1fr)', 
                gap: '1rem',
                marginBottom: '3rem'
              }}>
                {slicedUrls.map((url, i) => {
                  const versions = allSliceVersions[i] || [];
                  const currentVIdx = selectedVersionIndices[i] || 0;
                  
                  const handlePrevVersion = () => {
                    const newIdx = Math.max(0, currentVIdx - 1);
                    const newIndices = [...selectedVersionIndices];
                    newIndices[i] = newIdx;
                    setSelectedVersionIndices(newIndices);
                    
                    const newUrls = [...slicedUrls];
                    newUrls[i] = versions[newIdx];
                    setSlicedUrls(newUrls);
                  };

                  const handleNextVersion = () => {
                    const newIdx = Math.min(versions.length - 1, currentVIdx + 1);
                    const newIndices = [...selectedVersionIndices];
                    newIndices[i] = newIdx;
                    setSelectedVersionIndices(newIndices);
                    
                    const newUrls = [...slicedUrls];
                    newUrls[i] = versions[newIdx];
                    setSlicedUrls(newUrls);
                  };

                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div className="glass-card" style={{ padding: '0', overflow: 'hidden', height: '250px', background: 'rgba(255,255,255,0.02)', position: 'relative' }}>
                        
                        {/* Version Navigation Arrows */}
                        {versions.length > 1 && (
                          <>
                            <button 
                              onClick={handlePrevVersion}
                              disabled={currentVIdx === 0}
                              style={{ 
                                position: 'absolute', left: '5px', top: '50%', transform: 'translateY(-50%)',
                                background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)',
                                color: currentVIdx === 0 ? '#444' : 'white', borderRadius: '50%', padding: '4px',
                                zIndex: 10, cursor: currentVIdx === 0 ? 'default' : 'pointer'
                              }}
                            >
                              <ChevronLeft size={16} />
                            </button>
                            <button 
                              onClick={handleNextVersion}
                              disabled={currentVIdx === versions.length - 1}
                              style={{ 
                                position: 'absolute', right: '5px', top: '50%', transform: 'translateY(-50%)',
                                background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)',
                                color: currentVIdx === versions.length - 1 ? '#444' : 'white', borderRadius: '50%', padding: '4px',
                                zIndex: 10, cursor: currentVIdx === versions.length - 1 ? 'default' : 'pointer'
                              }}
                            >
                              <ChevronRight size={16} />
                            </button>
                            <div style={{ 
                              position: 'absolute', bottom: '8px', left: '50%', transform: 'translateX(-50%)',
                              fontSize: '0.6rem', color: 'var(--accent-secondary)', background: 'rgba(0,0,0,0.7)',
                              padding: '2px 8px', borderRadius: '10px', zIndex: 5, border: '1px solid rgba(217, 70, 239, 0.2)'
                            }}>
                              V{currentVIdx + 1} / {versions.length}
                            </div>
                          </>
                        )}

                        <div style={{ 
                          height: '100%', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          background: 'repeating-conic-gradient(#111 0% 25%, transparent 0% 50%) 50% / 20px 20px'
                        }}>
                          <img src={url} alt={`Pose ${i}`} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                        </div>
                      </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>Slice {i+1}</div>
                        <select 
                           value={sliceDirections[i]} 
                           onChange={(e) => handleSetSliceDirection(i, e.target.value)}
                           style={{ fontSize: '0.6rem', background: '#222', color: 'white', border: '1px solid #444', borderRadius: '4px', padding: '2px 4px' }}
                        >
                           <option value="front">Front</option>
                           <option value="side">Side</option>
                           <option value="back">Back</option>
                           <option value="front-quarter">3/4 Front</option>
                           <option value="back-quarter">3/4 Back</option>
                        </select>
                      </div>
                      <button 
                        className="btn-secondary" 
                        style={{ 
                          padding: '6px 8px', 
                          fontSize: '0.65rem', 
                          color: loading ? '#666' : 'var(--accent-primary)', 
                          borderColor: loading ? '#333' : 'rgba(139, 92, 246, 0.3)', 
                          width: '100%', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          gap: '0.4rem',
                          cursor: loading ? 'not-allowed' : 'pointer',
                          background: loading ? 'rgba(255,255,255,0.02)' : undefined
                        }}
                        onClick={() => handleQuickFix(i, sliceDirections[i])}
                        disabled={loading}
                      >
                        {loading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                        {loading ? 'Processing...' : `Quick Fix ${i+1}`}
                      </button>


                      <button 
                        className="btn-secondary" 
                        style={{ 
                          marginTop: '0.4rem',
                          fontSize: '0.65rem', 
                          color: '#38bdf8', 
                          borderColor: 'rgba(56, 189, 248, 0.3)', 
                          width: '100%', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          gap: '0.4rem'
                        }}
                        onClick={async () => {
                          setSelectedVideoSlice(slicedUrls[i]);
                          const templatePrompt = `Image 1 role: identity anchor. Preserve exact character colors and materials.
Side-view game sprite walk cycle. Character facing right. Character remains centered in frame as if walking on treadmill.
Generate clean animation frames only. Maintain original color palette. 
No color grading. No cinematic lighting. No bloom. No purple tint. No stylization. No blur.
Primary request: create 24-frame fluid walking sequence.
Flat opaque green background #2E8B57.`;
                          setVideoPrompt(templatePrompt);
                          setStage('video-forge');
                          // Trigger auto-start/warmup on the main backend
                          setIsWarmingUp(true);
                          try {
                            fetch(`${apiBase}/warmup-video-forge`).then(r => r.json()).then(data => {
                              if (data.status === 'success') {
                                console.log("Video Forge Warmup Initiated at:", data.url);
                                setVideoApiBase(data.url);
                              }
                            });
                          } catch (e) {
                            console.error("Warmup trigger failed:", e);
                          }
                        }}
                      >
                        <Video size={12} />
                        {rapidEngineReady ? 'Push to RAPID Forge' : 'Push to Video Forge'}
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>


              
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => { setStage('prompt'); setSlicedUrls([]); }}>
                  <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Start Over
                </button>
                <button className="btn-secondary" onClick={() => { setStage('prompt'); setIsTurnaroundModalOpen(true); }}>
                  <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Back to Turnaround
                </button>

              </div>
            </motion.div>
          )}



          {stage === 'video-forge' && (
            <motion.div
              key="video-forge"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card"
              style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div style={{ textAlign: 'left' }}>
                  <h2 style={{ margin: 0 }}>Video <span className="gradient-text">Forge</span></h2>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>Cinematic Sprite Generation Pipeline</p>
                </div>
                
                <div style={{ 
                  background: videoEngineReady ? 'rgba(74, 222, 128, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                  border: `1px solid ${videoEngineReady ? '#4ade80' : '#ef4444'}`,
                  padding: '0.5rem 1rem',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem'
                }}>
                  <div style={{ 
                    width: '10px', height: '10px', borderRadius: '50%', 
                    background: videoEngineReady ? '#4ade80' : '#ef4444',
                    boxShadow: videoEngineReady ? '0 0 10px #4ade80' : 'none'
                  }} />
                  <span style={{ fontSize: '0.8rem', color: videoEngineReady ? '#4ade80' : '#ef4444', fontWeight: 'bold' }}>
                    {videoEngineReady ? 'ENGINE READY' : 'ENGINE OFFLINE'}
                  </span>
                  
                  {/* Persistent Warmup Button */}
                  <button 
                    className="btn-primary" 
                    title="Restart Video Engine"
                    style={{ 
                      padding: '4px 8px', 
                      background: isWarmingUp ? '#3b82f6' : 'rgba(255,255,255,0.05)', 
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px'
                    }}
                    onClick={async () => {
                      setIsWarmingUp(true);
                      try {
                        const r = await fetch(`${apiBase}/warmup-video-forge`);
                        const data = await r.json();
                        if (data.status === 'success') {
                          console.log("Warmup initiated.");
                        }
                      } catch (e) {
                        console.error("Warmup failed:", e);
                        setIsWarmingUp(false);
                      }
                    }}
                  >
                    {isWarmingUp ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
                  </button>
                </div>
              </div>

              {!videoEngineReady && (
                <div className="glass-card" style={{ 
                  background: isWarmingUp ? 'rgba(59, 130, 246, 0.05)' : 'rgba(239, 68, 68, 0.05)', 
                  borderColor: isWarmingUp ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)', 
                  marginBottom: '2rem', padding: '2rem' 
                }}>
                   {isWarmingUp ? (
                     <>
                       <p style={{ color: '#3b82f6', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
                         <Loader2 className="animate-spin" size={18} /> Warming Up Engine...
                       </p>
                       <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
                         The Video Forge is initializing AI models and clearing VRAM. This can take up to 60 seconds.
                       </p>
                     </>
                   ) : (
                     <>
                       <p style={{ color: '#ef4444', fontWeight: 'bold' }}>⚠️ Engine Connection Lost</p>
                       <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
                         The Video Forge is not responding. Click the <Zap size={14} /> lightning icon above to jump-start it.
                       </p>
                     </>
                   )}
                </div>
              )}

              {/* Mode Toggle */}
              <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '4px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <button onClick={() => setBatchMode(false)} style={{ flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', background: !batchMode ? 'linear-gradient(to right, #3b82f6, #8b5cf6)' : 'transparent', color: !batchMode ? '#fff' : '#666', transition: 'all 0.2s' }}>
                  <Video size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />Single
                </button>
                <button onClick={() => setBatchMode(true)} style={{ flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', background: batchMode ? 'linear-gradient(to right, #f59e0b, #ef4444)' : 'transparent', color: batchMode ? '#fff' : '#666', transition: 'all 0.2s' }}>
                  <Play size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />Batch Mode
                </button>
              </div>

              {/* Duration & Quality Toggles */}
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '0', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '4px', border: '1px solid rgba(255,255,255,0.06)', flex: 1 }}>
                  <span style={{ padding: '0.4rem 0.6rem', fontSize: '0.65rem', color: '#555', fontWeight: 'bold' }}>⏱</span>
                  {durationOptions.map(opt => (
                    <button key={opt.frames} onClick={() => setAnimDuration(opt.frames)} style={{ flex: 1, padding: '0.4rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', background: animDuration === opt.frames ? 'linear-gradient(to right, #10b981, #059669)' : 'transparent', color: animDuration === opt.frames ? '#fff' : '#666', transition: 'all 0.2s' }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '4px', border: '1px solid rgba(255,255,255,0.06)', flex: 1 }}>
                  <span style={{ padding: '0.4rem 0.6rem', fontSize: '0.65rem', color: '#555', fontWeight: 'bold' }}>✨</span>
                  {qualityOptions.map(opt => (
                    <button key={opt.steps} onClick={() => setAnimQuality(opt.steps)} style={{ flex: 1, padding: '0.4rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem', background: animQuality === opt.steps ? 'linear-gradient(to right, #8b5cf6, #6366f1)' : 'transparent', color: animQuality === opt.steps ? '#fff' : '#666', transition: 'all 0.2s' }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {!batchMode ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="glass-card" style={{ 
                    padding: '0', 
                    overflow: 'hidden', 
                    height: '300px', 
                    background: '#2E8B57',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <img 
                      src={selectedVideoSlice?.startsWith('http') ? selectedVideoSlice : `${apiBase}${selectedVideoSlice}`} 
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', filter: 'drop-shadow(0 0 10px rgba(0,0,0,0.3))' }} 
                      alt="Target Slice" 
                    />
                  </div>
                  
                  <div style={{ textAlign: 'left' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'block' }}>Motion Prompt</label>
                    <textarea 
                      placeholder="Describe the cinematic motion..."
                      value={videoPrompt}
                      onChange={(e) => setVideoPrompt(e.target.value)}
                      style={{ height: '100px', resize: 'none' }}
                      disabled={videoStage === 'generating'}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="btn-secondary" onClick={() => setStage('slicing')} disabled={videoStage === 'generating'}>
                      <ArrowLeft size={18} /> Back to Slices
                    </button>
                    <button 
                      className="btn-primary" 
                      style={{ flex: 1, background: 'linear-gradient(to right, #3b82f6, #8b5cf6)' }}
                      onClick={handleForgeVideo}
                      disabled={!videoEngineReady || videoStage === 'generating' || !videoPrompt}
                    >
                      {videoStage === 'generating' ? <Loader2 size={18} className="animate-spin" /> : <Video size={18} />}
                      {videoStage === 'generating' ? 'Forging Video...' : 'Forge Cinematic Video'}
                    </button>
                  </div>
                </div>

                <div className="glass-card" style={{ background: '#020202', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', position: 'relative' }}>
                  {videoStage === 'idle' && (
                    <div style={{ color: '#333', textAlign: 'center' }}>
                      <Video size={48} style={{ marginBottom: '1rem', opacity: 0.2 }} />
                      <p>Awaiting generation...</p>
                    </div>
                  )}

                  {videoStage === 'generating' && (
                    <div style={{ width: '100%', padding: '2rem' }}>
                      <Loader2 size={48} className="animate-spin" color="var(--accent-primary)" style={{ marginBottom: '1.5rem' }} />
                      <h3 style={{ marginBottom: '1rem' }}>{videoHeartbeat.status}</h3>
                      <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', overflow: 'hidden', marginBottom: '0.5rem' }}>
                        <motion.div initial={{ width: 0 }} animate={{ width: `${videoHeartbeat.progress}%` }} style={{ height: '100%', background: 'linear-gradient(to right, #3b82f6, #8b5cf6)' }} />
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Progress: {videoHeartbeat.progress}%</p>
                      <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                         <p style={{ fontSize: '0.7rem', color: '#666' }}>Note: Initial generation takes ~9 minutes to load WanVideo GGUF models. Subsequent generations will be significantly faster.</p>
                      </div>
                    </div>
                  )}

                  {videoStage === 'done' && videoUrl && (
                    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                      <video src={videoUrl} controls autoPlay loop style={{ width: '100%', height: '100%', borderRadius: '8px', objectFit: 'contain' }} />
                      <button className="btn-secondary" style={{ position: 'absolute', top: '10px', right: '10px', padding: '0.4rem 0.8rem', fontSize: '0.7rem' }} onClick={() => window.open(videoUrl)}>
                        <Download size={14} /> Download MP4
                      </button>
                    </div>
                  )}
                </div>
              </div>
              ) : (
              /* ─── BATCH MODE ─── */
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                {/* Left: Preset Editor */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Preset Selector */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select value={selectedPresetId} onChange={e => { setSelectedPresetId(e.target.value); loadPreset(e.target.value); }} style={{ flex: 1, padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.85rem' }}>
                      {presetList.map(p => <option key={p.id} value={p.id}>{p.view_name} ({p.animation_count})</option>)}
                    </select>
                    <button className="btn-secondary" style={{ padding: '0.5rem 0.8rem', fontSize: '0.75rem' }} onClick={() => {
                      const name = prompt('New view name (e.g., "Three Quarter")');
                      if (!name) return;
                      const id = name.toLowerCase().replace(/\s+/g, '_');
                      const newPreset = { view_name: name, animations: [] };
                      fetch(`${apiBase}/api/presets/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPreset) })
                        .then(() => { loadPresetList(); setSelectedPresetId(id); loadPreset(id); });
                    }}>+ View</button>
                  </div>

                  {/* Animation List */}
                  <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {(currentPreset?.animations || []).map((anim, idx) => (
                      <div key={anim.id} style={{ background: batchChecked[anim.id] ? 'rgba(74, 222, 128, 0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${batchChecked[anim.id] ? 'rgba(74, 222, 128, 0.2)' : 'rgba(255,255,255,0.06)'}`, borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input type="checkbox" checked={batchChecked[anim.id] || false} onChange={e => setBatchChecked(prev => ({ ...prev, [anim.id]: e.target.checked }))} />
                          
                          {editingAnim === anim.id ? (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                              <input value={anim.display_name} onChange={e => {
                                const updated = { ...currentPreset };
                                updated.animations[idx].display_name = e.target.value;
                                setCurrentPreset(updated);
                              }} style={{ padding: '0.3rem', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.8rem' }} />
                              <textarea value={anim.prompt} onChange={e => {
                                const updated = { ...currentPreset };
                                updated.animations[idx].prompt = e.target.value;
                                setCurrentPreset(updated);
                              }} style={{ padding: '0.3rem', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.75rem', height: '60px', resize: 'none' }} />
                              <div style={{ display: 'flex', gap: '0.3rem' }}>
                                <span style={{ fontSize: '0.7rem', color: '#888' }}>Frames:</span>
                                <input type="number" value={anim.num_frames} onChange={e => {
                                  const updated = { ...currentPreset };
                                  updated.animations[idx].num_frames = parseInt(e.target.value);
                                  setCurrentPreset(updated);
                                }} style={{ width: '50px', padding: '0.2rem', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.75rem' }} />
                                <button onClick={() => { setEditingAnim(null); savePreset(); }} style={{ marginLeft: 'auto', padding: '0.2rem 0.5rem', borderRadius: '4px', background: '#4ade80', border: 'none', color: '#000', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 'bold' }}>
                                  <Check size={10} /> Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#e0e0e0' }}>{anim.display_name}</div>
                                <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px' }}>{anim.prompt}</div>
                              </div>
                              <button onClick={() => setEditingAnim(anim.id)} style={{ padding: '2px 6px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#888', cursor: 'pointer', fontSize: '0.7rem' }}>✏️</button>
                              <button onClick={() => {
                                const updated = { ...currentPreset, animations: currentPreset.animations.filter((_, i) => i !== idx) };
                                setCurrentPreset(updated);
                                savePreset();
                              }} style={{ padding: '2px 6px', background: 'none', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', fontSize: '0.7rem' }}>🗑</button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add Animation + Actions */}
                  <button className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => {
                    const name = prompt('Animation name (e.g., "Sword Slash")');
                    if (!name) return;
                    const id = name.toLowerCase().replace(/\s+/g, '_');
                    const newAnim = { id, display_name: name, prompt: '', num_frames: 25, seed: -1 };
                    const updated = { ...currentPreset, animations: [...(currentPreset?.animations || []), newAnim] };
                    setCurrentPreset(updated);
                    setBatchChecked(prev => ({ ...prev, [id]: true }));
                    setEditingAnim(id);
                  }}>+ Add Animation</button>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn-secondary" onClick={() => setStage('slicing')} style={{ fontSize: '0.8rem' }}>
                      <ArrowLeft size={14} /> Back
                    </button>
                    <button className="btn-primary" style={{ flex: 1, fontSize: '0.85rem', background: 'linear-gradient(to right, #f59e0b, #ef4444)' }}
                      onClick={handleStartBatch}
                      disabled={!videoEngineReady || batchStatus.running || !(currentPreset?.animations || []).some(a => batchChecked[a.id])}
                    >
                      {batchStatus.running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                      {batchStatus.running ? `Running ${batchStatus.completed}/${batchStatus.total}...` : `Run Batch (${Object.values(batchChecked).filter(Boolean).length})`}
                    </button>
                  </div>
                </div>

                {/* Right: Batch Progress */}
                <div className="glass-card" style={{ background: '#020202', minHeight: '400px', padding: '1.5rem', overflowY: 'auto' }}>
                  {!batchStatus.running && batchStatus.results.length === 0 && (
                    <div style={{ color: '#333', textAlign: 'center', marginTop: '30%' }}>
                      <Play size={48} style={{ marginBottom: '1rem', opacity: 0.2 }} />
                      <p>Select animations and hit Run Batch</p>
                      <p style={{ fontSize: '0.75rem', color: '#444', marginTop: '0.5rem' }}>Est. ~2 min per animation after warmup</p>
                    </div>
                  )}

                  {(batchStatus.running || batchStatus.results.length > 0) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <h4 style={{ margin: 0, fontSize: '0.85rem' }}>
                          {batchStatus.running ? `Batch: ${batchStatus.completed}/${batchStatus.total}` : `Complete: ${batchStatus.results.filter(r => r.status === 'success').length}/${batchStatus.total}`}
                        </h4>
                        {batchStatus.running && (
                          <button className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', color: '#ef4444' }}
                            onClick={async () => {
                              const activeApi = rapidEngineReady ? rapidApiBase : videoApiBase;
                              await fetch(`${activeApi}/batch/cancel`, { method: 'POST' });
                            }}>Cancel</button>
                        )}
                      </div>

                      {/* Overall progress bar */}
                      <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', overflow: 'hidden', marginBottom: '0.5rem' }}>
                        <motion.div initial={{ width: 0 }} animate={{ width: `${batchStatus.total > 0 ? (batchStatus.completed / batchStatus.total * 100) : 0}%` }} style={{ height: '100%', background: 'linear-gradient(to right, #f59e0b, #ef4444)' }} />
                      </div>

                      {batchStatus.running && batchStatus.current_name && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: 'rgba(59,130,246,0.08)', borderRadius: '6px', border: '1px solid rgba(59,130,246,0.2)' }}>
                          <Loader2 size={14} className="animate-spin" color="#3b82f6" />
                          <span style={{ fontSize: '0.8rem', color: '#3b82f6' }}>{batchStatus.current_name}</span>
                        </div>
                      )}

                      {batchStatus.results.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: r.status === 'success' ? 'rgba(74,222,128,0.05)' : r.status === 'error' ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)', borderRadius: '6px', border: `1px solid ${r.status === 'success' ? 'rgba(74,222,128,0.15)' : r.status === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)'}` }}>
                          <span>{r.status === 'success' ? '✅' : r.status === 'error' ? '❌' : '⏭️'}</span>
                          <span style={{ flex: 1, fontSize: '0.8rem', color: '#ccc' }}>{r.name}</span>
                          {r.duration && <span style={{ fontSize: '0.7rem', color: '#666' }}>{r.duration}s</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      <footer style={{ marginTop: '5rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
        <p>© 2026 SpriteForge AI Pipeline • Powered by Local AI</p>
      </footer>

      {/* Save Modal Overlay */}
      <AnimatePresence>
        {isSaveModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(5px)',
              zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem'
            }}
            onClick={() => setIsSaveModalOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="glass-card"
              style={{ width: '100%', maxWidth: '1000px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: '2rem' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <FolderOpen size={24} color="var(--accent-primary)" />
                  {isDeleteMode ? <span style={{ color: '#ef4444' }}>Delete</span> : 
                   isResetMode ? <span style={{ color: 'var(--accent-primary)' }}>Reset</span> : 'Load'}{' '}
                  Project
                </h2>
                <button 
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '0.5rem' }}
                  onClick={() => setIsSaveModalOpen(false)}
                >
                  <X size={24} />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
                {savesList.length === 0 ? (
                  <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-dim)' }}>
                    No saved projects found.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                    {savesList.map((save, i) => (
                      <div 
                        key={save.id || i}
                        className="glass-card"
                        style={{ padding: '0', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', height: '280px' }}
                        onClick={() => handleLoadSave(save)}
                      >
                        <div style={{ height: '180px', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}>
                          <img src={`${apiBase}${save.image_url}`} alt="Saved Sprite" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} />
                        </div>
                        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--glass-border)', flex: 1, overflow: 'hidden' }}>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {save.prompt}
                          </p>
                          {save.timestamp && (
                            <p style={{ fontSize: '0.65rem', color: 'var(--accent-primary)', marginTop: '0.5rem' }}>
                              {new Date(save.timestamp * 1000).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Experimental Turnaround Modal */}
      <AnimatePresence>
        {isTurnaroundModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
              zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem'
            }}
            onClick={() => {
               if (!generatingTurnaround) setIsTurnaroundModalOpen(false)
            }}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="glass-card"
              style={{ width: '100%', maxWidth: '1200px', display: 'flex', flexDirection: 'column', padding: '2rem', textAlign: 'center' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Sparkles size={24} color="#d946ef" /> FLUX 5-Point Turnaround <span style={{fontSize: '0.7rem', opacity: 0.5}}>(Backend: {apiBase})</span>
                </h2>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {!generatingTurnaround && turnaroundUrl && (
                    <>
                      <button 
                        className="btn-primary"
                        style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--accent-secondary)' }}
                        onClick={handleSaveProject}
                        title="Save Project (Ctrl+S)"
                      >
                        <Save size={14} /> {activeProjectId ? `Save ${activeProjectId}` : 'Save Project'}
                      </button>
                      <div style={{ width: '1px', height: '20px', background: 'var(--glass-border)', margin: '0 0.5rem' }} />
                      <button 
                        className="btn-secondary"
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                        onClick={handleUndo}
                        disabled={wandHistory.length === 0}
                        title="Undo (Ctrl+Z)"
                      >
                        <RefreshCw size={14} style={{ transform: 'scaleX(-1)' }} /> Undo
                      </button>
                      <button 
                        className={isWandActive ? "btn-primary" : "btn-secondary"}
                        style={{ 
                          padding: '0.4rem 1rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
                          background: isWandActive ? 'var(--accent-primary)' : undefined,
                          borderColor: isWandActive ? 'var(--accent-primary)' : undefined
                        }}
                        onClick={() => setIsWandActive(!isWandActive)}
                      >
                        <Wand2 size={14} /> Magic Wand {isWandActive ? 'ON' : 'OFF'}
                      </button>
                      <button 
                        className={zoomLevel > 1 ? "btn-primary" : "btn-secondary"}
                        style={{ 
                          padding: '0.4rem 1rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
                          background: zoomLevel > 1 ? 'var(--accent-secondary)' : undefined,
                          borderColor: zoomLevel > 1 ? 'var(--accent-secondary)' : undefined
                        }}
                        onClick={() => setZoomLevel(zoomLevel === 1 ? 1.5 : zoomLevel === 1.5 ? 2.5 : 1)}
                      >
                        <Sparkles size={14} /> Zoom {zoomLevel === 1 ? '1.0x' : zoomLevel === 1.5 ? '1.5x' : '2.5x'}
                      </button>
                    </>
                  )}
                  {!generatingTurnaround && (
                    <button 
                      style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '0.5rem' }}
                      onClick={() => { setIsTurnaroundModalOpen(false); setIsWandActive(false); }}
                    >
                      <X size={24} />
                    </button>
                  )}
                </div>
              </div>

              <div style={{ 
                background: '#050505', 
                borderRadius: '8px', 
                height: '65vh',
                display: zoomLevel > 1 ? 'block' : 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                padding: zoomLevel > 1 ? '0' : '1rem', 
                border: '1px solid var(--glass-border)',
                cursor: isWandActive ? 'crosshair' : 'default',
                overflow: 'auto',
                position: 'relative'
              }}>
                {generatingTurnaround ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <Loader2 size={48} className="animate-spin" color="#d946ef" />
                    <p style={{ color: 'var(--text-dim)' }}>Loading FLUX.1 and generating turnaround sheet...</p>
                    <p style={{ fontSize: '0.8rem', color: '#888' }}>This requires ~14GB VRAM. Generating high-fidelity assets...</p>
                  </div>
                ) : turnaroundUrl ? (
                  <img 
                    src={turnaroundUrl} 
                    alt="Turnaround Sheet" 
                    style={{ 
                      width: zoomLevel > 1 ? `${zoomLevel * 100}%` : 'auto',
                      maxWidth: zoomLevel > 1 ? 'none' : '100%', 
                      height: 'auto',
                      maxHeight: zoomLevel > 1 ? 'none' : '100%', 
                      objectFit: zoomLevel > 1 ? 'unset' : 'contain',
                      display: 'block',
                      transition: 'width 0.2s ease-in-out'
                    }} 
                    onClick={handleWandClick}
                    crossOrigin="anonymous"
                  />
                ) : (
                  <p style={{ color: 'var(--text-dim)' }}>Failed to generate turnaround sheet.</p>
                )}
              </div>
              
              {!generatingTurnaround && turnaroundUrl && (
                  <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                     <button className="btn-secondary" onClick={() => setIsTurnaroundModalOpen(false)}>Close Experiment</button>
                     <a href={turnaroundUrl} download="turnaround.png" className="btn-secondary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                       <Download size={18} /> Download Sheet
                     </a>
                     <button 
                        className="btn-primary" 
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'linear-gradient(to right, #8b5cf6, #d946ef)' }} 
                        onClick={handleSlice}
                        disabled={slicing}
                     >
                       {slicing ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                       {slicing ? 'Slicing...' : 'Save & Slice Poses'}
                     </button>
                  </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Options Modal */}
      <AnimatePresence>
        {isOptionsOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(5px)',
              zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem'
            }}
            onClick={() => setIsOptionsOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="glass-card"
              style={{ width: '100%', maxWidth: '500px', padding: '2rem', textAlign: 'center', maxHeight: '90vh', overflowY: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ marginBottom: '1.5rem' }}>Pipeline <span className="gradient-text">Options</span></h2>
              <div style={{ textAlign: 'left', marginBottom: '2rem' }}>
                <p style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>FLUX Parameters:</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <label style={{ fontSize: '0.9rem', color: '#888' }}>Inference Steps: 20</label>
                  <label style={{ fontSize: '0.9rem', color: '#888' }}>Guidance Scale: 3.5</label>
                  <label style={{ fontSize: '0.9rem', color: '#888' }}>VRAM Optimization: 4-bit NF4</label>
                </div>

                <p style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>Background Removal:</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button 
                      className={removerType === 'ai' ? "btn-primary" : "btn-secondary"}
                      style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem' }}
                      onClick={() => setRemoverType('ai')}
                    >
                      AI Remover
                    </button>
                    <button 
                      className={removerType === 'simple' ? "btn-primary" : "btn-secondary"}
                      style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem' }}
                      onClick={() => setRemoverType('simple')}
                    >
                      Simple
                    </button>
                    <button 
                      className={removerType === 'none' ? "btn-primary" : "btn-secondary"}
                      style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem' }}
                      onClick={() => setRemoverType('none')}
                    >
                      None
                    </button>
                  </div>
                  
                  <div style={{ marginBottom: '1rem', padding: '0.8rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <h4 style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Generation Quality Control</h4>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={enforceWhite} 
                        onChange={(e) => setEnforceWhite(e.target.checked)} 
                        style={{ width: '16px', height: '16px' }}
                      />
                      <span>Enforce White Background (Auto-Retry)</span>
                    </label>
                    <p style={{ fontSize: '0.7rem', color: '#666', marginTop: '0.4rem' }}>
                      * Automatically re-rolls the generation if the background is too dark.
                    </p>
                  </div>
                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.9rem' }}>Removal Sensitivity: {removalSensitivity}</label>
                        <button 
                          style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.7rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                          onClick={() => setRemovalSensitivity(240)}
                        >
                          Reset Default
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.7rem', color: '#666' }}>
                          {removalSensitivity > 245 ? 'Low (Keep More)' : removalSensitivity < 210 ? 'High (Cut More)' : 'Balanced'}
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="100" max="255" step="1"
                        value={removalSensitivity}
                        onChange={(e) => setRemovalSensitivity(parseInt(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer' }}
                      />
                      <p style={{ fontSize: '0.7rem', color: '#666', marginTop: '0.4rem' }}>
                        * Adjust this if parts are missing or neighbors leak in.
                      </p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', padding: '0.8rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.9rem', cursor: 'pointer', color: 'var(--accent-primary)' }}>
                        <input 
                          type="checkbox" 
                          checked={forceReslice} 
                          onChange={(e) => setForceReslice(e.target.checked)} 
                          style={{ width: '16px', height: '16px' }}
                        />
                        <span>Force Fresh Slice (Ignore Cache)</span>
                      </label>

                      {removerType === 'ai' && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={alphaMatting} 
                            onChange={(e) => setAlphaMatting(e.target.checked)} 
                            style={{ width: '16px', height: '16px' }}
                          />
                          <span>Enable Alpha Matting (Refined Edges)</span>
                        </label>
                      )}
                    </div>
                    
                    {removerType === 'simple' && (
                      <p style={{ fontSize: '0.8rem', color: '#666', fontStyle: 'italic', textAlign: 'left' }}>
                        * Simple mode targets pure backgrounds. Best for high-contrast sheets.
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <button className="btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={() => setIsOptionsOpen(false)}>
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Surgical Masking Tool */}
      {isMasking && (
        <LimbMasker 
          imageUrl={turnaroundUrl} 
          title={activeManualLimb ? `Manual Surgery: ${activeManualLimb}` : "Surgical Masking"}
          initialMask={activeManualLimb ? (directionalLimbMasks[activeDirection]?.[activeManualLimb]) : null}
          onCancel={() => { setIsMasking(false); setActiveManualLimb(null); }} 
          onSave={handleFixPose} 
        />
      )}
      
      {/* Load Project Modal */}
      <AnimatePresence>
        {isLoadModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
              zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem'
            }}
            onClick={() => setIsLoadModalOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 30 }}
              className="glass-card"
              style={{ width: '100%', maxWidth: '900px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.5rem' }}>
                  {isDeleteMode ? <span style={{ color: '#ef4444' }}>Delete</span> : 'Project'}{' '}
                  <span className="gradient-text">Library</span>
                </h2>
                <button onClick={() => setIsLoadModalOpen(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>
                  <X size={24} />
                </button>
              </div>
              
              <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
                {savedProjects.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)' }}>
                    <FolderOpen size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                    <p>No saved sprites found yet.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1.5rem' }}>
                    {savedProjects.filter(p => p && p.id).map(project => (
                      <motion.div 
                        key={project.id}
                        whileHover={{ y: -5, borderColor: isDeleteMode ? '#ef4444' : 'var(--accent-primary)' }}
                        className="glass-card"
                        style={{ padding: '1rem', cursor: 'pointer', transition: 'border-color 0.2s', borderColor: isDeleteMode ? '#ef444433' : undefined }}
                        onClick={() => {
                          if (isDeleteMode) {
                            setProjectToDelete(project);
                          } else if (isResetMode) {
                            handleResetProject(project);
                          } else {
                            handleLoadProject(project);
                          }
                        }}

                      >
                        { (isDeleteMode || isResetMode) && (
                        <div style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 5, display: 'flex', gap: '0.5rem' }}>
                          {isResetMode && (
                            <div 
                              style={{ background: 'var(--accent-primary)', borderRadius: '50%', padding: '0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
                              title="Reset Project"
                              onClick={(e) => { e.stopPropagation(); handleResetProject(project); }}
                            >
                              <RefreshCw size={12} color="white" />
                            </div>
                          )}
                          {isDeleteMode && (
                            <>
                              <div 
                                style={{ background: 'var(--accent-primary)', borderRadius: '50%', padding: '0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
                                title="Factory Reset (Restore Original)"
                                onClick={(e) => { e.stopPropagation(); handleResetProject(project); }}
                              >
                                <RefreshCw size={12} color="white" />
                              </div>
                              <div 
                                style={{ background: '#ef4444', borderRadius: '50%', padding: '0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
                                title="Delete Project"
                                onClick={(e) => { e.stopPropagation(); setProjectToDelete(project); }}
                              >
                                <Trash2 size={12} color="white" />
                              </div>
                            </>
                          )}
                        </div>
                        )}

                        <div style={{ 
                          width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem',
                          border: '1px solid var(--glass-border)'
                        }}>
                          <img src={`${apiBase}${project.image_url}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt={project.id} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--accent-primary)' }}>{project.id}</span>
                          <span style={{ fontSize: '0.7rem', color: '#555' }}>{new Date(project.timestamp * 1000).toLocaleDateString()}</span>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {project.prompt}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {projectToDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)',
              zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem'
            }}
            onClick={() => setProjectToDelete(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="glass-card"
              style={{ width: '100%', maxWidth: '450px', padding: '2rem', textAlign: 'center', borderColor: '#ef4444' }}
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 size={48} color="#ef4444" style={{ marginBottom: '1.5rem', marginLeft: 'auto', marginRight: 'auto' }} />
              <h2 style={{ marginBottom: '1rem' }}>Delete <span style={{ color: '#ef4444' }}>{projectToDelete.id}</span>?</h2>
              <p style={{ color: 'var(--text-dim)', marginBottom: '2rem', lineHeight: '1.5' }}>
                Are you sure you want to delete this sprite and all its parts? <br />
                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>This action cannot be undone.</span>
              </p>
              
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setProjectToDelete(null)}>Cancel</button>
                <button 
                  className="btn-primary" 
                  style={{ flex: 1, background: '#ef4444', borderColor: '#ef4444' }}
                  onClick={() => handleDeleteProject(projectToDelete)}
                >
                  Yes, Delete All
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
