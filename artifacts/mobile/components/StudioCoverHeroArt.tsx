/**
 * StudioCoverHeroArt.tsx — premium "dark studio, chrome hero object" cover
 * art, per Dev's direct feedback that the icon-on-gradient covers read as
 * cheap: "I wanted you to do a cover screen for each one, a way better
 * one... like album covers or Apple product-launch hero art... dark
 * studio, chrome/silver/black 3D objects with real lighting, reflections,
 * depth of field and grain, one hero object per card."
 *
 * This environment has no image-generation tool available and no way to
 * verify a real-time Skia shader render (Skia is unavailable both in Expo
 * Go and, without this app ever calling `LoadSkiaWeb()`, on the web build
 * this repo's own Playwright workflow uses — see lib/skiaAvailability.ts).
 * Dev's own brief named a second option for exactly this case: "or with
 * real-time Skia shaders + lighting if that looks better" — so this is
 * built the same way every other cover in this app is (code-drawn
 * react-native-svg gradients, no bitmap assets, zero licensing risk, and
 * fully verifiable in this repo's existing web screenshot workflow) rather
 * than attempting a literal photoreal asset pipeline this environment
 * can't actually produce or check.
 *
 * Per Dev's own checkpoint ask ("before building all 16, send me 3
 * finished covers... I'll review them before you do the rest"), only
 * THREE cards get real hero art so far: add-product, go-live, payouts.
 * `getCoverHeroArt` returns null for every other id, so those 13 cards are
 * untouched pending sign-off on this direction. Motion on top of this art
 * (parallax, settle light-sweep, one-shot object animation) is deliberately
 * NOT built yet either — no sense animating art that might still change.
 */
import React from 'react';
import Svg, {
  Defs, LinearGradient as SvgLinearGradient, RadialGradient, Stop,
  Mask, Rect, Ellipse, Circle, Path, G,
} from 'react-native-svg';

const W = 393;
const H = 520;

/** One shared metallic gradient def — alternating light/dark bands, the
 *  standard flat-art trick for reading as "chrome" (a polished surface
 *  reflecting a striped environment) without a real raytraced render. */
function ChromeDefs() {
  return (
    <Defs>
      <SvgLinearGradient id="chromeV" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0%" stopColor="#000000" />
        <Stop offset="18%" stopColor="#f2f2f2" />
        <Stop offset="34%" stopColor="#7a7a7a" />
        <Stop offset="50%" stopColor="#ffffff" />
        <Stop offset="66%" stopColor="#4d4d4d" />
        <Stop offset="82%" stopColor="#d8d8d8" />
        <Stop offset="100%" stopColor="#000000" />
      </SvgLinearGradient>
      <SvgLinearGradient id="chromeH" x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0%" stopColor="#000000" />
        <Stop offset="22%" stopColor="#e8e8e8" />
        <Stop offset="40%" stopColor="#6b6b6b" />
        <Stop offset="55%" stopColor="#ffffff" />
        <Stop offset="72%" stopColor="#3d3d3d" />
        <Stop offset="88%" stopColor="#c8c8c8" />
        <Stop offset="100%" stopColor="#000000" />
      </SvgLinearGradient>
      <RadialGradient id="studioGlow" cx="50%" cy="20%" r="65%">
        <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.24} />
        <Stop offset="45%" stopColor="#ffffff" stopOpacity={0.08} />
        <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
      </RadialGradient>
      <SvgLinearGradient id="floorFade" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0%" stopColor="#ffffff" stopOpacity={0} />
        <Stop offset="100%" stopColor="#ffffff" stopOpacity={0.4} />
      </SvgLinearGradient>
      <SvgLinearGradient id="reflFade" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.22} />
        <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
      </SvgLinearGradient>
      <Mask id="reflMask">
        <Rect x={0} y={0} width={W} height={H} fill="url(#reflFade)" />
      </Mask>
    </Defs>
  );
}

/** Deep black studio backdrop with a soft overhead "softbox" glow and a
 *  faint reflective floor plane — the majestic, less-flat replacement for
 *  the old plain diagonal gradient. Grain (StudioCoverGrain) still layers
 *  on top of this from the parent, unchanged. */
function StudioStage({ children, floorY = 340 }: { children: React.ReactNode; floorY?: number }) {
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
      <ChromeDefs />
      <Rect x={0} y={0} width={W} height={H} fill="#020202" />
      <Rect x={0} y={0} width={W} height={H} fill="url(#studioGlow)" />
      <Rect x={0} y={floorY} width={W} height={H - floorY} fill="url(#floorFade)" opacity={0.5} />
      {children}
    </Svg>
  );
}

/** Add product — a chrome garment on a hanger over a pedestal, per Dev's
 *  own example ("a chrome garment on a hanger/pedestal"). */
