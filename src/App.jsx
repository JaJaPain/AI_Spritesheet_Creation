import React, { useState, useEffect } from 'react'
import { Sparkles, Wand2, Play, Download, Settings, Image as ImageIcon, Loader2, ArrowLeft, RefreshCw } from 'lucide-react'

function App() {
  const [apiBase, setApiBase] = useState('http://localhost:8000')
  const [stage, setStage] = useState('prompt') // prompt, selecting-anchor, preview
  const [prompt, setPrompt] = useState('female high elf wearing leather armor')
  const [variants, setVariants] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Idle')
  const [selectedAnchor, setSelectedAnchor] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [spritesheetUrl, setSpritesheetUrl] = useState(null)

  useEffect(() => {
    const discover = async () => {
      for (let p = 8000; p <= 8005; p++) {
        try {
          const res = await fetch(`http://localhost:${p}/`, { method: 'GET' });
          const data = await res.json();
          if (data.status === 'active') { setApiBase(`http://localhost:${p}`); return; }
        } catch (e) {}
      }
    }
    discover();
  }, [])

  const handleForgeAnchor = async () => {
    setLoading(true);
    setStatus('Forging 4 Variants (Running SDXL + ControlNet)...');
    setStage('selecting-anchor');
    setVariants([]);
    try {
      const response = await fetch(`${apiBase}/generate-anchor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, template_id: 'default', num_variants: 4 })
      });
      const data = await response.json();
      if (data.status === 'success') {
        setVariants(data.urls.map(url => `${apiBase}${url}`));
        setStatus('Select your favorite anchor below.');
      }
    } catch (error) {
      setStatus('Error forging anchors. Check backend log.');
    } finally {
      setLoading(false);
    }
  }

  const handleAnimateGuided = async () => {
    setLoading(true);
    setStatus('Precision Forging: Running 8-frame ControlNet cycle using YouTube reference...');
    try {
      const response = await fetch(`${apiBase}/animate-guided`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: selectedAnchor, prompt: prompt })
      });
      const data = await response.json();
      if (data.url) {
        setSpritesheetUrl(`${apiBase}${data.url}`);
        setStage('preview');
        setStatus('Success! Your 8-frame walk cycle is ready.');
      }
    } catch (error) {
      setStatus('Error during guided animation.');
    } finally {
      setLoading(false);
    }
  }

  const reset = () => {
    setStage('prompt');
    setVariants([]);
    setSelectedAnchor(null);
    setVideoUrl(null);
    setSpritesheetUrl(null);
    setStatus('Ready to forge.');
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: 'white', padding: '2rem', fontFamily: 'Inter, system-ui' }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.05em' }}>
          SPRITEFORGE <span style={{ color: '#6366f1' }}>AI</span>
        </h1>
        <div style={{ background: '#1a1a1a', padding: '0.5rem 1rem', borderRadius: '20px', fontSize: '0.8rem', color: '#888' }}>
          Status: <span style={{ color: '#fff' }}>{status}</span>
        </div>
      </div>

      {/* STAGE: PROMPT */}
      {stage === 'prompt' && (
        <div style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Forge Your Hero</h2>
          <textarea 
            style={{ width: '100%', padding: '1rem', background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px', color: 'white', fontSize: '1.1rem', marginBottom: '1.5rem', height: '100px' }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button 
            onClick={handleForgeAnchor}
            disabled={loading}
            style={{ width: '100%', padding: '1rem', background: '#6366f1', border: 'none', borderRadius: '12px', color: 'white', fontWeight: 700, fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Wand2 size={20} />}
            {loading ? 'Working...' : 'Forge Character Anchors'}
          </button>
        </div>
      )}

      {/* STAGE: SELECTION */}
      {stage === 'selecting-anchor' && (
        <div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
            <button onClick={reset} style={{ background: 'none', border: '1px solid #333', color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>← Back</button>
            <h2 style={{ margin: 0 }}>Choose Your Anchor</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
            {loading && variants.length === 0 && [1,2,3,4].map(i => (
              <div key={i} style={{ height: '300px', background: '#1a1a1a', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 className="animate-spin" size={40} color="#333" />
              </div>
            ))}
            {variants.map((url, i) => (
              <div 
                key={i} 
                onClick={() => setSelectedAnchor(url)}
                style={{ 
                  background: '#1a1a1a', 
                  borderRadius: '12px', 
                  padding: '1rem', 
                  cursor: 'pointer', 
                  border: selectedAnchor === url ? '2px solid #6366f1' : '2px solid transparent',
                  transition: '0.2s'
                }}
              >
                <img src={url} alt="Variant" style={{ width: '100%', height: 'auto', borderRadius: '8px' }} />
                <button style={{ width: '100%', marginTop: '1rem', padding: '0.5rem', background: selectedAnchor === url ? '#6366f1' : '#333', border: 'none', color: 'white', borderRadius: '6px' }}>
                  {selectedAnchor === url ? 'SELECTED' : `Variant ${i+1}`}
                </button>
              </div>
            ))}
          </div>

          {selectedAnchor && (
            <div style={{ position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', padding: '1rem 2rem', borderRadius: '50px', border: '1px solid #333', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: '#888' }}>Step 2:</span>
              <button 
                onClick={handleAnimateGuided}
                disabled={loading}
                style={{ padding: '0.75rem 1.5rem', background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)', border: 'none', borderRadius: '25px', color: 'white', fontWeight: 700, cursor: 'pointer' }}
              >
                {loading ? 'Processing Frames...' : 'Precision Forge (Perfect Walk)'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* STAGE: PREVIEW */}
      {stage === 'preview' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
            <button onClick={() => setStage('selecting-anchor')} style={{ background: 'none', border: '1px solid #333', color: 'white', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>← Back</button>
            <h2 style={{ margin: 0 }}>Your Final Sprite</h2>
          </div>

          <div style={{ background: '#1a1a1a', padding: '3rem', borderRadius: '24px', display: 'inline-block', marginBottom: '2rem' }}>
            <img src={spritesheetUrl} alt="Final Sprite" style={{ maxWidth: '100%', imageRendering: 'pixelated' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
            <a href={spritesheetUrl} download="spritesheet.png" style={{ textDecoration: 'none', padding: '1rem 2rem', background: '#6366f1', borderRadius: '12px', color: 'white', fontWeight: 700 }}>Download Sprite Sheet</a>
            <button onClick={reset} style={{ padding: '1rem 2rem', background: '#333', border: 'none', borderRadius: '12px', color: 'white', fontWeight: 700, cursor: 'pointer' }}>Start Over</button>
          </div>
        </div>
      )}

      {/* FOOTER STATUS */}
      {loading && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <Loader2 className="animate-spin" size={60} color="#6366f1" />
          <p style={{ marginTop: '1.5rem', fontSize: '1.2rem', fontWeight: 500 }}>{status}</p>
        </div>
      )}
    </div>
  )
}

export default App
