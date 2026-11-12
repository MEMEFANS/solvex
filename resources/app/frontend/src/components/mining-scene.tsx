import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Pause, Pickaxe, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import './toy-mining-scene.css';

type Tier = 'copper' | 'silver' | 'gold';
type Props = {
  authenticated: boolean;
  counts: Record<Tier, number>;
  activeCount: number;
  loading: boolean;
  error: boolean;
  onConnect: () => void;
};
const regions = [
  // These foot pivots and impact points are registered to toy-cavern-v2.
  { tier: 'copper', title: '铜矿', x: '15%', y: '68%', impactX: '22.4%', impactY: '55.9%', delay: '0ms' },
  { tier: 'silver', title: '银矿', x: '44.5%', y: '68%', impactX: '51.9%', impactY: '55.9%', delay: '-370ms' },
  { tier: 'gold', title: '金矿', x: '72.5%', y: '68%', impactX: '79.9%', impactY: '55.9%', delay: '-760ms' },
] as const;

export function MiningScene({ authenticated, counts, activeCount, loading, error, onConnect }: Props) {
  const root = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [selected, setSelected] = useState<Tier | null>(null);
  const preview = !authenticated || (!loading && !error && activeCount === 0);
  const mode = loading ? 'loading' : error ? 'error' : preview ? 'preview' : 'active';
  const hasWorkers = !loading && !error && (preview || Object.values(counts).some(count => count > 0));

  useEffect(() => {
    let inView = true;
    const update = () => setVisible(inView && !document.hidden);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? true;
      update();
    }, { rootMargin: '80px' });
    if (root.current) observer?.observe(root.current);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);

  return <section ref={root} className="rx-cavern" data-mining-scene data-scene-state="sprite" data-scene-style="toy" data-scene-mode={mode} data-active-pools={activeCount} data-animation-running={hasWorkers && visible && !paused} aria-label="铜银金地下矿场">
    <header className="rx-cavern-heading">
      <div className="rx-cavern-title"><span className="rx-cavern-icon"><Pickaxe size={20} /></span><div><h2>地下矿场</h2><p>铜 · 银 · 金，探索你的矿藏</p></div></div>
      <div className="rx-cavern-tools">
        <span className={'rx-cavern-state is-' + mode}><i />{loading ? '同步矿池状态' : error ? '状态暂不可用' : preview ? '动画预览' : activeCount + ' 份矿池运行中'}</span>
        {hasWorkers && <button type="button" className="rx-cavern-toggle" onClick={() => setPaused(value => !value)} aria-pressed={paused} aria-label={paused ? '播放矿工动画' : '暂停矿工动画'} title={paused ? '播放动画' : '暂停动画'}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>}
      </div>
    </header>
    <div className="rx-cavern-viewport" role="region" aria-label="完整矿场全景，铜银金三个矿区同时显示">
      <div className="rx-cavern-stage">
        <img className="rx-cavern-background" src="/assets/mining/toy-cavern-v2.webp" width={2048} height={1152} alt="紫蓝晶石点亮连通的地下洞穴，铜矿、银矿、金矿沿矿车轨道依次分布" decoding="async" fetchPriority="high" draggable={false} />
        <span className="rx-cavern-motes" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
        {regions.map(region => {
          const working = hasWorkers && (preview || counts[region.tier] > 0);
          const position = { '--miner-x': region.x, '--miner-y': region.y, '--impact-x': region.impactX, '--impact-y': region.impactY, '--miner-delay': region.delay } as CSSProperties;
          return <div key={region.tier} className={'rx-cavern-region is-' + region.tier} data-mine-tier={region.tier} data-working={working} data-selected={selected === region.tier} style={position}>
            {working && <><span className="rx-cavern-shadow" aria-hidden="true" /><span className="rx-cavern-worker" role="img" aria-label={region.title + (preview ? '演示矿工挥镐挖矿' : '矿工挥镐挖矿')} /><span className="rx-cavern-impact" aria-hidden="true"><i /><i /><i /><i /><b /></span></>}
            <div className="rx-cavern-label"><i /><strong>{region.title}</strong><span>{loading ? '同步中' : error ? '状态未知' : preview ? '动画预览' : counts[region.tier] ? counts[region.tier] + ' 份运行中' : '待开通'}</span></div>
          </div>;
        })}
      </div>
    </div>
    <nav className="rx-cavern-zones" aria-label="选择矿区">{regions.map(region => <button key={region.tier} type="button" data-tone={region.tier} aria-pressed={selected === region.tier} onClick={() => setSelected(region.tier)}><span className="rx-cavern-zone-gem" aria-hidden="true" /><span><strong>{region.title}区</strong><small>{loading ? '同步中' : error ? '状态未知' : preview ? '预览矿工' : counts[region.tier] ? counts[region.tier] + ' 份运行中' : '等待开通'}</small></span><ArrowUpRight size={15} /></button>)}</nav>
    <footer className="rx-cavern-footer">
      <p>{preview ? '当前为动画预览，投入矿池后矿工按档位入场。' : error ? '暂时无法读取持仓，请重试同步。' : loading ? '正在读取矿池持仓…' : '矿工按有效持仓进场，每个矿区一名。'}<small>场景仅供展示，收益以账单为准。</small></p>
      {!authenticated && <Button variant="outline" onClick={onConnect}>连接钱包 <ArrowUpRight size={15} /></Button>}
    </footer>
  </section>;
}
