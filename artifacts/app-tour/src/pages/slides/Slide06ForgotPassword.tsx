export default function Slide06ForgotPassword() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#0F0F0F',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(0,200,83,0.08),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(0,200,83,0.06) 0%, transparent 55%)'}} />
      <div style={ph}>
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        <div style={{flex:1,overflow:'hidden',padding:'2vh 3vh 0'}}>
          <div style={{fontSize:'1.8vh',color:'rgba(255,255,255,0.4)',marginBottom:'3vh'}}>←</div>
          {/* Lock icon */}
          <div style={{width:'7vh',height:'7vh',borderRadius:'1.5vh',background:'rgba(0,200,83,0.12)',border:'0.15vh solid rgba(0,200,83,0.3)',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:'2.5vh'}}>
            <span style={{fontSize:'3.5vh'}}>🔒</span>
          </div>
          <div style={{fontSize:'2.8vh',fontWeight:800,color:'#FFF',letterSpacing:'-0.03em',marginBottom:'1vh'}}>Reset your password</div>
          <div style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.45)',lineHeight:1.5,marginBottom:'4vh'}}>Enter your email and we'll send a verification code.</div>
          <div style={{fontSize:'1.1vh',color:'rgba(255,255,255,0.45)',fontWeight:600,letterSpacing:'0.04em',marginBottom:'0.6vh'}}>EMAIL ADDRESS</div>
          <div style={{background:'#252525',borderRadius:'1.2vh',border:'0.15vh solid #2A2A2A',padding:'1.3vh 1.4vh',fontSize:'1.3vh',color:'rgba(255,255,255,0.6)',marginBottom:'1.5vh'}}>you@yourbrand.com</div>
          <div style={{background:'#00C853',borderRadius:'1.4vh',padding:'1.5vh',textAlign:'center',marginBottom:'4vh'}}>
            <span style={{fontSize:'1.4vh',fontWeight:700,color:'#021208'}}>Send reset code</span>
          </div>
          {/* Step 2 preview */}
          <div style={{background:'rgba(0,200,83,0.06)',border:'0.15vh solid rgba(0,200,83,0.15)',borderRadius:'1.2vh',padding:'1.5vh'}}>
            <div style={{fontSize:'1.1vh',color:'rgba(0,200,83,0.8)',fontWeight:600,marginBottom:'0.8vh'}}>NEXT STEP</div>
            <div style={{fontSize:'1.2vh',color:'rgba(255,255,255,0.5)'}}>Enter the 6-digit code + your new password</div>
          </div>
        </div>
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>FORGOT PASSWORD</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>06 / 19</span>
      </div>
    </div>
  );
}
