export default function Slide16BuyerCompletion() {
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
        <div style={{flex:1,overflow:'hidden',padding:'3vh 3.5vh 0',display:'flex',flexDirection:'column',alignItems:'center'}}>
          <div style={{fontSize:'5vh',marginBottom:'2.5vh'}}>🎉</div>
          <div style={{fontSize:'2.4vh',fontWeight:800,color:'#FFF',letterSpacing:'-0.03em',textAlign:'center',marginBottom:'1.5vh',lineHeight:1.2}}>Your Brandthread is ready.</div>
          <div style={{fontSize:'1.2vh',color:'rgba(255,255,255,0.45)',textAlign:'center',lineHeight:1.5,marginBottom:'3vh'}}>Discover brands, track your orders, and follow the drops that match your taste.</div>
          <div style={{width:'100%',display:'flex',flexDirection:'column',gap:'1.2vh',marginBottom:'3vh'}}>
            {['Personalised brand feed','Order tracking','Wishlist & collections','Chat with brands'].map(f => (
              <div key={f} style={{display:'flex',alignItems:'center',gap:'1.2vh'}}>
                <span style={{fontSize:'1.4vh',color:'#00C853',fontWeight:700}}>✓</span>
                <span style={{fontSize:'1.3vh',color:'rgba(255,255,255,0.75)',fontWeight:500}}>{f}</span>
              </div>
            ))}
          </div>
          <div style={{width:'100%',background:'#00C853',borderRadius:'1.4vh',padding:'1.5vh',display:'flex',alignItems:'center',justifyContent:'center',gap:'1vh',marginTop:'auto'}}>
            <span style={{fontSize:'1.4vh',fontWeight:700,color:'#021208'}}>Start exploring</span>
            <span style={{fontSize:'1.4vh',color:'#021208'}}>→</span>
          </div>
        </div>
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>BUYER COMPLETION</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>16 / 19</span>
      </div>
    </div>
  );
}
