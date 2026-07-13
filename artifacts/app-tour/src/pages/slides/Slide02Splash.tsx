export default function Slide02Splash() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#060A06',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(0,200,83,0.1),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(0,200,83,0.07) 0%, transparent 55%)'}} />
      <div style={ph}>
        {/* Dynamic Island */}
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        {/* Status bar */}
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        {/* Screen */}
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'2vh',padding:'0 3vh'}}>
          <div style={{position:'relative'}}>
            <div style={{position:'absolute',inset:'-2vh',borderRadius:'50%',background:'rgba(0,200,83,0.15)',filter:'blur(1.5vh)'}} />
            <div style={{width:'10vh',height:'10vh',borderRadius:'2.2vh',background:'#00C853',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 0 4vh 1vh rgba(0,200,83,0.5)',position:'relative'}}>
              <span style={{fontSize:'5.5vh',fontWeight:800,color:'#FFF'}}>B</span>
            </div>
          </div>
          <div style={{textAlign:'center',display:'flex',flexDirection:'column',gap:'0.8vh',marginTop:'0.5vh'}}>
            <span style={{fontSize:'1.6vh',fontWeight:700,color:'#FFF',letterSpacing:'0.3em'}}>BRANDTHREAD</span>
            <span style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.35)',letterSpacing:'0.05em'}}>Your brand, your rules.</span>
          </div>
        </div>
        {/* Home indicator */}
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      {/* Labels */}
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>SPLASH SCREEN</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>02 / 19</span>
      </div>
    </div>
  );
}
