export default function Slide19Settings() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#0D0D0D',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(0,200,83,0.08),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  const row = (icon: string, label: string, danger?: boolean) => (
    <div style={{display:'flex',alignItems:'center',gap:'1.2vh',padding:'1.2vh 1.5vh',borderBottom:'0.1vh solid #1A1A1A'}}>
      <span style={{fontSize:'1.5vh',width:'2.2vh',textAlign:'center'}}>{icon}</span>
      <span style={{flex:1,fontSize:'1.2vh',fontWeight:500,color: danger ? '#EF4444' : 'rgba(255,255,255,0.8)'}}>{label}</span>
      {!danger && <span style={{fontSize:'1.2vh',color:'rgba(255,255,255,0.2)'}}>›</span>}
    </div>
  );
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(0,200,83,0.06) 0%, transparent 55%)'}} />
      <div style={ph}>
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        {/* Header */}
        <div style={{padding:'2vh 3vh 1.5vh',background:'#0D0B08',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
          <span style={{fontSize:'2.2vh',fontWeight:800,color:'#FFF'}}>Settings</span>
          <div style={{width:'2.5vh',height:'2.5vh',borderRadius:'50%',background:'#1A1A1A',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <span style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.6)'}}>✕</span>
          </div>
        </div>
        {/* Search */}
        <div style={{padding:'0 3vh 1.5vh',flexShrink:0}}>
          <div style={{background:'#1A1A1A',borderRadius:'1.2vh',padding:'1vh 1.4vh',display:'flex',alignItems:'center',gap:'1vh'}}>
            <span style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.3)'}}>⌕</span>
            <span style={{fontSize:'1.2vh',color:'rgba(255,255,255,0.3)'}}>Search settings</span>
          </div>
        </div>
        <div style={{flex:1,overflow:'hidden',padding:'0 3vh'}}>
          {/* Account group */}
          <div style={{fontSize:'1.1vh',fontWeight:600,color:'rgba(255,255,255,0.35)',letterSpacing:'0.06em',marginBottom:'0.8vh'}}>ACCOUNT</div>
          <div style={{background:'#141414',borderRadius:'1.2vh',border:'0.1vh solid #222',marginBottom:'2vh',overflow:'hidden'}}>
            {row('◯','Edit profile')}
            {row('◻','Edit brand setup')}
            {row('⊙','Shopping preferences')}
            {row('◈','Account type')}
            {row('⟳','Switch mode')}
          </div>
          {/* App settings */}
          <div style={{fontSize:'1.1vh',fontWeight:600,color:'rgba(255,255,255,0.35)',letterSpacing:'0.06em',marginBottom:'0.8vh'}}>APP SETTINGS</div>
          <div style={{background:'#141414',borderRadius:'1.2vh',border:'0.1vh solid #222',marginBottom:'2vh',overflow:'hidden'}}>
            {row('◎','Push notifications')}
            {row('◻','App icon')}
          </div>
          {/* Danger zone */}
          <div style={{fontSize:'1.1vh',fontWeight:600,color:'rgba(239,68,68,0.6)',letterSpacing:'0.06em',marginBottom:'0.8vh'}}>DANGER ZONE</div>
          <div style={{background:'#141414',borderRadius:'1.2vh',border:'0.1vh solid rgba(239,68,68,0.15)',overflow:'hidden'}}>
            {row('↩','Sign out', true)}
            {row('⊗','Delete account', true)}
          </div>
        </div>
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>SETTINGS</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>19 / 19</span>
      </div>
    </div>
  );
}
