export default function Slide01Cover() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'radial-gradient(ellipse at 50% 55%, #041A0A 0%, #020802 45%, #010301 100%)', fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 50%, rgba(0,200,83,0.12) 0%, transparent 60%)'}} />

      {/* Top rule */}
      <div style={{position:'absolute',top:'8vh',left:'8vw',right:'8vw',height:'0.15vh',background:'rgba(0,200,83,0.3)'}} />

      {/* Center content */}
      <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',display:'flex',flexDirection:'column',alignItems:'center',gap:'3vh'}}>
        <div style={{width:'12vh',height:'12vh',borderRadius:'2.5vh',background:'#00C853',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 0 6vh 2vh rgba(0,200,83,0.4)'}}>
          <span style={{fontSize:'7vh',color:'#FFF',fontWeight:800,letterSpacing:'-0.05em'}}>B</span>
        </div>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:'8vw',fontWeight:800,color:'#FFFFFF',letterSpacing:'-0.04em',lineHeight:1,textWrap:'balance'}}>BRANDTHREAD</div>
          <div style={{fontSize:'1.6vw',fontWeight:500,color:'rgba(255,255,255,0.45)',letterSpacing:'0.4em',marginTop:'1.5vh',textTransform:'uppercase'}}>App Walkthrough</div>
        </div>
        <div style={{width:'6vw',height:'0.2vh',background:'rgba(0,200,83,0.5)',borderRadius:'1vh'}} />
        <div style={{fontSize:'1.6vw',color:'rgba(255,255,255,0.35)',letterSpacing:'0.02em',textAlign:'center',maxWidth:'40vw',lineHeight:1.6}}>
          From first open to your dashboard — every screen, in order
        </div>
      </div>

      {/* Bottom */}
      <div style={{position:'absolute',bottom:'5vh',left:'8vw',right:'8vw',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.25)',letterSpacing:'0.05em'}}>BRANDTHREAD INC.</span>
        <span style={{fontSize:'1.2vw',color:'rgba(0,200,83,0.5)',letterSpacing:'0.05em'}}>01 — 19</span>
      </div>
      <div style={{position:'absolute',bottom:'8vh',left:'8vw',right:'8vw',height:'0.15vh',background:'rgba(0,200,83,0.15)'}} />
    </div>
  );
}
