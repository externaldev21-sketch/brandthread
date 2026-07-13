export default function Slide07AccountType() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#0A0A0A',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(0,200,83,0.08),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(0,200,83,0.07) 0%, transparent 55%)'}} />
      <div style={ph}>
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        <div style={{flex:1,overflow:'hidden',padding:'2.5vh 3vh 0',display:'flex',flexDirection:'column'}}>
          <div style={{fontSize:'2.6vh',fontWeight:800,color:'#FFF',letterSpacing:'-0.03em',marginBottom:'0.8vh'}}>Who are you here as?</div>
          <div style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.45)',marginBottom:'3vh',lineHeight:1.4}}>This shapes your entire experience. You can add the other side later.</div>
          {/* Buyer card */}
          <div style={{background:'#141414',borderRadius:'1.6vh',border:'0.15vh solid #2A2A2A',padding:'1.8vh 2vh',marginBottom:'1.2vh',display:'flex',alignItems:'center',gap:'1.5vh'}}>
            <div style={{width:'5vh',height:'5vh',borderRadius:'1.2vh',background:'rgba(0,200,83,0.12)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <span style={{fontSize:'2.5vh'}}>🛒</span>
            </div>
            <div>
              <div style={{fontSize:'1.6vh',fontWeight:700,color:'#FFF',marginBottom:'0.3vh'}}>Buyer</div>
              <div style={{fontSize:'1.1vh',color:'rgba(255,255,255,0.4)',lineHeight:1.3}}>Discover and shop independent fashion brands</div>
            </div>
          </div>
          {/* Seller card — selected */}
          <div style={{background:'rgba(0,200,83,0.08)',borderRadius:'1.6vh',border:'0.2vh solid #00C853',padding:'1.8vh 2vh',marginBottom:'1.2vh',display:'flex',alignItems:'center',gap:'1.5vh',position:'relative'}}>
            <div style={{width:'5vh',height:'5vh',borderRadius:'1.2vh',background:'rgba(0,200,83,0.18)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <span style={{fontSize:'2.5vh'}}>🏷️</span>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:'1.6vh',fontWeight:700,color:'#00C853',marginBottom:'0.3vh'}}>Seller</div>
              <div style={{fontSize:'1.1vh',color:'rgba(255,255,255,0.45)',lineHeight:1.3}}>Build and run your fashion brand</div>
            </div>
            <div style={{width:'2vh',height:'2vh',borderRadius:'50%',background:'#00C853',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <span style={{fontSize:'1.2vh',color:'#000',fontWeight:700}}>✓</span>
            </div>
          </div>
          {/* Both card */}
          <div style={{background:'#141414',borderRadius:'1.6vh',border:'0.15vh solid #2A2A2A',padding:'1.8vh 2vh',marginBottom:'3vh',display:'flex',alignItems:'center',gap:'1.5vh'}}>
            <div style={{width:'5vh',height:'5vh',borderRadius:'1.2vh',background:'rgba(155,89,182,0.12)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <span style={{fontSize:'2.5vh'}}>✨</span>
            </div>
            <div>
              <div style={{fontSize:'1.6vh',fontWeight:700,color:'#FFF',marginBottom:'0.3vh'}}>Both</div>
              <div style={{fontSize:'1.1vh',color:'rgba(255,255,255,0.4)',lineHeight:1.3}}>Run a brand and shop others</div>
            </div>
          </div>
          <div style={{background:'#00C853',borderRadius:'1.4vh',padding:'1.5vh',textAlign:'center'}}>
            <span style={{fontSize:'1.4vh',fontWeight:700,color:'#021208'}}>Continue</span>
          </div>
        </div>
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>ACCOUNT TYPE</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>07 / 19</span>
      </div>
    </div>
  );
}
