import React, { useState, useEffect } from 'react'
import { Sparkles, Wand2, Play, Download, Settings, Image as ImageIcon, Loader2, ArrowLeft, RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

function App() {
  const [apiBase, setApiBase] = useState('http://localhost:8000')
  const [stage, setStage] = useState('prompt') // prompt, selecting-anchor, animating, preview

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
      const response = await fetch(`${apiBase}/animate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          image_url: selectedAnchor,
          prompt: `${prompt}, walking forward, consistent animation, game sprite`
        })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setVideoUrl(`${apiBase}${data.url}`);
        setStage('preview');
      }
    } catch (error) {
      console.error("Error animating:", error);
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
                  <p>Generating walk cycle video...</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>This may take 1-2 minutes on local hardware</p>
                </div>
              ) : (
                <>
                  <p style={{ color: 'var(--text-dim)', marginBottom: '2rem' }}>
                    We'll now generate a walk cycle video based on this anchor image.
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <button className="btn-secondary" onClick={() => setStage('selecting-anchor')}>
                      <ArrowLeft size={18} style={{ marginRight: '0.5rem' }} /> Back
                    </button>
                    <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={handleAnimate}>
                      <Play size={18} />
                      Animate Walk Cycle
                    </button>
                  </div>
                </>
              )}
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
              <h2 style={{ marginBottom: '1.5rem' }}>{spritesheetUrl ? 'Final' : 'Animation'} <span className="gradient-text">{spritesheetUrl ? 'Sprite Sheet' : 'Preview'}</span></h2>
              <div style={{ background: '#000', borderRadius: '12px', padding: '1rem', marginBottom: '2rem', overflow: 'hidden', minHeight: '300px', maxHeight: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {spritesheetUrl ? (
                  <div style={{ overflowX: 'auto', width: '100%' }}>
                    <img src={spritesheetUrl} alt="Spritesheet" style={{ height: '200px', imageRendering: 'pixelated', maxWidth: 'none' }} />
                  </div>
                ) : (
                  <video src={videoUrl} autoPlay loop muted style={{ maxHeight: '100%', maxWidth: '100%', borderRadius: '8px' }} />
                )}
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                <button className="btn-secondary" onClick={() => { setStage('animating'); setSpritesheetUrl(null); }}>
                  <RefreshCw size={18} style={{ marginRight: '0.5rem' }} /> Re-generate
                </button>
                {spritesheetUrl ? (
                  <a href={spritesheetUrl} download="spritesheet.png" className="btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 2rem' }}>
                    <Download size={18} />
                    Download Sprite Sheet
                  </a>
                ) : (
                  <button 
                    className="btn-primary" 
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 2rem' }} 
                    onClick={handleGenerateSpritesheet} 
                    disabled={loading}
                  >
                    {loading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                    {loading ? 'Forging Sheet...' : 'Generate Sprite Sheet'}
                  </button>
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
