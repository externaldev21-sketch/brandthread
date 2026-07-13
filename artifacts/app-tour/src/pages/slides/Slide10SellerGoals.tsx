export default function Slide10SellerGoals() {
  const ph: React.CSSProperties = {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-55%)',width:'38vh',height:'84vh',borderRadius:'4.5vh',background:'#0E0E0E',border:'0.25vh solid #1A1A1A',overflow:'hidden',boxShadow:'0 0 5vh 0.5vh rgba(74,144,226,0.1),0 3vh 14vh rgba(0,0,0,0.98)',fontFamily:"'Inter',sans-serif",display:'flex',flexDirection:'column'};
  const dot = (active: boolean) => <div style={{height:'0.5vh',flex:1,borderRadius:'0.3vh',background: active ? '#4A90E2' : 'rgba(255,255,255,0.15)'}} />;
  const chip = (label: string, active: boolean) => (
    <div style={{borderRadius:'10vh',paddingTop:'0.8vh',paddingBottom:'0.8vh',paddingLeft:'1.4vh',paddingRight:'1.4vh',border: active ? '0.2vh solid #4A90E2' : '0.15vh solid #333',background: active ? 'rgba(74,144,226,0.12)' : 'transparent',marginBottom:'0.8vh',marginRight:'0.6vh'}}>
      <span style={{fontSize:'1.2vh',fontWeight:500,color: active ? '#4A90E2' : 'rgba(255,255,255,0.6)'}}>{label}</span>
    </div>
  );
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{background:'#030503',fontFamily:"'Inter',sans-serif"}}>
      <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 50% 40%, rgba(74,144,226,0.06) 0%, transparent 55%)'}} />
      <div style={ph}>
        <div style={{position:'absolute',top:'1.6vh',left:'50%',transform:'translateX(-50%)',width:'7vh',height:'1.4vh',background:'#000',borderRadius:'2vh',zIndex:10}} />
        <div style={{height:'4.5vh',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'1.5vh 3vh 0',flexShrink:0}}>
          <span style={{fontSize:'1.2vh',color:'#FFF',fontWeight:700}}>9:41</span>
          <span style={{fontSize:'1vh',color:'rgba(255,255,255,0.7)'}}>■■ ▲ ▮▮</span>
        </div>
        <div style={{padding:'1.5vh 3vh 0',display:'flex',gap:'0.6vh',flexShrink:0}}>
          {dot(true)}{dot(true)}{dot(true)}{dot(false)}{dot(false)}{dot(false)}{dot(false)}{dot(false)}{dot(false)}
        </div>
        <div style={{flex:1,overflow:'hidden',padding:'2.5vh 3vh 0',display:'flex',flexDirection:'column'}}>
          <div style={{fontSize:'2.8vh',fontWeight:800,color:'#FFF',letterSpacing:'-0.03em',marginBottom:'0.5vh'}}>What do you want to accomplish?</div>
          <div style={{fontSize:'1.2vh',color:'rgba(255,255,255,0.45)',marginBottom:'2vh'}}>Pick everything you're focused on.</div>
          <div style={{display:'flex',flexWrap:'wrap'}}>
            {chip('Find manufacturers', true)}
            {chip('Build a website', false)}
            {chip('Design products', true)}
            {chip('Manage drops', true)}
            {chip('Grow my audience', false)}
            {chip('Handle payments', false)}
            {chip('Track inventory', true)}
            {chip('Connect with buyers', false)}
          </div>
          <div style={{marginTop:'1.5vh'}}>
            <div style={{fontSize:'1.4vh',fontWeight:700,color:'#FFF',marginBottom:'1vh'}}>How would you describe your aesthetic?</div>
            <div style={{display:'flex',flexWrap:'wrap'}}>
              {chip('Minimalist', true)}
              {chip('Bold & graphic', false)}
              {chip('Streetwear', true)}
              {chip('Luxury', false)}
              {chip('Techwear', true)}
              {chip('Sustainable', false)}
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:'auto',paddingTop:'1vh'}}>
            <div style={{background:'#4A90E2',borderRadius:'1.4vh',padding:'1.3vh 3.5vh'}}>
              <span style={{fontSize:'1.4vh',fontWeight:700,color:'#FFF'}}>Continue</span>
            </div>
          </div>
        </div>
        <div style={{height:'2.5vh',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <div style={{width:'10vh',height:'0.45vh',background:'rgba(255,255,255,0.3)',borderRadius:'1vh'}} />
        </div>
      </div>
      <div style={{position:'absolute',bottom:'3vh',left:'7vw',right:'7vw',display:'flex',justifyContent:'space-between'}}>
        <span style={{fontSize:'1.5vw',color:'rgba(255,255,255,0.3)',fontWeight:500,letterSpacing:'0.04em'}}>SELLER ONBOARDING — GOALS + AESTHETIC</span>
        <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.18)'}}>10 / 19</span>
      </div>
    </div>
  );
}
