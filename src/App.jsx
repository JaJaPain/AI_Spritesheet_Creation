import React, { useState, useEffect, useRef } from 'react'
import { Sparkles, Wand2, Play, Download, Settings, Image as ImageIcon, Loader2, ArrowLeft, RefreshCw, Save, Upload, X, Check, FolderOpen } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

function App() {
  const [apiBase, setApiBase] = useState(null)
  const [stage, setStage] = useState('prompt') // prompt, selecting-anchor, animating, editing, preview
  const [apiReady, setApiReady] = useState(false)

  useEffect(() => {
    let timeout = null;
    const discover = async () => {
      let found = false;
      // If we already have a base, check if it's still alive first
      if (apiBase) {
        try {
          const res = await fetch(`${apiBase}/`, { method: 'GET' });
          const data = await res.json();
          if (data.status === 'active') {
            setApiReady(true);
            timeout = setTimeout(discover, 5000); // Check again in 5s
            return;
          }
        } catch (e) {
          setApiReady(false);
        }
      }

      for (let p = 8000; p <= 8010; p++) {
        try {
          const res = await fetch(`http://localhost:${p}/`, { method: 'GET' });
          const data = await res.json();
          if (data.status === 'active') {
            console.log(`SpriteForge backend found on port ${p}`);
            setApiBase(`http://localhost:${p}`);
            setApiReady(true);
            found = true;
            break;
          }
        } catch (e) {}
      }
      
      if (!found) {
        setApiReady(false);
      }
      timeout = setTimeout(discover, found ? 10000 : 2000);
    }
    discover();
    return () => clearTimeout(timeout);
  }, [apiBase])
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
  const [isZoomed, setIsZoomed] = useState(false)
  const turnaroundCanvasRef = useRef(null)
  
  // Slicing State
  const [slicedUrls, setSlicedUrls] = useState([])
  const [slicing, setSlicing] = useState(false)
  
  // Rigging State
  const [rigData, setRigData] = useState([])
  const [rigging, setRigging] = useState(false)
  
  // UI Modals

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
    setGeneratingTurnaround(true)
    setIsTurnaroundModalOpen(true)
    try {
      const response = await fetch(`${apiBase}/generate-turnaround`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          session_id: Date.now().toString(),
          prompt: prompt,
          enforce_white: enforceWhite
        })
      });
      const data = await response.json();
      if (data.status === 'success') {
        const imageUrl = data.url || data.image_url;
        setTurnaroundUrl(`${apiBase}${imageUrl}?t=${Date.now()}`)
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
          force_overwrite: forceOverwrite
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
        setSlicedUrls(data.urls.map(u => `${apiBase}${u}`))
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

  const fetchSavedProjects = async () => {
    try {
      const res = await fetch(`${apiBase}/list-projects`);
      const data = await res.json();
      if (data.status === 'success') {
        setSavedProjects(data.saves);
        setIsLoadModalOpen(true);
      }
    } catch (err) {
      console.error("Failed to list saves:", err);
    }
  }

  const handleLoadProject = (project) => {
    setActiveProjectId(project.id);
    setPrompt(project.prompt);
    // Add cache buster to ensure the image refreshes
    setTurnaroundUrl(`${apiBase}${project.image_url}?t=${Date.now()}`);
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
              style={{ maxWidth: '800px', margin: '0 auto' }}
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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button 
                    className="btn-secondary" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} 
                    onClick={() => setIsOptionsOpen(true)}
                    disabled={!apiReady}
                  >
                    <Settings size={18} />
                    Options
                  </button>
                  <button 
                    className="btn-secondary" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    onClick={fetchSavedProjects}
                    disabled={!apiReady}
                  >
                    <FolderOpen size={18} />
                    Load Saved Sprite
                  </button>
                  <button 
                    className="btn-secondary" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: 0.7 }}
                    onClick={openOutputFolder}
                    disabled={!apiReady}
                    title="Open Output_Saves folder in Explorer"
                  >
                    <Download size={18} />
                    Open Saves Folder
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button 
                    className="btn-primary" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 2rem', background: 'linear-gradient(to right, #8b5cf6, #d946ef)' }}
                    onClick={handleGenerateTurnaround}
                    disabled={!prompt.trim() || generatingTurnaround || !apiReady}
                  >
                    {generatingTurnaround ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                    FLUX Turnaround (Exp)
                  </button>
                </div>
              </div>
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
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>This takes ~4 minutes (12 frames × 20 sec each)</p>
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
                {slicedUrls.map((url, i) => (
                  <div key={i} className="glass-card" style={{ padding: '0', overflow: 'hidden', height: '250px', background: 'rgba(255,255,255,0.02)' }}>
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
                ))}
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
                  <div key={i} className="glass-card" style={{ padding: '0', overflow: 'hidden', height: '350px', position: 'relative' }}>
                    <div style={{ 
                      height: '100%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      background: '#111'
                    }}>
                      <img src={rig.url} alt={`Pose ${i}`} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', opacity: 0.5 }} />
                      
                      {/* SVG Overlay for Skeleton */}
                      <svg 
                        viewBox="0 0 1 1" 
                        style={{ 
                          position: 'absolute', 
                          top: 0, left: 0, width: '100%', height: '100%',
                          pointerEvents: 'none'
                        }}
                      >
                        {/* Draw Bones */}
                        {rig.joints.shoulder_l && rig.joints.elbow_l && (
                          <line x1={rig.joints.shoulder_l.x} y1={rig.joints.shoulder_l.y} x2={rig.joints.elbow_l.x} y2={rig.joints.elbow_l.y} stroke="rgba(255,255,255,0.5)" strokeWidth="0.01" />
                        )}
                        {rig.joints.elbow_l && rig.joints.wrist_l && (
                          <line x1={rig.joints.elbow_l.x} y1={rig.joints.elbow_l.y} x2={rig.joints.wrist_l.x} y2={rig.joints.wrist_l.y} stroke="rgba(255,255,255,0.5)" strokeWidth="0.01" />
                        )}
                        {/* ... add more bones here ... */}
                        
                        {/* Draw Joints */}
                        {Object.entries(rig.joints).map(([name, pos]) => (
                          <circle 
                            key={name}
                            cx={pos.x} 
                            cy={pos.y} 
                            r="0.01" 
                            fill={pos.v > 0.5 ? "#8b5cf6" : "#444"} 
                            stroke="white" 
                            strokeWidth="0.002"
                          />
                        ))}
                      </svg>
                    </div>
                    <div style={{ padding: '0.5rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.5)' }}>
                      Pose {i + 1}
                    </div>
                  </div>
                ))}
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => setStage('slicing')}>
                  <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Back to Slices
                </button>
                <button 
                  className="btn-primary" 
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 2rem' }}
                  onClick={() => {
                    alert(`Animation Phase (Phase 5) will use project: ${activeProjectId || 'Temporary'}`);
                    // Future: handleAnimation(rigData)
                  }}
                >
                  <Play size={18} /> Proceed to Animation (Phase 5)
                </button>
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
                        className={isZoomed ? "btn-primary" : "btn-secondary"}
                        style={{ 
                          padding: '0.4rem 1rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
                          background: isZoomed ? 'var(--accent-secondary)' : undefined,
                          borderColor: isZoomed ? 'var(--accent-secondary)' : undefined
                        }}
                        onClick={() => setIsZoomed(!isZoomed)}
                      >
                        <Sparkles size={14} /> {isZoomed ? 'Zoom 1.0x' : 'Zoom 1.5x'}
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
                display: 'flex', 
                alignItems: isZoomed ? 'flex-start' : 'center', 
                justifyContent: isZoomed ? 'flex-start' : 'center', 
                padding: '1rem', 
                border: '1px solid var(--glass-border)',
                cursor: isWandActive ? 'crosshair' : 'default',
                overflow: 'auto',
                position: 'relative'
              }}>
                {generatingTurnaround ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <Loader2 size={48} className="animate-spin" color="#d946ef" />
                    <p style={{ color: 'var(--text-dim)' }}>Loading FLUX.1 and generating turnaround sheet...</p>
                    <p style={{ fontSize: '0.8rem', color: '#888' }}>This requires ~14GB VRAM and may take 30-60 seconds.</p>
                  </div>
                ) : turnaroundUrl ? (
                  <img 
                    src={turnaroundUrl} 
                    alt="Turnaround Sheet" 
                    style={{ 
                      maxWidth: isZoomed ? 'none' : '100%', 
                      maxHeight: isZoomed ? 'none' : '100%', 
                      width: isZoomed ? '150%' : 'auto',
                      height: 'auto',
                      objectFit: 'contain',
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
              style={{ width: '100%', maxWidth: '500px', padding: '2rem', textAlign: 'center' }}
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
                <h2 style={{ fontSize: '1.5rem' }}>Project <span className="gradient-text">Library</span></h2>
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
                    {savedProjects.map(project => (
                      <motion.div 
                        key={project.id}
                        whileHover={{ y: -5, borderColor: 'var(--accent-primary)' }}
                        className="glass-card"
                        style={{ padding: '1rem', cursor: 'pointer', transition: 'border-color 0.2s' }}
                        onClick={() => handleLoadProject(project)}
                      >
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
    </div>
  )
}

export default App
