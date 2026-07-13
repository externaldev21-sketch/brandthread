export default function Slide08SellerStep1() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#0E0E0E',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(74,144,226,0.1),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  const dot = (active: boolean) => <div style={{height:'0.5vh',flex:1,borderRadius:'0.3vh',background: active ? '#4A90E2' : 'rgba(255,255,255,0.15)'}} />;
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(74,144,226,0.06) 0%, transparent 55%)'}} />
      <div style={ph}>
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        {/* Progress dots */}
        <div style={{padding:'1.5vh 3vh 0',display:'flex',gap:'0.6vh',flexShrink:0}}>
          {dot(true)}{dot(false)}{dot(false)}{dot(false)}{dot(false)}{dot(false)}{dot(false)}{dot(false)}{dot(false)}
        </div>
        <div style={{flex:1,overflow:'hidden',padding:'2.5vh 3vh 0',display:'flex',flexDirection:'column'}}>
          <div style={{fontSize:'3.2vh',fontWeight:800,color:'#FFF',letterSpacing:'-0.03em',marginBottom:'0.8vh'}}>You're in!</div>
          <div style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.45)',marginBottom:'3.5vh',lineHeight:1.5}}>Let us help you get started with a few questions.</div>
          <div style={{fontSize:'1.5vh',fontWeight:700,color:'#FFF',marginBottom:'1.5vh'}}>What best describes you?</div>
          {/* Option 1 — selected */}
          <div style={{background:'rgba(74,144,226,0.08)',borderRadius:'1.2vh',border:'0.2vh solid #4A90E2',padding:'1.6vh',marginBottom:'1.2vh'}}>
            <span style={{fontSize:'1.4vh',fontWeight:500,color:'#FFF'}}>I am just starting</span>
          </div>
          {/* Option 2 */}
          <div style={{background:'#171717',borderRadius:'1.2vh',border:'0.15vh solid #2A2A2A',padding:'1.6vh',marginBottom:'4vh'}}>
            <span style={{fontSize:'1.4vh',fontWeight:500,color:'rgba(255,255,255,0.7)'}}>I am already selling online or in person</span>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end'}}>
            <div style={{background:'#4A90E2',borderRadius:'1.4vh',padding:'1.3vh 3.5vh',display:'flex',alignItems:'center',gap:'0.8vh'}}>
              <span style={{fontSize:'1.4vh',fontWeight:700,color:'#FFF'}}>Continue</span>
            </div>
          </div>
        </div>
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>SELLER ONBOARDING — STEP 1 OF 9</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>08 / 19</span>
      </div>
    </div>
  );
}
