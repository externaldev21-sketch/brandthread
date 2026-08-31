import React, { useState } from "react";
import { Bell, Bookmark, Check, ChevronRight, Heart, MessageCircle, MoreHorizontal, Play, Search, Share2, ShoppingBag, Sparkles, UserPlus, Users } from "lucide-react";
import "./ThreadPolished.css";

type Post = { id: number; brand: string; handle: string; initials: string; tone: string; caption: string; product: string; price: string; likes: string; comments: string; variant?: string };

const posts: Post[] = [
  { id: 1, brand: "Morrow Studio", handle: "@morrow.studio", initials: "MS", tone: "#d47d59", caption: "Soft structure for the days that start too early.", product: "Linen wrap jacket", price: "$168", likes: "1,248", comments: "84" },
  { id: 2, brand: "North / Form", handle: "@northform", initials: "NF", tone: "#799b88", caption: "The Field Tote, made for the long way home.", product: "Canvas field tote", price: "$92", likes: "836", comments: "41", variant: "two" },
];

export default function ThreadPolished() {
  const [active, setActive] = useState("Thread");
  const [liked, setLiked] = useState<number[]>([]);
  const [saved, setSaved] = useState<number[]>([]);
  const [following, setFollowing] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 1800);
  };
  const toggle = (list: number[], id: number, setter: (value: number[]) => void, message: string) => {
    setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    flash(message);
  };

  return (
    <main className="thread-polished min-h-[100dvh] flex justify-center">
      <section className="relative w-full max-w-[430px] overflow-hidden border-x border-[#252322] bg-[#0d0d0d]">
        <header className="sticky top-0 z-20 border-b border-[#252322] bg-[#0d0d0d]/95 px-5 pb-3 pt-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#c8f169] text-[#151710]"><Sparkles size={16} strokeWidth={2.5} /></div>
              <span className="text-[19px] font-black tracking-[-.06em]">brandthread</span>
            </div>
            <div className="flex items-center gap-1">
              <button aria-label="Search" onClick={() => setSearchOpen(!searchOpen)} className="thread-pill rounded-full p-2.5 text-[#aaa49d] hover:bg-[#201f1d] hover:text-[#f5f0e8]"><Search size={19} /></button>
              <button aria-label="Notifications" onClick={() => flash("You’re all caught up")} className="thread-pill relative rounded-full p-2.5 text-[#aaa49d] hover:bg-[#201f1d] hover:text-[#f5f0e8]"><Bell size={19} /><i className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#d47d59]" /></button>
            </div>
          </div>
          {searchOpen && <div className="thread-fade mt-3 flex items-center gap-2 rounded-xl border border-[#34312e] bg-[#171616] px-3 py-2.5"><Search size={15} className="text-[#89837b]" /><input autoFocus placeholder="Search brands, drops, people" className="w-full bg-transparent text-sm text-[#f5f0e8] outline-none placeholder:text-[#6e6a64]" /></div>}
          <nav className="mt-5 flex items-end gap-6">
            {["Thread", "Following"].map(tab => <button key={tab} onClick={() => setActive(tab)} className={`relative pb-1 text-[13px] font-bold ${active === tab ? "text-[#f5f0e8]" : "text-[#77736d]"}`}>{tab}{active === tab && <span className="absolute -bottom-[13px] left-0 h-[2px] w-full bg-[#c8f169]" />}</button>)}
          </nav>
        </header>

        <div className="thread-scroll h-[calc(100dvh-113px)] overflow-y-auto px-4 pb-24 pt-4">
          <div className="mb-5 flex items-center justify-between rounded-2xl border border-[#302d29] bg-[#161715] px-4 py-3.5">
            <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#c8f169]">Your daily edit</p><p className="mt-1 text-[13px] text-[#b3ada5]">New from the brands you follow</p></div>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#242620] text-[#c8f169]"><ChevronRight size={17} /></div>
          </div>
          {posts.map((post, index) => (
            <article key={post.id} className="thread-card thread-fade mb-5 overflow-hidden rounded-[20px]" style={{ animationDelay: `${index * 90}ms` }}>
              <div className={`thread-media ${post.variant ?? ""} thread-grain relative h-[310px]`}>
                <div className="absolute inset-0 flex items-center justify-center"><div className="grid h-16 w-16 place-items-center rounded-full border border-white/45 bg-black/15 text-white backdrop-blur-sm"><Play size={23} fill="white" className="ml-1" /></div></div>
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-[#10110ed9] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[.13em] text-white"><span className="h-1.5 w-1.5 rounded-full bg-[#c8f169]" /> New drop</div>
                <button aria-label="More options" onClick={() => flash("Post options opened")} className="absolute right-3 top-3 rounded-full bg-black/25 p-2 text-white backdrop-blur-sm"><MoreHorizontal size={17} /></button>
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                  <button onClick={() => toggle(following, post.id, setFollowing, following.includes(post.id) ? `Unfollowed ${post.brand}` : `Following ${post.brand}`)} className="flex items-center gap-2 text-left text-white">
                    <span className="grid h-9 w-9 place-items-center rounded-xl text-[11px] font-black text-[#181512]" style={{ backgroundColor: post.tone }}>{post.initials}</span>
                    <span><strong className="block text-[13px]">{post.brand} {following.includes(post.id) && <Check size={12} className="ml-1 inline text-[#c8f169]" />}</strong><small className="text-[11px] text-white/70">{post.handle}</small></span>
                  </button>
                  {!following.includes(post.id) && <button onClick={() => toggle(following, post.id, setFollowing, `Following ${post.brand}`)} className="thread-pill flex items-center gap-1.5 rounded-full border border-white/45 bg-black/20 px-3 py-2 text-[11px] font-bold text-white backdrop-blur-sm"><UserPlus size={13} /> Follow</button>}
                </div>
              </div>
              <div className="p-4">
                <p className="text-[14px] leading-5 text-[#d9d3ca]">{post.caption}</p>
                <button onClick={() => flash(`Opening ${post.product}`)} className="mt-4 flex w-full items-center justify-between rounded-xl border border-[#36322d] bg-[#201e1b] px-3 py-2.5 text-left">
                  <span className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#c8f169] text-[#1b2114]"><ShoppingBag size={15} /></span><span><small className="block text-[10px] uppercase tracking-[.12em] text-[#8e8981]">Shop the post</small><strong className="block text-[12px] text-[#f1ece3]">{post.product}</strong></span></span><span className="text-[13px] font-bold text-[#c8f169]">{post.price}</span>
                </button>
                <div className="mt-4 flex items-center justify-between text-[#8e8981]">
                  <div className="flex gap-4"><button onClick={() => toggle(liked, post.id, setLiked, liked.includes(post.id) ? "Like removed" : "Added to your likes")} className={`flex items-center gap-1.5 text-[11px] ${liked.includes(post.id) ? "text-[#d47d59]" : ""}`}><Heart size={17} fill={liked.includes(post.id) ? "currentColor" : "none"} />{post.likes}</button><button onClick={() => flash("Comments opened")} className="flex items-center gap-1.5 text-[11px]"><MessageCircle size={17} />{post.comments}</button><button onClick={() => flash("Share sheet opened")} className="text-[11px]"><Share2 size={16} /></button></div><button onClick={() => toggle(saved, post.id, setSaved, saved.includes(post.id) ? "Removed from saved" : "Saved for later")} className={`${saved.includes(post.id) ? "text-[#c8f169]" : ""}`} aria-label="Save post"><Bookmark size={17} fill={saved.includes(post.id) ? "currentColor" : "none"} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {notice && <div className="thread-fade absolute bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#f5f0e8] px-4 py-2.5 text-[12px] font-bold text-[#171616] shadow-2xl">{notice}</div>}
        <footer className="absolute bottom-0 left-0 right-0 z-20 flex justify-around border-t border-[#292725] bg-[#111110]/95 px-3 pb-5 pt-3 backdrop-blur-xl">
          {([{ label: "Thread", icon: Sparkles }, { label: "Discover", icon: Search }, { label: "Friends", icon: Users }, { label: "Profile", icon: UserPlus }] as const).map(({ label, icon: Icon }) => <button key={label} onClick={() => { setActive(label); flash(label === "Thread" ? "Back to your thread" : `${label} selected`); }} className={`flex min-w-[56px] flex-col items-center gap-1 text-[10px] font-bold ${active === label ? "text-[#c8f169]" : "text-[#77736d]"}`}><Icon size={19} /><span>{label}</span></button>)}
        </footer>
      </section>
    </main>
  );
}