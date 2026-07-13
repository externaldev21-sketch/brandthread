export default function Slide18ModeSwitcher() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#0D0D0D',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(0,200,83,0.1),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(0,200,83,0.07) 0%, transparent 55%)'}} />
      <div style={ph}>
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        {/* Mode switcher bar */}
        <div style={{padding:'1vh 3vh',background:'#0E0E0E',borderBottom:'0.1vh solid #1E1E1E',display:'flex',justifyContent:'center',flexShrink:0}}>
          <div style={{background:'#1A1A1A',borderRadius:'10vh',padding:'0.35vh',display:'flex'}}>
            <div style={{borderRadius:'10vh',padding:'0.7vh 2.2vh',background:'transparent'}}>
              <span style={{fontSize:'1.1vh',fontWeight:600,color:'#555'}}>🛍  Shopping</span>
            </div>
            <div style={{borderRadius:'10vh',padding:'0.7vh 2.2vh',background:'#00C853'}}>
              <span style={{fontSize:'1.1vh',fontWeight:600,color:'#000'}}>🏷  My Brand</span>
            </div>
          </div>
        </div>
        {/* Dashboard content */}
        <div style={{flex:1,overflow:'hidden',padding:'2vh 3vh 0'}}>
          {/* Header */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'2vh'}}>
            <div>
              <div style={{fontSize:'1.8vh',fontWeight:800,color:'#FFF',letterSpacing:'-0.02em'}}>Noir Collective</div>
              <div style={{fontSize:'1.1vh',color:'rgba(0,200,83,0.8)',fontWeight:600}}>Active • Seller Dashboard</div>
            </div>
            <div style={{width:'4.5vh',height:'4.5vh',borderRadius:'50%',background:'linear-gradient(135deg,#00C853,#39FF88)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <span style={{fontSize:'1.8vh',fontWeight:800,color:'#000'}}>NC</span>
            </div>
          </div>
          {/* Stats row */}
          <div style={{display:'flex',gap:'1.2vh',marginBottom:'2vh'}}>
            {[{v:'$2.4K',l:'Revenue'},{v:'18',l:'Orders'},{v:'412',l:'Visitors'}].map(s => (
              <div key={s.l} style={{flex:1,background:'#171717',borderRadius:'1.2vh',padding:'1.2vh',border:'0.1vh solid #222'}}>
                <div style={{fontSize:'2vh',fontWeight:800,color:'#FFF',letterSpacing:'-0.02em'}}>{s.v}</div>
                <div style={{fontSize:'1vh',color:'rgba(255,255,255,0.35)',marginTop:'0.3vh'}}>{s.l}</div>
              </div>
            ))}
          </div>
          {/* Recent orders */}
          <div style={{fontSize:'1.2vh',fontWeight:700,color:'rgba(255,255,255,0.6)',marginBottom:'1.2vh',letterSpacing:'0.05em'}}>RECENT ORDERS</div>
          {[{n:'Jordan M.',s:'Shipped',a:'$89'},{ n:'Aisha K.',s:'Processing',a:'$134'},{n:'Ryo T.',s:'Delivered',a:'$62'}].map(o => (
            <div key={o.n} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.2vh 0',borderBottom:'0.1vh solid #1A1A1A'}}>
              <div>
                <div style={{fontSize:'1.2vh',fontWeight:600,color:'#FFF'}}>{o.n}</div>
                <div style={{fontSize:'1vh',color: o.s==='Shipped'?'#00C853':o.s==='Processing'?'#F59E0B':'rgba(255,255,255,0.4)'}}>{o.s}</div>
              </div>
              <span style={{fontSize:'1.3vh',fontWeight:700,color:'#FFF'}}>{o.a}</span>
            </div>
          ))}
        </div>
        {/* Tab bar */}
        <div style={{height:'7vh',background:'#131513',borderTop:'0.1vh solid #232823',display:'flex',alignItems:'center',justifyContent:'space-around',flexShrink:0}}>
          {[{i:'⌂',l:'Dashboard',a:true},{i:'◻',l:'Products',a:false},{i:'',l:'Feed',center:true},{i:'≡',l:'More',a:false},{i:'◯',l:'Profile',a:false}].map((t:any) => (
            <div key={t.l} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'0.3vh',opacity: t.a ? 1 : 0.4}}>
              {t.center
                ? <div style={{background:'linear-gradient(135deg,#39FF88,#00C853)',borderRadius:'10vh',padding:'0.4vh 1.5vh'}}><span style={{fontSize:'1vh',fontWeight:700,color:'#FFF'}}>Feed</span></div>
                : <><span style={{fontSize:'1.6vh',color: t.a ? '#00C853' : '#6E7A72'}}>{t.i}</span><span style={{fontSize:'0.9vh',color: t.a ? '#00C853' : '#6E7A72'}}>{t.l}</span></>
              }
            </div>
          ))}
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>SELLER DASHBOARD + MODE SWITCHER</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>18 / 19</span>
      </div>
    </div>
  );
}
