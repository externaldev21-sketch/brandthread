import crypto from "node:crypto";
import type { Request, Response } from "express";

/**
 * Public copyright / trademark / counterfeit notice page (App Store 5.2 and
 * DMCA-style process). No account or app is needed: a rights holder fills in
 * the form and it creates an ip_case through the public POST /api/ip-cases
 * intake, which returns a case reference and a private status code.
 *
 * Served as static HTML like the shared-profile landing page. A per-request
 * nonce lets the single inline script run under a locked-down CSP.
 */
export const IP_NOTICE_PATHS = ["/legal/ip-notice", "/dmca"] as const;

const SUPPORT_EMAIL = "legal@brandthread.app";

export function renderIpNoticePage(nonce: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Report IP infringement - Brandthread</title>
<meta name="description" content="Report copyright, trademark or counterfeit listings on Brandthread.">
<style>
*{box-sizing:border-box}
:root{--bg:#fff;--fg:#0a0a0a;--muted:#5c5c5c;--line:#d4d4d4;--card:#f5f5f5;--err:#b00020}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#f5f5f5;--muted:#a3a3a3;--line:#2e2e2e;--card:#151515;--err:#ff6b6b}}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:1.5}
main{max-width:560px;margin:0 auto;padding:32px 16px 64px}
.brand{font-weight:700;letter-spacing:.08em;font-size:14px;margin:0 0 32px}
h1{font-size:28px;line-height:1.2;margin:0 0 12px}
h2{font-size:18px;margin:32px 0 8px}
p{margin:0 0 12px;color:var(--muted)}
ul{margin:0 0 12px;padding-left:20px;color:var(--muted)}
li{margin-bottom:6px}
label{display:block;font-weight:600;font-size:14px;margin:20px 0 6px}
input,select,textarea{width:100%;font:inherit;font-size:16px;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}
input,select{height:48px}
textarea{min-height:120px;resize:vertical}
input:focus,select:focus,textarea:focus,button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.check{display:flex;gap:12px;align-items:flex-start;margin:16px 0 0}
.check input{width:22px;height:22px;flex:none;margin:2px 0 0;padding:0;accent-color:var(--fg)}
.check span{color:var(--muted);font-size:14px}
button{width:100%;height:52px;margin-top:28px;font:inherit;font-weight:600;color:var(--bg);background:var(--fg);border:0;border-radius:12px;padding:0 16px;cursor:pointer}
button[disabled]{opacity:.5;cursor:default}
.error{color:var(--err);font-size:14px;margin:16px 0 0;min-height:0}
.done{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-top:8px}
.done dt{font-size:12px;color:var(--muted);margin-top:12px}
.done dd{margin:2px 0 0;font-weight:600;word-break:break-all}
[hidden]{display:none!important}
a{color:var(--fg)}
</style></head>
<body><main>
<p class="brand">BRANDTHREAD</p>
<div id="formView">
<h1>Report IP infringement</h1>
<p>Only a rights holder or an authorized agent may submit this notice. We review every notice, may ask for more information, and remove listings that infringe.</p>
<form id="notice" novalidate>
<label for="claimantName">Full name</label>
<input id="claimantName" name="claimantName" autocomplete="name" maxlength="200" required>
<label for="claimantEmail">Contact email</label>
<input id="claimantEmail" name="claimantEmail" type="email" autocomplete="email" maxlength="200" required>
<label for="claimantContact">Phone or postal address</label>
<input id="claimantContact" name="claimantContact" autocomplete="street-address" maxlength="500">
<label for="rightsType">Type of report</label>
<select id="rightsType" name="rightsType" required>
<option value="copyright">Copyright</option>
<option value="trademark">Trademark</option>
<option value="counterfeit">Counterfeit</option>
<option value="other">Other rights</option>
</select>
<label for="listingUrl">Link to the listing or content</label>
<input id="listingUrl" name="listingUrl" type="url" inputmode="url" placeholder="https://" maxlength="2048" required>
<label for="description">Your rights and how this infringes them</label>
<textarea id="description" name="description" maxlength="10000" required></textarea>
<label for="evidence">Evidence links (one per line)</label>
<textarea id="evidence" name="evidence" maxlength="8000"></textarea>
<div class="check"><input id="goodFaith" type="checkbox"><span>I have a good-faith belief that this use is not authorized by the rights owner, its agent or the law.</span></div>
<div class="check"><input id="accuracy" type="checkbox"><span>The information in this notice is accurate, and under penalty of perjury I am the rights owner or authorized to act for them.</span></div>
<label for="signature">Electronic signature (full name)</label>
<input id="signature" name="signature" autocomplete="name" maxlength="200" required>
<p class="error" id="error" role="alert" hidden></p>
<button id="submit" type="submit">Submit notice</button>
</form>
<h2>What happens next</h2>
<ul>
<li>We review the notice, usually within 24 hours, and may contact you for more information.</li>
<li>If the listing infringes, we take it down and notify the seller, who can file a counter-notice.</li>
<li>Sellers who are taken down repeatedly are flagged under our repeat-infringer policy and can lose their account.</li>
</ul>
<p>Submitting a false notice can have legal consequences. Questions: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
</div>
<div id="doneView" hidden>
<h1>Notice received</h1>
<p>Keep these details. The access code is the only way to check this case later.</p>
<dl class="done">
<dt>Case reference</dt><dd id="doneRef"></dd>
<dt>Access code</dt><dd id="doneToken"></dd>
</dl>
</div>
</main>
<script nonce="${nonce}">
(function(){
var form=document.getElementById('notice'),err=document.getElementById('error'),btn=document.getElementById('submit');
function show(m){err.textContent=m;err.hidden=false}
function v(id){return document.getElementById(id).value.trim()}
form.addEventListener('submit',function(e){
e.preventDefault();err.hidden=true;
var email=v('claimantEmail');
if(!v('claimantName')||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){return show('Enter your name and a valid email.')}
if(!/^https?:\\/\\//i.test(v('listingUrl'))){return show('Enter the full link to the listing, starting with https://')}
if(v('description').length<20){return show('Describe your rights in at least 20 characters.')}
var evidence=v('evidence').split(/\\n|,/).map(function(x){return x.trim()}).filter(Boolean);
for(var i=0;i<evidence.length;i++){if(!/^https?:\\/\\//i.test(evidence[i])){return show('Each evidence link must start with https://')}}
if(!document.getElementById('goodFaith').checked||!document.getElementById('accuracy').checked){return show('Confirm both statements to submit.')}
if(v('signature').length<2){return show('Type your full name as your signature.')}
btn.disabled=true;
fetch('/api/ip-cases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
channel:'web_notice',claimantName:v('claimantName'),claimantEmail:email,claimantContact:v('claimantContact')||undefined,
rightsType:v('rightsType'),listingUrl:v('listingUrl'),description:v('description'),evidenceReferences:evidence,
goodFaithStatement:true,accuracyStatement:true,signature:v('signature')})})
.then(function(r){return r.json().then(function(b){return{ok:r.ok,b:b}})})
.then(function(res){
if(!res.ok){btn.disabled=false;return show((res.b&&res.b.error)||'We could not submit this notice. Try again.')}
document.getElementById('doneRef').textContent=res.b.caseReference;
document.getElementById('doneToken').textContent=res.b.statusToken;
document.getElementById('formView').hidden=true;document.getElementById('doneView').hidden=false;window.scrollTo(0,0);
})
.catch(function(){btn.disabled=false;show('Check your connection and try again.')});
});
})();
</script>
</body></html>`;
}

export function ipNoticePage(_req: Request, res: Response): void {
  const nonce = crypto.randomBytes(16).toString("base64");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
  res.type("html").send(renderIpNoticePage(nonce));
}
