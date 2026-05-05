import React, { useState, useEffect, useRef } from 'react'
import { Sparkles, Wand2, Play, Download, Settings, Image as ImageIcon, Loader2, ArrowLeft, RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

function App() {
  const [apiBase, setApiBase] = useState('http://localhost:8000')
  const [stage, setStage] = useState('prompt') // prompt, selecting-anchor, animating, editing, preview

  useEffect(() => {
    const discover = async () => {
      for (let p = 8000; p <= 8010; p++) {
        try {
          const res = await fetch(`http://localhost:${p}/`, { method: 'GET' });
          const data = await res.json();
          if (data.status === 'active') {
            setApiBase(`http://localhost:${p}`);
            return;
          }
        } catch (e) {}
      }
    }
    discover();
  }, [])
  const [prompt, setPrompt] = useState('')
  const [variants, setVariants] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedAnchor, setSelectedAnchor] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [spritesheetUrl, setSpritesheetUrl] = useState(null)

  // Frame editor state
  const [sessionId, setSessionId] = useState(null)
  const [frameUrls, setFrameUrls] = useState([])
  const [skeletonUrls, setSkeletonUrls] = useState([])
  const [anchorUrl, setAnchorUrl] = useState(null)
  const [redoingFrame, setRedoingFrame] = useState(null) // index of frame being regenerated
  const [animFrame, setAnimFrame] = useState(0) // current animation preview frame

  // Animation preview timer
  const animRef = useRef(null)
  useEffect(() => {
    if (stage === 'editing' && frameUrls.length > 0) {
      animRef.current = setInterval(() => {
        setAnimFrame(prev => (prev + 1) % frameUrls.length)
      }, 150)
      return () => clearInterval(animRef.current)
    }
  }, [stage, frameUrls.length])

  const handleForgeAnchor = async () => {
    setLoading(true)
    setStage('selecting-anchor')
    setVariants([]) // Clear previous variants
    
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

  const handleAnimate = async () => {
    setLoading(true)
    
    try {
      const response = await fetch(`${apiBase}/animate-openpose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          image_url: selectedAnchor,
          prompt: prompt,
          reference_video: 'ref_front.mp4',
          num_frames: 8
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
          prompt: prompt,
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

  const handleStitchFrames = async () => {
    setLoading(true)
    try {
      // Strip apiBase from URLs for the backend
      const relativeUrls = frameUrls.map(u => {
        const url = new URL(u)
        return url.pathname
      })
      const response = await fetch(`${apiBase}/stitch-frames`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame_urls: relativeUrls })
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

  const handleGenerateSpritesheet = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${apiBase}/generate-spritesheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: videoUrl })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setSpritesheetUrl(`${apiBase}${data.url}`);
      }
    } catch (error) {
      console.error("Error generating spritesheet:", error);
    } finally {
      setLoading(false)
    }
  }

  const selectAnchor = (variant) => {
    setSelectedAnchor(variant)
    setStage('animating')
  }

  const reset = () => {
    setStage('prompt')
    setPrompt('')
    setVariants([])
    setSelectedAnchor(null)
    setVideoUrl(null)
    setSpritesheetUrl(null)
    setFrameUrls([])
    setSkeletonUrls([])
    setSessionId(null)
    setAnchorUrl(null)
  }

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
                  <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Settings size={18} />
                    Options
                  </button>
                </div>
                <button 
                  className="btn-primary" 
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 2rem' }}
                  onClick={handleForgeAnchor}
                  disabled={!prompt.trim()}
                >
                  <Wand2 size={18} />
                  Forge Anchor
                </button>
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
                      <div style={{ padding: '1rem', borderTop: '1px solid var(--glass-border)' }}>
                        <button className="btn-secondary" style={{ width: '100%' }}>Select Variant {i + 1}</button>
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
                  <p>Forging 8-frame walk cycle with OpenPose...</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>This takes ~3 minutes (8 frames × 20 sec each)</p>
                </div>
              ) : (
                <>
                  <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>
                    We'll generate 8 walk cycle frames. You can redo any frame afterwards.
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <button className="btn-secondary" onClick={() => setStage('selecting-anchor')}>
                      <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Back
                    </button>
                    <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={handleAnimate}>
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
              style={{ maxWidth: '1100px', margin: '0 auto' }}
            >
              <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>
                Refine your <span className="gradient-text">Walk Cycle</span>
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) minmax(200px, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                {/* 8 individual frames in a 4x2 grid on the left, animation preview on the right */}
                {frameUrls.map((url, i) => (
                  <motion.div
                    key={i}
                    className="glass-card"
                    style={{ padding: '0', overflow: 'hidden', textAlign: 'center' }}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <div style={{ 
                      background: '#0a0a0a', 
                      padding: '0.75rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      height: '140px',
                      position: 'relative'
                    }}>
                      <img 
                        src={url} 
                        alt={`Frame ${i + 1}`} 
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
                      />
                      <span style={{
                        position: 'absolute', top: '6px', left: '8px',
                        fontSize: '0.65rem', color: 'var(--text-dim)',
                        background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: '4px'
                      }}>F{i + 1}</span>
                    </div>
                    <div style={{ padding: '0.5rem' }}>
                      <button 
                        className="btn-secondary" 
                        style={{ 
                          width: '100%', 
                          fontSize: '0.75rem', 
                          padding: '0.4rem 0.5rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.3rem',
                          opacity: redoingFrame !== null ? 0.5 : 1
                        }}
                        onClick={() => handleRedoFrame(i)}
                        disabled={redoingFrame !== null}
                      >
                        {redoingFrame === i ? (
                          <><Loader2 size={12} className="animate-spin" /> Redoing...</>
                        ) : (
                          <><RefreshCw size={12} /> Redo</>
                        )}
                      </button>
                    </div>
                  </motion.div>
                ))}

                {/* Animation Preview - spans the 5th column, both rows */}
                <motion.div
                  className="glass-card"
                  style={{ 
                    padding: '0', 
                    overflow: 'hidden', 
                    gridRow: '1 / 3',
                    gridColumn: '5',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <span style={{ 
                    fontSize: '0.75rem', 
                    color: 'var(--accent-secondary)', 
                    fontWeight: 600, 
                    marginBottom: '0.5rem',
                    marginTop: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em'
                  }}>Preview</span>
                  <div style={{ 
                    background: '#0a0a0a', 
                    width: '100%', 
                    flex: 1, 
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
                          maxHeight: '200px', 
                          maxWidth: '100%', 
                          objectFit: 'contain', 
                          imageRendering: 'pixelated' 
                        }}
                      />
                    )}
                  </div>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', padding: '0.5rem' }}>
                    Frame {animFrame + 1}/{frameUrls.length}
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
              style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}
            >
              <h2 style={{ marginBottom: '1.5rem' }}>Final <span className="gradient-text">Sprite Sheet</span></h2>
              <div style={{ background: '#000', borderRadius: '12px', padding: '1rem', marginBottom: '2rem', overflow: 'hidden', minHeight: '300px', maxHeight: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
        </AnimatePresence>
      </main>

      <footer style={{ marginTop: '5rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
        <p>© 2026 SpriteForge AI Pipeline • Powered by Local AI</p>
      </footer>
    </div>
  )
}

export default App
