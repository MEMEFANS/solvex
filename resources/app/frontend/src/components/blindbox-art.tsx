import './blindbox.css';

export type BoxPhase = 'closed' | 'waiting' | 'opening' | 'opened';

export function BlindBoxArt({ phase, onSkip }: { phase: BoxPhase; onSkip: () => void }) {
  return <div className={'svx-mystery-art is-' + phase} data-box-phase={phase}>
    <div className="svx-mystery-illustration svx-box-rig">
      <span className="svx-mystery-ground" aria-hidden="true" />
      <img className="svx-box-frame svx-box-frame-body" src="/assets/blindbox/svx-cube-body-v4.webp" width="600" height="732" alt="正面、侧面和顶面印有原版 SVX 标志的彩色正方体盲盒" decoding="async" />
      <div className="svx-box-frame svx-box-frame-lid" aria-hidden="true">
        <img src="/assets/blindbox/svx-cube-lid-v5.webp" width="600" height="732" alt="" decoding="async" />
        <svg className="svx-cube-lid-logo" viewBox="0 0 600 732" fill="none"><defs><filter id="svx-cube-logo-edge" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius=".7" result="outline" /><feFlood floodColor="#fff" floodOpacity=".9" /><feComposite in2="outline" operator="in" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs><g transform="translate(299 125) rotate(-3)" filter="url(#svx-cube-logo-edge)"><svg x="-77" y="-76" width="154" height="152" viewBox="54 87 132 134"><image href="/assets/brand/logo.svg" x="40" y="75" width="160" height="160" /></svg></g></svg>
      </div>
      <span className="svx-mystery-light" aria-hidden="true" />
      <span className="svx-mystery-token" aria-hidden="true"><img src="/assets/brand/logo.svg" alt="" width="44" height="44" /></span>
    </div>
    <span className="svx-mystery-spark spark-one" aria-hidden="true" />
    <span className="svx-mystery-spark spark-two" aria-hidden="true" />
    <span className="svx-mystery-spark spark-three" aria-hidden="true" />
    {phase === 'opening' && <button type="button" className="svx-mystery-skip" onClick={onSkip}>跳过动画</button>}
  </div>;
}
