import React, { useState, useEffect, useRef } from 'react'
import { Sparkles, Wand2, Play, Download, Settings, Image as ImageIcon, Loader2, ArrowLeft, RefreshCw, Save, Upload, X, Check, FolderOpen, HelpCircle, Trash2, ChevronLeft, ChevronRight, Video } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

function LivePreview({ rig, params }) {
  const canvasRef = useRef(null);
  const [time, setTime] = useState(0);

  useEffect(() => {
    let frame;
    const tick = (t) => {
      setTime(t / 1000 * params.speed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [params.speed]);

  useEffect(() => {
    if (!canvasRef.current || !rig) return;
    const ctx = canvasRef.current.getContext('2d');
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;

    ctx.clearRect(0, 0, width, height);
    
    // Simulate Joint Positions
    const phase = (time * 2) % (Math.PI * 2);
    const { stride, bounce } = params;
    const simulatedJoints = {};
    
    Object.entries(rig.joints).forEach(([name, pos]) => {
      let nx = pos.x;
      let ny = pos.y;
      
      if (name.includes('knee_l') || name.includes('ankle_l') || name.includes('foot_l')) {
          nx += Math.sin(phase) * stride;
          ny += Math.max(0, Math.cos(phase)) * bounce;
      } else if (name.includes('knee_r') || name.includes('ankle_r') || name.includes('foot_r')) {
          nx += Math.sin(phase + Math.PI) * stride;
          ny += Math.max(0, Math.cos(phase + Math.PI)) * bounce;
      }
      
      if (name.includes('hip') || name.includes('torso') || name.includes('shoulder') || name.includes('nose')) {
          ny += Math.abs(Math.sin(phase * 2)) * (bounce * 0.5);
      }
      
      if (name.includes('wrist_l') || name.includes('elbow_l')) {
          nx += Math.sin(phase + Math.PI) * (stride * 0.5);
      } else if (name.includes('wrist_r') || name.includes('elbow_r')) {
          nx += Math.sin(phase) * (stride * 0.5);
      }
      
      simulatedJoints[name] = { x: nx, y: ny };
    });

    // Draw Skeletal Simulation
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    
    // Draw Bones (Lines)
    const bones = [
      ['shoulder_l', 'elbow_l'], ['elbow_l', 'wrist_l'],
      ['shoulder_r', 'elbow_r'], ['elbow_r', 'wrist_r'],
      ['hip_l', 'knee_l'], ['knee_l', 'ankle_l'],
      ['hip_r', 'knee_r'], ['knee_r', 'ankle_r'],
      ['shoulder_l', 'shoulder_r'], ['hip_l', 'hip_r']
    ];

    bones.forEach(([a, b]) => {
      if (simulatedJoints[a] && simulatedJoints[b]) {
        ctx.beginPath();
        ctx.moveTo(simulatedJoints[a].x * width, simulatedJoints[a].y * height);
        ctx.lineTo(simulatedJoints[b].x * width, simulatedJoints[b].y * height);
        ctx.stroke();
      }
    });

    // Draw Joints
    Object.entries(simulatedJoints).forEach(([name, pos]) => {
      ctx.fillStyle = name.includes('_l') ? '#8b5cf6' : name.includes('_r') ? '#d946ef' : '#fff';
      ctx.beginPath();
      ctx.arc(pos.x * width, pos.y * height, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Label
    ctx.fillStyle = '#666';
    ctx.font = '10px Inter';
    ctx.fillText("Real-time Skeletal Overlay", 10, height - 10);

  }, [time, rig, params]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img src={rig?.url} style={{ maxHeight: '80%', maxWidth: '80%', objectFit: 'contain', opacity: 0.3, filter: 'grayscale(1)' }} />
      <canvas 
        ref={canvasRef} 
        width={400} 
        height={400} 
        style={{ 
          position: 'absolute', 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }} 
      />
    </div>
  );
}
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

  useEffect(() => {
    let timeout = null;
    const discover = async () => {
      let mainFound = false;
      let videoFound = false;

      // Check existing bases first
      if (apiBase) {
        try {
          const res = await fetch(`${apiBase}/`, { method: 'GET' });
          const data = await res.json();
          if (data.status === 'active') {
            setApiReady(true);
            mainFound = true;
          }
        } catch (e) { setApiReady(false); }
      }

      if (videoApiBase) {
        try {
          const res = await fetch(`${videoApiBase}/status`, { method: 'GET' });
          const data = await res.json();
          if (data.identity === 'video-forge') {
            setVideoEngineReady(true);
            videoFound = true;
          }
        } catch (e) { setVideoEngineReady(false); }
      }

      // If either is missing, scan ports 8000-8020
      if (!mainFound || !videoFound) {
        for (let p = 8000; p <= 8020; p++) {
          const url = `http://localhost:${p}`;
          // Skip if we already checked these as active bases
          if (url === apiBase && mainFound) continue;
          if (url === videoApiBase && videoFound) continue;

          try {
            const res = await fetch(`${url}/status`, { method: 'GET' });
            if (res.ok) {
              const data = await res.json();
              
              if (data.identity === 'video-forge' && !videoFound) {
                console.log(`Video Forge discovered on port ${p}`);
                setVideoApiBase(url);
                setVideoEngineReady(true);
                videoFound = true;
              } else if (data.identity === 'main-backend' && !mainFound) {
                console.log(`Main Backend discovered on port ${p}`);
                setApiBase(url);
                setApiReady(true);
                mainFound = true;
              }
            }
          } catch (e) {
            // Silence noise for port scanning
          }
          if (mainFound && videoFound) break;
        }
      }
      
      setApiReady(mainFound);
      setVideoEngineReady(videoFound);
      timeout = setTimeout(discover, (mainFound && videoFound) ? 10000 : 3000);
    }
    discover();
    return () => clearTimeout(timeout);
  }, [apiBase, videoApiBase])
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
  const [projectToDelete, setProjectToDelete] = useState(null)
  const [numGenerations, setNumGenerations] = useState(1)
  const [zoomLevel, setZoomLevel] = useState(1)
  const turnaroundCanvasRef = useRef(null)

  
  // Slicing State
  const [slicedUrls, setSlicedUrls] = useState([])
  const [allSliceVersions, setAllSliceVersions] = useState([[], [], [], [], []])
  const [selectedVersionIndices, setSelectedVersionIndices] = useState([0, 0, 0, 0, 0])
  const [slicing, setSlicing] = useState(false)
  
  // Rigging State
  const [rigData, setRigData] = useState([])
  const [rigging, setRigging] = useState(false)
  const [selectedRigIdx, setSelectedRigIdx] = useState(0)
  
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
  const [regeneratingLimb, setRegeneratingLimb] = useState(null)
  const [poseLabels, setPoseLabels] = useState({}) // { index: 'front' }
  const [activeDirection, setActiveDirection] = useState(null)
  const [directionalLimbPacks, setDirectionalLimbPacks] = useState({}) // { 'front': { limbs } }
  const [directionalLimbMasks, setDirectionalLimbMasks] = useState({}) // { 'front': { 'torso': maskBase64 } }

  // Video Forge State
  const [videoStage, setVideoStage] = useState('idle') // idle, generating, done
  const [videoUrl, setVideoUrl] = useState(null)
  const [videoPrompt, setVideoPrompt] = useState('')
  const [selectedVideoSlice, setSelectedVideoSlice] = useState(null)
  const [videoHeartbeat, setVideoHeartbeat] = useState({ status: 'Offline', progress: 0 })
  const [videoEngineReady, setVideoEngineReady] = useState(false)
  const [isWarmingUp, setIsWarmingUp] = useState(false)

  // Video Engine Heartbeat Poller
  useEffect(() => {
    let timeout = null;
    const pollHeartbeat = async () => {
      if (!videoApiBase || !videoEngineReady) {
        timeout = setTimeout(pollHeartbeat, 2000);
        return;
      }
      try {
        const res = await fetch(`${videoApiBase}/status`);
        const data = await res.json();
        if (data.identity === 'video-forge') {
           setVideoHeartbeat(data);
           setIsWarmingUp(false);
        } else {
           setVideoEngineReady(false);
        }
      } catch (e) {
        setVideoEngineReady(false);
        setVideoHeartbeat({ status: 'Offline', progress: 0 });
      }
      timeout = setTimeout(pollHeartbeat, 3000);
    };
    pollHeartbeat();
    return () => clearTimeout(timeout);
  }, [videoApiBase, videoEngineReady]);

  const handleForgeVideo = async () => {
    if (!selectedVideoSlice || !videoPrompt) return;
    setVideoStage('generating');
    setVideoUrl(null);
    
    try {
      const formData = new FormData();
      // Ensure we strip cache busters if present
      const cleanUrl = selectedVideoSlice.split('?')[0];
      formData.append('image_url', cleanUrl);
      formData.append('prompt', videoPrompt);
      
      const response = await fetch(`${videoApiBase}/generate`, {
        method: 'POST',
        body: formData
      });
      
      if (response.ok) {
        const blob = await response.blob();
        setVideoUrl(URL.createObjectURL(blob));
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

  const handleSaveProject = async () => {
    // Increment click count for force override
    const newCount = saveClickCount + 1;
    setSaveClickCount(newCount);
    const forceOverwrite = newCount >= 3;
    
    if (forceOverwrite) {
      console.log(">>> [FORCE] Overwriting project file...");
      setSaveClickCount(0);
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
          all_slice_versions: allSliceVersions,
          selected_indices: selectedVersionIndices
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setActiveProjectId(data.project_id);
        // Ensure no double slashes and add cache buster
        const cleanPath = data.image_url.startsWith('/') ? data.image_url : `/${data.image_url}`;
        setTurnaroundUrl(`${apiBase}${cleanPath}?t=${Date.now()}`);
        setWandHistory([]);
        alert(`Project saved as ${data.project_id}`);
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

  const fetchSavedProjects = async (deleteMode = false) => {
    try {
      console.log("Fetching project list...");
      const res = await fetch(`${apiBase}/list-projects`);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.status === 'success') {
        setSavedProjects(data.saves);
        setIsDeleteMode(deleteMode);
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
    const msg = `FACTORY RESET: This will delete all AI corrections for ${project.id} and restore the ORIGINAL character sheet.\n\nThis cannot be undone. Continue?`;
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

  const handleRig = async () => {
    setRigging(true)
    try {
      const res = await fetch(`${apiBase}/rig-poses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          frame_urls: slicedUrls,
          project_id: activeProjectId
        })
      })
      const data = await res.json()
      if (data.status === 'success') {
        setRigData(data.rigs)
        setStage('rigging')
      }
    } catch (err) {
      console.error("Error rigging:", err)
    } finally {
      setRigging(false)
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


  const swapLimbSource = async (limbName, sourceIdx) => {
    // Re-trigger extraction for just one limb? 
    // For simplicity, let's just re-run the full extraction with a new source
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/extract-limbs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: activeProjectId,
          pose_index: 0, 
          source_pose_index: sourceIdx,
          label: activeDirection
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setDirectionalLimbPacks(prev => ({
          ...prev,
          [activeDirection]: { ...prev[activeDirection], [limbName]: data.limb_urls[limbName] }
        }));
      }
    } catch (err) {
      console.error("Swap failed:", err);
    } finally {
      setLoading(false);
    }
  }

  const handleGenerateAnimation = async () => {
    if (!rigData || rigData.length === 0) return;
    setLoading(true);
    try {
      const activeRig = rigData[0];
      const res = await fetch(`${apiBase}/generate-animation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frame_url: activeRig.url,
          joints: activeRig.joints,
          project_id: activeProjectId,
          anim_type: walkParams.type,
          stride: walkParams.stride,
          bounce: walkParams.bounce,
          num_frames: 12,
          limb_pack: directionalLimbPacks['front'] || {} 
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setAnimFrames(data.urls.map(u => `${apiBase}${u}`));
        setStage('preview-animation');
      }
    } catch (err) {
      console.error("Animation failed:", err);
    } finally {
      setLoading(false);
    }
  }

  const handleCompleteSocket = async (name, url) => {
    setRegeneratingLimb(name);
    try {
      const res = await fetch(`${apiBase}/complete-limb-socket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          project_id: activeProjectId, 
          limb_url: url, 
          limb_name: name,
          torso_url: directionalLimbPacks[activeDirection]?.torso 
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setDirectionalLimbPacks(prev => ({
          ...prev,
          [activeDirection]: { ...prev[activeDirection], [name]: data.url }
        }));
      }
    } catch (e) { console.error(e); }
    finally { setRegeneratingLimb(null); }
  };

  const handleSetPoseLabel = async (idx, label) => {
    setPoseLabels(prev => ({ ...prev, [idx]: label }));
    try {
      await fetch(`${apiBase}/set-pose-label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: activeProjectId, pose_index: idx, label })
      });
    } catch (e) { console.error(e); }
  };

  const handleExplodeDirection = async (idx) => {
    const label = poseLabels[idx];
    if (!label) return;
    setLoading(true);
    setActiveDirection(label);
    try {
      const res = await fetch(`${apiBase}/extract-limbs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: activeProjectId, pose_index: idx, label })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setDirectionalLimbPacks(prev => ({ ...prev, [label]: data.limb_urls }));
        setStage('directional-surgery');
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleGenerateDirectional = async (dir) => {
     setLoading(true);
     try {
       const res = await fetch(`${apiBase}/generate-directional-poses`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ project_id: activeProjectId, target_direction: dir })
       });
       const data = await res.json();
       if (data.status === 'success') {
         alert(`Generated ${dir} view!`);
       }
     } catch (e) { console.error(e); }
     finally { setLoading(false); }
  }

  const [walkParams, setWalkParams] = useState({ stride: 0.15, bounce: 0.05, speed: 1.0, type: 'walk' });
  const [animFrames, setAnimFrames] = useState([]);
  const [currentAnimIdx, setCurrentAnimIdx] = useState(0);

  useEffect(() => {
    if (stage === 'preview-animation' && animFrames.length > 0) {
      const interval = setInterval(() => {
        setCurrentAnimIdx(prev => (prev + 1) % animFrames.length);
      }, 100 / walkParams.speed);
      return () => clearInterval(interval);
    }
  }, [stage, animFrames, walkParams.speed]);

  const handleBuildIndex = async () => {
    try {
      const res = await fetch(`${apiBase}/build-character-index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: activeProjectId })
      });
      const data = await res.json();
      if (data.status === 'success') {
        alert(`Character Index created! Totality package ready at ${data.index_url}`);
      }
    } catch (err) {
      console.error("Index build failed:", err);
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
            setSelectedVersionIndices(prev => {
              const newIndices = [...prev];
              newIndices[index] = Math.max(0, absoluteVersions[index].length - 1);
              return newIndices;
            });
          }

          setSlicedUrls(freshUrls);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const handleFixPose = async (maskBase64) => {
    setIsMasking(false);
    
    if (activeManualLimb) {
      const name = activeManualLimb;
      // Save mask locally first so it persists even if generation fails
      setDirectionalLimbMasks(prev => ({
        ...prev,
        [activeDirection]: { ...(prev[activeDirection] || {}), [name]: maskBase64 }
      }));
      setActiveManualLimb(null);
      await handleRegenerateLimb(name, maskBase64);
      return;
    }

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
            background_threshold: Math.max(0, removalSensitivity - 230)
          }),
        });
        const sliceData = await sliceRes.json();
        if (sliceData.status === 'success') {
            const freshUrls = sliceData.urls.map(u => `${apiBase}${u}?t=${Date.now()}`);
            
            // For manual surgery, we might not know which slice changed, 
            // so we'll check which images are actually different from current selection
            setAllSliceVersions(prev => {
              return prev.map((versions, idx) => {
                const newUrl = freshUrls[idx];
                if (!versions.includes(newUrl)) {
                  return [...versions, newUrl];
                }
                return versions;
              });
            });

            // Auto-select newest versions that were added
            setSelectedVersionIndices(prev => {
              return prev.map((vIdx, idx) => {
                // If we added a new version, select it
                return allSliceVersions[idx].length; 
              });
            });

            setSlicedUrls(freshUrls);
            // Stay in current stage or return to slicing? 
            // Better to stay in rigging if possible, but we need to re-rig
            alert("Poses updated. Re-analyzing skeletons...");
            handleRig(); 
        }
      }
    } catch (err) {
      console.error("Pose correction failed:", err);
    } finally {
      setLoading(false);
    }
  }

  const handleRegenerateLimb = async (limbName, manualMask = null) => {
    setRegeneratingLimb(limbName);
    const rigIdx = Object.keys(poseLabels).find(key => poseLabels[key] === activeDirection);
    const activeRigUrl = rigIdx !== undefined ? rigData[rigIdx].url : selectedAnchor;
    
    try {
      const res = await fetch(`${apiBase}/generate-isolated-limb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: activeProjectId,
          limb_name: limbName,
          anchor_url: activeRigUrl,
          mask_image: manualMask
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setDirectionalLimbPacks(prev => ({
          ...prev,
          [activeDirection]: { ...prev[activeDirection], [limbName]: data.url }
        }));
      }
    } catch (err) {
      console.error("Limb regeneration failed:", err);
    } finally {
      setRegeneratingLimb(null);
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
    setRigData([])
    setPoseLabels({})
    setDirectionalLimbPacks({})
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
                    onClick={() => fetchSavedProjects(false)}
                    disabled={!apiReady}
                  >
                    <FolderOpen size={16} />
                    Load Saved Sprite
                  </button>
                  <button 
                    className="btn-secondary" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1rem', fontSize: '0.85rem', borderColor: '#ef444466' }}
                    onClick={() => fetchSavedProjects(true)}
                    disabled={!apiReady}
                  >
                    <Trash2 size={16} color="#ef4444" />
                    Delete Sprite
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
                          const templatePrompt = `Image 1 role: identity anchor. Preserve the exact approved anchor sprite identity.
Subject: Side view sprite walking form left to right. Character stays in one place as if on a treadmill.
Primary request: create 8-frame walking sequence.
Look and rendering: High-resolution pixelated sprite art. Crisp chunky sprite edges. Preserve visible pixel structure. No painterly rendering, no airbrushing, no soft gradients.
Background: Opaque exact flat chroma green background #00FF00.`;
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
                        Push to Video Forge
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>

              {/* Pose Repair / Surgical Correction Area */}
              <div style={{ 
                background: 'rgba(0,0,0,0.3)', 
                padding: '1.5rem', 
                borderRadius: '12px', 
                border: '1px solid var(--glass-border)',
                marginBottom: '3rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-primary)' }}>
                   <Sparkles size={18} />
                   <span style={{ fontSize: '0.9rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>Surgical Pose Repair</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', maxWidth: '600px' }}>
                  If a pose was generated incorrectly or is a duplicate, use the <b>Surgical Studio</b> to mask that specific slice and re-roll it with the correct direction.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.5)', padding: '6px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                   <select 
                     className="btn-secondary" 
                     style={{ border: 'none', background: 'none', fontSize: '0.85rem' }}
                     value={targetRotation}
                     onChange={(e) => setTargetRotation(e.target.value)}
                   >
                     <option value="front-quarter">Fix to: 3/4 Front</option>
                     <option value="back-quarter">Fix to: 3/4 Back</option>
                     <option value="side">Fix to: Side View</option>
                     <option value="front">Fix to: Front View</option>
                     <option value="back">Fix to: Back View</option>
                   </select>
                   <button 
                     className="btn-primary" 
                     onClick={() => setIsMasking(true)} 
                     style={{ padding: '0.5rem 1.5rem', fontSize: '0.85rem', background: 'var(--accent-primary)', border: 'none' }}
                   >
                     <Wand2 size={16} /> Open Surgical Studio
                   </button>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => { setStage('prompt'); setSlicedUrls([]); }}>
                  <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Start Over
                </button>
                <button className="btn-secondary" onClick={() => { setStage('prompt'); setIsTurnaroundModalOpen(true); }}>
                  <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Back to Turnaround
                </button>
                <button 
                  className="btn-primary" 
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 2rem' }}
                  onClick={handleRig}
                  disabled={rigging}
                >
                  {rigging ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                  {rigging ? 'Analyzing Joints...' : 'Proceed to Rigging (Phase 4)'}
                </button>
              </div>
            </motion.div>
          )}

          {stage === 'rigging' && (
            <motion.div
              key="rigging"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
              style={{ maxWidth: '1200px', margin: '0 auto', textAlign: 'center' }}
            >
              <h2 style={{ marginBottom: '1.5rem' }}>AI <span className="gradient-text">Skeleton Rigging</span></h2>
              <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>
                MediaPipe has detected the skeletal joints. These points will serve as pivots for animation.
              </p>
              
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(5, 1fr)', 
                gap: '1rem',
                marginBottom: '3rem'
              }}>
                {rigData.map((rig, i) => (
                  <div 
                    key={i} 
                    className="glass-card" 
                    style={{ 
                      padding: '0', 
                      overflow: 'hidden', 
                      height: '350px', 
                      position: 'relative',
                      border: selectedRigIdx === i ? '2px solid var(--accent-primary)' : '1px solid var(--glass-border)',
                      cursor: 'pointer'
                    }}
                    onClick={() => setSelectedRigIdx(i)}
                  >
                    <div style={{ 
                      height: '250px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      background: '#111',
                      position: 'relative'
                    }}>
                      <img src={rig.url} alt={`Pose ${i}`} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                      <svg viewBox="0 0 1 1" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                        {Object.entries(rig.joints).map(([name, pos]) => (
                          <circle key={name} cx={pos.x} cy={pos.y} r="0.01" fill={pos.v > 0.5 ? "#8b5cf6" : "#444"} stroke="white" strokeWidth="0.002" />
                        ))}
                      </svg>
                    </div>

                    <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.3)' }}>
                      <select 
                        className="select-input" 
                        value={poseLabels[i] || ''} 
                        onChange={(e) => handleSetPoseLabel(i, e.target.value)}
                        style={{ width: '100%', marginBottom: '0.5rem', background: '#222', color: 'white', border: '1px solid #444', padding: '4px', borderRadius: '4px' }}
                      >
                        <option value="">Assign Direction</option>
                        <option value="front">Front (S)</option>
                        <option value="back">Back (N)</option>
                        <option value="side">Side (E/W)</option>
                        <option value="3_4_front">3/4 Front</option>
                        <option value="3_4_back">3/4 Back</option>
                      </select>
                      
                      <button 
                        className="btn-primary" 
                        disabled={!poseLabels[i] || loading}
                        onClick={() => handleExplodeDirection(i)}
                        style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem', opacity: poseLabels[i] ? 1 : 0.5 }}
                      >
                        {loading && activeDirection === poseLabels[i] ? <Loader2 className="animate-spin" size={14} /> : 'Explode Direction'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => setStage('slicing')}>
                  <ArrowLeft size={18} /> Back to Slices
                </button>
              </div>
            </motion.div>
          )}

          {stage === 'directional-surgery' && (
            <motion.div
              key="directional-surgery"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
              style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center' }}
            >
              <h2 style={{ marginBottom: '0.5rem' }}>Directional <span className="gradient-text">Surgery: {activeDirection?.toUpperCase()}</span></h2>
              <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>
                We've extracted the parts for this specific view. Round out the joints for a seamless animation rig.
              </p>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '2rem' }}>
                 <button 
                   className="btn-secondary" 
                   onClick={async () => {
                     const limbs = Object.keys(directionalLimbPacks[activeDirection] || {});
                     for (const l of limbs) {
                       await handleRegenerateLimb(l);
                     }
                   }}
                   disabled={regeneratingLimb !== null}
                 >
                   {regeneratingLimb ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                   {regeneratingLimb ? ` Generating ${regeneratingLimb}...` : ` Re-explode Full ${activeDirection} Pack`}
                 </button>
              </div>

              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', 
                gap: '1.5rem',
                marginBottom: '3rem'
              }}>

                {Object.entries(directionalLimbPacks[activeDirection] || {}).map(([name, url]) => (
                  <div key={name} className="glass-card" style={{ padding: '1rem', background: '#080808' }}>
                    <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                       <img src={`${apiBase}${url}`} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                    </div>
                    <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '0.5rem', color: 'var(--accent-primary)' }}>{name}</div>
                    
                    <button 
                      className="btn-secondary" 
                      style={{ marginTop: '0.5rem', fontSize: '0.65rem', width: '100%', color: 'var(--accent-primary)' }}
                      onClick={() => handleRegenerateLimb(name)}
                      disabled={regeneratingLimb === name}
                    >
                      {regeneratingLimb === name ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} 
                      {regeneratingLimb === name ? ' Generating...' : ' Explode with AI'}
                    </button>
                    <button 
                      className="btn-secondary" 
                      style={{ marginTop: '0.4rem', fontSize: '0.65rem', width: '100%', borderColor: 'rgba(139, 92, 246, 0.3)' }}
                      onClick={() => {
                        const rigIdx = Object.keys(poseLabels).find(key => poseLabels[key] === activeDirection);
                        const url = rigIdx !== undefined ? rigData[rigIdx].url : turnaroundUrl;
                        setTurnaroundUrl(url); // Ensure we mask the correct view
                        setActiveManualLimb(name);
                        setIsMasking(true);
                      }}
                      disabled={regeneratingLimb === name}
                    >
                      <Wand2 size={12} /> Manual Explode
                    </button>
                    <button 
                      className="btn-secondary" 
                      style={{ marginTop: '0.4rem', fontSize: '0.65rem', width: '100%', borderColor: 'rgba(217, 70, 239, 0.3)' }}
                      onClick={() => handleCompleteSocket(name, url)}
                    >
                      Round Out Joint (Socket)
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => setStage('rigging')}>Back to Poses</button>
                <button 
                  className="btn-primary" 
                  style={{ padding: '0.75rem 2rem' }}
                  onClick={() => setStage('8dir-bake')}
                >
                  Proceed to 8-Dir Baking
                </button>
              </div>
            </motion.div>
          )}

          {stage === '8dir-bake' && (
            <motion.div
              key="8dir-bake"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card"
              style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center' }}
            >
              <h2 style={{ marginBottom: '1.5rem' }}>8-Directional <span className="gradient-text">Baking</span></h2>
              <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>
                Industry Standard: Generate the intermediate 45-degree angles to complete the 8-directional sprite set.
              </p>

              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(4, 1fr)', 
                gap: '1rem',
                marginBottom: '3rem'
              }}>
                {[
                  { id: 'N', label: 'North (Back)', type: 'cardinal' },
                  { id: 'NE', label: 'North-East', type: 'bake' },
                  { id: 'E', label: 'East (Side)', type: 'cardinal' },
                  { id: 'SE', label: 'South-East', type: 'bake' },
                  { id: 'S', label: 'South (Front)', type: 'cardinal' },
                  { id: 'SW', label: 'South-West', type: 'bake' },
                  { id: 'W', label: 'West (Side)', type: 'cardinal' },
                  { id: 'NW', label: 'North-West', type: 'bake' }
                ].map((dir) => (
                  <div key={dir.id} className="glass-card" style={{ padding: '1rem', background: '#080808', border: dir.type === 'bake' ? '1px dashed #444' : '1px solid #222' }}>
                    <div style={{ height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.5rem' }}>
                       {/* Simplified: Show placeholder or generated image */}
                       <div style={{ color: '#444' }}>{dir.id} View</div>
                    </div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{dir.label}</div>
                    
                    {dir.type === 'bake' ? (
                      <button 
                        className="btn-primary" 
                        style={{ fontSize: '0.6rem', width: '100%', padding: '4px' }}
                        onClick={() => handleGenerateDirectional(dir.id)}
                        disabled={loading}
                      >
                        {loading ? 'Baking...' : 'Bake with FLUX'}
                      </button>
                    ) : (
                      <div style={{ fontSize: '0.6rem', color: '#888' }}>Cardinally Set</div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => setStage('limb-surgery')}>Back to Surgery</button>
                <button 
                  className="btn-primary" 
                  style={{ padding: '0.75rem 2rem' }}
                  onClick={() => setStage('anim-tuner')}
                >
                  Proceed to Animator
                </button>
              </div>
            </motion.div>
          )}
          {stage === 'anim-tuner' && (
            <motion.div
              key="anim-tuner"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card"
              style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}
            >
              <div style={{ textAlign: 'left' }}>
                <h2 style={{ marginBottom: '1.5rem' }}>Animation <span className="gradient-text">Tuner</span></h2>
                <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>
                  Adjust the parameters for the Mesh Deformation animation.
                </p>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ fontSize: '0.9rem', display: 'block', marginBottom: '0.5rem' }}>Animation Type</label>
                    <select 
                      className="btn-secondary" 
                      style={{ width: '100%', padding: '0.75rem' }}
                      value={walkParams.type}
                      onChange={(e) => setWalkParams({...walkParams, type: e.target.value})}
                    >
                      <option value="walk">Walk Cycle (Looping)</option>
                      <option value="jump">Jump / Hop (Looping)</option>
                      <option value="attack">Basic Attack (Thrust)</option>
                    </select>
                 </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', textAlign: 'left', marginBottom: '2rem' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                       <label style={{ fontSize: '0.9rem' }}>Stride Length</label>
                       <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{walkParams.stride}</span>
                    </div>
                    <input type="range" min="0.05" max="0.4" step="0.01" value={walkParams.stride} onChange={(e) => setWalkParams({...walkParams, stride: parseFloat(e.target.value)})} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                       <label style={{ fontSize: '0.9rem' }}>Bounce / Lift</label>
                       <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{walkParams.bounce}</span>
                    </div>
                    <input type="range" min="0" max="0.15" step="0.01" value={walkParams.bounce} onChange={(e) => setWalkParams({...walkParams, bounce: parseFloat(e.target.value)})} style={{ width: '100%' }} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                       <label style={{ fontSize: '0.9rem' }}>Playback Speed</label>
                       <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold' }}>{walkParams.speed}x</span>
                    </div>
                    <input type="range" min="0.5" max="2.0" step="0.1" value={walkParams.speed} onChange={(e) => setWalkParams({...walkParams, speed: parseFloat(e.target.value)})} style={{ width: '100%' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button className="btn-secondary" onClick={() => setStage('rigging')}>Back</button>
                  <button 
                    className="btn-primary" 
                    style={{ flex: 1, padding: '0.75rem' }}
                    onClick={handleGenerateAnimation}
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="animate-spin" /> : <Play size={18} />} Bake Walk Cycle
                  </button>
                </div>
              </div>

              {/* Real-time Preview */}
              <div style={{ 
                background: '#050505', 
                borderRadius: '12px', 
                border: '1px solid var(--glass-border)',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}>
                <LivePreview 
                  rig={rigData[0]} 
                  params={walkParams} 
                />
                <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--accent-primary)' }}>
                  LIVE PREVIEW (REAL-TIME)
                </div>
              </div>
            </motion.div>
          )}

          {stage === 'preview-animation' && (
            <motion.div
              key="preview-animation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="glass-card"
              style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}
            >
              <h2 style={{ marginBottom: '1.5rem' }}>Animation <span className="gradient-text">Preview</span></h2>
              
              <div style={{ 
                width: '100%', 
                aspectRatio: '1/1', 
                background: '#050505', 
                borderRadius: '12px', 
                border: '1px solid var(--glass-border)',
                marginBottom: '2rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}>
                {animFrames.length > 0 && (
                  <img 
                    src={animFrames[currentAnimIdx]} 
                    alt="Animated Preview" 
                    style={{ maxHeight: '90%', maxWidth: '90%', objectFit: 'contain', imageRendering: 'pixelated' }} 
                  />
                )}
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => setStage('anim-tuner')}>Adjust Parameters</button>
                <button 
                  className="btn-primary"
                  onClick={handleBuildIndex}
                  style={{ background: 'var(--accent-secondary)' }}
                >
                  Export Character Index (Totality)
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="glass-card" style={{ 
                    padding: '0', 
                    overflow: 'hidden', 
                    height: '300px', 
                    background: '#00FF00' /* VISIBLE GREEN SCREEN */,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <img 
                      src={selectedVideoSlice?.startsWith('http') ? selectedVideoSlice : `${apiBase}${selectedVideoSlice}`} 
                      style={{ 
                        maxWidth: '100%', 
                        maxHeight: '100%', 
                        objectFit: 'contain',
                        filter: 'drop-shadow(0 0 10px rgba(0,0,0,0.3))'
                      }} 
                      alt="Target Slice" 
                    />
                  </div>
                  
                  <div style={{ textAlign: 'left' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'block' }}>Motion Prompt</label>
                    <textarea 
                      placeholder="Describe the cinematic motion (e.g., 'Character walking towards camera, high fidelity, smooth transition')"
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
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${videoHeartbeat.progress}%` }}
                          style={{ height: '100%', background: 'linear-gradient(to right, #3b82f6, #8b5cf6)' }}
                        />
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Progress: {videoHeartbeat.progress}%</p>
                      
                      <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                         <p style={{ fontSize: '0.7rem', color: '#666' }}>
                           Note: Initial generation takes ~9 minutes to load WanVideo GGUF models. 
                           Subsequent generations will be significantly faster.
                         </p>
                      </div>
                    </div>
                  )}

                  {videoStage === 'done' && videoUrl && (
                    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                      <video 
                        src={videoUrl} 
                        controls 
                        autoPlay 
                        loop 
                        style={{ width: '100%', height: '100%', borderRadius: '8px', objectFit: 'contain' }}
                      />
                      <button 
                        className="btn-secondary"
                        style={{ position: 'absolute', top: '10px', right: '10px', padding: '0.4rem 0.8rem', fontSize: '0.7rem' }}
                        onClick={() => window.open(videoUrl)}
                      >
                        <Download size={14} /> Download MP4
                      </button>
                    </div>
                  )}
                </div>
              </div>
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
                <h2 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Upload size={24} color="var(--accent-secondary)" /> Load Saved Project
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
                          } else {
                            handleLoadProject(project);
                          }
                        }}
                      >
                        {isDeleteMode && (
                        <div style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 5, display: 'flex', gap: '0.5rem' }}>
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
