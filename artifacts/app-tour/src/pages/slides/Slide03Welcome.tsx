export default function Slide03Welcome() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#060A06',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(0,200,83,0.1),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(0,200,83,0.07) 0%, transparent 55%)'}} />
      <div style={ph}>
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        <div style={{flex:1,overflow:'hidden',padding:'2vh 3vh 0'}}>
          {/* Brand row */}
          <div style={{display:'flex',alignItems:'center',gap:'1vh',marginBottom:'4vh'}}>
            <div style={{width:'3.5vh',height:'3.5vh',borderRadius:'0.8vh',background:'#00C853',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <span style={{fontSize:'2vh',fontWeight:800,color:'#FFF'}}>B</span>
            </div>
            <span style={{fontSize:'1.6vh',fontWeight:700,color:'#FFF'}}>Brandthread</span>
          </div>
          {/* Headline */}
          <div style={{marginBottom:'1.5vh'}}>
            <div style={{fontSize:'3.8vh',fontWeight:800,color:'#FFF',lineHeight:1.1,letterSpacing:'-0.03em'}}>Build your</div>
            <div style={{fontSize:'3.8vh',fontWeight:800,color:'#FFF',lineHeight:1.1,letterSpacing:'-0.03em'}}>fashion brand.</div>
          </div>
          <div style={{fontSize:'1.4vh',color:'rgba(255,255,255,0.5)',lineHeight:1.5,marginBottom:'5vh',maxWidth:'80%'}}>The platform built for independent fashion brands and their customers.</div>
          {/* Buttons */}
          <div style={{display:'flex',flexDirection:'column',gap:'1.5vh'}}>
            <div style={{background:'#00C853',borderRadius:'1.4vh',padding:'1.5vh 2vh',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:'1.5vh',fontWeight:700,color:'#021208'}}>Create my account</span>
              <span style={{fontSize:'1.5vh',color:'#021208'}}>→</span>
            </div>
            <div style={{borderRadius:'1.4vh',padding:'1.5vh 2vh',border:'0.15vh solid rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:'1.5vh',fontWeight:600,color:'rgba(255,255,255,0.8)'}}>Sign in</span>
              <span style={{fontSize:'1.5vh',color:'rgba(255,255,255,0.4)'}}>→</span>
            </div>
          </div>
          {/* Bottom note */}
          <div style={{marginTop:'3vh',textAlign:'center'}}>
            <span style={{fontSize:'1.1vh',color:'rgba(255,255,255,0.25)'}}>By continuing, you agree to our Terms &amp; Privacy Policy.</span>
          </div>
        </div>
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>WELCOME</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>03 / 19</span>
      </div>
    </div>
  );
}