function AddProductChromeCover() {
  const cx = W / 2;
  return (
    <StudioStage>
      <G>
        {/* hanger */}
        <Path d={`M${cx - 26},128 Q${cx},98 ${cx + 26},128`} stroke="url(#chromeH)" strokeWidth={4} fill="none" strokeLinecap="round" />
        <Circle cx={cx} cy={94} r={6} fill="url(#chromeV)" />
        {/* garment body */}
        <Path
          d={`M${cx - 70},150 L${cx - 30},128 L${cx - 12},142 L${cx + 12},142 L${cx + 30},128 L${cx + 70},150
              L${cx + 54},190 L${cx + 40},178 L${cx + 40},300 L${cx - 40},300 L${cx - 40},178 L${cx - 54},190 Z`}
          fill="url(#chromeV)"
        />
        {/* center seam highlight */}
        <Path d={`M${cx},142 L${cx},300`} stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1.5} />
        {/* pedestal */}
        <Ellipse cx={cx} cy={332} rx={64} ry={10} fill="url(#chromeH)" opacity={0.9} />
        <Rect x={cx - 46} y={310} width={92} height={24} fill="url(#chromeV)" opacity={0.9} />
      </G>
      {/* floor reflection */}
      <G transform={`translate(0, ${2 * 336}) scale(1, -1)`} mask="url(#reflMask)" opacity={0.5}>
        <Ellipse cx={cx} cy={332} rx={64} ry={10} fill="url(#chromeH)" />
        <Rect x={cx - 46} y={310} width={92} height={24} fill="url(#chromeV)" />
      </G>
    </StudioStage>
  );
}

/** Go Live — a chrome broadcast camera with ONE restrained red tally
 *  light that belongs to the housing, replacing the old floating red dot
 *  badge Dev called out as "half-ass". */
function GoLiveChromeCover() {
  const cx = W / 2;
  const cy = 190;
  return (
    <StudioStage>
      <G>
        {/* body */}
        <Rect x={cx - 62} y={cy - 34} width={124} height={68} rx={14} fill="url(#chromeH)" />
        {/* lens barrel */}
        <Circle cx={cx + 20} cy={cy} r={46} fill="url(#chromeV)" />
        <Circle cx={cx + 20} cy={cy} r={30} fill="#050505" />
        <Circle cx={cx + 20} cy={cy} r={30} stroke="url(#chromeV)" strokeWidth={3} fill="none" />
        <Circle cx={cx + 8} cy={cy - 12} r={7} fill="#ffffff" opacity={0.5} />
        {/* top handle */}
        <Path d={`M${cx - 30},${cy - 34} L${cx - 22},${cy - 58} L${cx + 6},${cy - 58} L${cx + 2},${cy - 34}`} fill="url(#chromeH)" />
        {/* the one restrained tally light — small, on the housing, off by default look but rendered lit since this is the Go Live card */}
        <Circle cx={cx - 46} cy={cy - 20} r={5} fill="#ff3b30" />
        <Circle cx={cx - 46} cy={cy - 20} r={9} fill="#ff3b30" opacity={0.25} />
        {/* soft contact shadow, right under the body — a floating product-shot
            look rather than a disconnected pedestal disc */}
        <Ellipse cx={cx} cy={cy + 58} rx={68} ry={9} fill="#000000" opacity={0.6} />
      </G>
      <G transform={`translate(0, ${2 * (cy + 58)}) scale(1, -1)`} mask="url(#reflMask)" opacity={0.5}>
        <Rect x={cx - 62} y={cy - 34} width={124} height={68} rx={14} fill="url(#chromeH)" />
        <Circle cx={cx + 20} cy={cy} r={46} fill="url(#chromeV)" />
      </G>
    </StudioStage>
  );
}

/** Payouts — stacked chrome coins, per Dev's own example. */
function PayoutsChromeCover() {
  const cx = W / 2;
  const coinYs = [300, 272, 244, 216, 188];
  return (
    <StudioStage>
      <G>
        {coinYs.map((y, i) => (
          <G key={i}>
            <Rect x={cx - 52} y={y} width={104} height={18} fill="url(#chromeH)" />
            <Ellipse cx={cx} cy={y} rx={52} ry={12} fill="url(#chromeV)" />
            <Ellipse cx={cx} cy={y} rx={38} ry={8} fill="none" stroke="#ffffff" strokeOpacity={0.3} strokeWidth={1} />
          </G>
        ))}
        <Ellipse cx={cx} cy={coinYs[coinYs.length - 1]} rx={52} ry={12} fill="url(#chromeV)" />
        <Ellipse cx={cx} cy={coinYs[coinYs.length - 1]} rx={38} ry={8} fill="none" stroke="#ffffff" strokeOpacity={0.4} strokeWidth={1.2} />
        <Ellipse cx={cx} cy={332} rx={74} ry={10} fill="url(#chromeH)" opacity={0.6} />
      </G>
      <G transform={`translate(0, ${2 * 336}) scale(1, -1)`} mask="url(#reflMask)" opacity={0.45}>
        {coinYs.map((y, i) => (
          <Ellipse key={i} cx={cx} cy={y} rx={52} ry={12} fill="url(#chromeV)" />
        ))}
      </G>
    </StudioStage>
  );
}

const COVER_HERO_ART: Record<string, React.ComponentType> = {
  'add-product': AddProductChromeCover,
  'go-live': GoLiveChromeCover,
  'payouts': PayoutsChromeCover,
};

/** Returns the premium hero-art component for this card, or null if it
 *  hasn't been redone yet (pending Dev's sign-off on the 3-card
 *  checkpoint) — the caller keeps the plain StudioCoverBackdrop + icon for
 *  every id this returns null for. */
export function getCoverHeroArt(itemId: string): React.ComponentType | null {
  return COVER_HERO_ART[itemId] ?? null;
}

export function StudioCoverHeroArtLayer({ itemId }: { itemId: string }) {
  const Art = getCoverHeroArt(itemId);
  if (!Art) return null;
  return (
    <>
      <Art />
    </>
  );
}
