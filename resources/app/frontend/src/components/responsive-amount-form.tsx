import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, Wallet } from 'lucide-react';
import { AmountForm } from './amount-form';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { useWallet } from '@/hooks/use-wallet';
import { connectWallet } from '@/lib/wallet';
const mobile = window.matchMedia('(max-width: 600px)');
const subscribe = (listener: () => void) => { mobile.addEventListener('change', listener); return () => mobile.removeEventListener('change', listener); };
export function ResponsiveAmountForm({ mode = 'pool' }: { mode?: 'pool' | 'energy' | 'upgrade' }) {
  const isMobile = useSyncExternalStore(subscribe, () => mobile.matches), wallet = useWallet();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [wallet.address, wallet.revision]);
  const title = mode === 'pool' ? '开通矿池' : mode === 'energy' ? '投入能量' : '进入升级舱';
  if (!isMobile) return <AmountForm mode={mode} />;
  return <div className="rx-amount-entry">
    <p>{wallet.authenticated ? '输入数量，查看详情后确认操作。' : '连接钱包后，可查看余额并进行操作。'}</p>
    <Button className="rx-full" data-open-amount={mode} onClick={() => wallet.authenticated ? setOpen(true) : connectWallet()}>
      {wallet.authenticated ? title : '连接钱包'}{wallet.authenticated ? <ArrowUpRight /> : <Wallet />}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent placement="bottom" className="rx-amount-sheet">
      <span className="rx-sheet-handle" aria-hidden="true" /><DialogTitle className="rx-dialog-title">{title}</DialogTitle>
      <DialogDescription className="rx-note">先核对数量和规则，再确认提交。</DialogDescription>
      <AmountForm mode={mode} />
    </DialogContent></Dialog>
  </div>;
}
