export default function Slide12BuildAnimation() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#0A0A0A',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(0,200,83,0.12),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(0,200,83,0.08) 0%, transparent 55%)'}} />
      <div style={ph}>
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'0 4vh',gap:'2.5vh'}}>
          <div style={{position:'relative'}}>
            <div style={{position:'absolute',inset:'-3vh',borderRadius:'50%',background:'rgba(0,200,83,0.1)',filter:'blur(2vh)'}} />
            <div style={{width:'9vh',height:'9vh',borderRadius:'2vh',background:'#00C853',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 0 5vh 2vh rgba(0,200,83,0.5)',position:'relative'}}>
              <span style={{fontSize:'5vh',fontWeight:800,color:'#FFF'}}>B</span>
            </div>
          </div>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:'2.2vh',fontWeight:800,color:'#FFF',letterSpacing:'-0.02em',marginBottom:'0.8vh'}}>Building your workspace</div>
            <div style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.4)'}}>Connecting your tools...</div>
          </div>
          {/* Progress bar */}
          <div style={{width:'100%',height:'0.5vh',background:'rgba(255,255,255,0.1)',borderRadius:'1vh',overflow:'hidden'}}>
            <div style={{width:'72%',height:'100%',background:'linear-gradient(90deg, #00C853, #39FF88)',borderRadius:'1vh'}} />
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'1vh',width:'100%'}}>
            {['Setting up your workspace', 'Configuring your brand profile', 'Connecting your tools'].map((step, i) => (
              <div key={step} style={{display:'flex',alignItems:'center',gap:'1.2vh'}}>
                <div style={{width:'1.5vh',height:'1.5vh',borderRadius:'50%',background: i < 2 ? '#00C853' : 'rgba(255,255,255,0.15)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {i < 2 && <span style={{fontSize:'0.8vh',color:'#000',fontWeight:800}}>✓</span>}
                </div>
                <span style={{fontSize:'1.2vh',color: i < 2 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.8)'}}>{step}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>BUILD ANIMATION</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>12 / 19</span>
      </div>
    </div>
  );
}
