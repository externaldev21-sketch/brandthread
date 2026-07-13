export default function Slide05SignIn() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#0F0F0F',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(0,200,83,0.08),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  const inp: React.CSSProperties = {background:'#252525',borderRadius:'1.2vh',border:'0.15vh solid #2A2A2A',padding:'1.2vh 1.4vh',fontSize:'1.3vh',color:'rgba(255,255,255,0.6)',marginBottom:'1.2vh'};
  const lbl: React.CSSProperties = {fontSize:'1.1vh',color:'rgba(255,255,255,0.45)',fontWeight:600,letterSpacing:'0.04em',marginBottom:'0.5vh',display:'block'};
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(0,200,83,0.06) 0%, transparent 55%)'}} />
      <div style={ph}>
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        <div style={{flex:1,overflow:'hidden',padding:'1.5vh 3vh 0'}}>
          <div style={{fontSize:'1.8vh',color:'rgba(255,255,255,0.4)',marginBottom:'1.5vh'}}>←</div>
          <div style={{display:'flex',alignItems:'center',gap:'1vh',marginBottom:'2.5vh'}}>
            <div style={{width:'3vh',height:'3vh',borderRadius:'0.7vh',background:'#00C853',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <span style={{fontSize:'1.6vh',fontWeight:800,color:'#FFF'}}>B</span>
            </div>
            <span style={{fontSize:'1.4vh',fontWeight:700,color:'#FFF'}}>Brandthread</span>
          </div>
          <div style={{fontSize:'2.8vh',fontWeight:800,color:'#FFF',letterSpacing:'-0.03em',marginBottom:'0.5vh'}}>Welcome back.</div>
          <div style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.4)',marginBottom:'2.5vh'}}>Sign in to continue building your Brandthread.</div>
          {/* OAuth */}
          <div style={{border:'0.15vh solid #333',borderRadius:'1.2vh',padding:'1.2vh',display:'flex',alignItems:'center',justifyContent:'center',gap:'1vh',marginBottom:'1.5vh'}}>
            <span style={{fontSize:'1.5vh'}}>🇬</span>
            <span style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.8)',fontWeight:600}}>Continue with Google</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'1vh',marginBottom:'1.5vh'}}>
            <div style={{flex:1,height:'0.1vh',background:'#333'}} />
            <span style={{fontSize:'1.1vh',color:'rgba(255,255,255,0.3)'}}>or</span>
            <div style={{flex:1,height:'0.1vh',background:'#333'}} />
          </div>
          <span style={lbl}>Email address</span>
          <div style={inp}>you@yourbrand.com</div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5vh'}}>
            <span style={lbl}>Password</span>
            <span style={{fontSize:'1.1vh',color:'#00C853',fontWeight:600}}>Forgot password?</span>
          </div>
          <div style={{...inp,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>••••••••</span><span style={{color:'rgba(255,255,255,0.4)',fontSize:'1.2vh'}}>👁</span>
          </div>
          <div style={{background:'#00C853',borderRadius:'1.4vh',padding:'1.4vh',textAlign:'center',marginTop:'0.5vh',marginBottom:'2vh'}}>
            <span style={{fontSize:'1.4vh',fontWeight:700,color:'#021208'}}>Sign in</span>
          </div>
          <div style={{textAlign:'center'}}>
            <span style={{fontSize:'1.1vh',color:'rgba(255,255,255,0.3)'}}>Don't have an account? </span>
            <span style={{fontSize:'1.1vh',color:'#00C853',fontWeight:600}}>Sign up</span>
          </div>
        </div>
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>SIGN IN</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>05 / 19</span>
      </div>
    </div>
  );
}
